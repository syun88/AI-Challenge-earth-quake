"""Training & research-only Kyoto arterial corridor alternative-route simulator."""

from __future__ import annotations

import heapq
import math
from typing import Any

from fastapi import HTTPException

from app.constants import ROUTE_SIMULATION_DISCLAIMER

# Simplified arterial intersection/hub network covering Kyoto's 11 wards.
# Coordinates correspond to real Kyoto City major intersections/stations (EPSG:4326).
ARTERIAL_NODES: dict[str, dict[str, Any]] = {
    "kitaoji_karasuma": {"name": "北大路烏丸（北区拠点）", "ward": "北区", "lon": 135.7585, "lat": 35.0445},
    "demachiyanagi": {"name": "出町柳（左京区入口）", "ward": "左京区", "lon": 135.7727, "lat": 35.0301},
    "sakyo_shugakuin": {"name": "修学院・白川通（左京区北部）", "ward": "左京区", "lon": 135.7880, "lat": 35.0450},
    "senbon_imadegawa": {"name": "千本今出川（上京区西）", "ward": "上京区", "lon": 135.7420, "lat": 35.0296},
    "karasuma_imadegawa": {"name": "烏丸今出川（上京区中心）", "ward": "上京区", "lon": 135.7593, "lat": 35.0294},
    "uzumasa": {"name": "太秦天神川（右京区拠点）", "ward": "右京区", "lon": 135.7100, "lat": 35.0150},
    "nijo_senbon": {"name": "二条駅前（中京区西）", "ward": "中京区", "lon": 135.7418, "lat": 35.0108},
    "horikawa_oike": {"name": "堀川御池（二条城前）", "ward": "中京区", "lon": 135.7518, "lat": 35.0107},
    "karasuma_oike": {"name": "烏丸御池（中京区中心）", "ward": "中京区", "lon": 135.7597, "lat": 35.0108},
    "kawaramachi_oike": {"name": "河原町御池（中京区東）", "ward": "中京区", "lon": 135.7689, "lat": 35.0108},
    "sanjo_keihan": {"name": "三条京阪（東山区北）", "ward": "東山区", "lon": 135.7735, "lat": 35.0090},
    "keage": {"name": "蹴上（三条通・山科口）", "ward": "東山区", "lon": 135.7920, "lat": 35.0075},
    "yamashina_st": {"name": "山科駅・外環三条（山科区拠点）", "ward": "山科区", "lon": 135.8165, "lat": 34.9922},
    "nagitsuji": {"name": "山科・椥辻（山科区中心）", "ward": "山科区", "lon": 135.8047, "lat": 34.9781},
    "higashino": {"name": "五条バイパス・東野", "ward": "山科区", "lon": 135.8150, "lat": 34.9830},
    "nishioji_shijo": {"name": "西大路四条（右京/中京境）", "ward": "右京区", "lon": 135.7320, "lat": 35.0035},
    "shijo_karasuma": {"name": "四条烏丸", "ward": "下京区", "lon": 135.7597, "lat": 35.0037},
    "shijo_kawaramachi": {"name": "四条河原町", "ward": "下京区", "lon": 135.7690, "lat": 35.0037},
    "katsura": {"name": "桂駅東・国道9号（西京区拠点）", "ward": "西京区", "lon": 135.7025, "lat": 34.9780},
    "nishioji_gojo": {"name": "西大路五条", "ward": "下京区", "lon": 135.7318, "lat": 34.9950},
    "horikawa_gojo": {"name": "堀川五条", "ward": "下京区", "lon": 135.7519, "lat": 34.9949},
    "gojo_karasuma": {"name": "五条烏丸", "ward": "下京区", "lon": 135.7595, "lat": 34.9950},
    "gojo_higashiyama": {"name": "五条坂・東大路五条（東山区）", "ward": "東山区", "lon": 135.7760, "lat": 34.9949},
    "shichijo_keihan": {"name": "七条京阪（東山区南）", "ward": "東山区", "lon": 135.7720, "lat": 34.9877},
    "kyoto_st": {"name": "京都駅烏丸口（中央拠点）", "ward": "下京区", "lon": 135.7588, "lat": 34.9858},
    "toji_kujo": {"name": "九条大宮・東寺（南区拠点）", "ward": "南区", "lon": 135.7478, "lat": 34.9795},
    "kujo_karasuma": {"name": "九条烏丸（南区）", "ward": "南区", "lon": 135.7590, "lat": 34.9794},
    "kamitoba": {"name": "上鳥羽・新堀川通（南区南）", "ward": "南区", "lon": 135.7470, "lat": 34.9620},
    "takeda_st": {"name": "竹田駅周辺（伏見区北）", "ward": "伏見区", "lon": 135.7563, "lat": 34.9562},
    "fushimi_west": {"name": "下鳥羽・油小路通（伏見区西）", "ward": "伏見区", "lon": 135.7470, "lat": 34.9365},
    "fushimi_otesuji": {"name": "伏見桃山・大手筋（伏見区中心）", "ward": "伏見区", "lon": 135.7615, "lat": 34.9355},
    "fushimi_east": {"name": "藤森・桃山御陵東（伏見区東）", "ward": "伏見区", "lon": 135.7755, "lat": 34.9460},
    "chushojima": {"name": "中書島・宇治川北岸（伏見区南）", "ward": "伏見区", "lon": 135.7604, "lat": 34.9255},
}

ARTERIAL_EDGES: list[tuple[str, str, str]] = [
    ("kitaoji_karasuma", "karasuma_imadegawa", "烏丸通（北大路〜今出川）"),
    ("kitaoji_karasuma", "demachiyanagi", "北大路〜加茂街道"),
    ("demachiyanagi", "sakyo_shugakuin", "白川通・東大路北"),
    ("karasuma_imadegawa", "demachiyanagi", "今出川通"),
    ("karasuma_imadegawa", "senbon_imadegawa", "今出川通（西）"),
    ("karasuma_imadegawa", "karasuma_oike", "烏丸通（丸太町〜御池）"),
    ("senbon_imadegawa", "nijo_senbon", "千本通"),
    ("senbon_imadegawa", "horikawa_oike", "堀川丸太町経由"),
    ("uzumasa", "nijo_senbon", "御池通西延伸・三条通"),
    ("uzumasa", "nishioji_shijo", "四条通（太秦〜西大路）"),
    ("uzumasa", "katsura", "葛野大路・桂川街道"),
    ("nijo_senbon", "horikawa_oike", "御池通（千本〜堀川）"),
    ("nijo_senbon", "nishioji_shijo", "西大路御池経由"),
    ("horikawa_oike", "karasuma_oike", "御池通（堀川〜烏丸）"),
    ("horikawa_oike", "horikawa_gojo", "堀川通（御池〜五条）"),
    ("karasuma_oike", "kawaramachi_oike", "御池通（烏丸〜河原町）"),
    ("karasuma_oike", "shijo_karasuma", "烏丸通（御池〜四条）"),
    ("kawaramachi_oike", "sanjo_keihan", "御池通〜三条京阪"),
    ("kawaramachi_oike", "shijo_kawaramachi", "河原町通"),
    ("sanjo_keihan", "demachiyanagi", "川端通"),
    ("sanjo_keihan", "keage", "三条通（蹴上方面）"),
    ("sanjo_keihan", "gojo_higashiyama", "東大路通（三条〜五条）"),
    ("keage", "yamashina_st", "三条通（日ノ岡〜山科）"),
    ("keage", "higashino", "五条バイパス西連絡"),
    ("yamashina_st", "higashino", "外環状線（山科〜東野）"),
    ("higashino", "nagitsuji", "外環状線（東野〜椥辻）"),
    ("nagitsuji", "gojo_higashiyama", "国道1号 五条バイパス"),
    ("nagitsuji", "fushimi_east", "大石道・小野〜藤森ルート"),
    ("nishioji_shijo", "shijo_karasuma", "四条通（西大路〜烏丸）"),
    ("nishioji_shijo", "nishioji_gojo", "西大路通（四条〜五条）"),
    ("shijo_karasuma", "shijo_kawaramachi", "四条通（烏丸〜河原町）"),
    ("shijo_karasuma", "gojo_karasuma", "烏丸通（四条〜五条）"),
    ("shijo_kawaramachi", "gojo_higashiyama", "河原町五条〜五条坂"),
    ("katsura", "nishioji_gojo", "国道9号 五条通"),
    ("katsura", "toji_kujo", "久世橋通・西大路九条"),
    ("katsura", "fushimi_west", "桂川街道・外環西"),
    ("nishioji_gojo", "horikawa_gojo", "五条通（西大路〜堀川）"),
    ("nishioji_gojo", "toji_kujo", "西大路通〜九条"),
    ("horikawa_gojo", "gojo_karasuma", "五条通（堀川〜烏丸）"),
    ("horikawa_gojo", "toji_kujo", "堀川通・大宮通"),
    ("gojo_karasuma", "gojo_higashiyama", "五条通（烏丸〜東大路）"),
    ("gojo_karasuma", "kyoto_st", "烏丸通（五条〜京都駅）"),
    ("gojo_higashiyama", "shichijo_keihan", "川端通〜七条"),
    ("shichijo_keihan", "kyoto_st", "七条通"),
    ("shichijo_keihan", "fushimi_east", "本町通・師団街道"),
    ("kyoto_st", "toji_kujo", "八条・九条（京都駅〜東寺）"),
    ("kyoto_st", "kujo_karasuma", "烏丸通（京都駅〜九条）"),
    ("toji_kujo", "kujo_karasuma", "九条通"),
    ("toji_kujo", "kamitoba", "油小路通・新堀川通（北）"),
    ("kujo_karasuma", "takeda_st", "竹田街道（九条〜竹田）"),
    ("kamitoba", "takeda_st", "十条・名神南連絡"),
    ("kamitoba", "fushimi_west", "新堀川通・油小路通（伏見）"),
    ("takeda_st", "fushimi_otesuji", "竹田街道（竹田〜大手筋）"),
    ("takeda_st", "fushimi_west", "津知橋通・西連絡"),
    ("takeda_st", "fushimi_east", "深草・藤森連絡"),
    ("fushimi_west", "fushimi_otesuji", "大手筋通（西）"),
    ("fushimi_west", "chushojima", "油小路南・中書島西連絡"),
    ("fushimi_otesuji", "chushojima", "竹田街道・大手筋南"),
    ("fushimi_east", "fushimi_otesuji", "京町通・大手筋東"),
    ("fushimi_east", "chushojima", "宇治川北岸・観月橋連絡"),
]


def _dist_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    lat_scale = 111.0
    lon_scale = 111.0 * math.cos(math.radians(35.0))
    dx = (lon2 - lon1) * lon_scale
    dy = (lat2 - lat1) * lat_scale
    return math.hypot(dx, dy)


def _point_to_segment_meters(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
) -> float:
    """Planar projection distance (calibrated around 35N in Kyoto) from point P to segment AB."""
    lon_m = 111000.0 * math.cos(math.radians(35.0))
    lat_m = 111000.0
    p_x, p_y = px * lon_m, py * lat_m
    a_x, a_y = ax * lon_m, ay * lat_m
    b_x, b_y = bx * lon_m, by * lat_m

    ab_x = b_x - a_x
    ab_y = b_y - a_y
    len_sq = ab_x * ab_x + ab_y * ab_y
    if len_sq <= 1e-6:
        return math.hypot(p_x - a_x, p_y - a_y)
    t = max(0.0, min(1.0, ((p_x - a_x) * ab_x + (p_y - a_y) * ab_y) / len_sq))
    proj_x = a_x + t * ab_x
    proj_y = a_y + t * ab_y
    return math.hypot(p_x - proj_x, p_y - proj_y)


def _dijkstra(
    adj: dict[str, list[tuple[str, float, str]]],
    start: str,
    goal: str,
) -> tuple[list[str], list[str], float] | None:
    pq: list[tuple[float, str, list[str], list[str]]] = [(0.0, start, [start], [])]
    best: dict[str, float] = {start: 0.0}
    while pq:
        cost, u, path_nodes, path_edges = heapq.heappop(pq)
        if u == goal:
            return path_nodes, path_edges, cost
        if cost > best.get(u, float("inf")):
            continue
        for v, w, label in adj.get(u, []):
            nc = cost + w
            if nc < best.get(v, float("inf")):
                best[v] = nc
                heapq.heappush(pq, (nc, v, [*path_nodes, v], [*path_edges, label]))
    return None


def list_route_nodes() -> list[dict[str, Any]]:
    """Return sorted selectable arterial hub nodes across Kyoto wards."""
    return [
        {"id": nid, **meta}
        for nid, meta in ARTERIAL_NODES.items()
    ]


def simulate_alternative_route(
    *,
    origin_id: str,
    destination_id: str,
    reports: list[dict[str, Any]],
    include_samples: bool = True,
    avoid_unverified: bool = True,
    block_radius_m: float = 420.0,
    store: Any | None = None,
) -> dict[str, Any]:
    """Compute shortest arterial path and detour avoiding active road_blocked reports."""
    if origin_id not in ARTERIAL_NODES:
        raise HTTPException(status_code=400, detail=f"未知の出発拠点IDです: {origin_id}")
    if destination_id not in ARTERIAL_NODES:
        raise HTTPException(status_code=400, detail=f"未知の目的拠点IDです: {destination_id}")
    if origin_id == destination_id:
        raise HTTPException(status_code=400, detail="出発拠点と目的拠点には異なる地点を選択してください。")

    # Collect active road_blocked points (explicit lat/lon or mesh centroid)
    hazard_points: list[dict[str, Any]] = []
    for r in reports:
        if r.get("category") != "road_blocked" or r.get("resolved"):
            continue
        if r.get("is_sample") and not include_samples:
            continue
        if r.get("verification_status") == "unverified" and not avoid_unverified:
            continue

        lon = r.get("lon")
        lat = r.get("lat")
        coord_source = "report_pin"
        if (lon is None or lat is None) and r.get("meshcode") and store is not None and getattr(store, "loaded", False):
            md = store.get_mesh_detail(str(r["meshcode"]))
            if md:
                lon = md.get("centroid_lon")
                lat = md.get("centroid_lat")
                coord_source = "mesh_centroid"
        if lon is None or lat is None:
            continue
        hazard_points.append({
            "report_id": r["id"],
            "title": r["title"],
            "verification_status": r["verification_status"],
            "verification_label": r["verification_label"],
            "is_sample": bool(r.get("is_sample")),
            "lon": float(lon),
            "lat": float(lat),
            "coord_source": coord_source,
        })

    base_adj: dict[str, list[tuple[str, float, str]]] = {k: [] for k in ARTERIAL_NODES}
    clear_adj: dict[str, list[tuple[str, float, str]]] = {k: [] for k in ARTERIAL_NODES}
    blocked_segments: list[dict[str, Any]] = []

    for u, v, label in ARTERIAL_EDGES:
        nu = ARTERIAL_NODES[u]
        nv = ARTERIAL_NODES[v]
        dist_km = _dist_km(nu["lon"], nu["lat"], nv["lon"], nv["lat"])
        base_adj[u].append((v, dist_km, label))
        base_adj[v].append((u, dist_km, label))

        hits: list[dict[str, Any]] = []
        for hp in hazard_points:
            d_m = _point_to_segment_meters(
                hp["lon"], hp["lat"],
                nu["lon"], nu["lat"],
                nv["lon"], nv["lat"],
            )
            if d_m <= block_radius_m:
                hits.append({
                    **hp,
                    "distance_m": round(d_m, 1),
                })

        if hits:
            blocked_segments.append({
                "from_id": u,
                "to_id": v,
                "label": label,
                "distance_km": round(dist_km, 2),
                "coordinates": [[nu["lon"], nu["lat"]], [nv["lon"], nv["lat"]]],
                "triggered_by": hits,
            })
        else:
            clear_adj[u].append((v, dist_km, label))
            clear_adj[v].append((u, dist_km, label))

    base_res = _dijkstra(base_adj, origin_id, destination_id)
    alt_res = _dijkstra(clear_adj, origin_id, destination_id)

    def format_route(res: tuple[list[str], list[str], float] | None) -> dict[str, Any]:
        if not res:
            return {
                "reachable": False,
                "node_ids": [],
                "node_names": [],
                "segments": [],
                "coordinates": [],
                "distance_km": None,
            }
        nids, segs, dist = res
        return {
            "reachable": True,
            "node_ids": nids,
            "node_names": [ARTERIAL_NODES[n]["name"] for n in nids],
            "segments": segs,
            "coordinates": [[ARTERIAL_NODES[n]["lon"], ARTERIAL_NODES[n]["lat"]] for n in nids],
            "distance_km": round(dist, 2),
        }

    baseline = format_route(base_res)
    alternative = format_route(alt_res)

    detour_delta_km: float | None = None
    rerouted = False
    if baseline["reachable"] and alternative["reachable"]:
        detour_delta_km = round(float(alternative["distance_km"]) - float(baseline["distance_km"]), 2)
        rerouted = baseline["node_ids"] != alternative["node_ids"]

    return {
        "is_simulation": True,
        "simulation_disclaimer": ROUTE_SIMULATION_DISCLAIMER,
        "origin": {"id": origin_id, **ARTERIAL_NODES[origin_id]},
        "destination": {"id": destination_id, **ARTERIAL_NODES[destination_id]},
        "settings": {
            "include_samples": include_samples,
            "avoid_unverified": avoid_unverified,
            "block_radius_m": block_radius_m,
            "active_road_hazard_points": len(hazard_points),
        },
        "blocked_segments": blocked_segments,
        "rerouted": rerouted,
        "detour_delta_km": detour_delta_km,
        "baseline_route": baseline,
        "alternative_route": alternative,
    }
