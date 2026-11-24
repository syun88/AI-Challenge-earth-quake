"""Hazard-map-integrated Evacuation Shelter Recommendation engine for Kyoto City.

Combines:
1. Official GSI / Kyoto City Designated Emergency Evacuation Sites (514 sites in kyoto_shelters.json)
2. J-SHIS 250m seismic hazard & surface ground amplification (ARV) + PLATEAU pre-1981 building density
3. Kyoto OpenStreetMap real street-network routing avoiding active road_blocked reports
4. Kyoto City Official Earthquake Hazard Map PDFs (https://www.bousai.city.kyoto.lg.jp/0000000196.html)
"""

from __future__ import annotations

import json
import math
import threading
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.constants import (
    HAZARD_TIER_LABELS,
    KYOTO_HAZARD_MAP_PORTAL,
    KYOTO_WARD_HAZARD_MAPS,
    ROUTE_SIMULATION_DISCLAIMER,
    WARD_CENTERS,
)
from app.route_sim import _ROAD_NET, _dist_km, _evaluate_network, _infer_ward_mesh

SHELTERS_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "processed" / "kyoto_shelters.json"
)

SCENARIO_LABELS: dict[str, str] = {
    "earthquake": "地震（指定緊急避難場所）",
    "post_quake_fire": "地震後の大規模火災（広域避難場所）",
    "multi_hazard": "複合災害（地震・水害・土砂対応）",
}


class OfficialShelterStore:
    """Thread-safe loader for Kyoto City's 514 official Designated Emergency Evacuation Sites."""

    def __init__(self, shelters_path: Path | None = None) -> None:
        self.shelters_path = shelters_path or SHELTERS_PATH
        self._lock = threading.Lock()
        self._loaded = False
        self._payload: dict[str, Any] = {}
        self._shelters: list[dict[str, Any]] = []

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            if not self.shelters_path.exists():
                raise HTTPException(
                    status_code=503,
                    detail="避難場所データが未構築です (`scripts/fetch_shelters.py` を実行してください)。",
                )
            data = json.loads(self.shelters_path.read_text(encoding="utf-8"))
            self._payload = data
            self._shelters = list(data.get("shelters") or [])
            self._loaded = True

    def list_shelters(
        self,
        *,
        ward: str | None = None,
        disaster_type: str | None = None,
        wide_area_only: bool = False,
        store: Any | None = None,
    ) -> list[dict[str, Any]]:
        self.ensure_loaded()
        out: list[dict[str, Any]] = []
        for s in self._shelters:
            if ward and ward != "all" and s["ward"] != ward:
                continue
            if wide_area_only and not s.get("is_wide_area"):
                continue
            if disaster_type and disaster_type != "all":
                dis = s.get("disasters") or {}
                if not dis.get(disaster_type):
                    continue
            item = dict(s)
            if store is not None and getattr(store, "loaded", False):
                item["hazard"] = _lookup_mesh_hazard(s["lat"], s["lon"], store)
            out.append(item)
        return out

    def get_meta(self) -> dict[str, Any]:
        self.ensure_loaded()
        return {
            "source": self._payload.get("source"),
            "source_url": self._payload.get("source_url"),
            "kyoto_hazard_map_url": KYOTO_HAZARD_MAP_PORTAL["earthquake_page_url"],
            "web_hazard_map_url": KYOTO_HAZARD_MAP_PORTAL["web_hazard_map_url"],
            "count": len(self._shelters),
        }


shelter_store = OfficialShelterStore()


def _lookup_mesh_hazard(lat: float, lon: float, store: Any | None) -> dict[str, Any] | None:
    if store is None or not getattr(store, "loaded", False) or not hasattr(store, "meshes"):
        return None
    try:
        sub = store.meshes.cx[lon : lon, lat : lat]
        if sub.empty:
            return None
        r = sub.iloc[0]
        tier = str(r.get("hazard_tier") or "unknown")
        t30 = r.get("t30_i55_ps")
        arv = r.get("arv")
        pre_share = r.get("pre_1981_share_known")
        return {
            "meshcode": str(r.get("meshcode") or ""),
            "ward_name": str(r.get("ward_name") or ""),
            "hazard_tier": tier,
            "hazard_label": HAZARD_TIER_LABELS.get(tier, "不明"),
            "t30_i55_ps": round(float(t30), 4) if t30 is not None and not math.isnan(float(t30)) else None,
            "arv": round(float(arv), 2) if arv is not None and not math.isnan(float(arv)) else None,
            "jname": str(r.get("jname") or "不明"),
            "pre_1981_count": int(r.get("pre_1981_count") or 0),
            "pre_1981_share_known": (
                round(float(pre_share), 4)
                if pre_share is not None and not math.isnan(float(pre_share))
                else None
            ),
        }
    except Exception:
        return None


def _get_ward_hazard_map_links(ward_name: str) -> dict[str, str]:
    ward_links = KYOTO_WARD_HAZARD_MAPS.get(ward_name, {})
    return {
        "earthquake_page_url": KYOTO_HAZARD_MAP_PORTAL["earthquake_page_url"],
        "web_hazard_map_url": KYOTO_HAZARD_MAP_PORTAL["web_hazard_map_url"],
        "ward_name": ward_name,
        "ward_map_pdf": ward_links.get("map_pdf", ""),
        "ward_info_pdf": ward_links.get("info_pdf", ""),
        "keihoku_map_pdf": ward_links.get("keihoku_map_pdf", ""),
        "keihoku_info_pdf": ward_links.get("keihoku_info_pdf", ""),
    }


def _strip_route(res: dict[str, Any]) -> dict[str, Any]:
    return {
        "reachable": res["reachable"],
        "node_ids": res["node_ids"],
        "node_names": res["node_names"],
        "segments": res["segments"],
        "coordinates": res["coordinates"],
        "distance_km": res["distance_km"],
    }


def recommend_shelters(
    *,
    lat: float | None = None,
    lon: float | None = None,
    ward: str | None = None,
    scenario: str = "earthquake",
    reports: list[dict[str, Any]],
    include_samples: bool = True,
    avoid_unverified: bool = True,
    block_radius_m: float = 420.0,
    limit: int = 5,
    store: Any | None = None,
) -> dict[str, Any]:
    """Recommend Kyoto City official emergency evacuation sites with hazard & road routing analysis."""
    if scenario not in SCENARIO_LABELS:
        raise HTTPException(status_code=400, detail=f"不正な災害シナリオです: {scenario}")

    if lat is None or lon is None:
        wc = WARD_CENTERS.get(ward or "中京区", WARD_CENTERS["中京区"])
        o_lat = float(wc["lat"])
        o_lon = float(wc["lon"])
    else:
        o_lat = float(lat)
        o_lon = float(lon)

    shelter_store.ensure_loaded()
    _ROAD_NET.ensure_loaded()

    origin_ward, origin_meshcode = _infer_ward_mesh(o_lat, o_lon, store=store)
    origin_mesh_hazard = _lookup_mesh_hazard(o_lat, o_lon, store)
    if origin_mesh_hazard and origin_mesh_hazard.get("ward_name"):
        origin_ward = origin_mesh_hazard["ward_name"]
    if origin_mesh_hazard and origin_mesh_hazard.get("meshcode"):
        origin_meshcode = origin_mesh_hazard["meshcode"]

    # Evaluate active road closures and shelter status citizen reports
    ev = _evaluate_network(
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store,
    )
    blocked_ids: set[int] = ev["blocked_edge_ids"]

    shelter_reports = [
        r
        for r in reports
        if not r.get("resolved")
        and r.get("category") == "shelter_status"
        and r.get("lat") is not None
        and r.get("lon") is not None
        and (include_samples or not r.get("is_sample"))
    ]

    # Filter official shelters by disaster scenario
    all_shelters = shelter_store.list_shelters()
    if scenario == "post_quake_fire":
        candidates = [s for s in all_shelters if s["disasters"].get("large_fire")]
    elif scenario == "multi_hazard":
        candidates = [
            s
            for s in all_shelters
            if s["disasters"].get("earthquake")
            and (s["disasters"].get("flood") or s["disasters"].get("inland_flood"))
        ]
        if not candidates:
            candidates = [s for s in all_shelters if s["disasters"].get("earthquake")]
    else:
        candidates = [s for s in all_shelters if s["disasters"].get("earthquake")]

    # Take closest 12 candidates by straight-line distance to run real street-network A*
    ranked_raw = sorted(
        candidates,
        key=lambda s: _dist_km(o_lon, o_lat, s["lon"], s["lat"]),
    )[:12]

    start_clear = _ROAD_NET.snap_point(o_lat, o_lon, blocked_ids, prefer_clear=True)
    start_base = _ROAD_NET.snap_point(o_lat, o_lon, None, prefer_clear=False)

    scored: list[tuple[float, dict[str, Any]]] = []
    for s in ranked_raw:
        crow_fly_km = round(_dist_km(o_lon, o_lat, s["lon"], s["lat"]), 2)
        goal_clear = _ROAD_NET.snap_point(s["lat"], s["lon"], blocked_ids, prefer_clear=True)
        goal_base = _ROAD_NET.snap_point(s["lat"], s["lon"], None, prefer_clear=False)

        alternative = _ROAD_NET.route_between(start_clear, goal_clear, blocked_ids)
        baseline = _ROAD_NET.route_between(start_base, goal_base, set())

        reachable = bool(alternative["reachable"])
        road_dist_km = float(alternative["distance_km"]) if reachable and alternative["distance_km"] is not None else None
        base_dist_km = (
            float(baseline["distance_km"])
            if baseline["reachable"] and baseline["distance_km"] is not None
            else None
        )
        walk_minutes = (
            max(1, round((road_dist_km / 4.0) * 60))
            if road_dist_km is not None
            else None
        )
        detour_delta_km = (
            round(road_dist_km - base_dist_km, 2)
            if road_dist_km is not None and base_dist_km is not None
            else None
        )
        rerouted = bool(
            reachable
            and baseline["reachable"]
            and (
                baseline["node_ids"] != alternative["node_ids"]
                or baseline["coordinates"] != alternative["coordinates"]
            )
        )

        # Shelter J-SHIS hazard & soil context
        sh_hazard = _lookup_mesh_hazard(s["lat"], s["lon"], store)

        # Check nearby shelter status citizen reports within 450m
        sh_status = "open"
        status_note = "指定緊急避難場所（開設想定・公式指定）"
        related_reports: list[dict[str, Any]] = []
        for sr in shelter_reports:
            d_sr = _dist_km(float(sr["lon"]), float(sr["lat"]), s["lon"], s["lat"])
            if d_sr <= 0.45:
                related_reports.append({
                    "report_id": sr["id"],
                    "title": sr["title"],
                    "verification_label": sr["verification_label"],
                })
                txt = f"{sr.get('title', '')} {sr.get('description', '')}"
                if any(k in txt for k in ["満員", "閉鎖", "使用不可", "被害", "不可"]):
                    sh_status = "restricted"
                    status_note = f"近傍報告により混雑・制限の可能性 ({sr['verification_label']})"
                elif any(k in txt for k in ["支援", "物資", "不足"]):
                    sh_status = "support_needed"
                    status_note = f"支援要請報告あり ({sr['verification_label']})"

        # Transparent composite ranking cost (lower = higher priority)
        eff_dist = road_dist_km if road_dist_km is not None else (crow_fly_km + 99.0)
        penalty = 0.0
        reasons: list[str] = []

        if sh_status == "restricted":
            penalty += 2.5
        elif sh_status == "support_needed":
            penalty += 0.3

        if s.get("is_wide_area"):
            penalty -= 0.08
            reasons.append("広域避難場所（延焼火災対応）")

        if sh_hazard:
            arv_val = sh_hazard.get("arv")
            pre_share = sh_hazard.get("pre_1981_share_known")
            if arv_val is not None:
                if arv_val <= 1.4:
                    penalty -= 0.1
                    reasons.append(f"地盤比較的良好 (ARV {arv_val})")
                elif arv_val >= 2.0:
                    penalty += 0.12
            if pre_share is not None and pre_share <= 0.3:
                penalty -= 0.05
                reasons.append("周辺旧耐震密度低")

        if rerouted:
            reasons.append("通行止め迂回ルート確保")

        if scenario == "multi_hazard" and s["disasters"].get("flood") and not s["disasters"].get("landslide"):
            reasons.append("水害・地震両対応")

        if not reachable:
            reasons.append("近傍通行止めにより迂回困難")

        composite = eff_dist + penalty

        # Construct route simulation compatible object for direct map visualization
        nav_payload = {
            "mode": "evacuate",
            "is_simulation": True,
            "simulation_disclaimer": ROUTE_SIMULATION_DISCLAIMER,
            "note": f"推薦避難場所: {s['name']}（{status_note}）",
            "origin": {
                "id": "shelter_rec_origin",
                "name": f"指定現在地（{origin_ward}）",
                "ward": origin_ward,
                "lon": o_lon,
                "lat": o_lat,
            },
            "destination": {
                "id": s["id"],
                "name": s["name"],
                "ward": s["ward"],
                "lon": s["lon"],
                "lat": s["lat"],
            },
            "settings": {
                "include_samples": include_samples,
                "avoid_unverified": avoid_unverified,
                "block_radius_m": min(float(block_radius_m), 65.0),
                "active_road_hazard_points": len(ev["hazard_points"]),
            },
            "blocked_segments": ev["blocked_segments"],
            "rerouted": rerouted,
            "detour_delta_km": detour_delta_km,
            "baseline_route": _strip_route(baseline),
            "alternative_route": _strip_route(alternative),
        }

        scored.append((
            composite,
            {
                **s,
                "crow_fly_km": crow_fly_km,
                "road_distance_km": round(road_dist_km, 2) if road_dist_km is not None else None,
                "baseline_distance_km": round(base_dist_km, 2) if base_dist_km is not None else None,
                "walk_minutes": walk_minutes,
                "rerouted": rerouted,
                "detour_delta_km": detour_delta_km,
                "reachable": reachable,
                "shelter_hazard": sh_hazard,
                "shelter_status": sh_status,
                "status_note": status_note,
                "related_reports": related_reports,
                "reasons": reasons,
                "nav_route": nav_payload,
            },
        ))

    scored.sort(key=lambda pair: pair[0])
    top_items: list[dict[str, Any]] = []
    for rank_idx, (_, item) in enumerate(scored[: max(1, min(limit, 10))], start=1):
        reasons = list(item["reasons"])
        if rank_idx == 1 and item["reachable"]:
            reasons.insert(0, "最優先推薦")
        elif item["road_distance_km"] is not None and not reasons:
            reasons.append("徒歩アクセス良好")
        item["rank"] = rank_idx
        item["reasons"] = reasons[:4]
        top_items.append(item)

    return {
        "scenario": scenario,
        "scenario_label": SCENARIO_LABELS[scenario],
        "is_simulation": True,
        "simulation_disclaimer": ROUTE_SIMULATION_DISCLAIMER,
        "origin": {
            "lat": round(o_lat, 6),
            "lon": round(o_lon, 6),
            "ward_name": origin_ward,
            "meshcode": origin_meshcode,
            "hazard": origin_mesh_hazard,
            "hazard_map_links": _get_ward_hazard_map_links(origin_ward),
        },
        "active_blocked_count": len(ev["closure_markers"]),
        "total_candidates": len(candidates),
        "recommendations": top_items,
    }
