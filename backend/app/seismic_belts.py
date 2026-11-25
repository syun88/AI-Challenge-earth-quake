"""Kyoto seismic belt (fault zone) impact & relationship analysis based on Kyoto City Disaster Map (`jishin_lisk.html`).

Integrates the 11 official earthquake risk sources published at:
https://www.bousaimap.city.kyoto.lg.jp/help/jishin_lisk.html
with QuakeLens Kyoto 250m mesh hazard (J-SHIS), soil/microtopography (ARV/jname),
PLATEAU building age/historic counts, R8 municipal seismic facilities, and official shelters.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from app.r8_seismic import r8_seismic_store

KYOTO_JISHIN_RISK_URL = "https://www.bousaimap.city.kyoto.lg.jp/help/jishin_lisk.html"

SOFT_LIQUEFACTION_JNAMES = {"後背湿地", "氾濫平野", "自然堤防", "旧河道", "谷底平野", "干拓地", "埋立地"}

HISTORICAL_DISASTER_CASE = {
    "title": "文政13年7月京都地震（文政京都地震・1830年8月19日）",
    "estimated_magnitude": "M 6.5（推定）",
    "summary": (
        "現在の京都市〜亀岡市にかけて発生。仁和寺・妙心寺など寺院建物の倒壊・損壊が相次ぎ、"
        "愛宕山周辺では坊舎の谷底崩落や参道沿い茶屋の全壊など甚大な被害が発生しました。"
    ),
    "modern_lesson": (
        "1950年以前の歴史的木造・社寺建築と急傾斜地／土砂災害警戒域・木造密集街区の複合リスク対策に直結しています。"
    ),
    "source_url": KYOTO_JISHIN_RISK_URL,
}

# 11 earthquake scenarios explicitly listed in jishin_lisk.html
SEISMIC_BELTS: list[dict[str, Any]] = [
    {
        "id": "hanaore",
        "name": "花折断層帯",
        "short_name": "花折断層",
        "type": "内陸型活断層",
        "source_study": "京都市第3次地震被害想定（平成15年）",
        "magnitude_note": "M7.5前後想定（京都市域で最甚大な市街地被害想定）",
        "primary_risks": ["直下強震（震度6強〜7想定）", "木造旧耐震・京町家の倒壊・延焼", "東西幹線道路・ライフライン寸断"],
        "liquefaction_note": "北部は砂礫質台地中心だが、鴨川沿い・南端部は中〜低度液状化と複合。",
        "primary_wards": ["左京区", "上京区", "中京区", "東山区", "下京区", "北区"],
        "impact_radius_km": 4.5,
        "color": "#f43f5e",
        "coordinates": [
            [135.845, 35.165],
            [135.812, 35.105],
            [135.792, 35.052],
            [135.786, 35.018],
            [135.780, 34.992],
        ],
    },
    {
        "id": "momoyama_shishigatani",
        "name": "桃山～鹿ケ谷断層帯",
        "short_name": "桃山～鹿ケ谷",
        "type": "内陸型活断層",
        "source_study": "京都市第3次地震被害想定（平成15年）",
        "magnitude_note": "M6.6前後想定（京都盆地東縁・東山〜伏見直下）",
        "primary_risks": ["東山・伏見市街地の強震動", "文化財・歴史的建造物への直下揺れ", "斜面崩壊との複合"],
        "liquefaction_note": "東山縁辺は硬質〜扇状地だが、伏見側低地へ繋がる西側では液状化リスクが上昇。",
        "primary_wards": ["東山区", "伏見区", "左京区", "山科区", "下京区"],
        "impact_radius_km": 4.0,
        "color": "#fb923c",
        "coordinates": [
            [135.798, 35.028],
            [135.786, 34.998],
            [135.778, 34.962],
            [135.775, 34.922],
        ],
    },
    {
        "id": "katagihara_mio",
        "name": "樫原～水尾断層帯",
        "short_name": "樫原～水尾",
        "type": "内陸型活断層",
        "source_study": "京都市第3次地震被害想定（平成15年）",
        "magnitude_note": "M6.6前後想定（京都盆地西縁・西山麓）",
        "primary_risks": ["西京区・右京区南部の直下強震", "西山斜面・急傾斜地の土砂災害併発", "桂川西岸交通網遮断"],
        "liquefaction_note": "断層東側の桂川流域・後背湿地では液状化危険度との重なりに注意。",
        "primary_wards": ["西京区", "右京区", "南区"],
        "impact_radius_km": 4.0,
        "color": "#f59e0b",
        "coordinates": [
            [135.662, 35.038],
            [135.682, 34.996],
            [135.694, 34.964],
            [135.688, 34.932],
        ],
    },
    {
        "id": "ujigawa",
        "name": "宇治川断層",
        "short_name": "宇治川断層",
        "type": "内陸型活断層",
        "source_study": "京都府第2次地震被害想定（平成19年・液状化平成20年）",
        "magnitude_note": "南部低地直下・液状化連鎖が顕著な断層",
        "primary_risks": ["伏見南部〜宇治川沿いの強震", "広域液状化（後背湿地・氾濫平野）", "河川堤防・橋梁・物流網被害"],
        "liquefaction_note": "軟弱地盤（ARV高・後背湿地）と直接重なるため、液状化危険度との相関が市内最高水準。",
        "primary_wards": ["伏見区", "南区"],
        "impact_radius_km": 4.5,
        "color": "#ec4899",
        "coordinates": [
            [135.718, 34.928],
            [135.768, 34.908],
            [135.815, 34.892],
        ],
    },
    {
        "id": "komyoji_kanegahara",
        "name": "光明寺～金ヶ原断層",
        "short_name": "光明寺～金ヶ原",
        "type": "内陸型活断層",
        "source_study": "京都府第2次地震被害想定（平成19年・液状化平成20年）",
        "magnitude_note": "西京区南部〜乙訓境界の西縁断層",
        "primary_risks": ["西京区南部・住宅団地の強震", "丘陵造成地・盛土の変状リスク"],
        "liquefaction_note": "丘陵側は揺れ主体、東側低地部では局部的な液状化に留意。",
        "primary_wards": ["西京区", "南区"],
        "impact_radius_km": 4.0,
        "color": "#eab308",
        "coordinates": [
            [135.654, 34.956],
            [135.668, 34.924],
            [135.676, 34.896],
        ],
    },
    {
        "id": "arima_takatsuki",
        "name": "有馬・高槻断層系",
        "short_name": "有馬・高槻",
        "type": "内陸型活断層",
        "source_study": "京都府第2次地震被害想定（平成19年・液状化平成20年）",
        "magnitude_note": "大阪北部〜京都南西部に及ぶ主要広域活断層帯",
        "primary_risks": ["南西部からの強い東西地震動", "三川合流・伏見/南区低地の液状化", "京阪・JR・名神広域輸送寸断"],
        "liquefaction_note": "淀川水系・桂川・宇治川の氾濫平野で液状化危険度が増幅しやすい関係性。",
        "primary_wards": ["伏見区", "南区", "西京区"],
        "impact_radius_km": 5.0,
        "color": "#a855f7",
        "coordinates": [
            [135.648, 34.888],
            [135.712, 34.894],
            [135.774, 34.902],
        ],
    },
    {
        "id": "obaku",
        "name": "黄檗断層",
        "short_name": "黄檗断層",
        "type": "内陸型活断層",
        "source_study": "京都府第2次地震被害想定（平成19年・液状化平成20年）",
        "magnitude_note": "山科南部〜伏見東部（宇治黄檗沿い）",
        "primary_risks": ["山科・伏見東部の局地強震", "谷底平野・斜面の複合被害", "桃山断層との東縁近接域"],
        "liquefaction_note": "山地縁辺は揺れ・土砂主体、宇治川近傍低地では液状化が併発。",
        "primary_wards": ["伏見区", "山科区"],
        "impact_radius_km": 4.0,
        "color": "#06b6d4",
        "coordinates": [
            [135.818, 34.985],
            [135.814, 34.950],
            [135.806, 34.906],
        ],
    },
    {
        "id": "biwako_seigan",
        "name": "琵琶湖西岸断層",
        "short_name": "琵琶湖西岸",
        "type": "内陸型活断層",
        "source_study": "京都府第2次地震被害想定（平成19年・液状化平成20年）",
        "magnitude_note": "M7級広域想定（滋賀県側〜京都東北部へ波及）",
        "primary_risks": ["左京区・山科区・北区東部の強震", "比叡山系・逢坂周辺の道路寸断", "広域インフラ・琵琶湖疏水影響"],
        "liquefaction_note": "市域東部は山地・台地が主体だが、山科盆地低地部で揺れ増幅。",
        "primary_wards": ["左京区", "山科区", "北区"],
        "impact_radius_km": 7.5,
        "color": "#3b82f6",
        "coordinates": [
            [135.890, 35.150],
            [135.875, 35.060],
            [135.862, 34.995],
        ],
    },
    {
        "id": "tonoda_kamiki_koshihata",
        "name": "殿田・神吉・越畑断層",
        "short_name": "殿田・神吉・越畑",
        "type": "内陸型活断層",
        "source_study": "京都府第2次地震被害想定（平成19年）",
        "magnitude_note": "文政京都地震（1830年）に関連づけられる北西部断層帯",
        "primary_risks": ["右京区北西部・愛宕山周辺の激震", "山地斜面・坊舎/社寺・山間集落の孤立", "歴史的寺院建造物への直接脅威"],
        "liquefaction_note": "山間谷底・河川沿いを除き、土砂災害・落石・細街路寸断との関係が特に強い。",
        "primary_wards": ["右京区", "北区", "西京区"],
        "impact_radius_km": 7.0,
        "color": "#10b981",
        "coordinates": [
            [135.585, 35.125],
            [135.622, 35.076],
            [135.654, 35.034],
        ],
    },
    {
        "id": "kameoka",
        "name": "亀岡断層",
        "short_name": "亀岡断層",
        "type": "内陸型活断層",
        "source_study": "京都府第2次地震被害想定（平成19年）",
        "magnitude_note": "亀岡盆地〜京都市西部の境界域",
        "primary_risks": ["右京区・西京区西部の強震", "国道9号・山陰本線の交通支障", "西山山麓の斜面リスク"],
        "liquefaction_note": "保津川〜桂川合流低地で局所的な地盤増幅・液状化に注意。",
        "primary_wards": ["右京区", "西京区"],
        "impact_radius_km": 7.0,
        "color": "#14b8a6",
        "coordinates": [
            [135.588, 35.042],
            [135.612, 34.998],
            [135.635, 34.962],
        ],
    },
    {
        "id": "nankai_trough",
        "name": "南海トラフ巨大地震（陸側ケース）",
        "short_name": "南海トラフ",
        "type": "海溝型巨大地震",
        "source_study": "内閣府 南海トラフ巨大地震対策検討WG（第二次報告・平成25年）",
        "magnitude_note": "M9クラス（長時間継続・長周期地震動で盆地軟弱地盤が増幅）",
        "primary_risks": ["京都市全域での長時間の強い揺れ", "軟弱地盤（後背湿地・ARV高）での液状化顕在化", "中高層ビル・免震建物の長周期共振"],
        "liquefaction_note": "海溝型のため市内全メッシュが影響圏。特にARV≧1.6・後背湿地（伏見区・南区等）で液状化・地盤増幅と強く相関。",
        "primary_wards": ["伏見区", "南区", "下京区", "中京区", "右京区", "西京区", "東山区", "上京区", "山科区", "左京区", "北区"],
        "impact_radius_km": 999.0,  # Basin-wide scenario
        "color": "#6366f1",
        "coordinates": [],  # Offshore subduction source affecting entire basin
    },
]


def _dist_km_point_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    """Approximate planar-scaled distance in km from point (px=lon, py=lat) to segment AB."""
    cos_lat = math.cos(math.radians(35.0))
    px_k, py_k = px * 111.32 * cos_lat, py * 110.94
    ax_k, ay_k = ax * 111.32 * cos_lat, ay * 110.94
    bx_k, by_k = bx * 111.32 * cos_lat, by * 110.94
    dx, dy = bx_k - ax_k, by_k - ay_k
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq <= 1e-9:
        return math.hypot(px_k - ax_k, py_k - ay_k)
    t = max(0.0, min(1.0, ((px_k - ax_k) * dx + (py_k - ay_k) * dy) / seg_len_sq))
    cx, cy = ax_k + t * dx, ay_k + t * dy
    return math.hypot(px_k - cx, py_k - cy)


def _dist_km_to_polyline(lon: float, lat: float, coords: list[list[float]]) -> float:
    if not coords:
        return 0.0
    if len(coords) == 1:
        return _dist_km_point_to_segment(lon, lat, coords[0][0], coords[0][1], coords[0][0], coords[0][1])
    best = 999.0
    for i in range(len(coords) - 1):
        d = _dist_km_point_to_segment(
            lon, lat, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]
        )
        if d < best:
            best = d
    return best


def get_seismic_belts_geojson() -> dict[str, Any]:
    """Return GeoJSON FeatureCollection of the 10 mapped Kyoto inland active fault lines."""
    features = []
    for belt in SEISMIC_BELTS:
        if not belt["coordinates"]:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "id": belt["id"],
                "name": belt["name"],
                "short_name": belt["short_name"],
                "color": belt["color"],
                "source_study": belt["source_study"],
            },
            "geometry": {
                "type": "LineString",
                "coordinates": belt["coordinates"],
            },
        })
    return {"type": "FeatureCollection", "features": features}


def analyze_seismic_belts(
    store: Any,
    *,
    ward: str = "all",
    belt_id: str = "all",
    limit: int = 6,
) -> dict[str, Any]:
    """Analyze the 11 Kyoto seismic belts' spatial impact, soil/liquefaction, and heritage relationships."""
    meshes = store.meshes
    buildings = store.buildings

    if meshes.empty:
        return {
            "source_url": KYOTO_JISHIN_RISK_URL,
            "ward": ward,
            "belt_id": belt_id,
            "historical_case": HISTORICAL_DISASTER_CASE,
            "belts": [],
            "belts_geojson": get_seismic_belts_geojson(),
            "multi_belt_hotspots": [],
            "ward_belt_matrix": [],
            "relationship_insights": [],
        }

    # Pre-aggregate historic (<=1950) & residential counts per mesh from buildings
    hist_by_mesh: dict[str, int] = {}
    res_pre81_by_mesh: dict[str, int] = {}
    if not buildings.empty and "meshcode" in buildings.columns:
        is_hist = buildings["year_built"].notna() & (buildings["year_built"] <= 1950)
        is_res_pre81 = (buildings["usage_group"] == "residential") & (buildings["age_category"] == "pre_1981")
        b_agg = pd.DataFrame({
            "meshcode": buildings["meshcode"].values,
            "hist": is_hist.values.astype(int),
            "res_pre81": is_res_pre81.values.astype(int),
        }).groupby("meshcode", as_index=False).sum()
        hist_by_mesh = dict(zip(b_agg["meshcode"], b_agg["hist"]))
        res_pre81_by_mesh = dict(zip(b_agg["meshcode"], b_agg["res_pre81"]))

    r8_records = r8_seismic_store.get_summary_and_list(ward=ward, limit=1500)["records"]
    r8_by_ward: dict[str, dict[str, int]] = {}
    for rec in r8_records:
        w = rec["ward"]
        d = r8_by_ward.setdefault(w, {"total": 0, "needs_retrofit": 0})
        d["total"] += 1
        if rec["needs_retrofit"]:
            d["needs_retrofit"] += 1

    scope_meshes = meshes if not ward or ward == "all" else meshes[meshes["ward_name"] == ward]

    # Pre-extract mesh rows as compact dicts for fast multi-belt intersection
    mesh_rows: list[dict[str, Any]] = []
    for _, r in scope_meshes.iterrows():
        mc = str(r["meshcode"])
        jname = str(r.get("jname") or "不明")
        arv = float(r["arv"]) if pd.notna(r.get("arv")) else 1.0
        t30 = float(r["t30_i55_ps"]) if pd.notna(r.get("t30_i55_ps")) else 0.0
        is_soft = (jname in SOFT_LIQUEFACTION_JNAMES) or (arv >= 1.6)
        mesh_rows.append({
            "meshcode": mc,
            "ward_name": str(r.get("ward_name") or ""),
            "lat": float(r["centroid_lat"]),
            "lon": float(r["centroid_lon"]),
            "jname": jname,
            "arv": arv,
            "t30": t30,
            "is_soft": is_soft,
            "total_b": int(r.get("total_buildings") or 0),
            "pre81": int(r.get("pre_1981_count") or 0),
            "wood81": int(r.get("wooden_pre_1981_count") or 0),
            "hist": int(hist_by_mesh.get(mc, 0)),
            "res_pre81": int(res_pre81_by_mesh.get(mc, 0)),
        })

    belt_results: list[dict[str, Any]] = []
    # Track which inland fault belts intersect each mesh for multi-belt hotspot analysis
    mesh_inland_hits: dict[str, list[dict[str, Any]]] = {}
    ward_belt_scores: dict[str, dict[str, dict[str, Any]]] = {}

    for belt in SEISMIC_BELTS:
        bid = belt["id"]
        is_nankai = bid == "nankai_trough"
        radius_km = float(belt["impact_radius_km"])

        impacted: list[dict[str, Any]] = []
        min_d_overall = 999.0
        for m in mesh_rows:
            if is_nankai:
                # For basin-wide Nankai Trough, highlight soft-ground / ARV>=1.5 high-amplification meshes as acute impact
                d_km = 0.0
                if m["is_soft"] or m["arv"] >= 1.5:
                    impacted.append({**m, "dist_km": 0.0})
            else:
                d_km = _dist_km_to_polyline(m["lon"], m["lat"], belt["coordinates"])
                if d_km < min_d_overall:
                    min_d_overall = d_km
                if d_km <= radius_km:
                    impacted.append({**m, "dist_km": round(d_km, 2)})
                    mesh_inland_hits.setdefault(m["meshcode"], []).append({
                        "id": bid,
                        "short_name": belt["short_name"],
                        "dist_km": round(d_km, 2),
                        "color": belt["color"],
                    })

            w_entry = ward_belt_scores.setdefault(m["ward_name"], {}).setdefault(
                bid,
                {"belt_id": bid, "short_name": belt["short_name"], "min_dist_km": 999.0, "impact_buildings": 0, "soft_meshes": 0},
            )
            if not is_nankai and d_km < w_entry["min_dist_km"]:
                w_entry["min_dist_km"] = round(d_km, 2)
            if is_nankai and (m["is_soft"] or m["arv"] >= 1.5):
                w_entry["min_dist_km"] = 0.0
                w_entry["impact_buildings"] += m["total_b"]
                w_entry["soft_meshes"] += 1
            elif not is_nankai and d_km <= radius_km:
                w_entry["impact_buildings"] += m["total_b"]
                if m["is_soft"]:
                    w_entry["soft_meshes"] += 1

        exp_b = sum(x["total_b"] for x in impacted)
        pre81_b = sum(x["pre81"] for x in impacted)
        wood81_b = sum(x["wood81"] for x in impacted)
        hist_b = sum(x["hist"] for x in impacted)
        soft_meshes = sum(1 for x in impacted if x["is_soft"])
        avg_arv = round(sum(x["arv"] for x in impacted) / len(impacted), 2) if impacted else None
        top_wards_counts: dict[str, int] = {}
        for x in impacted:
            top_wards_counts[x["ward_name"]] = top_wards_counts.get(x["ward_name"], 0) + x["pre81"] + x["hist"]
        impacted_wards = [
            w for w, _ in sorted(top_wards_counts.items(), key=lambda kv: kv[1], reverse=True)
        ][:4]

        # Focus point for map fly-to
        if impacted:
            anchor = max(impacted, key=lambda x: x["hist"] * 2 + x["wood81"] + x["pre81"])
            focus_lat, focus_lon = anchor["lat"], anchor["lon"]
        elif belt["coordinates"]:
            mid = belt["coordinates"][len(belt["coordinates"]) // 2]
            focus_lon, focus_lat = mid[0], mid[1]
        else:
            focus_lat, focus_lon = 34.96, 135.755

        liq_ratio = round(soft_meshes / len(impacted), 3) if impacted else 0.0
        # Impact severity score for sorting
        composite_score = (
            hist_b * 2 + pre81_b + (soft_meshes * 80) + (5000 if bid == "hanaore" else 0)
        )

        # Relationship summary linking belt -> soil/liquefaction + historic/residential + evacuation
        if is_nankai:
            rel_summary = (
                f"軟弱地盤（後背湿地等/ARV≧1.6）{soft_meshes}メッシュで液状化・長周期揺れ増幅が顕著。"
                f"該当域の旧耐震 {pre81_b:,}棟は長時間揺れによる累積損傷と液状化対策が焦点。"
            )
        elif liq_ratio >= 0.35:
            rel_summary = (
                f"強震域メッシュの {liq_ratio * 100:.0f}% が軟弱・液状化傾向地盤（ARV平均 {avg_arv}）と重複。"
                "「震度被害 × 液状化による道路段差・避難阻害」の複合関係が強い断層帯です。"
            )
        elif hist_b >= 2000:
            rel_summary = (
                f"影響圏内に1950年以前の歴史的建造物 {hist_b:,}棟・木造旧耐震 {wood81_b:,}棟が集中。"
                "「直下型強震 × 京町家・木造密集の倒壊/延焼連鎖」との相関が極めて高い断層帯です。"
            )
        else:
            rel_summary = (
                f"影響圏内に旧耐震建物 {pre81_b:,}棟（うち木造 {wood81_b:,}棟）。"
                "地形境界・斜面近傍の道路寸断や住宅耐震化（P1〜P3）と直接関係します。"
            )

        belt_results.append({
            "id": bid,
            "name": belt["name"],
            "short_name": belt["short_name"],
            "type": belt["type"],
            "source_study": belt["source_study"],
            "magnitude_note": belt["magnitude_note"],
            "primary_risks": belt["primary_risks"],
            "liquefaction_note": belt["liquefaction_note"],
            "relationship_summary": rel_summary,
            "color": belt["color"],
            "coordinates": belt["coordinates"],
            "focus_lat": round(focus_lat, 6),
            "focus_lon": round(focus_lon, 6),
            "impact": {
                "mesh_count": len(impacted),
                "exposed_buildings": exp_b,
                "pre_1981_count": pre81_b,
                "wooden_pre_1981_count": wood81_b,
                "historic_pre1950_count": hist_b,
                "soft_soil_meshes": soft_meshes,
                "liquefaction_overlap_rate": liq_ratio,
                "avg_arv": avg_arv,
                "impacted_wards": impacted_wards or belt["primary_wards"][:3],
                "min_distance_km": None if min_d_overall > 900 else round(min_d_overall, 2),
                "composite_score": composite_score,
            },
        })

    belt_results.sort(key=lambda b: b["impact"]["composite_score"], reverse=True)
    if belt_id and belt_id != "all":
        filtered_belts = [b for b in belt_results if b["id"] == belt_id]
        if filtered_belts:
            # Keep full ranking reference, but prioritize selected belt first
            belt_results = filtered_belts + [b for b in belt_results if b["id"] != belt_id]

    # Identify Multi-Belt Overlap Hotspots (meshes influenced by >=2 inland fault zones + high old/soft exposure)
    mesh_lookup = {m["meshcode"]: m for m in mesh_rows}
    hotspots: list[dict[str, Any]] = []
    for mc, hits in mesh_inland_hits.items():
        if len(hits) < 2:
            continue
        m = mesh_lookup[mc]
        if belt_id and belt_id != "all" and not any(h["id"] == belt_id for h in hits):
            continue
        hits_sorted = sorted(hits, key=lambda h: h["dist_km"])
        score = len(hits) * 400 + m["hist"] * 3 + m["pre81"] * 2 + (300 if m["is_soft"] else 0)
        hotspots.append({
            "meshcode": mc,
            "ward_name": m["ward_name"],
            "centroid_lat": round(m["lat"], 6),
            "centroid_lon": round(m["lon"], 6),
            "jname": m["jname"],
            "arv": round(m["arv"], 2),
            "t30_i55_ps": round(m["t30"], 4),
            "is_liquefaction_prone": m["is_soft"],
            "total_buildings": m["total_b"],
            "pre_1981_count": m["pre81"],
            "historic_pre1950_count": m["hist"],
            "overlapping_belts": hits_sorted[:4],
            "belt_count": len(hits),
            "risk_score": int(score),
            "note": (
                f"{len(hits)}つの断層帯の想定強震域が重複（同時発生ではないが、いずれが動いても強震・"
                + ("液状化" if m["is_soft"] else "旧耐震建物被害")
                + "リスクが顕在化しやすい地点）"
            ),
        })
    hotspots.sort(key=lambda h: h["risk_score"], reverse=True)
    top_hotspots = [{"rank": i, **h} for i, h in enumerate(hotspots[:limit], start=1)]

    # Ward-to-belt correlation matrix
    ward_matrix: list[dict[str, Any]] = []
    for w_name, bmap in ward_belt_scores.items():
        if not w_name or w_name == "不明":
            continue
        inland_list = [
            v for bid, v in bmap.items()
            if bid != "nankai_trough" and v["impact_buildings"] > 0
        ]
        inland_list.sort(key=lambda x: (-x["impact_buildings"], x["min_dist_km"]))
        nankai_info = bmap.get("nankai_trough", {})
        ward_matrix.append({
            "ward_name": w_name,
            "dominant_belts": inland_list[:3],
            "nankai_soft_meshes": nankai_info.get("soft_meshes", 0),
        })
    ward_matrix.sort(
        key=lambda x: (x["dominant_belts"][0]["impact_buildings"] if x["dominant_belts"] else 0),
        reverse=True,
    )

    relationship_insights = [
        {
            "title": "1. 直下型断層 × 歴史的建築・木造密集の関係",
            "summary": (
                "花折断層帯・桃山～鹿ケ谷断層帯の想定強震域は、1950年以前の京町家・伝統建築や1981年以前の木造密集と広く重なります。"
                "揺れそのものに加え、木造密集での地震火災延焼が最大の複合リスクです。"
            ),
        },
        {
            "title": "2. 南部断層・南海トラフ × 液状化危険度分布の関係",
            "summary": (
                "宇治川断層・有馬・高槻断層系および南海トラフ巨大地震は、伏見区・南区などの後背湿地・氾濫平野（ARV≧1.6）と強く関係し、"
                "強震だけでなく液状化による道路段差・建物傾斜・避難経路遮断を引き起こします。"
            ),
        },
        {
            "title": "3. 複数断層重複エリア（*1 注記の正しい読み方）",
            "summary": (
                "jishin_lisk.html の全地震ハザードマップは「複数断層の同時発生」ではなく「各地点で最大震度・最大液状化リスクを重ね合わせた結果」です。"
                "東山〜伏見・山科や西山麓のように2〜4断層の影響圏が重なる地域は、どの断層が動いても強震を受けるため優先耐震化と広域避難確保が重要です。"
            ),
        },
    ]

    return {
        "source_url": KYOTO_JISHIN_RISK_URL,
        "ward": ward,
        "belt_id": belt_id,
        "historical_case": HISTORICAL_DISASTER_CASE,
        "belts": belt_results,
        "belts_geojson": get_seismic_belts_geojson(),
        "multi_belt_hotspots": top_hotspots,
        "ward_belt_matrix": ward_matrix,
        "relationship_insights": relationship_insights,
        "disclaimer": (
            "※出典：京都市防災情報マップ『地震リスク｜解説（jishin_lisk.html）』。"
            "「全地震」の想定は同時に複数の断層地震が発生する想定ではなく、各断層帯・南海トラフ地震の最大想定影響と"
            "地盤(J-SHIS)・建物データ(PLATEAU)との関係性を分析したものです。"
        ),
    }
