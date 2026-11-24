"""Google-Maps-style geocoding, Kyoto local place search, and reverse geocoding."""

from __future__ import annotations

import asyncio
import math
import re
import threading
import time
import unicodedata
from collections import OrderedDict
from typing import Any

import httpx
import pandas as pd

from app.constants import HAZARD_TIER_LABELS, WARD_CENTERS, WARD_NAMES
from app.route_sim import ARTERIAL_NODES, SHELTER_RELIEF_HUBS, _ROAD_NET, _dist_km
from app.shelter_rec import shelter_store

GSI_SEARCH_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch"
GSI_REVERSE_URL = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "QuakeLensJapan/0.2 (Kyoto Disaster Support Platform)"}

# Approximate bounding box covering Kyoto City (EPSG:4326)
KYOTO_MIN_LON = 135.42
KYOTO_MAX_LON = 135.95
KYOTO_MIN_LAT = 34.78
KYOTO_MAX_LAT = 35.33

KIND_LABELS: dict[str, str] = {
    "address": "住所・地名",
    "landmark": "施設・ランドマーク",
    "shelter": "指定緊急避難場所",
    "street": "道路・通り",
    "station": "駅・拠点",
    "ward": "行政区",
    "building": "建物 (PLATEAU)",
    "mesh": "250mメッシュ",
    "coordinates": "緯度・経度",
}

SOURCE_LABELS: dict[str, str] = {
    "gsi": "国土地理院 住所検索",
    "gsi_reverse": "国土地理院 逆ジオコーディング",
    "nominatim": "OpenStreetMap Nominatim",
    "local_shelter": "京都市 指定緊急避難場所",
    "local_street": "京都市 実道路ネットワーク",
    "local_node": "京都市 主要拠点・交差点",
    "local_ward": "京都市 行政区",
    "local_plateau": "Project PLATEAU / J-SHIS",
    "coordinates": "座標直接入力",
}

COORD_RE = re.compile(
    r"^\s*([+-]?\d{1,3}(?:\.\d+)?)\s*[,、\s　]+\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$"
)
MESHCODE_RE = re.compile(r"^\d{10}$")
BUILDING_ID_RE = re.compile(r"^(?:26100-)?bldg-[A-Za-z0-9_-]+$", re.IGNORECASE)
TORINA_RE = re.compile(
    r"((?:北|上京|左京|中京|東山|下京|南|右京|伏見|山科|西京)区|京都市(?!(?:北|上京|左京|中京|東山|下京|南|右京|伏見|山科|西京)区)|[\s　]|^)"
    r"[^\s　区]{1,12}?通[^\s　]{0,16}?(?:上ル|下ル|東入ル?|西入ル?|上がる|下がる|東入る|西入る)"
)
WARD_PREFIX_RE = re.compile(r"^(北|上京|左京|中京|東山|下京|南|右京|伏見|山科|西京)区")

_CACHE_LOCK = threading.Lock()
_SEARCH_CACHE: OrderedDict[tuple[Any, ...], tuple[float, dict[str, Any]]] = OrderedDict()
_REVERSE_CACHE: OrderedDict[tuple[float, float, bool], tuple[float, dict[str, Any]]] = OrderedDict()
_CACHE_TTL_SEC = 600.0
_CACHE_MAX_ITEMS = 256

_STREET_LOCK = threading.Lock()
_STREET_INDEX: list[dict[str, Any]] | None = None


def clear_geocode_cache() -> None:
    """Clear in-memory geocoding caches (primarily for unit tests)."""
    with _CACHE_LOCK:
        _SEARCH_CACHE.clear()
        _REVERSE_CACHE.clear()


def in_kyoto_bounds(lon: float, lat: float) -> bool:
    """Return True when (lon, lat) lies within the Kyoto City study envelope."""
    return KYOTO_MIN_LON <= lon <= KYOTO_MAX_LON and KYOTO_MIN_LAT <= lat <= KYOTO_MAX_LAT


def normalize_query(q: str) -> str:
    """Normalize Unicode width and collapse whitespace for consistent matching."""
    text = unicodedata.normalize("NFKC", q or "")
    return re.sub(r"\s+", " ", text).strip()


def strip_kyoto_torina(q: str) -> str:
    """Strip Kyoto street-intersection prefix (通り名・上ル/下ル/東入/西入) for GSI address matching."""
    cleaned = TORINA_RE.sub(r"\1", q).strip()
    if WARD_PREFIX_RE.match(cleaned) and "京都市" not in cleaned:
        cleaned = f"京都市{cleaned}"
    return re.sub(r"\s+", " ", cleaned).strip()


def parse_coordinates(q: str) -> tuple[float, float] | None:
    """Parse 'lat, lon' or 'lon, lat' strings inside valid geographic ranges."""
    m = COORD_RE.match(q)
    if not m:
        return None
    a = float(m.group(1))
    b = float(m.group(2))
    # Japan latitude ~20..46, longitude ~122..154
    if 20.0 <= a <= 46.0 and 122.0 <= b <= 154.0:
        return round(a, 6), round(b, 6)
    if 122.0 <= a <= 154.0 and 20.0 <= b <= 46.0:
        return round(b, 6), round(a, 6)
    if -90.0 <= a <= 90.0 and -180.0 <= b <= 180.0:
        return round(a, 6), round(b, 6)
    return None


def _get_street_index() -> list[dict[str, Any]]:
    """Build and cache named Kyoto street centroids, bounding boxes, and polyline samples."""
    global _STREET_INDEX
    if _STREET_INDEX is not None:
        return _STREET_INDEX
    with _STREET_LOCK:
        if _STREET_INDEX is not None:
            return _STREET_INDEX
        entries: list[dict[str, Any]] = []
        try:
            _ROAD_NET.ensure_loaded()
            grouped: dict[str, list[Any]] = {}
            for edge in _ROAD_NET.edges:
                name = normalize_query(edge.name)
                if name:
                    grouped.setdefault(name, []).append(edge)
            for name, edges in grouped.items():
                lons: list[float] = []
                lats: list[float] = []
                segments: list[list[list[float]]] = []
                step = max(1, len(edges) // 80)
                for idx, e in enumerate(edges):
                    lons.append(e.mid_lon)
                    lats.append(e.mid_lat)
                    if idx % step == 0 and len(segments) < 80:
                        segments.append(e.coords)
                lons_sorted = sorted(lons)
                lats_sorted = sorted(lats)
                mid_idx = len(lons_sorted) // 2
                entries.append({
                    "name": name,
                    "name_lower": name.lower(),
                    "edge_count": len(edges),
                    "lon": round(lons_sorted[mid_idx], 6),
                    "lat": round(lats_sorted[mid_idx], 6),
                    "bbox": [
                        round(min(c[0] for seg in segments for c in seg), 6),
                        round(min(c[1] for seg in segments for c in seg), 6),
                        round(max(c[0] for seg in segments for c in seg), 6),
                        round(max(c[1] for seg in segments for c in seg), 6),
                    ],
                    "segments": segments,
                })
        except Exception:
            entries = []
        _STREET_INDEX = entries
        return _STREET_INDEX


def _lookup_kyoto_context(lat: float, lon: float, store: Any | None) -> dict[str, Any]:
    """Enrich a coordinate with Kyoto 250m mesh hazard, PLATEAU building stats, and nearest shelter."""
    in_bounds = in_kyoto_bounds(lon, lat)
    ctx: dict[str, Any] = {
        "in_kyoto_coverage": False,
        "ward_name": None,
        "meshcode": None,
        "hazard_tier": None,
        "hazard_label": None,
        "t30_i55_ps": None,
        "arv": None,
        "jname": None,
        "total_buildings": None,
        "pre_1981_count": None,
        "pre_1981_share_known": None,
        "nearest_shelter": None,
    }
    if not in_bounds:
        return ctx

    if store is not None and getattr(store, "loaded", False) and hasattr(store, "meshes"):
        try:
            sub = store.meshes.cx[lon:lon, lat:lat]
            if not sub.empty:
                r = sub.iloc[0]
                tier = str(r.get("hazard_tier") or "unknown")
                t30 = r.get("t30_i55_ps")
                arv = r.get("arv")
                pre_share = r.get("pre_1981_share_known")
                ctx.update({
                    "in_kyoto_coverage": True,
                    "ward_name": str(r.get("ward_name") or "") or None,
                    "meshcode": str(r.get("meshcode") or "") or None,
                    "hazard_tier": tier,
                    "hazard_label": HAZARD_TIER_LABELS.get(tier, "不明"),
                    "t30_i55_ps": round(float(t30), 4) if t30 is not None and pd.notna(t30) else None,
                    "arv": round(float(arv), 2) if arv is not None and pd.notna(arv) else None,
                    "jname": str(r.get("jname") or "") or None,
                    "total_buildings": int(r.get("total_buildings") or 0),
                    "pre_1981_count": int(r.get("pre_1981_count") or 0),
                    "pre_1981_share_known": (
                        round(float(pre_share), 4)
                        if pre_share is not None and pd.notna(pre_share)
                        else None
                    ),
                })
        except Exception:
            pass

    try:
        shelter_store.ensure_loaded()
        shelters = shelter_store._shelters
        if shelters:
            best_s = min(
                shelters,
                key=lambda s: _dist_km(lon, lat, float(s["lon"]), float(s["lat"])),
            )
            dist_km = _dist_km(lon, lat, float(best_s["lon"]), float(best_s["lat"]))
            if dist_km <= 8.0:
                ctx["nearest_shelter"] = {
                    "id": best_s["id"],
                    "name": best_s["name"],
                    "ward": best_s["ward"],
                    "address": best_s["address"],
                    "is_wide_area": bool(best_s.get("is_wide_area")),
                    "distance_m": int(round(dist_km * 1000)),
                    "lat": float(best_s["lat"]),
                    "lon": float(best_s["lon"]),
                }
                if not ctx["ward_name"]:
                    ctx["ward_name"] = best_s["ward"]
    except Exception:
        pass

    return ctx


def _extract_ward_from_text(text: str) -> str | None:
    for w in WARD_NAMES.values():
        if w in text:
            return w
    return None


def _text_match_score(query_norm: str, target_text: str) -> float:
    """Compute a transparent lexical match score in [0..60]."""
    q = query_norm.lower()
    t = normalize_query(target_text).lower()
    if not q or not t:
        return 0.0
    if q == t:
        return 60.0
    if t.startswith(q):
        return 46.0
    if q in t:
        return 36.0
    tokens = [tok for tok in re.split(r"[\s　,/、]+", q) if tok]
    if len(tokens) > 1 and all(tok in t for tok in tokens):
        return 32.0
    hits = sum(1 for tok in tokens if tok in t)
    if hits > 0:
        return 14.0 * (hits / len(tokens))
    return 0.0


def _local_candidates(q_norm: str, store: Any | None) -> list[dict[str, Any]]:
    """Collect instant local Kyoto candidates across IDs, wards, hubs, shelters, and streets."""
    candidates: list[dict[str, Any]] = []
    q_lower = q_norm.lower()
    tokens = [t for t in re.split(r"[\s　,/、]+", q_lower) if t]

    # 1. Coordinates direct jump
    coords = parse_coordinates(q_norm)
    if coords is not None:
        lat, lon = coords
        candidates.append({
            "id": f"coord:{lat:.6f},{lon:.6f}",
            "title": f"指定座標 ({lat:.5f}, {lon:.5f})",
            "subtitle": "緯度・経度ジャンプ",
            "address": f"緯度 {lat:.5f}, 経度 {lon:.5f}",
            "kind": "coordinates",
            "source": "coordinates",
            "lat": lat,
            "lon": lon,
            "zoom": 16.5,
            "bbox": None,
            "ward_name": None,
            "score": 150.0,
        })
        return candidates

    # 2. Exact building ID lookup
    if store is not None and getattr(store, "loaded", False) and BUILDING_ID_RE.match(q_norm):
        target_id = q_norm if q_norm.lower().startswith("26100-") else f"26100-{q_norm}"
        matches = store.buildings[store.buildings["building_id"].str.lower() == target_id.lower()]
        if matches.empty:
            matches = store.buildings[store.buildings["building_id"].str.lower() == q_lower]
        if not matches.empty:
            row = matches.iloc[0]
            c = row.geometry.centroid
            yr = f"築{int(row['year_built'])}年" if pd.notna(row["year_built"]) else "建築年不明"
            candidates.append({
                "id": f"bldg:{row['building_id']}",
                "title": str(row["building_id"]),
                "subtitle": f"{row['ward_name']}・{yr}・{row['usage_label']}・{row['structure_label']}",
                "address": f"京都府京都市{row['ward_name']}（メッシュ {row['meshcode']}）",
                "kind": "building",
                "source": "local_plateau",
                "lat": round(float(c.y), 6),
                "lon": round(float(c.x), 6),
                "zoom": 17.4,
                "bbox": None,
                "ward_name": str(row["ward_name"]),
                "meshcode": str(row["meshcode"]),
                "building_id": str(row["building_id"]),
                "score": 150.0,
            })
            return candidates

    # 3. Exact 10-digit 250m meshcode lookup
    if store is not None and getattr(store, "loaded", False) and MESHCODE_RE.match(q_norm):
        matches = store.meshes[store.meshes["meshcode"] == q_norm]
        if not matches.empty:
            r = matches.iloc[0]
            minx, miny, maxx, maxy = r.geometry.bounds
            candidates.append({
                "id": f"mesh:{q_norm}",
                "title": f"250mメッシュ {q_norm}",
                "subtitle": f"{r['ward_name']}・建物 {int(r['total_buildings'])}棟（1981以前 {int(r['pre_1981_count'])}棟）",
                "address": f"京都府京都市{r['ward_name']} メッシュ {q_norm}",
                "kind": "mesh",
                "source": "local_plateau",
                "lat": round(float(r["centroid_lat"]), 6),
                "lon": round(float(r["centroid_lon"]), 6),
                "zoom": 15.8,
                "bbox": [round(minx, 6), round(miny, 6), round(maxx, 6), round(maxy, 6)],
                "ward_name": str(r["ward_name"]),
                "meshcode": q_norm,
                "score": 150.0,
            })
            return candidates

    # 4. Kyoto 11 Wards
    for ward, info in WARD_CENTERS.items():
        if ward in ("all", "京都市全域"):
            continue
        full_ward = f"京都市{ward}"
        score = max(_text_match_score(q_norm, ward), _text_match_score(q_norm, full_ward))
        if score <= 0:
            continue
        bbox = None
        if store is not None and getattr(store, "loaded", False):
            sub_m = store.meshes[store.meshes["ward_name"] == ward]
            if not sub_m.empty:
                minx, miny, maxx, maxy = sub_m.total_bounds
                bbox = [round(float(minx), 6), round(float(miny), 6), round(float(maxx), 6), round(float(maxy), 6)]
        candidates.append({
            "id": f"ward:{ward}",
            "title": f"京都市{ward}",
            "subtitle": "京都市 行政区",
            "address": f"京都府京都市{ward}",
            "kind": "ward",
            "source": "local_ward",
            "lat": float(info["lat"]),
            "lon": float(info["lon"]),
            "zoom": float(info.get("zoom", 13.8)),
            "bbox": bbox,
            "ward_name": ward,
            "score": score + 55.0,
        })

    # 5. Arterial Nodes & Relief Hubs
    for node_id, node in ARTERIAL_NODES.items():
        hub = SHELTER_RELIEF_HUBS.get(node_id)
        hay = f"{node['name']} {node['ward']} {hub['title'] if hub else ''}"
        score = _text_match_score(q_norm, node["name"])
        if hub:
            score = max(score, _text_match_score(q_norm, hub["title"]))
        if score <= 0 and all(t in normalize_query(hay).lower() for t in tokens):
            score = 26.0
        if score > 0:
            candidates.append({
                "id": f"node:{node_id}",
                "title": node["name"],
                "subtitle": hub["title"] if hub else f"{node['ward']}・主要交差点/駅拠点",
                "address": f"京都府京都市{node['ward']} {node['name']}",
                "kind": "station",
                "source": "local_node",
                "lat": float(node["lat"]),
                "lon": float(node["lon"]),
                "zoom": 15.6,
                "bbox": None,
                "ward_name": node["ward"],
                "score": score + 22.0,
            })

    # 6. Official Kyoto Shelters (514 GSI sites)
    try:
        shelter_store.ensure_loaded()
        for s in shelter_store._shelters:
            name_score = _text_match_score(q_norm, s["name"])
            addr_score = _text_match_score(q_norm, s["address"])
            comb = f"{s['ward']} {s['name']} {s['address']}"
            comb_norm = normalize_query(comb).lower()
            token_bonus = 24.0 if tokens and all(t in comb_norm for t in tokens) else 0.0
            best = max(name_score, addr_score * 0.9, token_bonus)
            if best <= 0:
                continue
            badge = "広域避難場所" if s.get("is_wide_area") else "指定緊急避難場所"
            dis_str = "・".join(s.get("disaster_labels") or [])
            candidates.append({
                "id": f"shelter:{s['id']}",
                "title": s["name"],
                "subtitle": f"{badge}（{dis_str}）" if dis_str else badge,
                "address": s["address"],
                "kind": "shelter",
                "source": "local_shelter",
                "lat": float(s["lat"]),
                "lon": float(s["lon"]),
                "zoom": 16.3,
                "bbox": None,
                "ward_name": s["ward"],
                "shelter_id": s["id"],
                "is_wide_area": bool(s.get("is_wide_area")),
                "disaster_labels": list(s.get("disaster_labels") or []),
                "score": best + (44.0 if name_score >= 36.0 else 20.0),
            })
    except Exception:
        pass

    # 7. Named Kyoto Streets
    for st in _get_street_index():
        s_score = _text_match_score(q_norm, st["name"])
        if s_score <= 0:
            continue
        candidates.append({
            "id": f"street:{st['name']}",
            "title": st["name"],
            "subtitle": f"京都市内 通り・路線（{st['edge_count']}区間）",
            "address": f"京都府京都市 {st['name']}",
            "kind": "street",
            "source": "local_street",
            "lat": st["lat"],
            "lon": st["lon"],
            "zoom": 15.2,
            "bbox": st["bbox"],
            "ward_name": None,
            "street_segments": st["segments"],
            "score": s_score + 56.0 + min(8.0, st["edge_count"] / 40.0),
        })

    return candidates


def _format_nominatim_address(addr: dict[str, Any], display_name: str) -> tuple[str, str | None]:
    """Format OSM Nominatim address dictionary into natural Japanese address order."""
    if not addr:
        return display_name, _extract_ward_from_text(display_name)
    province = addr.get("province") or addr.get("state") or ""
    city = addr.get("city") or addr.get("town") or addr.get("village") or ""
    ward = addr.get("city_district") or addr.get("suburb") or ""
    quarter = addr.get("quarter") or addr.get("neighbourhood") or addr.get("hamlet") or ""
    road = addr.get("road") or ""
    house = addr.get("house_number") or ""
    postcode = addr.get("postcode") or ""

    parts: list[str] = []
    for p in (province, city, ward, quarter, road, house):
        p_str = str(p).strip()
        if p_str and p_str not in parts:
            parts.append(p_str)
    formatted = "".join(parts) if parts else display_name
    if postcode and postcode not in formatted:
        formatted = f"〒{postcode} {formatted}"
    ward_name = _extract_ward_from_text(formatted)
    return formatted, ward_name


def _classify_nominatim_kind(item: dict[str, Any]) -> str:
    cls = str(item.get("class") or item.get("category") or "").lower()
    typ = str(item.get("type") or "").lower()
    if cls in {"railway", "public_transport"} or typ in {
        "station",
        "halt",
        "tram_stop",
        "subway_entrance",
        "bus_stop",
    }:
        return "station"
    if cls in {"amenity", "tourism", "historic", "leisure", "shop", "office", "building"}:
        return "landmark"
    if cls == "highway":
        return "street"
    return "address"


async def _query_gsi_search(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    resp = await client.get(GSI_SEARCH_URL, params={"q": query})
    resp.raise_for_status()
    payload = resp.json()
    return payload if isinstance(payload, list) else []


async def _query_nominatim(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    resp = await client.get(
        NOMINATIM_SEARCH_URL,
        params={
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": 6,
            "countrycodes": "jp",
            "viewbox": f"{KYOTO_MIN_LON},{KYOTO_MAX_LAT},{KYOTO_MAX_LON},{KYOTO_MIN_LAT}",
            "bounded": 0,
            "accept-language": "ja",
        },
        headers=NOMINATIM_HEADERS,
    )
    resp.raise_for_status()
    payload = resp.json()
    return payload if isinstance(payload, list) else []


def _parse_gsi_features(
    features: list[dict[str, Any]],
    q_norm: str,
    via_variant: bool = False,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for idx, feat in enumerate(features):
        coords = (feat.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        props = feat.get("properties") or {}
        raw_title = normalize_query(str(props.get("title") or ""))
        if not raw_title:
            continue
        # Filter generic city center fallback unless user searched literally for Kyoto City
        if raw_title in {"京都府京都市", "京都市"} and q_norm not in {"京都", "京都市", "京都府京都市"}:
            continue

        addr_code = str(props.get("addressCode") or "").strip()
        ds = str(props.get("dataSource") or "")
        ward_name = WARD_NAMES.get(addr_code) or _extract_ward_from_text(raw_title)
        in_kyoto = in_kyoto_bounds(lon, lat) or "京都市" in raw_title

        kind = "landmark" if ds == "3" and not raw_title.endswith(("町", "丁目", "番地")) else "address"
        zoom = 17.0 if ("番地" in raw_title or ds == "1") else 16.0 if ds == "3" else 15.4
        base_score = _text_match_score(q_norm, raw_title)
        if base_score <= 0:
            base_score = 26.0 if via_variant else 20.0
        kyoto_boost = 34.0 if in_kyoto else 0.0
        specificity_boost = (
            18.0 if ("番地" in raw_title or ds == "1") else 10.0 if ("丁目" in raw_title or ds == "3") else 0.0
        )
        rank_decay = max(0.0, 6.0 - idx * 0.8)

        out.append({
            "id": f"gsi:{addr_code}:{lat:.5f},{lon:.5f}",
            "title": raw_title,
            "subtitle": "住所（国土地理院）" if kind == "address" else "施設・公共機関（国土地理院）",
            "address": raw_title,
            "kind": kind,
            "source": "gsi",
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "zoom": zoom,
            "bbox": None,
            "ward_name": ward_name,
            "score": base_score + kyoto_boost + specificity_boost + rank_decay,
        })
    return out


def _parse_nominatim_items(items: list[dict[str, Any]], q_norm: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for idx, item in enumerate(items):
        try:
            lat = float(item["lat"])
            lon = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        raw_name = normalize_query(str(item.get("name") or ""))
        display_name = normalize_query(str(item.get("display_name") or ""))
        addr_dict = item.get("address") if isinstance(item.get("address"), dict) else {}
        formatted_addr, ward_name = _format_nominatim_address(addr_dict, display_name)
        title = raw_name or formatted_addr
        if not title:
            continue

        bbox: list[float] | None = None
        raw_bb = item.get("boundingbox")
        if isinstance(raw_bb, list) and len(raw_bb) == 4:
            try:
                s_lat, n_lat, w_lon, e_lon = (float(x) for x in raw_bb)
                if w_lon < e_lon and s_lat < n_lat:
                    bbox = [round(w_lon, 6), round(s_lat, 6), round(e_lon, 6), round(n_lat, 6)]
            except (TypeError, ValueError):
                bbox = None

        kind = _classify_nominatim_kind(item)
        in_kyoto = in_kyoto_bounds(lon, lat) or "京都市" in formatted_addr
        zoom = 16.2 if kind in {"landmark", "station"} else 15.6

        title_score = max(_text_match_score(q_norm, title), _text_match_score(q_norm, formatted_addr) * 0.9)
        importance = float(item.get("importance") or 0.0) * 14.0
        kyoto_boost = 34.0 if in_kyoto else 0.0
        poi_boost = 10.0 if kind in {"landmark", "station"} else 0.0
        rank_decay = max(0.0, 5.0 - idx * 0.8)

        out.append({
            "id": f"osm:{item.get('place_id', f'{lat:.5f},{lon:.5f}')}",
            "title": title,
            "subtitle": formatted_addr if formatted_addr != title else KIND_LABELS[kind],
            "address": formatted_addr,
            "kind": kind,
            "source": "nominatim",
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "zoom": zoom,
            "bbox": bbox,
            "ward_name": ward_name,
            "score": title_score + importance + kyoto_boost + poi_boost + rank_decay,
        })
    return out


def _deduplicate_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort candidates by score descending and merge duplicates within ~120m with matching names."""
    ordered = sorted(candidates, key=lambda c: c.get("score", 0.0), reverse=True)
    kept: list[dict[str, Any]] = []
    for cand in ordered:
        c_title = normalize_query(cand["title"]).lower().replace("京都府京都市", "")
        duplicate_of: dict[str, Any] | None = None
        for existing in kept:
            d_km = _dist_km(cand["lon"], cand["lat"], existing["lon"], existing["lat"])
            e_title = normalize_query(existing["title"]).lower().replace("京都府京都市", "")
            same_name = c_title == e_title or (len(c_title) >= 2 and (c_title in e_title or e_title in c_title))
            max_dup_km = (
                4.0
                if existing.get("kind") == "ward"
                and c_title.replace("京都市", "") == e_title.replace("京都市", "")
                else 0.15
            )
            in_existing_street_bbox = False
            if existing.get("kind") == "street" and c_title == e_title and existing.get("bbox"):
                bx0, by0, bx1, by1 = existing["bbox"]
                in_existing_street_bbox = (bx0 - 0.01 <= cand["lon"] <= bx1 + 0.01) and (
                    by0 - 0.01 <= cand["lat"] <= by1 + 0.01
                )
            if (d_km <= max_dup_km and same_name) or in_existing_street_bbox:
                duplicate_of = existing
                break
        if duplicate_of is not None:
            # Merge richer metadata (shelter details, street segments, bbox, address)
            if (not duplicate_of.get("bbox")) and cand.get("bbox"):
                duplicate_of["bbox"] = cand["bbox"]
            if (not duplicate_of.get("street_segments")) and cand.get("street_segments"):
                duplicate_of["street_segments"] = cand["street_segments"]
            if cand.get("kind") == "station" and duplicate_of.get("kind") in {"address", "landmark"}:
                duplicate_of["kind"] = "station"
            if cand.get("shelter_id") and not duplicate_of.get("shelter_id"):
                duplicate_of["shelter_id"] = cand["shelter_id"]
                duplicate_of["kind"] = "shelter"
                duplicate_of["source"] = cand["source"]
                duplicate_of["title"] = cand["title"]
                duplicate_of["subtitle"] = cand["subtitle"]
                duplicate_of["address"] = cand["address"]
                duplicate_of["is_wide_area"] = cand.get("is_wide_area", False)
                duplicate_of["disaster_labels"] = cand.get("disaster_labels", [])
            if len(cand.get("address") or "") > len(duplicate_of.get("address") or ""):
                if duplicate_of.get("source") in {"nominatim", "gsi"}:
                    duplicate_of["address"] = cand["address"]
            continue
        kept.append(cand)
    return kept


async def search_locations(
    q: str,
    *,
    limit: int = 8,
    store: Any | None = None,
    use_external: bool = True,
) -> dict[str, Any]:
    """Search Kyoto & Japan addresses, landmarks, shelters, streets, buildings, and coordinates."""
    q_norm = normalize_query(q)
    if not q_norm:
        return {"query": "", "count": 0, "results": [], "notice": None}

    store_loaded = bool(store is not None and getattr(store, "loaded", False))
    cache_key = (q_norm, limit, use_external, store_loaded)
    now = time.time()
    with _CACHE_LOCK:
        cached = _SEARCH_CACHE.get(cache_key)
        if cached and (now - cached[0]) < _CACHE_TTL_SEC:
            _SEARCH_CACHE.move_to_end(cache_key)
            return cached[1]

    candidates = _local_candidates(q_norm, store)
    external_notice: str | None = None

    is_direct_id_or_coord = bool(
        parse_coordinates(q_norm)
        or BUILDING_ID_RE.match(q_norm)
        or MESHCODE_RE.match(q_norm)
    )

    if use_external and not is_direct_id_or_coord and len(q_norm) >= 2:
        stripped = strip_kyoto_torina(q_norm)
        gsi_queries = [q_norm]
        if stripped and stripped != q_norm:
            gsi_queries.append(stripped)
        if "京都" not in q_norm and not re.match(r"^[\d-]+$", q_norm) and any(ord(ch) > 127 for ch in q_norm):
            gsi_queries.append(f"京都市 {stripped or q_norm}")

        try:
            async with httpx.AsyncClient(timeout=3.5) as client:
                tasks = [_query_gsi_search(client, gq) for gq in gsi_queries]
                tasks.append(_query_nominatim(client, q_norm))
                responses = await asyncio.gather(*tasks, return_exceptions=True)

            gsi_resps = responses[:-1]
            nom_resp = responses[-1]

            failed_ext = 0
            for idx, r in enumerate(gsi_resps):
                if isinstance(r, Exception):
                    failed_ext += 1
                    continue
                candidates.extend(_parse_gsi_features(r, q_norm, via_variant=(idx > 0)))

            if isinstance(nom_resp, Exception):
                failed_ext += 1
            else:
                candidates.extend(_parse_nominatim_items(nom_resp, q_norm))

            if failed_ext == len(responses):
                external_notice = "外部住所検索APIへの接続が混み合っているため、京都市内のローカルデータから検索しました。"
        except Exception:
            external_notice = "外部住所検索APIに接続できないため、京都市内のローカルデータから検索しました。"

    deduped = _deduplicate_candidates(candidates)[:limit]
    results: list[dict[str, Any]] = []
    for item in deduped:
        if item["kind"] == "coordinates":
            rev = await reverse_geocode(
                item["lat"],
                item["lon"],
                store=store,
                use_external=use_external,
            )
            if rev.get("address"):
                item["address"] = rev["address"]
                item["subtitle"] = rev["address"]
            if rev.get("ward_name"):
                item["ward_name"] = rev["ward_name"]
            ctx = rev.get("kyoto_context") or _lookup_kyoto_context(item["lat"], item["lon"], store)
        else:
            ctx = _lookup_kyoto_context(item["lat"], item["lon"], store)
        ward_name = item.get("ward_name") or ctx.get("ward_name")
        item_out = {
            "id": item["id"],
            "title": item["title"],
            "subtitle": item["subtitle"],
            "address": item["address"],
            "kind": item["kind"],
            "kind_label": KIND_LABELS.get(item["kind"], "場所"),
            "source": item["source"],
            "source_label": SOURCE_LABELS.get(item["source"], item["source"]),
            "lat": item["lat"],
            "lon": item["lon"],
            "zoom": item["zoom"],
            "bbox": item.get("bbox"),
            "ward_name": ward_name,
            "meshcode": item.get("meshcode") or ctx.get("meshcode"),
            "building_id": item.get("building_id"),
            "shelter_id": item.get("shelter_id"),
            "is_wide_area": item.get("is_wide_area", False),
            "disaster_labels": item.get("disaster_labels", []),
            "street_segments": item.get("street_segments"),
            "kyoto_context": ctx,
        }
        results.append(item_out)

    response = {
        "query": q_norm,
        "count": len(results),
        "results": results,
        "notice": external_notice,
    }
    with _CACHE_LOCK:
        _SEARCH_CACHE[cache_key] = (now, response)
        _SEARCH_CACHE.move_to_end(cache_key)
        while len(_SEARCH_CACHE) > _CACHE_MAX_ITEMS:
            _SEARCH_CACHE.popitem(last=False)
    return response


async def reverse_geocode(
    lat: float,
    lon: float,
    *,
    store: Any | None = None,
    use_external: bool = True,
) -> dict[str, Any]:
    """Resolve coordinates into a human-readable Japanese address and Kyoto risk context."""
    rlat = round(float(lat), 5)
    rlon = round(float(lon), 5)
    store_loaded = bool(store is not None and getattr(store, "loaded", False))
    cache_key = (rlat, rlon, store_loaded)
    now = time.time()
    with _CACHE_LOCK:
        cached = _REVERSE_CACHE.get(cache_key)
        if cached and (now - cached[0]) < _CACHE_TTL_SEC:
            _REVERSE_CACHE.move_to_end(cache_key)
            return cached[1]

    ctx = _lookup_kyoto_context(rlat, rlon, store)
    ward_name: str | None = ctx.get("ward_name")
    town_name: str | None = None
    nearest_road: str | None = None
    address: str = ""
    source = "local_fallback"

    if in_kyoto_bounds(rlon, rlat):
        try:
            _ROAD_NET.ensure_loaded()
            snapped = _ROAD_NET.snap_point(rlat, rlon)
            if snapped.name and snapped.snap_dist_km <= 0.35:
                nearest_road = snapped.name
        except Exception:
            pass

    if use_external:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(GSI_REVERSE_URL, params={"lat": rlat, "lon": rlon})
                r.raise_for_status()
                data = r.json()
            res = data.get("results") or {}
            muni_cd = str(res.get("muniCd") or "").strip()
            lv01 = normalize_query(str(res.get("lv01Nm") or ""))
            if muni_cd in WARD_NAMES:
                ward_name = WARD_NAMES[muni_cd]
                town_name = lv01 or None
                address = f"京都府京都市{ward_name}{lv01}"
                source = "gsi_reverse"
            elif lv01:
                town_name = lv01
                address = f"京都市{ward_name}{lv01}" if ward_name else lv01
                source = "gsi_reverse"
        except Exception:
            pass

    if not address:
        if ward_name:
            address = f"京都府京都市{ward_name}" + (f" {nearest_road}付近" if nearest_road else "付近")
        else:
            address = f"緯度 {rlat:.5f}, 経度 {rlon:.5f}"

    result = {
        "lat": rlat,
        "lon": rlon,
        "address": address,
        "ward_name": ward_name,
        "town_name": town_name,
        "nearest_road": nearest_road,
        "source": source,
        "kyoto_context": ctx,
    }
    with _CACHE_LOCK:
        _REVERSE_CACHE[cache_key] = (now, result)
        _REVERSE_CACHE.move_to_end(cache_key)
        while len(_REVERSE_CACHE) > _CACHE_MAX_ITEMS:
            _REVERSE_CACHE.popitem(last=False)
    return result
