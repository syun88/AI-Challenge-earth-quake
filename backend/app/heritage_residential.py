"""Priority ranking and actionable solution proposals for historic buildings and residential buildings."""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.constants import HAZARD_TIER_LABELS, OFFICIAL_RETROFIT_PROGRAMS
from app.r8_seismic import R8_PDF_URL, R8_PAGE_URL

HISTORIC_RESIDENTIAL_FOCUS_LABELS = {
    "all": "歴史的建築物＋住宅系（統合優先順位）",
    "historic": "歴史がある建物（1950年以前・京町家・伝統木造/土蔵/石造等）",
    "residential": "住宅系（旧耐震住宅・1982〜2000木造・共同住宅・併用住宅）",
}

_TRADITIONAL_STRUCTURE_PATTERN = "木造|土蔵|レンガ|石造|ブロック"


def _build_solution_catalog(counts: dict[str, int]) -> list[dict[str, Any]]:
    """Return ordered P1-P4 priority tiers with concrete technical, financial, and operational solutions."""
    return [
        {
            "tier": "P1",
            "rank": 1,
            "urgency_label": "最優先・緊急対策",
            "title": "1950年以前の歴史的建造物・京町家等 × 高危険・軟弱地盤",
            "target_criteria": (
                "昭和25年（1950年）以前の建築基準法施行前建物（京町家・伝統木造・土蔵・歴史的石/レンガ造等）かつ "
                "30年震度6弱以上確率 6%以上または軟弱地盤（ARV≧1.5）。原則 R8_list.pdf 未掲載。"
            ),
            "building_count": counts["p1"],
            "solutions": [
                {
                    "kind": "構造・工法",
                    "action": "限界耐力計算による伝統構法対応の耐震補強＋屋根軽量化",
                    "detail": (
                        "現代の壁量計算に当てはめにくい京町家・伝統木造は「限界耐力計算」を用い、"
                        "外観・町並みを残したまま荒壁パネル・仕口金物・軽量瓦への葺き替えで揺れエネルギーを低減します。"
                    ),
                },
                {
                    "kind": "防火・初動",
                    "action": "感震ブレーカー設置・延焼遅延間仕切り改修（町家連担対策）",
                    "detail": (
                        "通電火災と木造密集の延焼連鎖を防ぐため、分電盤型感震ブレーカー、住宅用火災警報器、"
                        "隣戸境界の防火ボード（まちの匠・ぷらす対象）を優先導入します。"
                    ),
                },
                {
                    "kind": "公的支援",
                    "action": "京都市「木造住宅・京町家 無料耐震診断士派遣」＋「まちの匠・ぷらす」活用",
                    "detail": "昭和25年11月22日以前着工の京町家等は無料診断および耐震・防火改修補助の対象要件を確認できます。",
                },
            ],
            "program_urls": [OFFICIAL_RETROFIT_PROGRAMS[0]["url"], OFFICIAL_RETROFIT_PROGRAMS[1]["url"]],
        },
        {
            "tier": "P2",
            "rank": 2,
            "urgency_label": "高優先・早急対策",
            "title": "1951〜1981年 旧耐震住宅 × 高ハザード（または低中ハザードの歴史的建物）",
            "target_criteria": (
                "1981年以前の旧耐震住宅（一般住宅・共同住宅・店舗併用住宅）で高/やや高ハザード域・木造密集、"
                "または低・中ハザード域の1950年以前歴史的建築物。"
            ),
            "building_count": counts["p2"],
            "solutions": [
                {
                    "kind": "段階的補強",
                    "action": "1階寝室・居室への耐震シェルター／防災ベッド＋部分耐震改修",
                    "detail": (
                        "全面改修の費用・仮住まいが難しい高齢者世帯等は、1階就寝空間の耐震シェルター設置や"
                        "低コストな1階重点補強（上部構造評点 0.7→1.0以上）を先行し命を守ります。"
                    ),
                },
                {
                    "kind": "避難路確保",
                    "action": "ブロック塀・老朽門塀の撤去／軽量フェンス化と感震遮断",
                    "detail": "細街路沿いの旧耐震住宅は倒壊・塀崩落による避難経路閉塞を防ぐため、門塀の安全化を優先します。",
                },
                {
                    "kind": "公的支援",
                    "action": "京安心すまいセンター「木造住宅耐震化助成制度」の段階的改修プラン相談",
                    "detail": "耐震診断・耐震改修・簡易耐震改修（部分補強・シェルター等）の補助制度窓口へ相談します。",
                },
            ],
            "program_urls": [OFFICIAL_RETROFIT_PROGRAMS[2]["url"], OFFICIAL_RETROFIT_PROGRAMS[0]["url"]],
        },
        {
            "tier": "P3",
            "rank": 3,
            "urgency_label": "中優先・予防補強",
            "title": "1982〜2000年 木造住宅（新耐震グレーゾーン）＆ 低・中ハザード旧耐震住宅",
            "target_criteria": (
                "1981年新耐震後〜2000年6月基準改正（四分割法・N値計算による接合金物義務化）前の木造住宅、"
                "および比較的ハザードの低いエリアの旧耐震住宅。"
            ),
            "building_count": counts["p3"],
            "solutions": [
                {
                    "kind": "ピンポイント補強",
                    "action": "N値計算に基づく柱頭・柱脚接合金物の後付け＆壁バランス改善",
                    "detail": (
                        "1982〜2000年木造は基礎や壁量が比較的良好な一方、直下型地震で柱の引き抜けが起こりやすいため、"
                        "床下・小屋裏からの接合金物補強で高い費用対効果が得られます。"
                    ),
                },
                {
                    "kind": "室内・設備対策",
                    "action": "家具固定・ガラス飛散防止・給湯器（エコキュート等）アンカー点検",
                    "detail": "構造被害が軽くても室内転倒・避難経路塞ぎを防ぐため、寝室と玄関動線の固定を徹底します。",
                },
            ],
            "program_urls": [OFFICIAL_RETROFIT_PROGRAMS[2]["url"], OFFICIAL_RETROFIT_PROGRAMS[3]["url"]],
        },
        {
            "tier": "P4",
            "rank": 4,
            "urgency_label": "把握優先・調査対象",
            "title": "建築年不明の住宅・木造・伝統構造物（R8_list.pdf 未掲載）",
            "target_criteria": (
                "PLATEAU上で建築年が記録されていない建物（R8市有耐震リスト未掲載の民間住宅や増改築不明建築等）。"
            ),
            "building_count": counts["p4"],
            "solutions": [
                {
                    "kind": "築年特定",
                    "action": "登記事項証明書・固定資産税課税明細・建築確認済証で着工時期を確定",
                    "detail": "1950年以前／1981年以前／2000年以前のいずれに該当するかを確定し、P1〜P3の補助金・工法へ直結させます。",
                },
                {
                    "kind": "現地スクリーニング",
                    "action": "「誰でもできるわが家の耐震診断」＋無料専門家派遣の申込",
                    "detail": "築年不明でも基礎のひび割れ・筋かい有無・屋根材（重い土葺き瓦か軽量材か）を現地目視で確認します。",
                },
            ],
            "program_urls": [OFFICIAL_RETROFIT_PROGRAMS[0]["url"], OFFICIAL_RETROFIT_PROGRAMS[3]["url"]],
        },
    ]


def classify_single_building_priority(building: dict[str, Any]) -> dict[str, Any]:
    """Classify a single building row into P1-P4 or Post-2001/Modern and attach tailored solutions."""
    year = building.get("year_built")
    try:
        year_int = int(year) if year is not None and pd.notna(year) else None
    except Exception:
        year_int = None

    age_cat = str(building.get("age_category") or "unknown")
    usage_group = str(building.get("usage_group") or "unknown")
    structure = str(building.get("structure_label") or "")
    hazard_tier = str(building.get("hazard_tier") or "unknown")
    arv_raw = building.get("arv")
    arv = float(arv_raw) if arv_raw is not None and pd.notna(arv_raw) else 1.0

    is_historic = year_int is not None and year_int <= 1950
    is_residential = usage_group == "residential"
    is_wood_or_trad = any(k in structure for k in ("木造", "土蔵", "レンガ", "石造", "ブロック"))
    is_high_hazard = hazard_tier in ("very_high", "elevated") or arv >= 1.5

    if is_historic and is_high_hazard:
        tier = "P1"
        category_tag = "歴史的建物 × 高危険・軟弱地盤"
        title = "最優先（P1）: 伝統構法・京町家型の耐震＆防火改修を推奨"
        actions = [
            "限界耐力計算対応の耐震診断士による無料診断・伝統木造補強（荒壁パネル・仕口補強・屋根軽量化）",
            "感震ブレーカー設置＋町家境界の延焼遅延対策（「まちの匠・ぷらす」支援検討）",
        ]
        program = OFFICIAL_RETROFIT_PROGRAMS[1]
    elif (age_cat == "pre_1981" and is_residential and is_high_hazard) or is_historic:
        tier = "P2"
        category_tag = "歴史的建物（低中ハザード）" if is_historic else "旧耐震住宅 × 高ハザード"
        title = "高優先（P2）: 1階重点補強・耐震シェルター／段階的改修を推奨"
        actions = [
            "全面改修が難しい場合は1階主要寝室の耐震シェルター・防災ベッド設置を先行",
            "京安心すまいセンター・無料耐震診断士派遣で耐震評点を確認",
        ]
        program = OFFICIAL_RETROFIT_PROGRAMS[0]
    elif (age_cat == "1982_2000" and (is_residential or is_wood_or_trad)) or (
        age_cat == "pre_1981" and (is_residential or is_wood_or_trad)
    ):
        tier = "P3"
        category_tag = "81-00木造グレーゾーン" if age_cat == "1982_2000" else "旧耐震住宅（低中ハザード）"
        title = "中優先（P3）: 柱頭・柱脚接合金物補強＆室内安全対策を推奨"
        actions = [
            "2000年基準前木造はN値計算に基づく接合金物追加・壁量バランス点検で低コスト補強可能",
            "大型家具固定・感震ブレーカー・ブロック塀点検を実施",
        ]
        program = OFFICIAL_RETROFIT_PROGRAMS[2]
    elif age_cat == "unknown":
        tier = "P4"
        category_tag = "建築年不明（R8未掲載・調査優先）"
        title = "把握優先（P4）: 築年特定（登記/確認証）と現地簡易診断を推奨"
        actions = [
            "1950年以前／1981年以前／2000年以前のいずれかを確定し補助制度対象か判定",
            "屋根の重さ・基礎ひび割れ・接合金物の目視点検または無料耐震診断を申込",
        ]
        program = OFFICIAL_RETROFIT_PROGRAMS[0]
    else:
        tier = "OK"
        category_tag = "新耐震/2001年以降（現行基準期）"
        title = "維持・室内安全（現行基準期）: 家具固定・避難備蓄・定期点検を推奨"
        actions = [
            "2001年以降の基準期建築ですが、高ハザード/高ARV域では室内転倒防止と非常電源・備蓄を維持してください。",
        ]
        program = OFFICIAL_RETROFIT_PROGRAMS[3]

    return {
        "priority_tier": tier,
        "category_tag": category_tag,
        "is_historic_pre1950": is_historic,
        "is_residential": is_residential,
        "title": title,
        "recommended_actions": actions,
        "primary_program": program,
    }


def analyze_historic_and_residential_priorities(
    store: Any,
    *,
    ward: str = "all",
    focus: str = "all",
    limit: int = 6,
) -> dict[str, Any]:
    """Rank Kyoto wards, 250m meshes, and sample buildings by historic/residential retrofit priority."""
    df = store.buildings
    if df.empty or store.meshes.empty:
        return {
            "focus": focus,
            "focus_label": HISTORIC_RESIDENTIAL_FOCUS_LABELS.get(focus, HISTORIC_RESIDENTIAL_FOCUS_LABELS["all"]),
            "ward": ward,
            "counts": {"total_in_scope": 0, "historic_pre1950": 0, "residential_total": 0, "p1": 0, "p2": 0, "p3": 0, "p4": 0, "unknown_all": 0},
            "priority_tiers": _build_solution_catalog({"p1": 0, "p2": 0, "p3": 0, "p4": 0}),
            "ward_ranking": [],
            "priority_meshes": [],
            "sample_buildings": [],
            "official_programs": OFFICIAL_RETROFIT_PROGRAMS,
            "r8_pdf_url": R8_PDF_URL,
            "r8_page_url": R8_PAGE_URL,
        }

    scope_df = df if not ward or ward == "all" else df[df["ward_name"] == ward]

    year_series = scope_df["year_built"]
    is_hist = year_series.notna() & (year_series <= 1950)
    is_pre81 = scope_df["age_category"] == "pre_1981"
    is_81_00 = scope_df["age_category"] == "1982_2000"
    is_unk = scope_df["age_category"] == "unknown"
    is_res = scope_df["usage_group"] == "residential"
    is_trad = scope_df["structure_label"].astype(str).str.contains(_TRADITIONAL_STRUCTURE_PATTERN, na=False)
    is_high_haz = scope_df["hazard_tier"].isin(["very_high", "elevated"]) | (scope_df["arv"].fillna(0.0) >= 1.5)

    # Focus filter applies to priority counting & hotspot scoring
    if focus == "historic":
        focus_mask = is_hist | (is_pre81 & is_trad)
    elif focus == "residential":
        focus_mask = is_res
    else:
        focus_mask = is_hist | is_res | (is_pre81 & is_trad) | is_unk

    p1_mask = focus_mask & is_hist & is_high_haz
    p2_mask = focus_mask & (~p1_mask) & ((is_pre81 & is_res & is_high_haz) | is_hist | (is_pre81 & is_trad & is_high_haz))
    p3_mask = focus_mask & (~p1_mask) & (~p2_mask) & ((is_81_00 & (is_res | is_trad)) | (is_pre81 & (is_res | is_trad)))
    p4_mask = focus_mask & (~p1_mask) & (~p2_mask) & (~p3_mask) & is_unk & (is_res | is_trad | (scope_df["usage_label"] == "不明"))

    counts = {
        "total_in_scope": int(len(scope_df)),
        "historic_pre1950": int(is_hist.sum()),
        "residential_total": int(is_res.sum()),
        "wooden_pre1981_residential": int((is_pre81 & is_res & is_trad).sum()),
        "p1": int(p1_mask.sum()),
        "p2": int(p2_mask.sum()),
        "p3": int(p3_mask.sum()),
        "p4": int(p4_mask.sum()),
        "unknown_all": int(is_unk.sum()),
    }

    # Compute ward-level ranking across ALL 11 wards (so user can always compare wards)
    w_hist = df["year_built"].notna() & (df["year_built"] <= 1950)
    w_pre81 = df["age_category"] == "pre_1981"
    w_81_00 = df["age_category"] == "1982_2000"
    w_res = df["usage_group"] == "residential"
    w_trad = df["structure_label"].astype(str).str.contains(_TRADITIONAL_STRUCTURE_PATTERN, na=False)
    w_high = df["hazard_tier"].isin(["very_high", "elevated"]) | (df["arv"].fillna(0.0) >= 1.5)

    w_p1 = w_hist & w_high
    w_p2 = (~w_p1) & ((w_pre81 & w_res & w_high) | w_hist | (w_pre81 & w_trad & w_high))
    w_p3 = (~w_p1) & (~w_p2) & ((w_81_00 & (w_res | w_trad)) | (w_pre81 & (w_res | w_trad)))

    tmp_w = pd.DataFrame({
        "ward_name": df["ward_name"].values,
        "p1": w_p1.values.astype(int),
        "p2": w_p2.values.astype(int),
        "p3": w_p3.values.astype(int),
        "hist": w_hist.values.astype(int),
        "res_pre81": (w_pre81 & w_res).values.astype(int),
    })
    ward_agg = tmp_w.groupby("ward_name", as_index=False).sum()
    ward_ranking: list[dict[str, Any]] = []
    for _, row in ward_agg.iterrows():
        w_str = str(row["ward_name"])
        if not w_str or w_str == "不明":
            continue
        p1_c = int(row["p1"])
        p2_c = int(row["p2"])
        p3_c = int(row["p3"])
        hist_c = int(row["hist"])
        res_pre81_c = int(row["res_pre81"])
        if focus == "historic":
            priority_score = hist_c * 2 + p1_c * 3
        elif focus == "residential":
            priority_score = res_pre81_c * 2 + p2_c * 2 + p1_c
        else:
            priority_score = p1_c * 3 + p2_c * 2 + p3_c
        ward_ranking.append({
            "ward_name": w_str,
            "p1_count": p1_c,
            "p2_count": p2_c,
            "p3_count": p3_c,
            "historic_pre1950_count": hist_c,
            "pre_1981_residential_count": res_pre81_c,
            "priority_score": int(priority_score),
        })
    ward_ranking.sort(key=lambda x: x["priority_score"], reverse=True)

    # Aggregate 250m mesh hotspots inside scope
    tmp_m = pd.DataFrame({
        "meshcode": scope_df["meshcode"].values,
        "p1": p1_mask.values.astype(int),
        "p2": p2_mask.values.astype(int),
        "p3": p3_mask.values.astype(int),
        "p4": p4_mask.values.astype(int),
        "hist": is_hist.values.astype(int),
        "res_pre81": (is_pre81 & is_res).values.astype(int),
    })
    mesh_agg = tmp_m.groupby("meshcode", as_index=False).sum()
    meshes_lookup = store.meshes.set_index("meshcode")

    mesh_candidates: list[dict[str, Any]] = []
    for _, row in mesh_agg.iterrows():
        mc = str(row["meshcode"])
        if not mc or mc not in meshes_lookup.index:
            continue
        mrow = meshes_lookup.loc[mc]
        if isinstance(mrow, pd.DataFrame):
            mrow = mrow.iloc[0]
        p1_c = int(row["p1"])
        p2_c = int(row["p2"])
        p3_c = int(row["p3"])
        p4_c = int(row["p4"])
        hist_c = int(row["hist"])
        res_pre81_c = int(row["res_pre81"])
        if focus == "historic":
            score = p1_c * 4 + hist_c * 2
        elif focus == "residential":
            score = p2_c * 3 + res_pre81_c * 2 + p1_c * 2 + p3_c
        else:
            score = p1_c * 4 + p2_c * 2 + hist_c + p3_c
        if score <= 0:
            continue

        t30 = float(mrow["t30_i55_ps"]) if pd.notna(mrow.get("t30_i55_ps")) else None
        arv = float(mrow["arv"]) if pd.notna(mrow.get("arv")) else None
        tier_key = str(mrow.get("hazard_tier") or "unknown")
        dominant_tier = "P1" if p1_c >= max(10, p2_c // 2) else ("P2" if p2_c >= p3_c else "P3")
        recommended_action = (
            "限界耐力計算・京町家耐震診断＋感震ブレーカー／町家防火改修（まちの匠・ぷらす）を優先"
            if dominant_tier == "P1"
            else "木造旧耐震の無料耐震診断・1階耐震シェルター／段階的改修と細街路の塀安全化を優先"
            if dominant_tier == "P2"
            else "1982〜2000年木造の接合金物（N値計算）補強・家具固定を推奨"
        )
        mesh_candidates.append({
            "meshcode": mc,
            "ward_name": str(mrow.get("ward_name") or ""),
            "centroid_lat": round(float(mrow["centroid_lat"]), 6),
            "centroid_lon": round(float(mrow["centroid_lon"]), 6),
            "jname": str(mrow.get("jname") or "不明"),
            "hazard_tier": tier_key,
            "hazard_label": HAZARD_TIER_LABELS.get(tier_key, "不明"),
            "t30_i55_ps": round(t30, 4) if t30 is not None else None,
            "arv": round(arv, 2) if arv is not None else None,
            "p1_count": p1_c,
            "p2_count": p2_c,
            "p3_count": p3_c,
            "p4_count": p4_c,
            "historic_pre1950_count": hist_c,
            "pre_1981_residential_count": res_pre81_c,
            "dominant_priority": dominant_tier,
            "priority_score": int(score),
            "recommended_action": recommended_action,
        })

    mesh_candidates.sort(key=lambda x: x["priority_score"], reverse=True)
    top_meshes = [
        {"rank": i, **item}
        for i, item in enumerate(mesh_candidates[:limit], start=1)
    ]

    # Pick concrete representative priority buildings (older & higher hazard first)
    cand_df = scope_df[p1_mask | p2_mask].copy()
    if cand_df.empty:
        cand_df = scope_df[p3_mask | p4_mask].copy()

    sample_buildings: list[dict[str, Any]] = []
    if not cand_df.empty:
        # Prefer known oldest year & higher t30_i55_ps; ensure diverse meshes if possible
        cand_df["_sort_p1"] = p1_mask.reindex(cand_df.index, fill_value=False).astype(int)
        cand_df["_sort_year"] = cand_df["year_built"].fillna(2010)
        cand_df["_sort_haz"] = cand_df["t30_i55_ps"].fillna(0.0)
        if focus == "residential":
            cand_df["_sort_res"] = (cand_df["usage_group"] == "residential").astype(int)
            cand_df = cand_df.sort_values(
                by=["_sort_res", "_sort_p1", "_sort_haz", "_sort_year"],
                ascending=[False, False, False, True],
            )
        else:
            cand_df = cand_df.sort_values(
                by=["_sort_p1", "_sort_year", "_sort_haz"],
                ascending=[False, True, False],
            )

        seen_meshes: set[str] = set()
        picked_rows = []
        for _, brow in cand_df.head(60).iterrows():
            mc = str(brow.get("meshcode") or "")
            if mc in seen_meshes and len(picked_rows) < limit:
                continue
            seen_meshes.add(mc)
            picked_rows.append(brow)
            if len(picked_rows) >= min(limit, 5):
                break
        if len(picked_rows) < min(limit, 5):
            for _, brow in cand_df.head(limit).iterrows():
                if all(str(r["building_id"]) != str(brow["building_id"]) for r in picked_rows):
                    picked_rows.append(brow)
                if len(picked_rows) >= min(limit, 5):
                    break

        for idx, brow in enumerate(picked_rows, start=1):
            bdict = brow.to_dict()
            sol = classify_single_building_priority(bdict)
            centroid = brow.geometry.centroid
            sample_buildings.append({
                "rank": idx,
                "building_id": str(brow["building_id"]),
                "ward_name": str(brow["ward_name"]),
                "meshcode": str(brow["meshcode"]),
                "year_built": int(brow["year_built"]) if pd.notna(brow["year_built"]) else None,
                "usage_label": str(brow["usage_label"]),
                "structure_label": str(brow["structure_label"]),
                "storeys_above": int(brow["storeys_above"]) if pd.notna(brow["storeys_above"]) else None,
                "t30_i55_ps": round(float(brow["t30_i55_ps"]), 4) if pd.notna(brow["t30_i55_ps"]) else None,
                "arv": round(float(brow["arv"]), 2) if pd.notna(brow["arv"]) else None,
                "centroid_lat": round(float(centroid.y), 6),
                "centroid_lon": round(float(centroid.x), 6),
                "priority_tier": sol["priority_tier"],
                "category_tag": sol["category_tag"],
                "title": sol["title"],
                "recommended_actions": sol["recommended_actions"],
            })

    return {
        "focus": focus,
        "focus_label": HISTORIC_RESIDENTIAL_FOCUS_LABELS.get(focus, HISTORIC_RESIDENTIAL_FOCUS_LABELS["all"]),
        "ward": ward,
        "counts": counts,
        "priority_tiers": _build_solution_catalog(counts),
        "ward_ranking": ward_ranking,
        "priority_meshes": top_meshes,
        "sample_buildings": sample_buildings,
        "official_programs": OFFICIAL_RETROFIT_PROGRAMS,
        "r8_pdf_url": R8_PDF_URL,
        "r8_page_url": R8_PAGE_URL,
        "disclaimer": (
            "※PLATEAU建築年・用途・構造属性とJ-SHIS 250mハザード（2024年版）を組み合わせた優先度スクリーニングです。"
            "実際の建物耐震性は現地調査・耐震診断により確認してください。"
        ),
    }
