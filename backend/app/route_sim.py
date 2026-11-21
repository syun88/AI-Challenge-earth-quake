"""Kyoto real OpenStreetMap street-network routing & road-closure simulator.

Uses junction-compressed OSM Kyoto roads (`backend/data/processed/kyoto_roads.json.gz`)
to highlight exact closed street polylines and compute street-following evacuation,
rescue dispatch, and detour routes across Kyoto City. All routes are strictly labeled
for training and research simulation only.
"""

from __future__ import annotations

import gzip
import heapq
import json
import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.constants import ROUTE_SIMULATION_DISCLAIMER, WARD_CENTERS

ROAD_NETWORK_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "processed" / "kyoto_roads.json.gz"
)
GRID_DEG = 0.002  # ~200m uniform spatial grid cell

HIGHWAY_WEIGHT_FACTORS: dict[str, float] = {
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

# Selectable preset intersections / stations covering Kyoto's 11 wards (EPSG:4326)
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
    "fushimi_otesuji": {"name": "伏見桃山・大手筋（伏見区中心）", "ward": "伏見区", "lon": 135.7584, "lat": 34.9330},
    "fushimi_east": {"name": "伏見・総合庁舎北東拠点（伏見区東）", "ward": "伏見区", "lon": 135.7685, "lat": 34.9418},
    "chushojima": {"name": "中書島・竹田街道南（伏見区南）", "ward": "伏見区", "lon": 135.7596, "lat": 34.9254},
}

SHELTER_RELIEF_HUBS: dict[str, dict[str, str]] = {
    "kyoto_st": {"title": "下京・京都駅 広域防災拠点（訓練モデル）", "role": "広域救護・物資集積"},
    "karasuma_oike": {"title": "中京・御池防災拠点（訓練モデル）", "role": "避難所・救援調整"},
    "sanjo_keihan": {"title": "東山・三条京阪拠点（訓練モデル）", "role": "避難・救護拠点"},
    "nagitsuji": {"title": "山科・椥辻拠点（訓練モデル）", "role": "避難所・地域支援"},
    "fushimi_east": {"title": "伏見・桃山丹波橋拠点（訓練モデル）", "role": "避難所・救援派遣"},
    "toji_kujo": {"title": "南区・九条東寺拠点（訓練モデル）", "role": "避難所・物資拠点"},
    "uzumasa": {"title": "右京・太秦天神川拠点（訓練モデル）", "role": "避難所・救護拠点"},
    "katsura": {"title": "西京・桂拠点（訓練モデル）", "role": "避難所・救援派遣"},
    "kitaoji_karasuma": {"title": "北区・北大路拠点（訓練モデル）", "role": "避難所・連絡拠点"},
    "karasuma_imadegawa": {"title": "上京・今出川拠点（訓練モデル）", "role": "避難所・連絡拠点"},
    "demachiyanagi": {"title": "左京・出町柳拠点（訓練モデル）", "role": "避難所・救援派遣"},
}


@dataclass(slots=True)
class RoadEdge:
    idx: int
    u: int
    v: int
    name: str
    highway: str
    length_km: float
    weight_km: float
    coords: list[list[float]]
    mid_lon: float
    mid_lat: float


@dataclass(slots=True)
class SnappedPoint:
    edge_idx: int
    u: int
    v: int
    snap_lon: float
    snap_lat: float
    snap_dist_km: float
    name: str
    to_u_coords: list[list[float]]
    to_v_coords: list[list[float]]
    to_u_km: float
    to_v_km: float
    to_u_cost: float
    to_v_cost: float
    seg_idx: int


def _dist_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    lat_scale = 111.0
    lon_scale = 111.0 * math.cos(math.radians(35.0))
    return math.hypot((lon2 - lon1) * lon_scale, (lat2 - lat1) * lat_scale)


def _polyline_km(coords: list[list[float]]) -> float:
    total = 0.0
    for i in range(len(coords) - 1):
        total += _dist_km(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
    return total


def _project_point_to_segment(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
) -> tuple[float, float, float, float]:
    """Return (dist_m, t in [0..1], proj_lon, proj_lat) calibrated around Kyoto."""
    lon_m = 111000.0 * math.cos(math.radians(35.0))
    lat_m = 111000.0
    p_x, p_y = px * lon_m, py * lat_m
    a_x, a_y = ax * lon_m, ay * lat_m
    b_x, b_y = bx * lon_m, by * lat_m
    ab_x = b_x - a_x
    ab_y = b_y - a_y
    len_sq = ab_x * ab_x + ab_y * ab_y
    if len_sq <= 1e-6:
        return math.hypot(p_x - a_x, p_y - a_y), 0.0, ax, ay
    t = max(0.0, min(1.0, ((p_x - a_x) * ab_x + (p_y - a_y) * ab_y) / len_sq))
    proj_lon = round(ax + t * (bx - ax), 5)
    proj_lat = round(ay + t * (by - ay), 5)
    dist_m = math.hypot(p_x - (a_x + t * ab_x), p_y - (a_y + t * ab_y))
    return dist_m, t, proj_lon, proj_lat


def _project_to_polyline(px: float, py: float, coords: list[list[float]]) -> tuple[float, int, float, float]:
    best_dist = float("inf")
    best_seg = 0
    best_lon, best_lat = coords[0][0], coords[0][1]
    for i in range(len(coords) - 1):
        d_m, _, plon, plat = _project_point_to_segment(
            px, py, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]
        )
        if d_m < best_dist:
            best_dist = d_m
            best_seg = i
            best_lon, best_lat = plon, plat
    return best_dist, best_seg, best_lon, best_lat


class KyotoRoadNetwork:
    """Thread-safe lazy loader & A* street-routing graph for Kyoto City."""

    def __init__(self, path: Path = ROAD_NETWORK_PATH) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._loaded = False
        self.nodes: list[tuple[float, float]] = []
        self.edges: list[RoadEdge] = []
        self.adj: list[list[tuple[int, int, float]]] = []
        self.grid: dict[tuple[int, int], list[int]] = {}

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            if not self.path.exists():
                raise RuntimeError(f"Road network file not found: {self.path}")
            with gzip.open(self.path, "rb") as f:
                raw = json.loads(f.read().decode("utf-8"))

            names: list[str] = raw["names"]
            highways: list[str] = raw["highways"]
            self.nodes = [(float(n[0]), float(n[1])) for n in raw["nodes"]]
            self.adj = [[] for _ in range(len(self.nodes))]
            self.edges = []
            self.grid = {}

            for idx, item in enumerate(raw["edges"]):
                u, v, name_i, hw_i, length_m, coords = item
                hw = highways[hw_i] if hw_i < len(highways) else "residential"
                name = names[name_i] if name_i < len(names) else ""
                len_km = float(length_m) / 1000.0
                factor = HIGHWAY_WEIGHT_FACTORS.get(hw, 1.35)
                weight_km = max(0.001, len_km * factor)
                mid = coords[len(coords) // 2]
                edge = RoadEdge(
                    idx=idx,
                    u=int(u),
                    v=int(v),
                    name=name,
                    highway=hw,
                    length_km=len_km,
                    weight_km=weight_km,
                    coords=coords,
                    mid_lon=float(mid[0]),
                    mid_lat=float(mid[1]),
                )
                self.edges.append(edge)
                self.adj[edge.u].append((edge.v, idx, weight_km))
                self.adj[edge.v].append((edge.u, idx, weight_km))

                lons = [c[0] for c in coords]
                lats = [c[1] for c in coords]
                cx0 = int(math.floor(min(lons) / GRID_DEG))
                cx1 = int(math.floor(max(lons) / GRID_DEG))
                cy0 = int(math.floor(min(lats) / GRID_DEG))
                cy1 = int(math.floor(max(lats) / GRID_DEG))
                for cx in range(cx0, cx1 + 1):
                    for cy in range(cy0, cy1 + 1):
                        self.grid.setdefault((cx, cy), []).append(idx)

            self._loaded = True

    def _candidate_edges_near(self, lon: float, lat: float, radius_deg: float) -> set[int]:
        self.ensure_loaded()
        cx0 = int(math.floor((lon - radius_deg) / GRID_DEG))
        cx1 = int(math.floor((lon + radius_deg) / GRID_DEG))
        cy0 = int(math.floor((lat - radius_deg) / GRID_DEG))
        cy1 = int(math.floor((lat + radius_deg) / GRID_DEG))
        out: set[int] = set()
        for cx in range(cx0, cx1 + 1):
            for cy in range(cy0, cy1 + 1):
                if (cx, cy) in self.grid:
                    out.update(self.grid[(cx, cy)])
        return out

    def find_edges_for_closure(
        self,
        lon: float,
        lat: float,
        radius_m: float = 48.0,
        fallback_nearest_m: float = 180.0,
    ) -> list[tuple[int, float, float, float]]:
        """Find exact road segment(s) blocked by a road_blocked coordinate.

        Returns sorted tuples `(edge_idx, dist_m, snap_lon, snap_lat)`.
        Matches all road segments within `radius_m` (exact street/intersection), or
        falls back to the single nearest road edge within `fallback_nearest_m`.
        """
        search_m = max(radius_m, fallback_nearest_m) + 120.0
        cands = self._candidate_edges_near(lon, lat, search_m / 90000.0)
        measured: list[tuple[int, float, float, float]] = []
        for eidx in cands:
            edge = self.edges[eidx]
            d_m, _, plon, plat = _project_to_polyline(lon, lat, edge.coords)
            measured.append((eidx, d_m, plon, plat))
        measured.sort(key=lambda t: t[1])

        within = [m for m in measured if m[1] <= radius_m]
        if within:
            return within[:8]
        if measured and measured[0][1] <= fallback_nearest_m:
            return [measured[0]]
        return []

    def snap_point(
        self,
        lat: float,
        lon: float,
        blocked_edges: set[int] | None = None,
        prefer_clear: bool = True,
    ) -> SnappedPoint:
        """Snap an arbitrary map coordinate cleanly onto the nearest real Kyoto road polyline."""
        self.ensure_loaded()
        blocked = blocked_edges or set()
        best_clear: tuple[float, int, int, float, float] | None = None
        best_any: tuple[float, int, int, float, float] | None = None

        for rad_deg in (0.0025, 0.006, 0.015, 0.035):
            cands = self._candidate_edges_near(lon, lat, rad_deg)
            for eidx in cands:
                edge = self.edges[eidx]
                d_m, seg_idx, plon, plat = _project_to_polyline(lon, lat, edge.coords)
                cand = (d_m, eidx, seg_idx, plon, plat)
                if best_any is None or d_m < best_any[0]:
                    best_any = cand
                if eidx not in blocked and (best_clear is None or d_m < best_clear[0]):
                    best_clear = cand
            if (prefer_clear and best_clear is not None) or (not prefer_clear and best_any is not None):
                break

        chosen = (best_clear if prefer_clear and best_clear is not None else best_any)
        if chosen is None:
            # Emergency fallback to node 0
            e = self.edges[0]
            chosen = (1000.0, 0, 0, e.coords[0][0], e.coords[0][1])

        d_m, eidx, seg_idx, plon, plat = chosen
        edge = self.edges[eidx]
        snap_pt = [plon, plat]

        raw_u = [snap_pt, *reversed(edge.coords[: seg_idx + 1])]
        to_u_coords = _dedupe_coords(raw_u)
        to_v_coords = _dedupe_coords([snap_pt, *edge.coords[seg_idx + 1 :]])

        to_u_km = _polyline_km(to_u_coords)
        to_v_km = _polyline_km(to_v_coords)
        factor = HIGHWAY_WEIGHT_FACTORS.get(edge.highway, 1.35)

        return SnappedPoint(
            edge_idx=eidx,
            u=edge.u,
            v=edge.v,
            snap_lon=plon,
            snap_lat=plat,
            snap_dist_km=round(d_m / 1000.0, 3),
            name=edge.name or ("生活道路" if edge.highway in ("residential", "unclassified") else "幹線道路"),
            to_u_coords=to_u_coords,
            to_v_coords=to_v_coords,
            to_u_km=to_u_km,
            to_v_km=to_v_km,
            to_u_cost=to_u_km * factor,
            to_v_cost=to_v_km * factor,
            seg_idx=seg_idx,
        )

    def route_between(
        self,
        start: SnappedPoint,
        goal: SnappedPoint,
        blocked_edges: set[int] | None = None,
        start_pin: tuple[float, float] | None = None,
        end_pin: tuple[float, float] | None = None,
    ) -> dict[str, Any]:
        """Compute street-following route via admissible A* on Kyoto real road graph."""
        self.ensure_loaded()
        blocked = blocked_edges or set()

        # Direct same-edge shortcut
        if start.edge_idx == goal.edge_idx and start.edge_idx not in blocked:
            edge = self.edges[start.edge_idx]
            coords = _slice_same_edge_coords(edge.coords, start, goal)
            dist_km = _polyline_km(coords)
            full_coords = _attach_curb_pins(coords, start_pin, end_pin)
            segs = [f"{start.name} (約{max(10, round(dist_km * 1000))}m)"]
            return {
                "reachable": True,
                "node_ids": [f"r{start.u}", f"r{goal.v}"],
                "node_names": [start.name],
                "segments": segs,
                "coordinates": full_coords,
                "distance_km": round(max(0.01, dist_km), 2),
                "weighted_cost": dist_km,
            }

        goal_lon, goal_lat = goal.snap_lon, goal.snap_lat
        goal_nodes = {goal.u, goal.v}
        goal_branch_cost = {goal.u: goal.to_u_cost, goal.v: goal.to_v_cost}

        best_g: dict[int, float] = {}
        parent: dict[int, tuple[int | None, int | None]] = {}
        start_branch_edge: dict[int, int] = {}
        pq: list[tuple[float, float, int]] = []

        # Virtual start opens edges to start.u and start.v (unless edge blocked; snapped clear handles it)
        for node_id, cost in ((start.u, start.to_u_cost), (start.v, start.to_v_cost)):
            if node_id not in best_g or cost < best_g[node_id]:
                best_g[node_id] = cost
                parent[node_id] = (None, None)
                start_branch_edge[node_id] = start.edge_idx
                h = _dist_km(self.nodes[node_id][0], self.nodes[node_id][1], goal_lon, goal_lat) * 0.98
                heapq.heappush(pq, (cost + h, cost, node_id))

        best_total_cost = float("inf")
        best_end_node: int | None = None

        while pq:
            f_val, g_val, u = heapq.heappop(pq)
            if f_val >= best_total_cost:
                break
            if g_val > best_g.get(u, float("inf")):
                continue
            if u in goal_nodes:
                cand_total = g_val + goal_branch_cost[u]
                if cand_total < best_total_cost:
                    best_total_cost = cand_total
                    best_end_node = u

            for v, eidx, w_cost in self.adj[u]:
                if eidx in blocked:
                    continue
                ng = g_val + w_cost
                if ng < best_g.get(v, float("inf")) and ng < best_total_cost:
                    best_g[v] = ng
                    parent[v] = (u, eidx)
                    h = _dist_km(self.nodes[v][0], self.nodes[v][1], goal_lon, goal_lat) * 0.98
                    heapq.heappush(pq, (ng + h, ng, v))

        if best_end_node is None:
            return {
                "reachable": False,
                "node_ids": [],
                "node_names": [],
                "segments": [],
                "coordinates": [],
                "distance_km": None,
                "weighted_cost": float("inf"),
            }

        # Reconstruct chain
        rev_nodes: list[int] = []
        rev_edges: list[int] = []
        cur: int | None = best_end_node
        while cur is not None:
            rev_nodes.append(cur)
            prev_n, eidx = parent[cur]
            if eidx is not None:
                rev_edges.append(eidx)
            cur = prev_n
        node_chain = list(reversed(rev_nodes))
        edge_chain = list(reversed(rev_edges))

        start_node = node_chain[0]
        full_coords: list[list[float]] = []
        step_parts: list[tuple[str, float]] = []

        # 1) Start snap -> first junction node
        first_branch = list(reversed(start.to_u_coords if start_node == start.u else start.to_v_coords))
        # Wait: to_u_coords goes FROM snap_pt TO u, which is already forward order [snap_pt -> ... -> start_node]!
        first_branch = list(start.to_u_coords if start_node == start.u else start.to_v_coords)
        full_coords.extend(first_branch)
        first_len = _polyline_km(first_branch)
        if first_len > 0.005:
            step_parts.append((start.name, first_len))

        # 2) Graph edge polylines
        for i, eidx in enumerate(edge_chain):
            edge = self.edges[eidx]
            u_n = node_chain[i]
            seg_c = edge.coords if u_n == edge.u else list(reversed(edge.coords))
            full_coords.extend(seg_c)
            ename = edge.name or ("生活道路" if edge.highway in ("residential", "unclassified") else "幹線道路")
            step_parts.append((ename, edge.length_km))

        # 3) Final junction node -> goal snap
        last_branch_from_snap = goal.to_u_coords if best_end_node == goal.u else goal.to_v_coords
        last_branch = list(reversed(last_branch_from_snap))
        full_coords.extend(last_branch)
        last_len = _polyline_km(last_branch)
        if last_len > 0.005:
            step_parts.append((goal.name, last_len))

        street_coords = _dedupe_coords(full_coords)
        dist_km = _polyline_km(street_coords)
        final_coords = _attach_curb_pins(street_coords, start_pin, end_pin)
        merged_steps = _summarize_street_steps(step_parts)

        return {
            "reachable": True,
            "node_ids": [f"r{n}" for n in node_chain],
            "node_names": [s for s in merged_steps[:8]],
            "segments": merged_steps,
            "coordinates": final_coords,
            "distance_km": round(max(0.01, dist_km), 2),
            "weighted_cost": best_total_cost,
        }


_ROAD_NET = KyotoRoadNetwork()


def _dedupe_coords(coords: list[list[float]]) -> list[list[float]]:
    out: list[list[float]] = []
    for c in coords:
        pt = [round(float(c[0]), 5), round(float(c[1]), 5)]
        if not out or abs(out[-1][0] - pt[0]) > 1e-6 or abs(out[-1][1] - pt[1]) > 1e-6:
            out.append(pt)
    return out


def _attach_curb_pins(
    street_coords: list[list[float]],
    start_pin: tuple[float, float] | None,
    end_pin: tuple[float, float] | None,
) -> list[list[float]]:
    res = list(street_coords)
    if start_pin is not None and res:
        if _dist_km(start_pin[0], start_pin[1], res[0][0], res[0][1]) <= 0.15:
            res = [[round(start_pin[0], 5), round(start_pin[1], 5)], *res]
    if end_pin is not None and res:
        if _dist_km(end_pin[0], end_pin[1], res[-1][0], res[-1][1]) <= 0.15:
            res = [*res, [round(end_pin[0], 5), round(end_pin[1], 5)]]
    return _dedupe_coords(res)


def _slice_same_edge_coords(
    edge_coords: list[list[float]],
    start: SnappedPoint,
    goal: SnappedPoint,
) -> list[list[float]]:
    # Both snapped points lie on same edge. Order them along edge vertex indices + progress.
    s_pos = start.seg_idx + _dist_km(edge_coords[start.seg_idx][0], edge_coords[start.seg_idx][1], start.snap_lon, start.snap_lat)
    g_pos = goal.seg_idx + _dist_km(edge_coords[goal.seg_idx][0], edge_coords[goal.seg_idx][1], goal.snap_lon, goal.snap_lat)
    s_pt = [start.snap_lon, start.snap_lat]
    g_pt = [goal.snap_lon, goal.snap_lat]
    if s_pos <= g_pos:
        mid = edge_coords[start.seg_idx + 1 : goal.seg_idx + 1]
        return _dedupe_coords([s_pt, *mid, g_pt])
    mid = list(reversed(edge_coords[goal.seg_idx + 1 : start.seg_idx + 1]))
    return _dedupe_coords([s_pt, *mid, g_pt])


def _summarize_street_steps(parts: list[tuple[str, float]]) -> list[str]:
    merged: list[tuple[str, float]] = []
    for name, km in parts:
        clean_name = name or "一般街路"
        if merged and merged[-1][0] == clean_name:
            merged[-1] = (clean_name, merged[-1][1] + km)
        else:
            merged.append((clean_name, km))

    out: list[str] = []
    for name, km in merged:
        if km < 0.015 and len(merged) > 1:
            continue
        if km >= 1.0:
            dist_lbl = f"{km:.1f}km"
        else:
            dist_lbl = f"約{max(10, int(round(km * 1000 / 10.0) * 10))}m"
        out.append(f"{name} ({dist_lbl})")
    return out or ["現場周辺道路へ移動"]


def list_route_nodes() -> list[dict[str, Any]]:
    """Return sorted selectable preset nodes across Kyoto wards."""
    return [{"id": nid, **meta} for nid, meta in ARTERIAL_NODES.items()]


def find_nearest_node(lat: float, lon: float, allowed_nodes: set[str] | None = None) -> tuple[str, float]:
    """Return nearest preset node ID for backward compatibility."""
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
    block_radius_m: float = 48.0,
    store: Any | None = None,
) -> dict[str, Any]:
    """Evaluate active road_blocked reports onto real Kyoto street polylines & shelter statuses."""
    _ROAD_NET.ensure_loaded()
    # Keep localized road closure radius tight (<= 65m) even if caller passes a legacy broad radius
    eff_radius_m = min(float(block_radius_m), 65.0) if block_radius_m > 0 else 48.0

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

    blocked_edge_hits: dict[int, list[dict[str, Any]]] = {}
    closure_markers: list[dict[str, Any]] = []

    for hp in hazard_points:
        matches = _ROAD_NET.find_edges_for_closure(
            hp["lon"], hp["lat"], radius_m=eff_radius_m, fallback_nearest_m=180.0
        )
        if not matches:
            continue
        primary_eidx, _, p_lon, p_lat = matches[0]
        primary_edge = _ROAD_NET.edges[primary_eidx]
        closure_markers.append({
            "id": hp["report_id"],
            "label": primary_edge.name or f"{hp['title'][:18]}付近道路",
            "mid_lon": p_lon,
            "mid_lat": p_lat,
            "triggered_by": [hp],
        })
        for eidx, d_m, _, _ in matches:
            blocked_edge_hits.setdefault(eidx, []).append({**hp, "distance_m": round(d_m, 1)})

    blocked_edge_ids = set(blocked_edge_hits.keys())
    blocked_segments: list[dict[str, Any]] = []
    edge_features: list[dict[str, Any]] = []

    for eidx in sorted(blocked_edge_ids):
        edge = _ROAD_NET.edges[eidx]
        hits = blocked_edge_hits[eidx]
        label = edge.name or "通行止め街路区間"
        blocked_segments.append({
            "from_id": f"r{edge.u}",
            "to_id": f"r{edge.v}",
            "label": label,
            "distance_km": round(edge.length_km, 3),
            "coordinates": edge.coords,
            "triggered_by": hits,
        })
        edge_features.append({
            "from_id": f"r{edge.u}",
            "to_id": f"r{edge.v}",
            "label": label,
            "status": "blocked",
            "coordinates": edge.coords,
            "mid_lon": edge.mid_lon,
            "mid_lat": edge.mid_lat,
            "triggered_by": hits,
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
        "blocked_edge_ids": blocked_edge_ids,
        "blocked_segments": blocked_segments,
        "edge_features": edge_features,
        "closure_markers": closure_markers,
        "hubs": hubs,
    }


def get_network_status(
    *,
    reports: list[dict[str, Any]],
    include_samples: bool = True,
    avoid_unverified: bool = True,
    block_radius_m: float = 48.0,
    store: Any | None = None,
) -> dict[str, Any]:
    """Return active blocked street polylines + deduplicated markers + shelter hub statuses."""
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
        "blocked_count": len(ev["closure_markers"]),
        "total_segments": len(_ROAD_NET.edges),
        "edges": ev["edge_features"],
        "closure_markers": ev["closure_markers"],
        "hubs": ev["hubs"],
    }


def _strip_internal(res: dict[str, Any]) -> dict[str, Any]:
    return {
        "reachable": res["reachable"],
        "node_ids": res["node_ids"],
        "node_names": res["node_names"],
        "segments": res["segments"],
        "coordinates": res["coordinates"],
        "distance_km": res["distance_km"],
    }


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
        rerouted = (
            baseline["node_ids"] != alternative["node_ids"]
            or baseline["coordinates"] != alternative["coordinates"]
        )
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
            "block_radius_m": min(float(block_radius_m), 65.0),
            "active_road_hazard_points": len(ev["hazard_points"]),
        },
        "blocked_segments": ev["blocked_segments"],
        "rerouted": rerouted,
        "detour_delta_km": detour_delta_km,
        "baseline_route": _strip_internal(baseline),
        "alternative_route": _strip_internal(alternative),
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
    block_radius_m: float = 48.0,
    store: Any | None = None,
) -> dict[str, Any]:
    """Compute real-road evacuation, rescue dispatch, or custom two-point detour routes."""
    ev = _evaluate_network(
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store,
    )
    blocked_ids: set[int] = ev["blocked_edge_ids"]

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
        if start_lat is not None and start_lon is not None:
            o_lat, o_lon = float(start_lat), float(start_lon)
            origin_meta = {
                "id": "clicked_point",
                "name": "地図上の指定地点（現在地想定）",
                "ward": "京都市",
                "lon": o_lon,
                "lat": o_lat,
            }
        elif origin_id and origin_id in ARTERIAL_NODES:
            origin_meta = {"id": origin_id, **ARTERIAL_NODES[origin_id]}
            o_lat, o_lon = float(origin_meta["lat"]), float(origin_meta["lon"])
        else:
            raise HTTPException(status_code=400, detail="地図上の地点または出発拠点を指定してください。")

        start_clear = _ROAD_NET.snap_point(o_lat, o_lon, blocked_ids, prefer_clear=True)
        start_base = _ROAD_NET.snap_point(o_lat, o_lon, None, prefer_clear=False)

        candidate_hubs = [h for h in ev["hubs"] if h["hub_status"] != "restricted"] or ev["hubs"]
        # Evaluate top 4 closest hubs by crow-fly first, running A* on all 4 to pick true road shortest
        ranked_hubs = sorted(
            candidate_hubs,
            key=lambda h: _dist_km(o_lon, o_lat, h["lon"], h["lat"]),
        )[:4]

        best_choice: tuple[dict[str, Any], SnappedPoint, dict[str, Any]] | None = None
        for h in ranked_hubs:
            g_clear = _ROAD_NET.snap_point(h["lat"], h["lon"], blocked_ids, prefer_clear=True)
            res = _ROAD_NET.route_between(start_clear, g_clear, blocked_ids)
            if res["reachable"]:
                if best_choice is None or res["weighted_cost"] < best_choice[2]["weighted_cost"]:
                    best_choice = (h, g_clear, res)

        if best_choice is None:
            chosen_hub = ranked_hubs[0]
            g_base = _ROAD_NET.snap_point(chosen_hub["lat"], chosen_hub["lon"], None, prefer_clear=False)
            baseline = _ROAD_NET.route_between(start_base, g_base, set())
            alternative = {"reachable": False, "node_ids": [], "node_names": [], "segments": [], "coordinates": [], "distance_km": None}
        else:
            chosen_hub, _, alternative = best_choice
            g_base = _ROAD_NET.snap_point(chosen_hub["lat"], chosen_hub["lon"], None, prefer_clear=False)
            baseline = _ROAD_NET.route_between(start_base, g_base, set())

        dest_meta = {
            "id": chosen_hub["id"],
            "name": chosen_hub["name"],
            "ward": chosen_hub["ward"],
            "lon": chosen_hub["lon"],
            "lat": chosen_hub["lat"],
        }
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
            note=f"避難先候補: {chosen_hub['name']}（{chosen_hub['status_note']}）",
        )

    if mode == "rescue":
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
                wc = WARD_CENTERS.get(target_ward, WARD_CENTERS["京都市全域"])
                t_lon, t_lat = wc["lon"], wc["lat"]

        if t_lat is not None and t_lon is not None:
            d_lat, d_lon = float(t_lat), float(t_lon)
            dest_meta = {
                "id": target_report_id or "target_point",
                "name": target_name,
                "ward": target_ward,
                "lon": d_lon,
                "lat": d_lat,
            }
        elif destination_id and destination_id in ARTERIAL_NODES:
            dest_meta = {"id": destination_id, **ARTERIAL_NODES[destination_id]}
            d_lat, d_lon = float(dest_meta["lat"]), float(dest_meta["lon"])
        else:
            raise HTTPException(status_code=400, detail="救援先の報告または地図座標を指定してください。")

        goal_clear = _ROAD_NET.snap_point(d_lat, d_lon, blocked_ids, prefer_clear=True)
        goal_base = _ROAD_NET.snap_point(d_lat, d_lon, None, prefer_clear=False)

        if origin_id and origin_id in hub_by_id:
            chosen_hub = hub_by_id[origin_id]
            s_clear = _ROAD_NET.snap_point(chosen_hub["lat"], chosen_hub["lon"], blocked_ids, prefer_clear=True)
            s_base = _ROAD_NET.snap_point(chosen_hub["lat"], chosen_hub["lon"], None, prefer_clear=False)
            alternative = _ROAD_NET.route_between(s_clear, goal_clear, blocked_ids, end_pin=(d_lon, d_lat))
            baseline = _ROAD_NET.route_between(s_base, goal_base, set(), end_pin=(d_lon, d_lat))
        else:
            ranked_hubs = sorted(
                ev["hubs"],
                key=lambda h: _dist_km(d_lon, d_lat, h["lon"], h["lat"]),
            )[:4]
            best_pair: tuple[dict[str, Any], dict[str, Any], float] | None = None
            for h in ranked_hubs:
                s_clear = _ROAD_NET.snap_point(h["lat"], h["lon"], blocked_ids, prefer_clear=True)
                res = _ROAD_NET.route_between(s_clear, goal_clear, blocked_ids, end_pin=(d_lon, d_lat))
                if res["reachable"]:
                    penalty = 0.0 if h["hub_status"] == "open" else (0.35 if h["hub_status"] == "support_needed" else 1.8)
                    score = res["weighted_cost"] + penalty
                    if best_pair is None or score < best_pair[2]:
                        best_pair = (h, res, score)

            if best_pair is None:
                chosen_hub = ranked_hubs[0]
                s_base = _ROAD_NET.snap_point(chosen_hub["lat"], chosen_hub["lon"], None, prefer_clear=False)
                baseline = _ROAD_NET.route_between(s_base, goal_base, set(), end_pin=(d_lon, d_lat))
                alternative = {"reachable": False, "node_ids": [], "node_names": [], "segments": [], "coordinates": [], "distance_km": None}
            else:
                chosen_hub, alternative, _ = best_pair
                s_base = _ROAD_NET.snap_point(chosen_hub["lat"], chosen_hub["lon"], None, prefer_clear=False)
                baseline = _ROAD_NET.route_between(s_base, goal_base, set(), end_pin=(d_lon, d_lat))

        origin_meta = {
            "id": chosen_hub["id"],
            "name": chosen_hub["name"],
            "ward": chosen_hub["ward"],
            "lon": chosen_hub["lon"],
            "lat": chosen_hub["lat"],
        }
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


def simulate_alternative_route(
    *,
    origin_id: str,
    destination_id: str,
    reports: list[dict[str, Any]],
    include_samples: bool = True,
    avoid_unverified: bool = True,
    block_radius_m: float = 48.0,
    store: Any | None = None,
) -> dict[str, Any]:
    """Compute street-following shortest path and detour avoiding active road_blocked reports."""
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
    ori = ARTERIAL_NODES[origin_id]
    dst = ARTERIAL_NODES[destination_id]
    blocked_ids: set[int] = ev["blocked_edge_ids"]

    s_base = _ROAD_NET.snap_point(ori["lat"], ori["lon"], None, prefer_clear=False)
    g_base = _ROAD_NET.snap_point(dst["lat"], dst["lon"], None, prefer_clear=False)
    baseline = _ROAD_NET.route_between(s_base, g_base, set())

    s_clear = _ROAD_NET.snap_point(ori["lat"], ori["lon"], blocked_ids, prefer_clear=True)
    g_clear = _ROAD_NET.snap_point(dst["lat"], dst["lon"], blocked_ids, prefer_clear=True)
    alternative = _ROAD_NET.route_between(s_clear, g_clear, blocked_ids)

    return _build_nav_response(
        mode="custom",
        origin_meta={"id": origin_id, **ori},
        dest_meta={"id": destination_id, **dst},
        ev=ev,
        baseline=baseline,
        alternative=alternative,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
    )
