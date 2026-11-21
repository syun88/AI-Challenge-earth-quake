"""Gemini AI Assistant with streaming Function Calling backed by QuakeLensDataStore."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlencode

from google import genai

from app.board_store import DisasterBoardStore
from app.constants import (
    OFFICIAL_RETROFIT_PROGRAMS,
    REPORT_CATEGORY_LABELS,
    ROUTE_SIMULATION_DISCLAIMER,
    WARD_NAMES,
)
from app.data_store import QuakeLensDataStore
from app.grounding import verify_grounded_response
from app.reports_store import DamageReportStore
from app.route_sim import ARTERIAL_NODES, simulate_alternative_route

DEFAULT_MODEL = "gemini-3.5-flash-lite"
ALLOWED_MODELS = {"gemini-3.5-flash-lite", "gemini-4-hydrogen", "gemini-4-argon"}

SYSTEM_INSTRUCTION = """あなたは「QuakeLens Japan」の統合防災・災害状況分析AIアシスタントです。
対象地域は京都市全域（Project PLATEAU 2025年度版 + J-SHIS 2024年版地震ハザード・表層地盤V4 + 災害用伝言板 + 被害状況報告）です。

【厳守事項】
1. 建物棟数、割合、ハザード確率、増幅率(ARV)、メッシュコード、区別数値、地震履歴、公式補助制度URL、災害用伝言板の安否件数、被害状況報告の件数・内容、代替経路計算結果を回答する際は、必ず事前に用意されたFunction Callingツールを呼び出し、返却された実データのみに基づいて回答してください。
2. 実データにない数値・住所・確率・URL・報告IDを絶対に推測・捏造しないでください。データが「不明」または0件の場合は、その事実と分母をそのまま伝えてください。
3. **未確認情報・訓練サンプルの区別（最重要）**:
   - 市民投稿による被害報告（`verification_status == "unverified"`）は**「未確認の市民報告」**であり、確定事実や公式発表として絶対に断定しないでください。
   - 訓練用データ（`is_sample == true` / `verification_status == "demo_sample"`）は**「訓練用サンプル」**として実報告と明確に分けて表記してください。
4. 個人情報保護のため、安否伝言板の電話番号（常に伏せ字のまま）や個人の詳細位置を推測・公開しないでください。
5. J-SHISの「今後30年間に震度6弱以上となる確率（T30_I55_PS）」等は地震動の確率であり、「建物の倒壊確率」「個別の耐震診断結果」「リアルタイムの地震予知」ではないことを明記してください。
6. 代替経路シミュレーション結果を示す場合は、必ず「訓練・研究用の簡易幹線道路モデルであり、実際の通行可否を保証しない」旨を明記してください。
7. 簡潔でわかりやすく、見出し・箇条書き・表・太字を活用して日本語で回答してください。
"""

TOOLS = [
    {
        "type": "function",
        "name": "get_area_statistics",
        "description": "京都市全体または指定した区（例: '伏見区', '東山区', '中京区'）の建物統計、築年区分別棟数、建築年不明率、地震ハザード区分別棟数、1981年以前×高ハザード重複件数、区別サマリーを取得します。現在の画面フィルター（age_categories, hazard_tiers, usage_group, meshcode）も渡せます。",
        "parameters": {
            "type": "object",
            "properties": {
                "ward": {
                    "type": "string",
                    "description": "区名（例: '伏見区', '東山区', '中京区'）。市全体の場合は 'all'。",
                },
                "usage_group": {
                    "type": "string",
                    "description": "'all'（全用途）, 'residential'（住宅系）, 'non_residential'（非住宅）",
                },
                "age_categories": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "絞り込む築年区分（pre_1981, 1982_2000, post_2001, unknown）",
                },
                "hazard_tiers": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "絞り込むハザード区分（very_high, elevated, moderate, low）",
                },
                "meshcode": {
                    "type": "string",
                    "description": "特定の250mメッシュコードで絞り込む場合に指定",
                },
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "compare_wards",
        "description": "京都市の複数の区（または全11区）の建物総数、建築年判明率、1981年以前建物数、高ハザード×1981以前重複数、平均30年震度6弱以上確率を比較します。",
        "parameters": {
            "type": "object",
            "properties": {
                "wards": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "比較したい区名の配列（例: ['伏見区', '東山区', '山科区']）。省略時は全11区を比較。",
                },
                "usage_group": {
                    "type": "string",
                    "description": "'all', 'residential', 'non_residential'",
                },
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "get_priority_confirmation_areas",
        "description": "250mメッシュ単位で1981年以前建築の建物数、建築年判明率、地震ハザード確率（T30_I55_PS）、表層地盤増幅率（ARV）、微地形区分（JNAME）を集計し、優先確認エリア一覧を取得します。",
        "parameters": {
            "type": "object",
            "properties": {
                "ward": {
                    "type": "string",
                    "description": "区名で絞り込む場合に指定（例: '伏見区'）。市全体は 'all'。",
                },
                "sort_by": {
                    "type": "string",
                    "description": "並び順: 'pre_1981_high_hazard', 'pre_1981_count', 't30_i55_ps', 'pre_1981_share_known'",
                },
                "min_t30_i55": {
                    "type": "number",
                    "description": "最低30年震度6弱以上確率（0.0〜1.0、例: 0.26 で26%以上）",
                },
                "limit": {
                    "type": "integer",
                    "description": "取得件数（最大15）",
                },
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "get_mesh_details",
        "description": "指定した250mメッシュコード（10桁）の詳細統計・地震ハザード・地盤情報を取得します。",
        "parameters": {
            "type": "object",
            "properties": {
                "meshcode": {
                    "type": "string",
                    "description": "10桁のJIS 250mメッシュコード（例: '5235367414'）",
                }
            },
            "required": ["meshcode"],
        },
    },
    {
        "type": "function",
        "name": "get_building_details",
        "description": "指定した建物IDの建築年・用途・構造・階数・高さと所属メッシュの地震ハザード情報を取得します。",
        "parameters": {
            "type": "object",
            "properties": {
                "building_id": {
                    "type": "string",
                    "description": "建物ID（例: '26100-bldg-479477'）",
                }
            },
            "required": ["building_id"],
        },
    },
    {
        "type": "function",
        "name": "get_recent_earthquakes_summary",
        "description": "気象庁 地震情報APIのキャッシュから直近の地震発生履歴（発生日時・震央地名・マグニチュード・最大震度）を取得します。",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "取得件数（最大20）",
                }
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "get_data_methodology_and_programs",
        "description": "使用しているデータセットの出典・基準年・ライセンス、地図の指標（T30_I55_PS, ARV, AVS, 築年区分）の定義、および京都市公式の耐震診断・耐震改修補助制度情報を取得します。",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "get_disaster_board_summary",
        "description": "災害用伝言板（安否確認）の地域別（区別・メッシュ別）および安否区分別の集計と最近の登録状況（伏せ字済み・サンプル/一般区別あり）を取得します。",
        "parameters": {
            "type": "object",
            "properties": {
                "ward": {
                    "type": "string",
                    "description": "絞り込む区名（例: '伏見区'）。全域は 'all'。",
                },
                "include_samples": {
                    "type": "boolean",
                    "description": "訓練用サンプルを含めるか（デフォルト true）。",
                },
                "limit": {
                    "type": "integer",
                    "description": "最近の一覧取得件数（最大20）。",
                },
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "get_damage_reports_summary",
        "description": "利用者が投稿した災害・被害状況報告（建物損傷・道路通行止め・避難所状況・救助支援要請・その他）の区別・カテゴリ別・確認ステータス別（未確認/確認済/公式/訓練サンプル）集計および報告詳細を取得します。",
        "parameters": {
            "type": "object",
            "properties": {
                "ward": {
                    "type": "string",
                    "description": "絞り込む区名（例: '伏見区'）。全域は 'all'。",
                },
                "category": {
                    "type": "string",
                    "description": "カテゴリ（all, building_damage, road_blocked, shelter_status, rescue_support, other_disaster）",
                },
                "verification_status": {
                    "type": "string",
                    "description": "確認ステータス（all, unverified, verified, official, demo_sample）",
                },
                "include_samples": {
                    "type": "boolean",
                    "description": "訓練サンプルを含めるか（デフォルト true）。",
                },
                "limit": {
                    "type": "integer",
                    "description": "一覧取得件数（最大30）。",
                },
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "prepare_disaster_export",
        "description": "現在の災害状況（建物リスク・安否集計・被害報告）のCSVまたはExcel（.xlsx）ダウンロードリンクと件数サマリーを生成します。「CSVにまとめて」「Excelで出力して」等の要望時に呼び出します。",
        "parameters": {
            "type": "object",
            "properties": {
                "ward": {
                    "type": "string",
                    "description": "対象区名（例: '伏見区'）。全域は 'all'。",
                },
                "category": {
                    "type": "string",
                    "description": "被害報告カテゴリ（all, building_damage, road_blocked, shelter_status, rescue_support, other_disaster）",
                },
                "scope": {
                    "type": "string",
                    "description": "'overview'（統合サマリー+報告詳細）, 'reports'（被害報告のみ）, 'board'（安否伝言板）, 'wards'（区別一覧）",
                },
                "include_samples": {
                    "type": "boolean",
                    "description": "訓練サンプルを含めるか（デフォルト true）。",
                },
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "simulate_alternative_route",
        "description": "【訓練・研究用シミュレーション】京都市主要幹線モデル上で、登録された道路通行止め報告（road_blocked）を回避する代替経路を探索します。",
        "parameters": {
            "type": "object",
            "properties": {
                "origin_id": {
                    "type": "string",
                    "description": "出発拠点ID（例: 'kyoto_st', 'takeda_st', 'karasuma_oike'）",
                },
                "destination_id": {
                    "type": "string",
                    "description": "目的拠点ID（例: 'chushojima', 'yamashina_st', 'fushimi_otesuji'）",
                },
                "include_samples": {
                    "type": "boolean",
                    "description": "訓練用サンプルの通行止めも含めるか（デフォルト true）",
                },
            },
            "required": ["origin_id", "destination_id"],
        },
    },
]


def _resolve_model(model: str | None) -> str:
    if model and model in ALLOWED_MODELS:
        return model
    return DEFAULT_MODEL


def _summarize_tool_call(name: str, args: dict[str, Any], result: Any) -> str:
    if isinstance(result, dict) and result.get("error"):
        return str(result["error"])
    if name == "get_area_statistics" and isinstance(result, dict):
        ward = (result.get("scope") or {}).get("ward", "all")
        w_label = "京都市全域" if ward == "all" else f"京都市{ward}"
        tot = result.get("total_buildings", 0)
        pre81 = result.get("pre_1981_count", 0)
        rate = float(result.get("known_year_rate") or 0) * 100
        return f"{w_label}: {tot:,}棟（1981以前 {pre81:,}棟 / 判明率 {rate:.1f}%）"
    if name == "compare_wards" and isinstance(result, dict):
        rows = result.get("wards", [])
        return f"区別比較: {len(rows)}区の統計を取得"
    if name == "get_priority_confirmation_areas" and isinstance(result, dict):
        areas = result.get("areas", [])
        if areas:
            top = areas[0]
            return f"優先エリア {len(areas)}件取得（1位: {top['ward_name']} {top['meshcode']} / 1981以前 {top['pre_1981_count']}棟）"
        return "該当する優先確認エリア 0件"
    if name == "get_mesh_details" and isinstance(result, dict):
        return f"メッシュ {result.get('meshcode')}（{result.get('ward_name')}）: 総{result.get('total_buildings', 0):,}棟・1981以前 {result.get('pre_1981_count', 0):,}棟"
    if name == "get_building_details" and isinstance(result, dict):
        yr = f"{result['year_built']}年築" if result.get("year_built") else "建築年不明"
        return f"建物 {result.get('building_id')}（{result.get('ward_name')} / {yr} / {result.get('structure_label')}）"
    if name == "get_recent_earthquakes_summary" and isinstance(result, dict):
        return f"気象庁 直近地震情報 {len(result.get('earthquakes', []))}件"
    if name == "get_data_methodology_and_programs":
        return "データ出典・指標定義・京都市公式耐震補助制度を取得"
    if name == "get_disaster_board_summary" and isinstance(result, dict):
        w = (result.get("scope") or {}).get("ward", "all")
        w_label = "京都市全域" if w == "all" else f"京都市{w}"
        return f"災害用伝言板（{w_label}）: 計{result.get('total_entries', 0)}件（市民 {result.get('user_entries_count', 0)}件 / 訓練 {result.get('sample_entries_count', 0)}件）"
    if name == "get_damage_reports_summary" and isinstance(result, dict):
        return f"被害状況報告: 継続中{result.get('total_reports', 0)}件（未確認 {result.get('unverified_count', 0)}件 / 確認済・公式 {result.get('verified_count', 0) + result.get('official_count', 0)}件 / 訓練 {result.get('demo_sample_count', 0)}件）"
    if name == "prepare_disaster_export" and isinstance(result, dict):
        return f"CSV・Excel出力データを生成（報告 {result.get('report_count', 0)}件・安否 {result.get('board_count', 0)}件）"
    if name == "simulate_alternative_route" and isinstance(result, dict):
        alt = result.get("alternative_route") or {}
        if alt.get("reachable"):
            return f"代替経路シミュレーション（訓練用）: {alt.get('distance_km')}km（回避箇所 {len(result.get('blocked_segments', []))}区間）"
        return "代替経路シミュレーション（訓練用）: 回避経路なし"
    return f"{name} 実行完了"


def _extract_map_actions(name: str, result: Any) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    if not isinstance(result, dict) or result.get("error"):
        return actions

    if name == "get_priority_confirmation_areas":
        for area in (result.get("areas") or [])[:3]:
            prob = f"{area['t30_i55_ps']*100:.0f}%" if area.get("t30_i55_ps") is not None else "—"
            actions.append({
                "type": "fly_to_mesh",
                "key": f"mesh:{area['meshcode']}",
                "label": f"{area['ward_name']} {area['meshcode']}（1981以前 {area['pre_1981_count']}棟・確率{prob}）",
                "meshcode": area["meshcode"],
                "lon": area["centroid_lon"],
                "lat": area["centroid_lat"],
                "zoom": 15.8,
            })
    elif name == "get_mesh_details" and result.get("meshcode"):
        actions.append({
            "type": "fly_to_mesh",
            "key": f"mesh:{result['meshcode']}",
            "label": f"メッシュ {result['meshcode']}（{result['ward_name']}）へ移動",
            "meshcode": result["meshcode"],
            "lon": result["centroid_lon"],
            "lat": result["centroid_lat"],
            "zoom": 15.8,
        })
    elif name == "get_building_details" and result.get("building_id"):
        actions.append({
            "type": "focus_building",
            "key": f"bldg:{result['building_id']}",
            "label": f"建物 {result['building_id']} を地図で確認",
            "building_id": result["building_id"],
            "lon": result["centroid_lon"],
            "lat": result["centroid_lat"],
            "zoom": 17.2,
        })
    elif name == "get_area_statistics":
        ward = (result.get("scope") or {}).get("ward")
        if ward and ward != "all" and ward in WARD_NAMES.values():
            actions.append({
                "type": "fly_to_ward",
                "key": f"ward:{ward}",
                "label": f"京都市 {ward} に移動して表示",
                "ward": ward,
            })
    elif name == "compare_wards":
        for row in (result.get("wards") or [])[:2]:
            w = row.get("ward_name")
            if w and w in WARD_NAMES.values():
                actions.append({
                    "type": "fly_to_ward",
                    "key": f"ward:{w}",
                    "label": f"{w}（1981以前 {row['pre_1981_count']:,}棟）へ移動",
                    "ward": w,
                })
    elif name == "get_disaster_board_summary":
        for row in (result.get("by_ward") or [])[:2]:
            w = row.get("ward_name")
            if w and w in WARD_NAMES.values():
                actions.append({
                    "type": "fly_to_ward",
                    "key": f"board_ward:{w}",
                    "label": f"{w}の安否・地図を確認（{row['total_count']}件）",
                    "ward": w,
                })
    elif name == "get_damage_reports_summary":
        for rep in (result.get("reports") or [])[:3]:
            if rep.get("lon") is not None and rep.get("lat") is not None:
                actions.append({
                    "type": "focus_report",
                    "key": f"rep:{rep['id']}",
                    "label": f"[{rep['verification_label']}] {rep['ward_name']} {rep['category_label']}",
                    "report_id": rep["id"],
                    "ward": rep["ward_name"],
                    "lon": rep["lon"],
                    "lat": rep["lat"],
                    "zoom": 15.6,
                })
    elif name == "prepare_disaster_export":
        if result.get("csv_url"):
            actions.append({
                "type": "download_export",
                "key": f"csv:{result['csv_url']}",
                "label": f"CSVをダウンロード（{result.get('ward', 'all')}）",
                "url": result["csv_url"],
                "format": "csv",
            })
        if result.get("xlsx_url"):
            actions.append({
                "type": "download_export",
                "key": f"xlsx:{result['xlsx_url']}",
                "label": f"Excel (.xlsx) をダウンロード",
                "url": result["xlsx_url"],
                "format": "xlsx",
            })
    elif name == "simulate_alternative_route":
        ori = result.get("origin") or {}
        dst = result.get("destination") or {}
        if ori.get("id") and dst.get("id"):
            actions.append({
                "type": "show_route_simulation",
                "key": f"route:{ori['id']}:{dst['id']}",
                "label": f"訓練ルート確認: {ori.get('ward')} → {dst.get('ward')}",
                "origin_id": ori["id"],
                "destination_id": dst["id"],
                "lon": dst.get("lon"),
                "lat": dst.get("lat"),
                "zoom": 13.5,
            })
    return actions


def _dedupe_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for a in actions:
        k = str(a.get("key") or a.get("label"))
        if k not in seen:
            seen.add(k)
            out.append(a)
        if len(out) >= 6:
            break
    return out


def _resolve_board_store(board_store: DisasterBoardStore | None) -> DisasterBoardStore:
    if board_store is not None:
        return board_store
    s = DisasterBoardStore()
    s.ensure_initialized()
    return s


def _resolve_reports_store(reports_store: DamageReportStore | None) -> DamageReportStore:
    if reports_store is not None:
        return reports_store
    s = DamageReportStore()
    s.ensure_initialized()
    return s


def _execute_tool(
    store: QuakeLensDataStore,
    name: str,
    args: dict[str, Any] | None,
    earthquakes_cache: list[dict[str, Any]] | None = None,
    board_store: DisasterBoardStore | None = None,
    reports_store: DamageReportStore | None = None,
) -> Any:
    args = args or {}
    if name == "get_area_statistics":
        ward = args.get("ward") or "all"
        usage_group = args.get("usage_group") or "all"
        age_cats = args.get("age_categories") or None
        hazard_tiers = args.get("hazard_tiers") or None
        meshcode = args.get("meshcode") or None
        stats = store.get_stats(
            ward=ward,
            age_categories=age_cats,
            hazard_tiers=hazard_tiers,
            usage_group=usage_group,
            meshcode=meshcode,
        )
        return {
            "scope": stats["scope"],
            "total_buildings": stats["total_buildings"],
            "known_year_count": stats["known_year_count"],
            "unknown_year_count": stats["unknown_year_count"],
            "known_year_rate": stats["known_year_rate"],
            "unknown_year_rate": stats["unknown_year_rate"],
            "pre_1981_count": stats["pre_1981_count"],
            "pre_1981_share_of_total": stats["pre_1981_share_of_total"],
            "pre_1981_share_of_known": stats["pre_1981_share_of_known"],
            "overlap_very_high_pre1981_26pct_plus": stats["overlap_very_high_pre1981"],
            "overlap_elevated_or_higher_pre1981_6pct_plus": stats["overlap_elevated_or_higher_pre1981"],
            "age_breakdown": stats["age_breakdown"],
            "hazard_breakdown": stats["hazard_breakdown"],
            "usage_breakdown": stats["usage_breakdown"],
            "structure_breakdown": stats["structure_breakdown"],
            "ward_summary": stats["ward_summary"],
        }

    if name == "compare_wards":
        usage_group = args.get("usage_group") or "all"
        stats = store.get_stats(ward="all", usage_group=usage_group)
        target_wards = args.get("wards") or []
        rows = stats["ward_summary"]
        if target_wards:
            rows = [r for r in rows if r["ward_name"] in target_wards]
        return {
            "usage_group": usage_group,
            "wards": rows,
        }

    if name == "get_priority_confirmation_areas":
        ward = args.get("ward") or "all"
        sort_by = args.get("sort_by") or "pre_1981_high_hazard"
        min_t30 = float(args.get("min_t30_i55") or 0.0)
        limit = min(int(args.get("limit") or 10), 15)
        areas = store.get_priority_areas(
            ward=ward,
            min_t30_i55=min_t30,
            sort_by=sort_by,
            limit=limit,
        )
        return {"ward": ward, "sort_by": sort_by, "min_t30_i55": min_t30, "areas": areas}

    if name == "get_mesh_details":
        meshcode = str(args.get("meshcode") or "")
        detail = store.get_mesh_detail(meshcode)
        return detail or {"error": f"メッシュコード '{meshcode}' のデータが見つかりません。"}

    if name == "get_building_details":
        building_id = str(args.get("building_id") or "")
        detail = store.get_building_detail(building_id)
        return detail or {"error": f"建物ID '{building_id}' のデータが見つかりません。"}

    if name == "get_recent_earthquakes_summary":
        limit = min(int(args.get("limit") or 10), 20)
        items = (earthquakes_cache or [])[:limit]
        return {
            "source": "気象庁 地震情報 JSON",
            "count": len(items),
            "earthquakes": items,
            "note": "未取得の場合は地図レイヤー『気象庁 直近震源履歴』から最新情報を取得できます。" if not items else None,
        }

    if name == "get_data_methodology_and_programs":
        meta = store.get_metadata()
        return {
            "municipality": meta["municipality"],
            "data_sources": meta["data_sources"],
            "indicator_definitions": {
                "T30_I55_PS": "J-SHIS（2024年版・平均ケース）による、今後30年間に震度6弱以上の揺れに見舞われる確率（0〜1の数値、100倍で%）。建物の倒壊確率ではありません。",
                "T30_I60_PS": "今後30年間に震度6強以上の揺れに見舞われる確率。",
                "ARV": "表層地盤の最大速度増幅率（数値が大きいほど表層地盤で揺れが増幅しやすい傾向）。",
                "AVS": "深さ30mまでの平均S波速度（m/s、数値が小さいほど軟弱な地盤の傾向）。",
                "JNAME": "微地形区分（例: 扇状地、砂礫質台地、後背湿地、自然堤防など）。",
                "age_category": "PLATEAUの建築年(bldg:yearOfConstruction)に基づく4区分（1981年以前 / 1982〜2000年 / 2001年以降 / 建築年不明）。建築年欠損や異常値（0001等）は推定せず『建築年不明』として保持。",
            },
            "official_retrofit_programs": OFFICIAL_RETROFIT_PROGRAMS,
        }

    if name == "get_disaster_board_summary":
        b_store = _resolve_board_store(board_store)
        ward = args.get("ward") or "all"
        include_samples = bool(args.get("include_samples", True))
        limit = min(int(args.get("limit") or 10), 20)
        summary = b_store.summarize_entries(
            ward=ward,
            include_samples=include_samples,
            store=store,
        )
        entries = b_store.list_entries(
            ward=ward,
            include_samples=include_samples,
            limit=limit,
        )
        return {
            **summary,
            "recent_entries": entries,
        }

    if name == "get_damage_reports_summary":
        r_store = _resolve_reports_store(reports_store)
        ward = args.get("ward") or "all"
        category = args.get("category") or "all"
        ver_status = args.get("verification_status") or "all"
        include_samples = bool(args.get("include_samples", True))
        limit = min(int(args.get("limit") or 15), 30)
        summary = r_store.summarize_reports(
            ward=ward,
            category=category,
            include_samples=include_samples,
            store=store,
        )
        reports = r_store.list_reports(
            ward=ward,
            category=category,
            verification_status=ver_status,
            include_samples=include_samples,
            include_resolved=False,
            limit=limit,
        )
        return {
            **summary,
            "reports": reports,
        }

    if name == "prepare_disaster_export":
        b_store = _resolve_board_store(board_store)
        r_store = _resolve_reports_store(reports_store)
        ward = args.get("ward") or "all"
        category = args.get("category") or "all"
        scope = args.get("scope") or "overview"
        if scope not in {"overview", "wards", "reports", "board"}:
            scope = "overview"
        include_samples = bool(args.get("include_samples", True))
        params = urlencode({
            "scope": scope,
            "ward": ward,
            "category": category,
            "include_samples": "true" if include_samples else "false",
        })
        r_sum = r_store.summarize_reports(ward=ward, category=category, include_samples=include_samples, store=store)
        b_sum = b_store.summarize_entries(ward=ward, include_samples=include_samples, store=store)
        return {
            "scope": scope,
            "ward": ward,
            "category": category,
            "category_label": REPORT_CATEGORY_LABELS.get(category, "全カテゴリ"),
            "include_samples": include_samples,
            "report_count": r_sum["total_reports"],
            "unverified_report_count": r_sum["unverified_count"],
            "board_count": b_sum["total_entries"],
            "csv_url": f"/api/exports/disaster-summary.csv?{params}",
            "xlsx_url": f"/api/exports/disaster-summary.xlsx?{params}",
            "note": "未確認の市民報告・訓練サンプルの区分列を保持した状態でCSV/Excelを生成します。",
        }

    if name == "simulate_alternative_route":
        r_store = _resolve_reports_store(reports_store)
        origin_id = str(args.get("origin_id") or "takeda_st")
        destination_id = str(args.get("destination_id") or "chushojima")
        include_samples = bool(args.get("include_samples", True))
        if origin_id not in ARTERIAL_NODES or destination_id not in ARTERIAL_NODES:
            return {
                "error": "未知の拠点IDが指定されました。",
                "available_nodes": list(ARTERIAL_NODES.keys()),
            }
        reports = r_store.list_reports(category="road_blocked", include_samples=include_samples, include_resolved=False, limit=100)
        return simulate_alternative_route(
            origin_id=origin_id,
            destination_id=destination_id,
            reports=reports,
            include_samples=include_samples,
            store=store,
        )

    return {"error": f"Unknown tool: {name}"}


def _build_contextual_prompt(message: str, context: dict[str, Any] | None) -> str:
    if not context:
        return message
    ctx_lines = []
    if context.get("ward") and context["ward"] != "all":
        ctx_lines.append(f"表示中の区: {context['ward']}")
    if context.get("usage_group") and context["usage_group"] != "all":
        ctx_lines.append(f"用途フィルター: {context['usage_group']}")
    if context.get("age_categories") and len(context["age_categories"]) < 4:
        ctx_lines.append(f"築年フィルター: {','.join(context['age_categories'])}")
    if context.get("hazard_tiers") and len(context["hazard_tiers"]) < 4:
        ctx_lines.append(f"ハザードフィルター: {','.join(context['hazard_tiers'])}")
    if context.get("selected_meshcode"):
        ctx_lines.append(f"選択中の250mメッシュ: {context['selected_meshcode']}")
    if context.get("selected_building_id"):
        ctx_lines.append(f"選択中の建物ID: {context['selected_building_id']}")
    if context.get("is_3d"):
        ctx_lines.append("地図表示モード: 3D立体表示")
    if not ctx_lines:
        return message
    return f"[現在の画面コンテキスト: {' / '.join(ctx_lines)}]\n\n質問: {message}"


def _build_correction_prompt(verification: dict[str, Any]) -> str:
    if verification["status"] == "no_tools":
        return (
            "実データ照会ツールを呼び出さずに数値・識別子・URLを記述しました。"
            "必ず事前に用意されたFunction Callingツールを実行し、返却された実測値・コード・URLのみを用いて回答し直してください。"
        )
    flagged = (verification.get("unverified_claims") or []) + (verification.get("unverified_urls") or [])
    sample = ", ".join(flagged[:6])
    return (
        f"回答内の次の数値・識別子またはURLがツール返却値内で直接照合できませんでした: {sample}。"
        "推測や記憶による数値を削除するか必要なツールを追加呼び出しし、ツール返却値に含まれる数値・コード・URLのみを使って正確に回答を書き直してください。"
    )


def _detect_ward_from_message(message: str, fallback_ward: str) -> str:
    for w in WARD_NAMES.values():
        if w in message:
            return w
    return fallback_ward


def _build_unconfigured_fallback(
    store: QuakeLensDataStore,
    message: str,
    context: dict[str, Any] | None,
    board_store: DisasterBoardStore | None = None,
    reports_store: DamageReportStore | None = None,
) -> dict[str, Any]:
    """Return real backend tool results + transparent setup notice when no Gemini API key is configured."""
    ctx = context or {}
    ctx_ward = str(ctx.get("ward") or "all")
    ward = _detect_ward_from_message(message, ctx_ward)
    meshcode = ctx.get("selected_meshcode")
    building_id = ctx.get("selected_building_id")
    usage_group = str(ctx.get("usage_group") or "all")
    age_categories = ctx.get("age_categories") if isinstance(ctx.get("age_categories"), list) else None
    hazard_tiers = ctx.get("hazard_tiers") if isinstance(ctx.get("hazard_tiers"), list) else None

    tool_trace: list[dict[str, Any]] = []
    tool_records: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    sections: list[str] = [
        "⚠️ **Gemini APIキー（`GEMINI_API_KEY`）が未設定のため、AIによる自然言語生成は停止中です。**\n"
        "代わりに、バックエンドの実データ照会ツールを直接実行して得られた正確な集計値をご案内します。\n"
        "（`.env` に `GEMINI_API_KEY` を設定するか、上の「APIキー設定」からキーを入力すると Gemini による対話解説が利用できます）"
    ]

    if building_id:
        b_args = {"building_id": building_id}
        b = _execute_tool(store, "get_building_details", b_args, board_store=board_store, reports_store=reports_store)
        tool_records.append({"name": "get_building_details", "arguments": b_args, "result": b})
        tool_trace.append({
            "name": "get_building_details",
            "arguments": b_args,
            "summary": _summarize_tool_call("get_building_details", b_args, b),
        })
        actions.extend(_extract_map_actions("get_building_details", b))
        if isinstance(b, dict) and not b.get("error"):
            prob = f"{b['t30_i55_ps']*100:.1f}%" if b.get("t30_i55_ps") is not None else "不明"
            sections.append(
                f"### 選択建物（`{b['building_id']}`）の実測データ\n"
                f"- 所在地・区分: 京都市 {b['ward_name']} / {b['age_label']}（建築年: {b.get('year_built') or '不明'}）\n"
                f"- 構造・用途: {b['structure_label']} / {b['usage_label']}\n"
                f"- 30年震度6弱以上確率: **{prob}**（微地形: {b['jname']} / ARV: {b.get('arv') or '—'}）"
            )
    elif meshcode:
        m_args = {"meshcode": meshcode}
        m = _execute_tool(store, "get_mesh_details", m_args, board_store=board_store, reports_store=reports_store)
        tool_records.append({"name": "get_mesh_details", "arguments": m_args, "result": m})
        tool_trace.append({
            "name": "get_mesh_details",
            "arguments": m_args,
            "summary": _summarize_tool_call("get_mesh_details", m_args, m),
        })
        actions.extend(_extract_map_actions("get_mesh_details", m))
        if isinstance(m, dict) and not m.get("error"):
            prob = f"{m['t30_i55_ps']*100:.1f}%" if m.get("t30_i55_ps") is not None else "不明"
            sections.append(
                f"### 選択メッシュ（`{m['meshcode']}` / {m['ward_name']}）の実測データ\n"
                f"- 総建物数: **{m['total_buildings']:,}棟**（建築年不明 {m['unknown_year_count']:,}棟・判明率 {m['known_year_rate']*100:.2f}%）\n"
                f"- 1981年以前建築: **{m['pre_1981_count']:,}棟**（木造 {m['wooden_pre_1981_count']:,}棟）\n"
                f"- 30年震度6弱以上確率: **{prob}** / 表層地盤増幅率 ARV: **{m.get('arv') or '—'}**（{m['jname']}）"
            )

    stats_args: dict[str, Any] = {"ward": ward}
    if usage_group and usage_group != "all":
        stats_args["usage_group"] = usage_group
    if age_categories and len(age_categories) < 4:
        stats_args["age_categories"] = age_categories
    if hazard_tiers and len(hazard_tiers) < 5:
        stats_args["hazard_tiers"] = hazard_tiers

    stats = _execute_tool(store, "get_area_statistics", stats_args, board_store=board_store, reports_store=reports_store)
    tool_records.append({"name": "get_area_statistics", "arguments": stats_args, "result": stats})
    tool_trace.append({
        "name": "get_area_statistics",
        "arguments": stats_args,
        "summary": _summarize_tool_call("get_area_statistics", stats_args, stats),
    })
    actions.extend(_extract_map_actions("get_area_statistics", stats))
    w_label = "京都市全域" if ward == "all" else f"京都市 {ward}"
    tot_b = stats["total_buildings"]
    known_pct = (stats["known_year_count"] / tot_b * 100.0) if tot_b else 0.0
    unknown_pct = (stats["unknown_year_count"] / tot_b * 100.0) if tot_b else 0.0
    sections.append(
        f"### {w_label} の建物・ハザード統計\n"
        f"- 対象総棟数: **{tot_b:,}棟**（建築年判明 {stats['known_year_count']:,}棟 [{known_pct:.2f}%] / 不明 {stats['unknown_year_count']:,}棟 [{unknown_pct:.2f}%]）\n"
        f"- 1981年以前建築: **{stats['pre_1981_count']:,}棟**\n"
        f"- 震度6弱+確率6%以上 × 1981以前重複: **{stats['overlap_elevated_or_higher_pre1981_6pct_plus']:,}棟**（うち26%以上: {stats['overlap_very_high_pre1981_26pct_plus']:,}棟）"
    )

    if any(k in message for k in ["被害", "報告", "道路", "損壊", "通行止め", "避難所", "救助", "支援", "状況", "CSV", "csv", "Excel", "まとめ"]):
        cat_filter = "all"
        if any(k in message for k in ["道路", "通行止め", "損壊"]):
            cat_filter = "road_blocked"
        elif "救助" in message or ("支援" in message and "補助" not in message):
            cat_filter = "rescue_support"
        elif "避難所" in message:
            cat_filter = "shelter_status"
        elif "倒壊" in message or "建物損傷" in message:
            cat_filter = "building_damage"

        rep_args = {"ward": ward, "category": cat_filter, "limit": 10}
        rep_res = _execute_tool(
            store,
            "get_damage_reports_summary",
            rep_args,
            board_store=board_store,
            reports_store=reports_store,
        )
        tool_records.append({"name": "get_damage_reports_summary", "arguments": rep_args, "result": rep_res})
        tool_trace.append({
            "name": "get_damage_reports_summary",
            "arguments": rep_args,
            "summary": _summarize_tool_call("get_damage_reports_summary", rep_args, rep_res),
        })
        actions.extend(_extract_map_actions("get_damage_reports_summary", rep_res))
        rep_lines = [
            f"- 抽出件数（継続中）: **{rep_res['total_reports']}件**（うち未確認・市民報告 **{rep_res['unverified_count']}件** / 訓練サンプル **{rep_res['demo_sample_count']}件** / 確認済・公式 **{rep_res['verified_count'] + rep_res['official_count']}件**）"
        ]
        for r in (rep_res.get("reports") or [])[:5]:
            rep_lines.append(
                f"  - `{r['id']}` [{r['verification_label']}] {r['ward_name']} / {r['category_label']}: {r['title']}"
            )
        rep_lines.append("※ 未確認の市民投稿や訓練サンプルは確定事実ではありません。")
        sections.append("### 被害状況報告サマリー\n" + "\n".join(rep_lines))

    if any(k in message for k in ["安否", "伝言", "無事", "避難所", "状況", "まとめ", "CSV", "csv", "Excel"]):
        b_args = {"ward": ward, "limit": 8}
        b_res = _execute_tool(
            store,
            "get_disaster_board_summary",
            b_args,
            board_store=board_store,
            reports_store=reports_store,
        )
        tool_records.append({"name": "get_disaster_board_summary", "arguments": b_args, "result": b_res})
        tool_trace.append({
            "name": "get_disaster_board_summary",
            "arguments": b_args,
            "summary": _summarize_tool_call("get_disaster_board_summary", b_args, b_res),
        })
        actions.extend(_extract_map_actions("get_disaster_board_summary", b_res))
        sc = b_res.get("status_counts") or {}
        sections.append(
            f"### 災害用伝言板（安否集計）\n"
            f"- 登録総数: **{b_res['total_entries']}件**（市民登録 **{b_res['user_entries_count']}件** / 訓練サンプル **{b_res['sample_entries_count']}件**）\n"
            f"- 区分別: 無事 {sc.get('safe', 0)}件 / 避難所 {sc.get('shelter', 0)}件 / 自宅 {sc.get('home', 0)}件 / 軽傷・支援要 {sc.get('minor_injury', 0)}件 / 連絡待ち {sc.get('waiting', 0)}件"
        )

    if any(k in message for k in ["CSV", "csv", "Excel", "excel", "xlsx", "ダウンロード", "出力"]):
        ex_args = {"ward": ward, "scope": "overview"}
        ex_res = _execute_tool(
            store,
            "prepare_disaster_export",
            ex_args,
            board_store=board_store,
            reports_store=reports_store,
        )
        tool_records.append({"name": "prepare_disaster_export", "arguments": ex_args, "result": ex_res})
        tool_trace.append({
            "name": "prepare_disaster_export",
            "arguments": ex_args,
            "summary": _summarize_tool_call("prepare_disaster_export", ex_args, ex_res),
        })
        actions.extend(_extract_map_actions("prepare_disaster_export", ex_res))
        sections.append(
            f"### CSV / Excel 出力\n"
            f"下のボタンから最新集計（報告 {ex_res['report_count']}件・安否 {ex_res['board_count']}件）をCSVまたはExcel形式でダウンロードできます。"
        )

    if any(k in message for k in ["優先", "多い", "エリア", "メッシュ", "ハザード", "どこ"]):
        p_args = {"ward": ward, "limit": 3}
        p_res = _execute_tool(store, "get_priority_confirmation_areas", p_args, board_store=board_store, reports_store=reports_store)
        tool_records.append({"name": "get_priority_confirmation_areas", "arguments": p_args, "result": p_res})
        tool_trace.append({
            "name": "get_priority_confirmation_areas",
            "arguments": p_args,
            "summary": _summarize_tool_call("get_priority_confirmation_areas", p_args, p_res),
        })
        actions.extend(_extract_map_actions("get_priority_confirmation_areas", p_res))

    if any(k in message for k in ["補助", "診断", "制度"]):
        prog = _execute_tool(store, "get_data_methodology_and_programs", {}, board_store=board_store, reports_store=reports_store)
        tool_records.append({"name": "get_data_methodology_and_programs", "arguments": {}, "result": prog})
        tool_trace.append({
            "name": "get_data_methodology_and_programs",
            "arguments": {},
            "summary": _summarize_tool_call("get_data_methodology_and_programs", {}, prog),
        })
        links = "\n".join(f"- [{p['title']}]({p['url']})" for p in prog["official_retrofit_programs"][:3])
        sections.append(f"### 京都市公式の耐震診断・補助制度\n{links}")

    answer = "\n\n".join(sections)
    verification = verify_grounded_response(answer, tool_records)
    return {
        "configured": False,
        "answer": answer,
        "interaction_id": None,
        "tool_calls": tool_trace,
        "map_actions": _dedupe_actions(actions),
        "model": None,
        "verification": verification,
    }


def _max_output_tokens() -> int:
    raw = os.getenv("AI_MAX_OUTPUT_TOKENS", "").strip()
    if raw:
        try:
            return min(4096, max(256, int(raw)))
        except ValueError:
            pass
    return 1536


def _resolve_api_key(api_key_override: str | None) -> str:
    if api_key_override and api_key_override.strip():
        return api_key_override.strip()
    env_key = os.getenv("GEMINI_API_KEY", "").strip()
    if env_key and env_key != "your_gemini_api_key_here":
        return env_key
    return ""


def ask_quakelens_ai(
    store: QuakeLensDataStore,
    message: str,
    context: dict[str, Any] | None = None,
    previous_interaction_id: str | None = None,
    model: str | None = None,
    api_key_override: str | None = None,
    earthquakes_cache: list[dict[str, Any]] | None = None,
    board_store: DisasterBoardStore | None = None,
    reports_store: DamageReportStore | None = None,
) -> dict[str, Any]:
    """Run Gemini Interactions API with Function Calling against real Kyoto City data."""
    api_key = _resolve_api_key(api_key_override)
    if not api_key:
        return _build_unconfigured_fallback(
            store,
            message,
            context,
            board_store=board_store,
            reports_store=reports_store,
        )

    chosen_model = _resolve_model(model)
    prompt = _build_contextual_prompt(message, context)
    client = genai.Client(api_key=api_key, http_options={"timeout": 120000})
    tool_trace: list[dict[str, Any]] = []
    tool_records: list[dict[str, Any]] = []
    map_actions: list[dict[str, Any]] = []
    gen_cfg = {"max_output_tokens": _max_output_tokens()}
    current_input: Any = prompt
    prev_id = previous_interaction_id
    tool_rounds = 0
    correction_used = False

    for _ in range(6):
        kwargs: dict[str, Any] = {
            "model": chosen_model,
            "input": current_input,
            "system_instruction": SYSTEM_INSTRUCTION,
            "tools": TOOLS,
            "generation_config": gen_cfg,
        }
        if prev_id:
            kwargs["previous_interaction_id"] = prev_id

        interaction = client.interactions.create(**kwargs)
        inter_status = getattr(interaction, "status", None)
        if inter_status in {"failed", "cancelled"}:
            raise RuntimeError(f"AI処理が正常に完了しませんでした（ステータス: {inter_status}）。")
        prev_id = interaction.id

        fc_steps = [s for s in (interaction.steps or []) if getattr(s, "type", None) == "function_call"]
        if fc_steps:
            tool_rounds += 1
            if tool_rounds > 4:
                raise RuntimeError("ツール照会回数の上限に達したため、回答生成を完了できませんでした。")
            fn_results = []
            for fc in fc_steps:
                fn_name = fc.name
                fn_args = dict(fc.arguments) if fc.arguments else {}
                result_data = _execute_tool(
                    store,
                    fn_name,
                    fn_args,
                    earthquakes_cache=earthquakes_cache,
                    board_store=board_store,
                    reports_store=reports_store,
                )
                tool_records.append({"name": fn_name, "arguments": fn_args, "result": result_data})
                summary = _summarize_tool_call(fn_name, fn_args, result_data)
                map_actions.extend(_extract_map_actions(fn_name, result_data))
                tool_trace.append({
                    "name": fn_name,
                    "arguments": fn_args,
                    "summary": summary,
                })
                fn_results.append({
                    "type": "function_result",
                    "name": fn_name,
                    "call_id": fc.id,
                    "result": [{"type": "text", "text": json.dumps(result_data, ensure_ascii=False)}],
                })
            current_input = fn_results
            continue

        answer_text = (interaction.output_text or "").strip()
        if not answer_text:
            raise RuntimeError("モデルから回答テキストが返却されませんでした。")

        verification = verify_grounded_response(answer_text, tool_records)
        if verification["status"] in {"no_tools", "warning"} and not correction_used and inter_status != "incomplete":
            correction_used = True
            current_input = _build_correction_prompt(verification)
            continue

        return {
            "configured": True,
            "answer": answer_text,
            "interaction_id": interaction.id,
            "tool_calls": tool_trace,
            "map_actions": _dedupe_actions(map_actions),
            "model": chosen_model,
            "incomplete": inter_status == "incomplete",
            "verification": verification,
        }

    raise RuntimeError("ツール照会回数の上限に達したため、回答生成を完了できませんでした。")


def stream_quakelens_ai(
    store: QuakeLensDataStore,
    message: str,
    context: dict[str, Any] | None = None,
    previous_interaction_id: str | None = None,
    model: str | None = None,
    api_key_override: str | None = None,
    earthquakes_cache: list[dict[str, Any]] | None = None,
    board_store: DisasterBoardStore | None = None,
    reports_store: DamageReportStore | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield structured SSE events while streaming Gemini Function Calling and text deltas."""
    api_key = _resolve_api_key(api_key_override)
    if not api_key:
        fallback = _build_unconfigured_fallback(
            store,
            message,
            context,
            board_store=board_store,
            reports_store=reports_store,
        )
        for tc in fallback["tool_calls"]:
            yield {"type": "tool_result", **tc}
        yield {"type": "done", **fallback, "model": _resolve_model(model)}
        return

    chosen_model = _resolve_model(model)
    prompt = _build_contextual_prompt(message, context)
    client = genai.Client(api_key=api_key, http_options={"timeout": 120000})

    tool_trace: list[dict[str, Any]] = []
    tool_records: list[dict[str, Any]] = []
    map_actions: list[dict[str, Any]] = []
    full_text_parts: list[str] = []
    current_input: Any = prompt
    prev_id = previous_interaction_id
    gen_cfg = {"max_output_tokens": _max_output_tokens()}
    tool_rounds = 0
    correction_used = False

    yield {"type": "status", "message": f"{chosen_model} で実データを照会中..."}

    for _ in range(6):
        kwargs: dict[str, Any] = {
            "model": chosen_model,
            "input": current_input,
            "system_instruction": SYSTEM_INSTRUCTION,
            "tools": TOOLS,
            "generation_config": gen_cfg,
            "stream": True,
        }
        if prev_id:
            kwargs["previous_interaction_id"] = prev_id

        completed_interaction = None
        fc_by_index: dict[int, dict[str, Any]] = {}

        for event in client.interactions.create(**kwargs):
            ev_type = getattr(event, "event_type", None)
            ev_idx = getattr(event, "index", None)
            if ev_type in {"error", "interaction.failed"}:
                err_obj = getattr(event, "error", None)
                err_msg = getattr(err_obj, "message", None) or str(err_obj or "AIストリーミング中にエラーが発生しました。")
                yield {"type": "error", "message": err_msg}
                return
            if ev_type == "step.start":
                step = getattr(event, "step", None)
                st_type = getattr(step, "type", None)
                if st_type == "thought":
                    yield {"type": "status", "message": f"{chosen_model} が質問内容と必要なツールを分析中..."}
                elif st_type == "function_call":
                    fn_name = getattr(step, "name", "")
                    init_args = getattr(step, "arguments", None)
                    key = ev_idx if ev_idx is not None else len(fc_by_index)
                    fc_by_index[key] = {
                        "id": getattr(step, "id", ""),
                        "name": fn_name,
                        "arguments": dict(init_args) if isinstance(init_args, dict) else {},
                        "arg_chunks": [],
                    }
                    yield {
                        "type": "tool_start",
                        "name": fn_name,
                    }
            elif ev_type == "step.delta":
                delta = getattr(event, "delta", None)
                d_type = getattr(delta, "type", None)
                if d_type == "text" and getattr(delta, "text", None):
                    chunk = delta.text
                    full_text_parts.append(chunk)
                    yield {"type": "text_delta", "delta": chunk}
                elif ev_idx in fc_by_index and getattr(delta, "arguments", None) is not None:
                    arg_val = delta.arguments
                    if isinstance(arg_val, str):
                        fc_by_index[ev_idx]["arg_chunks"].append(arg_val)
                    elif isinstance(arg_val, dict):
                        fc_by_index[ev_idx]["arguments"].update(arg_val)
            elif ev_type == "interaction.completed":
                completed_interaction = getattr(event, "interaction", None)

        if completed_interaction is None:
            yield {
                "type": "error",
                "message": "AIストリーミング応答が途中で中断されました（完了イベント未受信）。",
            }
            return

        inter_status = getattr(completed_interaction, "status", None)
        if inter_status in {"failed", "cancelled"}:
            yield {
                "type": "error",
                "message": f"AI処理が正常に完了しませんでした（ステータス: {inter_status}）。",
            }
            return

        prev_id = completed_interaction.id

        # Build unified function calls list from streamed steps (with fallback to completed.steps)
        fc_calls: list[dict[str, Any]] = []
        if fc_by_index:
            for _, fc_raw in sorted(fc_by_index.items()):
                merged_args = dict(fc_raw["arguments"])
                if fc_raw["arg_chunks"]:
                    raw_str = "".join(fc_raw["arg_chunks"]).strip()
                    if raw_str:
                        try:
                            parsed = json.loads(raw_str)
                            if isinstance(parsed, dict):
                                merged_args.update(parsed)
                        except json.JSONDecodeError:
                            pass
                fc_calls.append({
                    "id": fc_raw["id"],
                    "name": fc_raw["name"],
                    "arguments": merged_args,
                })
        elif getattr(completed_interaction, "steps", None):
            for s in completed_interaction.steps:
                if getattr(s, "type", None) == "function_call":
                    fc_calls.append({
                        "id": getattr(s, "id", ""),
                        "name": getattr(s, "name", ""),
                        "arguments": dict(s.arguments) if getattr(s, "arguments", None) else {},
                    })

        if not fc_calls:
            answer = (
                "".join(full_text_parts).strip()
                or (getattr(completed_interaction, "output_text", None) or "").strip()
            )
            if not answer:
                yield {
                    "type": "error",
                    "message": "モデルから回答テキストが返却されませんでした（未完了）。",
                }
                return

            verification = verify_grounded_response(answer, tool_records)
            if (
                verification["status"] in {"no_tools", "warning"}
                and not correction_used
                and inter_status != "incomplete"
            ):
                correction_used = True
                if full_text_parts:
                    full_text_parts.clear()
                    yield {"type": "reset_draft"}
                yield {"type": "status", "message": "実データとの数値照合で根拠を再確認中..."}
                current_input = _build_correction_prompt(verification)
                continue

            yield {"type": "verification", **verification}
            yield {
                "type": "done",
                "configured": True,
                "answer": answer,
                "interaction_id": completed_interaction.id,
                "tool_calls": tool_trace,
                "map_actions": _dedupe_actions(map_actions),
                "model": chosen_model,
                "incomplete": inter_status == "incomplete",
                "verification": verification,
            }
            return

        tool_rounds += 1
        if tool_rounds > 4:
            yield {
                "type": "error",
                "message": "ツール照会回数の上限（4回）に達したため、回答の生成を完了できませんでした。質問を絞って再試行してください。",
            }
            return

        fn_results = []
        for fc in fc_calls:
            fn_name = fc["name"]
            fn_args = fc["arguments"]
            result_data = _execute_tool(
                store,
                fn_name,
                fn_args,
                earthquakes_cache=earthquakes_cache,
                board_store=board_store,
                reports_store=reports_store,
            )
            tool_records.append({"name": fn_name, "arguments": fn_args, "result": result_data})
            summary = _summarize_tool_call(fn_name, fn_args, result_data)
            map_actions.extend(_extract_map_actions(fn_name, result_data))
            tc_entry = {
                "name": fn_name,
                "arguments": fn_args,
                "summary": summary,
            }
            tool_trace.append(tc_entry)
            yield {"type": "tool_result", **tc_entry}
            fn_results.append({
                "type": "function_result",
                "name": fn_name,
                "call_id": fc["id"],
                "result": [{"type": "text", "text": json.dumps(result_data, ensure_ascii=False)}],
            })

        current_input = fn_results

    yield {
        "type": "error",
        "message": "ツール照会回数の上限（4回）に達したため、回答の生成を完了できませんでした。質問を絞って再試行してください。",
    }
