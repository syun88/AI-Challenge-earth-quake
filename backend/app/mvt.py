"""Fast pure-Python Mapbox Vector Tile (MVT v2.1) encoder for building polygons."""

from __future__ import annotations

import math
import struct
from typing import Any

import numpy as np
import pandas as pd
import shapely

MERCATOR_HALF = 20037508.342789244
MVT_EXTENT = 4096


def _encode_varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)


def _encode_zigzag(n: int) -> int:
    return ((n << 1) ^ -1) if n < 0 else (n << 1)


def _pb_varint(field_no: int, val: int) -> bytes:
    return _encode_varint((field_no << 3) | 0) + _encode_varint(val)


def _pb_bytes(field_no: int, data: bytes) -> bytes:
    return _encode_varint((field_no << 3) | 2) + _encode_varint(len(data)) + data


def _pb_packed_uints(field_no: int, vals: list[int]) -> bytes:
    if not vals:
        return b""
    buf = b"".join(_encode_varint(v) for v in vals)
    return _pb_bytes(field_no, buf)


def _pb_value(val: Any) -> bytes:
    if isinstance(val, bool):
        return _pb_varint(7, 1 if val else 0)
    if isinstance(val, int):
        if val >= 0:
            return _pb_varint(4, val)
        return _pb_varint(6, _encode_zigzag(val))
    if isinstance(val, float):
        # MVT Value float_value is field 2, wire type 5 (fixed32 little-endian)
        return _encode_varint((2 << 3) | 5) + struct.pack("<f", val)
    s = str(val)
    return _pb_bytes(1, s.encode("utf-8"))


def tile_bounds_lonlat(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Return (minlon, minlat, maxlon, maxlat) in EPSG:4326 for XYZ tile."""
    n = 1 << z
    minlon = x / n * 360.0 - 180.0
    maxlon = (x + 1) / n * 360.0 - 180.0
    maxlat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / n))))
    minlat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * (y + 1) / n))))
    return minlon, minlat, maxlon, maxlat


def _encode_ring_cmds(xs: np.ndarray, ys: np.ndarray) -> list[int] | None:
    if len(xs) < 4:
        return None
    pts: list[tuple[int, int]] = [(int(xs[0]), int(ys[0]))]
    for j in range(1, len(xs) - 1):
        pt = (int(xs[j]), int(ys[j]))
        if pt != pts[-1]:
            pts.append(pt)
    if len(pts) < 3:
        return None

    # MVT spec v2.1 requires exterior polygon rings to have positive shoelace area
    # (clockwise in screen space where +Y points downward).
    n_pts = len(pts)
    area2 = 0
    for k in range(n_pts):
        x0, y0 = pts[k]
        x1, y1 = pts[(k + 1) % n_pts]
        area2 += x0 * y1 - x1 * y0
    if area2 == 0:
        return None
    if area2 < 0:
        pts.reverse()

    cmds = [
        (1 & 0x7) | (1 << 3),  # MoveTo(1)
        _encode_zigzag(pts[0][0]),
        _encode_zigzag(pts[0][1]),
        (2 & 0x7) | ((n_pts - 1) << 3),  # LineTo(n_pts - 1)
    ]
    px_prev, py_prev = pts[0]
    for xk, yk in pts[1:]:
        cmds.append(_encode_zigzag(xk - px_prev))
        cmds.append(_encode_zigzag(yk - py_prev))
        px_prev, py_prev = xk, yk
    cmds.append((7 & 0x7) | (1 << 3))  # ClosePath(1)
    return cmds


def encode_buildings_mvt(buildings_df: pd.DataFrame, z: int, x: int, y: int) -> bytes:
    """Encode all buildings intersecting XYZ tile (with small buffer) as MVT v2.1 bytes."""
    if z < 0 or z > 22:
        return b""
    n = 1 << z
    if x < 0 or x >= n or y < 0 or y >= n:
        return b""

    minlon, minlat, maxlon, maxlat = tile_bounds_lonlat(z, x, y)
    pad_lon = (maxlon - minlon) * 0.02
    pad_lat = (maxlat - minlat) * 0.02
    sub = buildings_df.cx[
        minlon - pad_lon : maxlon + pad_lon,
        minlat - pad_lat : maxlat + pad_lat,
    ]
    if sub.empty:
        return b""

    tile_w = (2.0 * MERCATOR_HALF) / n
    mx0 = -MERCATOR_HALF + x * tile_w
    my1 = MERCATOR_HALF - y * tile_w
    scale = MVT_EXTENT / tile_w

    ext_rings = shapely.get_exterior_ring(sub.geometry.values)
    coords, ring_idx = shapely.get_coordinates(ext_rings, return_index=True)
    if len(coords) == 0:
        return b""

    mx = coords[:, 0] * (MERCATOR_HALF / 180.0)
    lat_clipped = np.clip(coords[:, 1], -85.05112878, 85.05112878)
    my = np.log(np.tan(np.pi / 4.0 + np.radians(lat_clipped) / 2.0)) * (MERCATOR_HALF / np.pi)
    px = np.rint((mx - mx0) * scale).astype(np.int32)
    py = np.rint((my1 - my) * scale).astype(np.int32)

    splits = np.flatnonzero(np.diff(ring_idx)) + 1
    starts = np.concatenate(([0], splits))
    ends = np.concatenate((splits, [len(px)]))

    keys = [
        "building_id",
        "ward_name",
        "age_category",
        "hazard_tier",
        "usage_group",
        "usage_label",
        "structure_label",
        "meshcode",
        "year_built",
        "measured_height",
        "storeys_above",
    ]
    val_index: dict[tuple[type, Any], int] = {}
    values_pb: list[bytes] = []

    def intern_val(val: Any) -> int:
        if isinstance(val, float):
            val = round(val, 2)
        key = (type(val), val)
        idx = val_index.get(key)
        if idx is None:
            idx = len(values_pb)
            val_index[key] = idx
            values_pb.append(_pb_value(val))
        return idx

    col_bid = sub["building_id"].tolist()
    col_ward = sub["ward_name"].tolist()
    col_age = sub["age_category"].tolist()
    col_haz = sub["hazard_tier"].tolist()
    col_ug = sub["usage_group"].tolist()
    col_ul = sub["usage_label"].tolist()
    col_sl = sub["structure_label"].tolist()
    col_mc = sub["meshcode"].tolist()
    col_yb = sub["year_built"].tolist()
    col_mh = sub["measured_height"].tolist()
    col_st = sub["storeys_above"].tolist()
    row_ids = sub.index.tolist()

    # Map row offset cleanly in case any geometry had empty coords
    feat_pbs: list[bytes] = []
    for k_pos in range(len(starts)):
        i = int(ring_idx[starts[k_pos]])
        cmds = _encode_ring_cmds(px[starts[k_pos] : ends[k_pos]], py[starts[k_pos] : ends[k_pos]])
        if not cmds:
            continue

        tags: list[int] = [
            0, intern_val(str(col_bid[i])),
            1, intern_val(str(col_ward[i])),
            2, intern_val(str(col_age[i])),
            3, intern_val(str(col_haz[i])),
            4, intern_val(str(col_ug[i])),
            5, intern_val(str(col_ul[i])),
            6, intern_val(str(col_sl[i])),
            7, intern_val(str(col_mc[i])),
        ]
        yb = col_yb[i]
        if yb is not None and pd.notna(yb):
            tags.extend((8, intern_val(int(yb))))
        mh = col_mh[i]
        if mh is not None and pd.notna(mh):
            tags.extend((9, intern_val(float(mh))))
        st = col_st[i]
        if st is not None and pd.notna(st):
            tags.extend((10, intern_val(int(st))))

        fid = int(row_ids[i]) + 1 if isinstance(row_ids[i], (int, np.integer)) else k_pos + 1
        feat_buf = (
            _pb_varint(1, fid)
            + _pb_packed_uints(2, tags)
            + _pb_varint(3, 3)  # POLYGON
            + _pb_packed_uints(4, cmds)
        )
        feat_pbs.append(_pb_bytes(2, feat_buf))

    if not feat_pbs:
        return b""

    layer_parts = [
        _pb_varint(15, 2),  # version = 2
        _pb_bytes(1, b"buildings"),  # name = "buildings"
        *feat_pbs,
        *[_pb_bytes(3, k.encode("utf-8")) for k in keys],
        *[_pb_bytes(4, v) for v in values_pb],
        _pb_varint(5, MVT_EXTENT),
    ]
    return _pb_bytes(3, b"".join(layer_parts))
