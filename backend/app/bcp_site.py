"""Enterprise BCP / Critical Facility Safe Site Recommendation Engine for Kyoto City.

Combines:
1. J-SHIS 250m seismic hazard probabilities (t30_i55_ps, t30_i60_ps) & surface soil firmness (ARV, AVS, JNAME)
2. PLATEAU building age & wooden pre-1981 fire-spread / road-blockage density
3. Kyoto City R8_list.pdf (市有建築物耐震性能リスト 949 wings) municipal infrastructure readiness per ward
4. Official Kyoto City Designated Emergency Evacuation Sites (kyoto_shelters.json) proximity & flood/landslide check
"""

from __future__ import annotations

import math
from typing import Any

from app.constants import HAZARD_TIER_LABELS
from app.r8_seismic import R8_PAGE_URL, R8_PDF_URL, r8_seismic_store
from app.route_sim import _dist_km
from app.shelter_rec import shelter_store

BCP_PURPOSE_LABELS: dict[str, str] = {
    "datacenter_server": "サーバー室・データセンター・金庫（揺れ・地盤重視）",
    "bcp_hq": "災害時BCP代替拠点・オフィス（公的防災拠点連携重視）",
    "logistics_storage": "重要書類・資機材備蓄倉庫（周辺延焼・倒壊回避重視）",
}

LANDSLIDE_PRONE_JNAMES = {"山地", "山麓地", "丘陵"}
SOFT_LIQUEFACTION_JNAMES = {"後背湿地", "旧河道・旧池沼", "干拓地", "河原", "谷底低地"}
FIRM_FLAT_JNAMES = {"砂礫質台地", "扇状地", "自然堤防", "岩石台地"}


def _safe_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _compute_mesh_safety_score(
    *,
    t30_i55: float,
    arv: float,
    avs: float | None,
    pre81_share: float,
    wooden_pre81: int,
    jname: str,
    r8_ward_safe_rate: float,
    purpose: str,
) -> float:
    """Compute a transparent 0-100 comparative safety index within Kyoto (higher = safer)."""
    # Normalize components cleanly into 0..1 sub-scores
    # 1) Low 30y intensity 6-lower probability (0.01..0.55 -> 1..0)
    prob_score = max(0.0, min(1.0, 1.0 - (t30_i55 / 0.45)))
    # 2) Low amplification ARV (0.6..2.2 -> 1..0)
    arv_score = max(0.0, min(1.0, 1.0 - ((arv - 0.65) / 1.45)))
    # 3) Firm shear-wave velocity AVS (150..650 -> 0..1)
    avs_val = avs if avs is not None else 300.0
    avs_score = max(0.0, min(1.0, (avs_val - 150.0) / 450.0))
    # 4) Low surrounding pre-1981 collapse/fire-spread share
    surround_score = max(0.0, min(1.0, 1.0 - pre81_share * 0.85 - min(wooden_pre81, 80) / 260.0))
    # 5) Landform bonus for firm flat terraces vs soft/steep terrain
    if jname in FIRM_FLAT_JNAMES:
        landform_score = 1.0 if jname == "砂礫質台地" else 0.85
    elif jname in SOFT_LIQUEFACTION_JNAMES:
        landform_score = 0.25
    elif jname == "丘陵":
        landform_score = 0.7
    else:
        landform_score = 0.55

    if purpose == "bcp_hq":
        w_prob, w_arv, w_avs, w_sur, w_land, w_r8 = 0.30, 0.20, 0.12, 0.16, 0.10, 0.12
    elif purpose == "logistics_storage":
        w_prob, w_arv, w_avs, w_sur, w_land, w_r8 = 0.28, 0.18, 0.10, 0.26, 0.10, 0.08
    else:  # datacenter_server
        w_prob, w_arv, w_avs, w_sur, w_land, w_r8 = 0.32, 0.24, 0.16, 0.12, 0.10, 0.06

    total = (
        w_prob * prob_score
        + w_arv * arv_score
        + w_avs * avs_score
        + w_sur * surround_score
        + w_land * landform_score
        + w_r8 * r8_ward_safe_rate
    )
    return round(total * 100.0, 1)


def recommend_safe_enterprise_sites(
    store: Any,
    *,
    ward: str = "all",
    purpose: str = "datacenter_server",
    avoid_mountain: bool = True,
    min_buildings: int = 15,
    limit: int = 6,
) -> dict[str, Any]:
    """Recommend comparatively safer Kyoto locations for corporate critical infrastructure / BCP bases."""
    if purpose not in BCP_PURPOSE_LABELS:
        purpose = "datacenter_server"

    r8_summary = r8_seismic_store.get_summary_and_list(ward="all", limit=1000)
    r8_by_ward: dict[str, dict[str, int]] = {}
    r8_safe_examples: dict[str, list[str]] = {}
    for item in r8_summary.get("by_ward", []):
        w = item["ward"]
        r8_by_ward[w] = {
            "total": item["total"],
            "safe": item["safe"],
            "needs_retrofit": item["needs_retrofit"],
        }
    for rec in r8_summary.get("records", []):
        w = rec.get("ward") or ""
        if not rec.get("needs_retrofit") and len(r8_safe_examples.get(w, [])) < 3:
            r8_safe_examples.setdefault(w, []).append(f"{rec['name']}（{rec['seismic_grade']}）")

    meshes_df = store.meshes
    if meshes_df is None or meshes_df.empty:
        return {
            "purpose": purpose,
            "purpose_label": BCP_PURPOSE_LABELS[purpose],
            "ward": ward,
            "avoid_mountain": avoid_mountain,
            "r8_pdf_url": R8_PDF_URL,
            "r8_page_url": R8_PAGE_URL,
            "r8_total_listed": r8_summary["total_listed"],
            "r8_grade_counts": r8_summary["grade_counts"],
            "ward_ranking": [],
            "recommendations": [],
            "avoid_high_risk_areas": [],
            "disclaimer": R8_SEISMIC_DISCLAIMER,
        }

    # 1) Build Ward Comparative Safety Ranking
    ward_ranking: list[dict[str, Any]] = []
    for w_name, grp in meshes_df.groupby("ward_name"):
        w_str = str(w_name)
        avg_prob = float(grp["t30_i55_ps"].dropna().mean()) if grp["t30_i55_ps"].notna().any() else 0.15
        avg_arv = float(grp["arv"].dropna().mean()) if grp["arv"].notna().any() else 1.3
        avg_avs = float(grp["avs"].dropna().mean()) if grp["avs"].notna().any() else 320.0
        tot_b = int(grp["total_buildings"].sum())
        pre81_b = int(grp["pre_1981_count"].sum())
        unk_b = int(grp["unknown_year_count"].sum())
        pre81_share = pre81_b / tot_b if tot_b else 0.0
        r8_w = r8_by_ward.get(w_str, {"total": 0, "safe": 0, "needs_retrofit": 0})
        r8_safe_rate = (r8_w["safe"] / r8_w["total"]) if r8_w["total"] else 0.85

        w_score = _compute_mesh_safety_score(
            t30_i55=avg_prob,
            arv=avg_arv,
            avs=avg_avs,
            pre81_share=pre81_share,
            wooden_pre81=int(grp["wooden_pre_1981_count"].mean()) if "wooden_pre_1981_count" in grp else 0,
            jname="砂礫質台地",
            r8_ward_safe_rate=r8_safe_rate,
            purpose=purpose,
        )
        ward_ranking.append({
            "ward_name": w_str,
            "safety_score": w_score,
            "avg_t30_i55_ps": round(avg_prob, 4),
            "avg_arv": round(avg_arv, 2),
            "avg_avs": round(avg_avs, 1),
            "total_buildings": tot_b,
            "pre_1981_count": pre81_b,
            "unlisted_priority_count": pre81_b + unk_b,
            "r8_total": r8_w["total"],
            "r8_safe_count": r8_w["safe"],
            "r8_needs_retrofit": r8_w["needs_retrofit"],
            "r8_safe_rate": round(r8_safe_rate, 3),
        })
    ward_ranking.sort(key=lambda x: x["safety_score"], reverse=True)

    # 2) Score Individual 250m Mesh Candidates (both safe sites & high-risk avoid zones)
    df_all = meshes_df.copy()
    if ward and ward != "all":
        df_all = df_all[df_all["ward_name"] == ward]
    df_all = df_all[df_all["t30_i55_ps"].notna() & df_all["arv"].notna()]
    min_b_all = df_all[df_all["total_buildings"] >= min_buildings]
    if not min_b_all.empty:
        df_all = min_b_all

    shelter_store.ensure_loaded()
    shelters = shelter_store.list_shelters(ward=None if ward == "all" else ward)

    safe_scored_rows: list[tuple[float, dict[str, Any]]] = []
    avoid_scored_rows: list[tuple[float, dict[str, Any]]] = []
    has_non_mountain = not df_all[~df_all["jname"].isin(["山地", "山麓地"])].empty

    for _, r in df_all.iterrows():
        t30_55 = _safe_float(r.get("t30_i55_ps"))
        arv = _safe_float(r.get("arv"))
        if t30_55 is None or arv is None:
            continue
        t30_60 = _safe_float(r.get("t30_i60_ps"))
        avs = _safe_float(r.get("avs"))
        jname = str(r.get("jname") or "不明")
        w_str = str(r.get("ward_name") or "")
        tot_b = int(r.get("total_buildings") or 0)
        pre81 = int(r.get("pre_1981_count") or 0)
        unk = int(r.get("unknown_year_count") or 0)
        wooden_pre81 = int(r.get("wooden_pre_1981_count") or 0)
        pre81_share_tot = float(r.get("pre_1981_share_total") or (pre81 / tot_b if tot_b else 0.0))
        pre81_share_known = _safe_float(r.get("pre_1981_share_known"))

        r8_w = r8_by_ward.get(w_str, {"total": 0, "safe": 0, "needs_retrofit": 0})
        r8_safe_rate = (r8_w["safe"] / r8_w["total"]) if r8_w["total"] else 0.85

        score = _compute_mesh_safety_score(
            t30_i55=t30_55,
            arv=arv,
            avs=avs,
            pre81_share=pre81_share_tot,
            wooden_pre81=wooden_pre81,
            jname=jname,
            r8_ward_safe_rate=r8_safe_rate,
            purpose=purpose,
        )
        risk_score = round(max(0.0, 100.0 - score), 1)
        h_tier = str(r.get("hazard_tier") or "unknown")
        h_label = HAZARD_TIER_LABELS.get(h_tier, "不明")

        # High-risk avoidance reasons (applicable across ALL landforms including mountain/wetland)
        avoid_reasons: list[str] = []
        if t30_55 >= 0.25:
            avoid_reasons.append(f"30年震度6弱以上確率が非常に高い（{t30_55 * 100:.1f}% / {h_label}）")
        elif t30_55 >= 0.15:
            avoid_reasons.append(f"30年震度6弱以上確率が高め（{t30_55 * 100:.1f}% / {h_label}）")
        if arv >= 1.6:
            avoid_reasons.append(
                f"表層地盤増幅率が大きく揺れが増幅しやすい（ARV {arv:.2f}"
                + (f" / AVS {avs:.0f}m/s）" if avs else "）")
            )
        if jname in SOFT_LIQUEFACTION_JNAMES:
            avoid_reasons.append(f"液状化・軟弱地盤に注意すべき微地形「{jname}」")
        elif jname in LANDSLIDE_PRONE_JNAMES:
            avoid_reasons.append(f"急傾斜・土砂災害リスクに注意すべき微地形「{jname}」")
        if wooden_pre81 >= 40 or pre81_share_tot >= 0.35:
            avoid_reasons.append(
                f"R8未掲載の木造旧耐震密集（{wooden_pre81}棟 / 旧耐震率 {pre81_share_tot * 100:.1f}%：延焼・道路閉塞リスク）"
            )
        if not avoid_reasons:
            avoid_reasons.append(
                f"複合安全性スコアが相対的に低い（安全性 {score:.1f}点 / ARV {arv:.2f} / 確率 {t30_55 * 100:.1f}%）"
            )

        base_item: dict[str, Any] = {
            "meshcode": str(r["meshcode"]),
            "ward_name": w_str,
            "centroid_lat": round(float(r["centroid_lat"]), 6),
            "centroid_lon": round(float(r["centroid_lon"]), 6),
            "safety_score": score,
            "risk_score": risk_score,
            "t30_i55_ps": round(t30_55, 4),
            "t30_i60_ps": round(t30_60, 4) if t30_60 is not None else None,
            "hazard_tier": h_tier,
            "hazard_label": h_label,
            "arv": round(arv, 2),
            "avs": round(avs, 1) if avs is not None else None,
            "jname": jname,
            "total_buildings": tot_b,
            "pre_1981_count": pre81,
            "wooden_pre_1981_count": wooden_pre81,
            "unlisted_priority_count": pre81 + unk,
            "pre_1981_share_known": round(pre81_share_known, 4) if pre81_share_known is not None else None,
            "r8_ward_stats": {
                **r8_w,
                "safe_rate": round(r8_safe_rate, 3),
                "sample_safe_facilities": r8_safe_examples.get(w_str, []),
            },
        }
        avoid_scored_rows.append((risk_score, {**base_item, "avoid_reasons": avoid_reasons}))

        if avoid_mountain and has_non_mountain and jname in {"山地", "山麓地"}:
            continue

        # Build clear human-readable reasons & cautions for safe recommendations
        reasons: list[str] = []
        cautions: list[str] = []

        if t30_55 < 0.03:
            reasons.append(f"30年震度6弱以上確率が極めて低い（{t30_55 * 100:.2f}% / 低区分）")
        elif t30_55 < 0.06:
            reasons.append(f"30年震度6弱以上確率が低水準（{t30_55 * 100:.2f}% / 中区分）")
        elif t30_55 < 0.15:
            reasons.append(f"30年震度6弱以上確率 {t30_55 * 100:.1f}%（市内平均より低め）")
        else:
            cautions.append(f"震度6弱以上確率がやや高め（{t30_55 * 100:.1f}%）のため免震・耐震等級3設計推奨")

        if arv <= 1.0:
            reasons.append(f"表層地盤が非常に強固（地盤増幅率 ARV {arv:.2f} / 揺れが増幅しにくい）")
        elif arv <= 1.3:
            reasons.append(f"表層地盤が良好（ARV {arv:.2f}" + (f" / AVS {avs:.0f}m/s）" if avs else "）"))
        elif arv >= 1.6:
            cautions.append(f"地盤増幅率 ARV {arv:.2f} のため杭基礎・地盤改良の現地調査を推奨")

        if jname in FIRM_FLAT_JNAMES:
            reasons.append(f"微地形「{jname}」：平坦かつ支持地盤が比較的安定（サーバー/金庫設置向き）")
        elif jname in LANDSLIDE_PRONE_JNAMES:
            cautions.append(f"微地形「{jname}」のため急傾斜地・土砂災害警戒区域の事前確認が必要")
        elif jname in SOFT_LIQUEFACTION_JNAMES:
            cautions.append(f"微地形「{jname}」のため液状化対策・高床防水設計が必要")

        if pre81_share_tot <= 0.15:
            reasons.append(f"周辺旧耐震率 {pre81_share_tot * 100:.1f}%（R8未掲載の古い木造密集・延焼連鎖リスク小）")
        elif wooden_pre81 >= 40:
            cautions.append(f"周辺にR8未掲載の木造旧耐震建物が {wooden_pre81}棟あり（延焼・道路閉塞への防火対策推奨）")

        if r8_w["total"] > 0:
            reasons.append(
                f"{w_str}のR8市有防災拠点 耐震適合率 {r8_safe_rate * 100:.1f}%（{r8_w['safe']}/{r8_w['total']}棟が新耐震/Ⅲ）"
            )

        safe_scored_rows.append((
            score,
            {
                **base_item,
                "reasons": reasons,
                "cautions": cautions,
            },
        ))

    safe_scored_rows.sort(key=lambda x: x[0], reverse=True)
    avoid_scored_rows.sort(key=lambda x: x[0], reverse=True)
    avoid_items = [
        {"risk_rank": idx, **item}
        for idx, (_, item) in enumerate(avoid_scored_rows[: min(limit, 5)], start=1)
    ]

    top_items: list[dict[str, Any]] = []
    for idx, (_, item) in enumerate(safe_scored_rows[:limit], start=1):
        # Find nearest official shelter for BCP staff evacuation / emergency coordination
        nearest_sh: dict[str, Any] | None = None
        best_d = 999.0
        for s in shelters:
            d = _dist_km(item["centroid_lon"], item["centroid_lat"], s["lon"], s["lat"])
            if d < best_d:
                best_d = d
                nearest_sh = {
                    "id": s["id"],
                    "name": s["name"],
                    "ward": s["ward"],
                    "distance_km": round(d, 2),
                    "is_wide_area": s["is_wide_area"],
                    "disaster_labels": s["disaster_labels"],
                }

        bcp_guidance = (
            "民間・企業の新設重要施設は『R8_list.pdf（市有リスト）』掲載対象外となるため、"
            "比較的安全な低震度・硬質地盤エリアを選定した上で、"
            + (
                "耐震等級3／免震基礎・非常用自家発電・耐火区画（サーバールーム/金庫仕様）での設計を推奨します。"
                if purpose == "datacenter_server"
                else "耐震等級2〜3・72時間非常電源・通信二重化を備えたBCP拠点設計を推奨します。"
                if purpose == "bcp_hq"
                else "不燃構造・ラック固定・浸水対策（高床化）と緊急輸送道路アクセス確保を推奨します。"
            )
        )
        top_items.append({
            "rank": idx,
            **item,
            "nearest_official_shelter": nearest_sh,
            "bcp_guidance": bcp_guidance,
        })

    return {
        "purpose": purpose,
        "purpose_label": BCP_PURPOSE_LABELS[purpose],
        "ward": ward,
        "avoid_mountain": avoid_mountain,
        "r8_pdf_url": R8_PDF_URL,
        "r8_page_url": R8_PAGE_URL,
        "r8_total_listed": r8_summary["total_listed"],
        "r8_grade_counts": r8_summary["grade_counts"],
        "ward_ranking": ward_ranking,
        "recommendations": top_items,
        "avoid_high_risk_areas": avoid_items,
        "disclaimer": (
            "※本診断はJ-SHIS 250m地震ハザード・表層地盤、PLATEAU建物築年集計、および京都市『R8_list.pdf（市有建築物耐震性能リスト）』に基づく"
            "比較スクリーニングです。最終的な重要施設（サーバー室・金庫等）の建設時は、敷地ごとのボーリング地質調査・水害/土砂ハザードマップ確認を行ってください。"
        ),
    }


def assess_enterprise_assets(
    store: Any,
    *,
    assets: list[dict[str, Any]],
    public_reports: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Evaluate seismic hazard, nearby road closures/damage, and nearest shelter for confidential corporate assets in-memory (never persisted on server)."""
    from app.shelter_rec import _lookup_mesh_hazard

    shelter_store.ensure_loaded()
    shelters = shelter_store.list_shelters()
    results: list[dict[str, Any]] = []

    for asset in assets[:30]:
        lat = float(asset["lat"])
        lon = float(asset["lon"])
        asset_type = str(asset.get("asset_type") or "server_room")
        purpose = (
            "datacenter_server"
            if asset_type in {"server_room", "datacenter", "vault"}
            else "bcp_hq"
            if asset_type == "bcp_hq"
            else "logistics_storage"
        )

        hazard = _lookup_mesh_hazard(lat, lon, store)
        safety_score: float | None = None
        if hazard and hazard.get("t30_i55_ps") is not None and hazard.get("arv") is not None:
            tot_b = int(hazard.get("pre_1981_count") or 0)
            pre81_share = float(hazard.get("pre_1981_share_known") or 0.0)
            safety_score = _compute_mesh_safety_score(
                t30_i55=float(hazard["t30_i55_ps"]),
                arv=float(hazard["arv"]),
                avs=None,
                pre81_share=pre81_share,
                wooden_pre81=min(tot_b, 40),
                jname=str(hazard.get("jname") or "不明"),
                r8_ward_safe_rate=0.85,
                purpose=purpose,
            )

        nearby_blocked = 0
        nearby_building_damage = 0
        for rep in public_reports:
            if rep.get("resolved") or rep.get("lat") is None or rep.get("lon") is None:
                continue
            d_km = _dist_km(lon, lat, float(rep["lon"]), float(rep["lat"]))
            if d_km <= 0.6:
                if rep.get("category") == "road_blocked":
                    nearby_blocked += 1
                elif rep.get("category") == "building_damage":
                    nearby_building_damage += 1

        nearest_sh: dict[str, Any] | None = None
        best_d = 999.0
        for s in shelters:
            d = _dist_km(lon, lat, float(s["lon"]), float(s["lat"]))
            if d < best_d:
                best_d = d
                nearest_sh = {
                    "id": s["id"],
                    "name": s["name"],
                    "ward": s["ward"],
                    "distance_km": round(d, 2),
                    "is_wide_area": s["is_wide_area"],
                }

        alerts: list[str] = []
        if nearby_blocked > 0:
            alerts.append(f"半径600m以内に通行止め報告 {nearby_blocked}件（アクセス・保守車両迂回注意）")
        if nearby_building_damage > 0:
            alerts.append(f"半径600m以内に建物損傷報告 {nearby_building_damage}件（周辺延焼・倒壊注意）")
        if hazard and hazard.get("hazard_tier") in {"very_high", "elevated"}:
            alerts.append(f"30年震度6弱+確率が高い区分（{hazard.get('hazard_label')}）のため免震・非常電源強化推奨")

        results.append({
            "id": str(asset.get("id") or ""),
            "safety_score": safety_score,
            "hazard": hazard,
            "nearby_road_closures_600m": nearby_blocked,
            "nearby_building_damage_600m": nearby_building_damage,
            "nearest_official_shelter": nearest_sh,
            "alerts": alerts,
        })

    return results

