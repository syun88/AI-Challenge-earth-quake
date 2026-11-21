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


# Training/simulation regional evacuation & rescue dispatch hubs mapped onto arterial nodes
SHELTER_RELIEF_HUBS: dict[str, dict[str, str]] = {
    "kyoto_st": {"title": "下京・京都駅 広域防災拠点（訓練モデル）", "role": "広域救護・物資集積"},
    "karasuma_oike": {"title": "中京・御池防災拠点（訓練モデル）", "role": "避難所・救援調整"},
    "sanjo_keihan": {"title": "東山・三条京阪拠点（訓練モデル）", "role": "避難・救護拠点"},
    "nagitsuji": {"title": "山科・椥辻拠点（訓練モデル）", "role": "避難所・地域支援"},
    "fushimi_east": {"title": "伏見・桃山東拠点（訓練モデル）", "role": "避難所・救援派遣"},
    "toji_kujo": {"title": "南区・九条東寺拠点（訓練モデル）", "role": "避難所・物資拠点"},
    "uzumasa": {"title": "右京・太秦天神川拠点（訓練モデル）", "role": "避難所・救護拠点"},
    "katsura": {"title": "西京・桂拠点（訓練モデル）", "role": "避難所・救援派遣"},
    "kitaoji_karasuma": {"title": "北区・北大路拠点（訓練モデル）", "role": "避難所・連絡拠点"},
    "karasuma_imadegawa": {"title": "上京・今出川拠点（訓練モデル）", "role": "避難所・連絡拠点"},
    "demachiyanagi": {"title": "左京・出町柳拠点（訓練モデル）", "role": "避難所・救援派遣"},
}


def find_nearest_node(
    lat: float,
    lon: float,
    allowed_nodes: set[str] | None = None,
) -> tuple[str, float]:
    """Snap a map coordinate (lat, lon) to the nearest arterial node, returning (node_id, distance_km)."""
    best_id = "kyoto_st"
    best_dist = float("inf")
    for nid, meta in ARTERIAL_NODES.items():
        if allowed_nodes is not None and nid not in allowed_nodes:
            continue
        d = _dist_km(lon, lat, meta["lon"], meta["lat"])
        if d < best_dist:
            best_dist = d
            best_id = nid
    return best_id, round(best_dist, 2)


def _evaluate_network(
    *,
    reports: list[dict[str, Any]],
    include_samples: bool = True,
    avoid_unverified: bool = True,
    block_radius_m: float = 420.0,
    store: Any | None = None,
) -> dict[str, Any]:
    """Evaluate road_blocked closures across all arterial segments and live shelter statuses."""
    hazard_points: list[dict[str, Any]] = []
    shelter_reports: list[dict[str, Any]] = []

    for r in reports:
        if r.get("resolved"):
            continue
        if r.get("is_sample") and not include_samples:
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

        if r.get("category") == "shelter_status" and lon is not None and lat is not None:
            shelter_reports.append({**r, "lon": float(lon), "lat": float(lat)})

        if r.get("category") != "road_blocked":
            continue
        if r.get("verification_status") == "unverified" and not avoid_unverified:
            continue
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
    edge_features: list[dict[str, Any]] = []

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

        coords = [[nu["lon"], nu["lat"]], [nv["lon"], nv["lat"]]]
        if hits:
            blocked_segments.append({
                "from_id": u,
                "to_id": v,
                "label": label,
                "distance_km": round(dist_km, 2),
                "coordinates": coords,
                "triggered_by": hits,
            })
            edge_features.append({
                "from_id": u,
                "to_id": v,
                "label": label,
                "status": "blocked",
                "coordinates": coords,
                "mid_lon": round((nu["lon"] + nv["lon"]) / 2.0, 5),
                "mid_lat": round((nu["lat"] + nv["lat"]) / 2.0, 5),
                "triggered_by": hits,
            })
        else:
            clear_adj[u].append((v, dist_km, label))
            clear_adj[v].append((u, dist_km, label))
            edge_features.append({
                "from_id": u,
                "to_id": v,
                "label": label,
                "status": "clear",
                "coordinates": coords,
                "mid_lon": round((nu["lon"] + nv["lon"]) / 2.0, 5),
                "mid_lat": round((nu["lat"] + nv["lat"]) / 2.0, 5),
                "triggered_by": [],
            })

    hubs: list[dict[str, Any]] = []
    for hid, meta in SHELTER_RELIEF_HUBS.items():
        node = ARTERIAL_NODES[hid]
        hub_status = "open"
        status_note = "訓練用モデル拠点（開設想定）"
        related_reports: list[dict[str, Any]] = []
        for sr in shelter_reports:
            d_km = _dist_km(sr["lon"], sr["lat"], node["lon"], node["lat"])
            if d_km <= 0.9:
                related_reports.append({
                    "report_id": sr["id"],
                    "title": sr["title"],
                    "verification_label": sr["verification_label"],
                })
                txt = f"{sr.get('title', '')} {sr.get('description', '')}"
                if any(k in txt for k in ["満員", "閉鎖", "使用不可", "被害", "不可"]):
                    hub_status = "restricted"
                    status_note = f"近傍報告により混雑/制限想定 ({sr['verification_label']})"
                elif any(k in txt for k in ["支援", "物資", "不足"]):
                    hub_status = "support_needed"
                    status_note = f"支援要請あり ({sr['verification_label']})"
        hubs.append({
            "id": hid,
            "name": meta["title"],
            "role": meta["role"],
            "ward": node["ward"],
            "lon": node["lon"],
            "lat": node["lat"],
            "hub_status": hub_status,
            "status_note": status_note,
            "related_reports": related_reports,
        })

    return {
        "hazard_points": hazard_points,
        "base_adj": base_adj,
        "clear_adj": clear_adj,
        "blocked_segments": blocked_segments,
        "edge_features": edge_features,
        "hubs": hubs,
    }


def get_network_status(
    *,
    reports: list[dict[str, Any]],
    include_samples: bool = True,
    avoid_unverified: bool = True,
    block_radius_m: float = 420.0,
    store: Any | None = None,
) -> dict[str, Any]:
    """Return full arterial closure overlay + shelter/relief hub statuses for map visualization."""
    ev = _evaluate_network(
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store,
    )
    return {
        "is_simulation": True,
        "simulation_disclaimer": ROUTE_SIMULATION_DISCLAIMER,
        "blocked_count": len(ev["blocked_segments"]),
        "total_segments": len(ev["edge_features"]),
        "edges": ev["edge_features"],
        "hubs": ev["hubs"],
    }


def _format_dijkstra_route(
    res: tuple[list[str], list[str], float] | None,
    prefix_coord: tuple[float, float] | None = None,
    suffix_coord: tuple[float, float] | None = None,
    prefix_km: float = 0.0,
    suffix_km: float = 0.0,
    prefix_label: str | None = None,
    suffix_label: str | None = None,
) -> dict[str, Any]:
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
    coords = [[ARTERIAL_NODES[n]["lon"], ARTERIAL_NODES[n]["lat"]] for n in nids]
    node_names = [ARTERIAL_NODES[n]["name"] for n in nids]
    final_segs = list(segs)
    total_km = dist
    if prefix_coord is not None:
        coords = [[prefix_coord[0], prefix_coord[1]], *coords]
        total_km += prefix_km
        if prefix_label:
            final_segs = [prefix_label, *final_segs]
    if suffix_coord is not None:
        coords = [*coords, [suffix_coord[0], suffix_coord[1]]]
        total_km += suffix_km
        if suffix_label:
            final_segs = [*final_segs, suffix_label]

    return {
        "reachable": True,
        "node_ids": nids,
        "node_names": node_names,
        "segments": final_segs,
        "coordinates": coords,
        "distance_km": round(total_km, 2),
    }


def simulate_navigation(
    *,
    mode: str,
    reports: list[dict[str, Any]],
    origin_id: str | None = None,
    destination_id: str | None = None,
    start_lat: float | None = None,
    start_lon: float | None = None,
    target_lat: float | None = None,
    target_lon: float | None = None,
    target_report_id: str | None = None,
    include_samples: bool = True,
    avoid_unverified: bool = True,
    block_radius_m: float = 420.0,
    store: Any | None = None,
) -> dict[str, Any]:
    """Unified simulation supporting Evacuation (point->nearest open hub), Rescue Dispatch (hub->incident), and Custom."""
    ev = _evaluate_network(
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store,
    )

    if mode == "custom":
        if not origin_id or not destination_id:
            raise HTTPException(status_code=400, detail="出発拠点と目的拠点を指定してください。")
        return simulate_alternative_route(
            origin_id=origin_id,
            destination_id=destination_id,
            reports=reports,
            include_samples=include_samples,
            avoid_unverified=avoid_unverified,
            block_radius_m=block_radius_m,
            store=store,
        )

    hub_by_id = {h["id"]: h for h in ev["hubs"]}

    if mode == "evacuate":
        # Snap clicked coordinate OR chosen origin node -> find nearest reachable non-restricted hub
        prefix_coord = None
        prefix_km = 0.0
        prefix_label = None
        clear_node_set = {k for k, edges in ev["clear_adj"].items() if len(edges) > 0} or None
        if start_lat is not None and start_lon is not None:
            entry_id, prefix_km = find_nearest_node(start_lat, start_lon, allowed_nodes=clear_node_set)
            prefix_coord = (float(start_lon), float(start_lat))
            prefix_label = f"指定地点から最寄り幹線（{ARTERIAL_NODES[entry_id]['name']}へ約{prefix_km}km）"
            origin_meta = {
                "id": "clicked_point",
                "name": "地図上の指定地点（現在地想定）",
                "ward": ARTERIAL_NODES[entry_id]["ward"],
                "lon": float(start_lon),
                "lat": float(start_lat),
            }
        elif origin_id and origin_id in ARTERIAL_NODES:
            entry_id = origin_id
            origin_meta = {"id": entry_id, **ARTERIAL_NODES[entry_id]}
        else:
            raise HTTPException(status_code=400, detail="地図上の地点または出発拠点を指定してください。")

        candidate_hubs = [h for h in ev["hubs"] if h["hub_status"] != "restricted"] or ev["hubs"]
        best_alt: tuple[str, tuple[list[str], list[str], float]] | None = None
        for h in candidate_hubs:
            res = _dijkstra(ev["clear_adj"], entry_id, h["id"])
            if res and (best_alt is None or res[2] < best_alt[1][2]):
                best_alt = (h["id"], res)

        if best_alt is None:
            fallback_hub = candidate_hubs[0]
            base_res = _dijkstra(ev["base_adj"], entry_id, fallback_hub["id"])
            alt_res = None
            chosen_hub_id = fallback_hub["id"]
        else:
            chosen_hub_id, alt_res = best_alt
            base_res = _dijkstra(ev["base_adj"], entry_id, chosen_hub_id)

        dest_hub = hub_by_id[chosen_hub_id]
        dest_meta = {
            "id": dest_hub["id"],
            "name": dest_hub["name"],
            "ward": dest_hub["ward"],
            "lon": dest_hub["lon"],
            "lat": dest_hub["lat"],
        }
        baseline = _format_dijkstra_route(base_res, prefix_coord=prefix_coord, prefix_km=prefix_km, prefix_label=prefix_label)
        alternative = _format_dijkstra_route(alt_res, prefix_coord=prefix_coord, prefix_km=prefix_km, prefix_label=prefix_label)
        return _build_nav_response(
            mode="evacuate",
            origin_meta=origin_meta,
            dest_meta=dest_meta,
            ev=ev,
            baseline=baseline,
            alternative=alternative,
            include_samples=include_samples,
            avoid_unverified=avoid_unverified,
            block_radius_m=block_radius_m,
            note=f"避難先候補: {dest_hub['name']}（{dest_hub['status_note']}）",
        )

    if mode == "rescue":
        # From nearest clear relief/shelter hub -> clicked target OR specific incident report
        target_name = "支援要請・被害報告現場"
        target_ward = "京都市"
        t_lon = target_lon
        t_lat = target_lat
        if target_report_id:
            rep = next((r for r in reports if r.get("id") == target_report_id), None)
            if not rep:
                raise HTTPException(status_code=404, detail="指定された報告が見つかりません。")
            target_name = f"現場: {rep['title']}"
            target_ward = rep["ward_name"]
            t_lon = rep.get("lon")
            t_lat = rep.get("lat")
            if (t_lon is None or t_lat is None) and rep.get("meshcode") and store is not None and getattr(store, "loaded", False):
                md = store.get_mesh_detail(str(rep["meshcode"]))
                if md:
                    t_lon = md.get("centroid_lon")
                    t_lat = md.get("centroid_lat")
            if t_lon is None or t_lat is None:
                from app.constants import WARD_CENTERS
                wc = WARD_CENTERS.get(target_ward, WARD_CENTERS["京都市全域"])
                t_lon, t_lat = wc["lon"], wc["lat"]

        clear_node_set = {k for k, edges in ev["clear_adj"].items() if len(edges) > 0} or None
        if t_lat is not None and t_lon is not None:
            exit_id, suffix_km = find_nearest_node(float(t_lat), float(t_lon), allowed_nodes=clear_node_set)
            suffix_coord = (float(t_lon), float(t_lat))
            suffix_label = f"幹線出口（{ARTERIAL_NODES[exit_id]['name']}）→ 現場周辺（約{suffix_km}km）"
            dest_meta = {
                "id": target_report_id or "target_point",
                "name": target_name,
                "ward": target_ward,
                "lon": float(t_lon),
                "lat": float(t_lat),
            }
        elif destination_id and destination_id in ARTERIAL_NODES:
            exit_id = destination_id
            suffix_coord = None
            suffix_km = 0.0
            suffix_label = None
            dest_meta = {"id": exit_id, **ARTERIAL_NODES[exit_id]}
        else:
            raise HTTPException(status_code=400, detail="救援先の報告または地図座標を指定してください。")

        if origin_id and origin_id in hub_by_id:
            chosen_hub = hub_by_id[origin_id]
            alt_res = _dijkstra(ev["clear_adj"], origin_id, exit_id)
            base_res = _dijkstra(ev["base_adj"], origin_id, exit_id)
        else:
            # Find nearest clear shelter/relief hub to dispatch rescue team/supplies
            best_pair: tuple[dict[str, Any], tuple[list[str], list[str], float]] | None = None
            for h in ev["hubs"]:
                res = _dijkstra(ev["clear_adj"], h["id"], exit_id)
                if res:
                    # Prefer hubs other than the exact exit node unless it's the only option
                    score = res[2] + (0.05 if h["hub_status"] == "open" else 1.5)
                    if best_pair is None or score < best_pair[1][2] + (0.05 if best_pair[0]["hub_status"] == "open" else 1.5):
                        best_pair = (h, res)
            if best_pair is None:
                chosen_hub = ev["hubs"][0]
                alt_res = None
                base_res = _dijkstra(ev["base_adj"], chosen_hub["id"], exit_id)
            else:
                chosen_hub, alt_res = best_pair
                base_res = _dijkstra(ev["base_adj"], chosen_hub["id"], exit_id)

        origin_meta = {
            "id": chosen_hub["id"],
            "name": chosen_hub["name"],
            "ward": chosen_hub["ward"],
            "lon": chosen_hub["lon"],
            "lat": chosen_hub["lat"],
        }
        baseline = _format_dijkstra_route(base_res, suffix_coord=suffix_coord, suffix_km=suffix_km, suffix_label=suffix_label)
        alternative = _format_dijkstra_route(alt_res, suffix_coord=suffix_coord, suffix_km=suffix_km, suffix_label=suffix_label)
        return _build_nav_response(
            mode="rescue",
            origin_meta=origin_meta,
            dest_meta=dest_meta,
            ev=ev,
            baseline=baseline,
            alternative=alternative,
            include_samples=include_samples,
            avoid_unverified=avoid_unverified,
            block_radius_m=block_radius_m,
            note=f"出動元拠点: {chosen_hub['name']}（{chosen_hub['role']}）",
        )

    raise HTTPException(status_code=400, detail=f"不正なナビゲーションモードです: {mode}")


def _build_nav_response(
    *,
    mode: str,
    origin_meta: dict[str, Any],
    dest_meta: dict[str, Any],
    ev: dict[str, Any],
    baseline: dict[str, Any],
    alternative: dict[str, Any],
    include_samples: bool,
    avoid_unverified: bool,
    block_radius_m: float,
    note: str | None = None,
) -> dict[str, Any]:
    detour_delta_km: float | None = None
    rerouted = False
    if baseline["reachable"] and alternative["reachable"]:
        detour_delta_km = round(float(alternative["distance_km"]) - float(baseline["distance_km"]), 2)
        rerouted = baseline["node_ids"] != alternative["node_ids"]
    return {
        "mode": mode,
        "is_simulation": True,
        "simulation_disclaimer": ROUTE_SIMULATION_DISCLAIMER,
        "note": note,
        "origin": origin_meta,
        "destination": dest_meta,
        "settings": {
            "include_samples": include_samples,
            "avoid_unverified": avoid_unverified,
            "block_radius_m": block_radius_m,
            "active_road_hazard_points": len(ev["hazard_points"]),
        },
        "blocked_segments": ev["blocked_segments"],
        "rerouted": rerouted,
        "detour_delta_km": detour_delta_km,
        "baseline_route": baseline,
        "alternative_route": alternative,
    }


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

    ev = _evaluate_network(
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store,
    )
    base_res = _dijkstra(ev["base_adj"], origin_id, destination_id)
    alt_res = _dijkstra(ev["clear_adj"], origin_id, destination_id)
    baseline = _format_dijkstra_route(base_res)
    alternative = _format_dijkstra_route(alt_res)

    return _build_nav_response(
        mode="custom",
        origin_meta={"id": origin_id, **ARTERIAL_NODES[origin_id]},
        dest_meta={"id": destination_id, **ARTERIAL_NODES[destination_id]},
        ev=ev,
        baseline=baseline,
        alternative=alternative,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
    )
