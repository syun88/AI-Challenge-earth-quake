"""Fetch and build compact Kyoto real street-network topology from OpenStreetMap (Overpass API).

Produces `backend/data/processed/kyoto_roads.json.gz` with junction-compressed
bi-directional street segments retaining full polyline curvature, street names,
highway classifications, and Largest Connected Component filtering.
"""

from __future__ import annotations

import gzip
import json
import math
import tempfile
import time
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any

import httpx

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "processed" / "kyoto_roads.json.gz"

# Covers all 11 wards matching PLATEAU Kyoto bounds
BBOX = (34.88, 135.65, 35.095, 135.842)  # (south, west, north, east)
URBAN_BBOX = (34.895, 135.675, 35.072, 135.832)

HIGHWAY_FACTORS: dict[str, float] = {
    "trunk": 1.0,
    "trunk_link": 1.05,
    "primary": 1.0,
    "primary_link": 1.05,
    "secondary": 1.02,
    "secondary_link": 1.08,
    "tertiary": 1.08,
    "tertiary_link": 1.12,
    "unclassified": 1.22,
    "residential": 1.38,
}


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    lat_m = 111000.0
    lon_m = 111000.0 * math.cos(math.radians((lat1 + lat2) * 0.5))
    return math.hypot((lon2 - lon1) * lon_m, (lat2 - lat1) * lat_m)


def _polyline_length_m(coords: list[list[float]]) -> float:
    total = 0.0
    for i in range(len(coords) - 1):
        total += _haversine_m(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
    return total


def _fetch_overpass_chunk(cache_file: Path, label: str, query: str) -> list[dict[str, Any]]:
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            els = data.get("elements", [])
            if els:
                print(f"Loaded cached {label}: {len(els)} ways")
                return els
        except Exception:
            pass

    for attempt in range(6):
        try:
            print(f"Fetching {label} via Overpass out geom (attempt {attempt + 1})...")
            resp = httpx.post(
                OVERPASS_URL,
                data={"data": query},
                headers={
                    "User-Agent": "QuakeLensJapan/1.0 (Disaster Platform Research)",
                    "Accept": "application/json",
                },
                timeout=90.0,
            )
            resp.raise_for_status()
            data = resp.json()
            els = data.get("elements", [])
            cache_file.write_text(json.dumps({"elements": els}, ensure_ascii=False), encoding="utf-8")
            print(f"  OK {label}: {len(els)} ways")
            return els
        except Exception as exc:
            wait_s = 12 + attempt * 8
            print(f"  Error on {label} ({exc}); cooling down {wait_s}s...")
            time.sleep(wait_s)

    raise RuntimeError(f"Failed to fetch Overpass chunk: {label}")


def fetch_osm_roads() -> list[dict[str, Any]]:
    cache_dir = Path(tempfile.gettempdir()) / "kyoto_osm_geom_v2"
    cache_dir.mkdir(parents=True, exist_ok=True)
    merged_ways: dict[int, dict[str, Any]] = {}

    s, w, n, e = BBOX
    arterial_q = (
        f"[out:json][timeout:60];"
        f'way["highway"~"^(trunk|primary|secondary|tertiary|trunk_link|primary_link|secondary_link|tertiary_link)$"]["area"!="yes"]({s},{w},{n},{e});'
        f"out geom qt;"
    )
    for el in _fetch_overpass_chunk(cache_dir / "arterials.json", "citywide-arterials", arterial_q):
        if el.get("type") == "way":
            merged_ways[int(el["id"])] = el
    time.sleep(8.0)

    us, uw, un, ue = URBAN_BBOX
    step = (un - us) / 4.0
    for idx in range(4):
        bs = round(max(us, us + idx * step - 0.002), 4)
        bn = round(min(un, us + (idx + 1) * step + 0.002), 4)
        local_q = (
            f"[out:json][timeout:60];"
            f'way["highway"~"^(unclassified|residential)$"]["area"!="yes"]["access"!~"^(private|no)$"]({bs},{uw},{bn},{ue});'
            f"out geom qt;"
        )
        els = _fetch_overpass_chunk(cache_dir / f"urban_local_{idx + 1}.json", f"urban-local-{idx + 1}/4", local_q)
        for el in els:
            if el.get("type") == "way":
                merged_ways[int(el["id"])] = el
        if idx < 3:
            time.sleep(8.0)

    return list(merged_ways.values())


def build_compact_graph(osm_ways_raw: list[dict[str, Any]]) -> dict[str, Any]:
    osm_nodes: dict[int, tuple[float, float]] = {}
    osm_ways: list[dict[str, Any]] = []

    for el in osm_ways_raw:
        nids = el.get("nodes") or []
        geom = el.get("geometry") or []
        tags = el.get("tags") or {}
        hw = str(tags.get("highway", ""))
        if hw not in HIGHWAY_FACTORS or len(nids) < 2 or len(nids) != len(geom):
            continue
        for nid, pt in zip(nids, geom):
            if pt and "lon" in pt and "lat" in pt:
                osm_nodes[int(nid)] = (round(float(pt["lon"]), 5), round(float(pt["lat"]), 5))
        osm_ways.append(el)

    print(f"Parsed OSM elements: {len(osm_nodes)} unique nodes, {len(osm_ways)} ways")

    node_ref_count: Counter[int] = Counter()
    for w in osm_ways:
        nids = [int(x) for x in w["nodes"]]
        node_ref_count[nids[0]] += 1
        node_ref_count[nids[-1]] += 1
        for nid in nids[1:-1]:
            node_ref_count[nid] += 1

    # Split ways at intersections (endpoints or ref_count > 1) preserving exact intermediate geometry
    raw_edges: list[tuple[int, int, str, str, list[list[float]], float]] = []
    for w in osm_ways:
        nids = [int(x) for x in w["nodes"] if int(x) in osm_nodes]
        if len(nids) < 2:
            continue
        tags = w.get("tags") or {}
        hw = str(tags.get("highway", "residential"))
        name = str(tags.get("name") or tags.get("name:ja") or tags.get("ref") or "").strip()

        seg_start = 0
        for idx in range(1, len(nids)):
            nid = nids[idx]
            is_junction = idx == len(nids) - 1 or node_ref_count[nid] > 1
            if is_junction:
                u_osm = nids[seg_start]
                v_osm = nid
                sub_nids = nids[seg_start : idx + 1]
                coords = [[osm_nodes[k][0], osm_nodes[k][1]] for k in sub_nids]
                length_m = _polyline_length_m(coords)
                if u_osm != v_osm and length_m >= 1.0:
                    raw_edges.append((u_osm, v_osm, name, hw, coords, length_m))
                elif u_osm == v_osm and len(coords) >= 4 and length_m >= 5.0:
                    mid = len(sub_nids) // 2
                    m_osm = sub_nids[mid]
                    if m_osm != u_osm:
                        c1 = [[osm_nodes[k][0], osm_nodes[k][1]] for k in sub_nids[: mid + 1]]
                        c2 = [[osm_nodes[k][0], osm_nodes[k][1]] for k in sub_nids[mid:]]
                        raw_edges.append((u_osm, m_osm, name, hw, c1, _polyline_length_m(c1)))
                        raw_edges.append((m_osm, v_osm, name, hw, c2, _polyline_length_m(c2)))
                seg_start = idx

    print(f"Split into {len(raw_edges)} intersection-to-intersection edges")

    # Largest Connected Component
    adj: dict[int, list[int]] = defaultdict(list)
    for u, v, *_ in raw_edges:
        adj[u].append(v)
        adj[v].append(u)

    visited: set[int] = set()
    components: list[set[int]] = []
    for nid in adj:
        if nid in visited:
            continue
        comp: set[int] = set()
        q = deque([nid])
        visited.add(nid)
        while q:
            cur = q.popleft()
            comp.add(cur)
            for nxt in adj[cur]:
                if nxt not in visited:
                    visited.add(nxt)
                    q.append(nxt)
        components.append(comp)

    components.sort(key=len, reverse=True)
    lcc = components[0] if components else set()
    print(f"Connected components: {len(components)}, LCC nodes: {len(lcc)}")

    osm_to_idx: dict[int, int] = {}
    nodes_out: list[list[float]] = []
    for osm_id in sorted(lcc):
        osm_to_idx[osm_id] = len(nodes_out)
        lon, lat = osm_nodes[osm_id]
        nodes_out.append([lon, lat])

    name_table: list[str] = [""]
    name_map: dict[str, int] = {"": 0}
    hw_table: list[str] = list(HIGHWAY_FACTORS.keys())
    hw_map: dict[str, int] = {h: i for i, h in enumerate(hw_table)}

    edges_out: list[list[Any]] = []
    for u_osm, v_osm, name, hw, coords, length_m in raw_edges:
        if u_osm not in osm_to_idx or v_osm not in osm_to_idx:
            continue
        if name not in name_map:
            name_map[name] = len(name_table)
            name_table.append(name)
        edges_out.append([
            osm_to_idx[u_osm],
            osm_to_idx[v_osm],
            name_map[name],
            hw_map.get(hw, hw_map["residential"]),
            round(length_m, 1),
            coords,
        ])

    return {
        "source": "OpenStreetMap (Overpass API) Kyoto City street network",
        "license": "ODbL (© OpenStreetMap contributors)",
        "bbox": list(BBOX),
        "node_count": len(nodes_out),
        "edge_count": len(edges_out),
        "nodes": nodes_out,
        "names": name_table,
        "highways": hw_table,
        "edges": edges_out,
    }


def main() -> None:
    ways = fetch_osm_roads()
    graph = build_compact_graph(ways)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(graph, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(OUTPUT_PATH, "wb", compresslevel=6) as f:
        f.write(payload)
    gz_size = OUTPUT_PATH.stat().st_size
    print(
        f"Saved {OUTPUT_PATH} -> {graph['node_count']} nodes, {graph['edge_count']} edges "
        f"(raw={len(payload)/1e6:.2f}MB, gz={gz_size/1e6:.2f}MB)"
    )


if __name__ == "__main__":
    main()
