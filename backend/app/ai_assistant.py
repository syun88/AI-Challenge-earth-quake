"""Gemini AI Assistant with Function Calling backed by QuakeLensDataStore."""

from __future__ import annotations

import json
import os
from typing import Any

from google import genai

from app.constants import OFFICIAL_RETROFIT_PROGRAMS
from app.data_store import QuakeLensDataStore

MODEL_NAME = "gemini-4-hydrogen"

SYSTEM_INSTRUCTION = """あなたは「QuakeLens Japan」の防災データ解説AIアシスタントです。
対象地域は京都市全域（Project PLATEAU 2025年度版 + J-SHIS 2024年版地震ハザード・表層地盤V4）です。

【厳守事項】
1. 建物棟数、割合、ハザード確率、増幅率(ARV)、メッシュコード、区別数値、公式補助制度URLを回答する際は、必ず事前に用意されたFunction Callingツールを呼び出し、返却された実データのみに基づいて回答してください。
2. 実データにない数値・住所・確率・URLを絶対に推測・捏造しないでください。データが「不明」または欠損している場合は、その事実と不明件数・割合（分母）を明記してください。
3. J-SHISの「今後30年間に震度6弱以上となる確率（T30_I55_PS）」等は地震動の確率であり、「建物の倒壊確率」「個別の耐震診断結果」「リアルタイムの地震予知」ではないことを明確に説明してください。
4. PLATEAUの建築年は「年」単位のため、1981年6月1日（新耐震基準）や2000年6月1日（木造住宅接合部等の規定強化）の前後判定を築年数だけで断定しないでください。
5. 任意の重み付けスコア等を「公式の危険度」として提示しないでください。
6. 簡潔でわかりやすく、防災の専門家ではない一般利用者にも理解しやすい日本語（箇条書きや太字を活用）で回答してください。
"""

TOOLS = [
    {
        "type": "function",
        "name": "get_area_statistics",
        "description": "京都市全体または指定した区（例: '伏見区', '東山区', '中京区'）の建物統計、築年区分別棟数、建築年不明率、地震ハザード区分別棟数、1981年以前×高ハザード重複件数、区別サマリーを取得します。",
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
                    "description": "並び順: 'pre_1981_high_hazard'（高ハザード域×1981年以前棟数）, 'pre_1981_count'（1981年以前棟数順）, 't30_i55_ps'（震度6弱以上確率順）, 'pre_1981_share_known'（判明建物のうち1981年以前割合順）",
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
                    "description": "10桁のJIS 250mメッシュコード（例: '5235362024'）",
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
        "name": "get_data_methodology_and_programs",
        "description": "使用しているデータセットの出典・基準年・ライセンス、地図の指標（T30_I55_PS, ARV, AVS, 築年区分）の定義、および京都市公式の耐震診断・耐震改修補助制度情報を取得します。",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
]


def _execute_tool(store: QuakeLensDataStore, name: str, args: dict[str, Any] | None) -> Any:
    args = args or {}
    if name == "get_area_statistics":
        ward = args.get("ward") or "all"
        usage_group = args.get("usage_group") or "all"
        stats = store.get_stats(ward=ward, usage_group=usage_group)
        # Keep response compact and clear for LLM
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

    if name == "get_priority_confirmation_areas":
        ward = args.get("ward") or "all"
        sort_by = args.get("sort_by") or "pre_1981_high_hazard"
        limit = min(int(args.get("limit") or 10), 15)
        areas = store.get_priority_areas(ward=ward, sort_by=sort_by, limit=limit)
        return {"ward": ward, "sort_by": sort_by, "areas": areas}

    if name == "get_mesh_details":
        meshcode = str(args.get("meshcode") or "")
        detail = store.get_mesh_detail(meshcode)
        return detail or {"error": f"メッシュコード '{meshcode}' のデータが見つかりません。"}

    if name == "get_building_details":
        building_id = str(args.get("building_id") or "")
        detail = store.get_building_detail(building_id)
        return detail or {"error": f"建物ID '{building_id}' のデータが見つかりません。"}

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

    return {"error": f"Unknown tool: {name}"}


def ask_quakelens_ai(
    store: QuakeLensDataStore,
    message: str,
    context: dict[str, Any] | None = None,
    previous_interaction_id: str | None = None,
) -> dict[str, Any]:
    """Run Gemini Interactions API with Function Calling against real Kyoto City data."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or api_key == "your_gemini_api_key_here":
        return {
            "configured": False,
            "answer": (
                "現在 `GEMINI_API_KEY` が設定されていないため、AI自然言語解説機能は利用できません。"
                "地図・フィルター・ダッシュボード統計・優先確認エリア分析はAPIキーなしで引き続き全機能をご利用いただけます。\n\n"
                "`.env` に `GEMINI_API_KEY` を設定してバックエンドを再起動すると、実データに基づいたAI解説が有効になります。"
            ),
            "interaction_id": None,
            "tool_calls": [],
        }

    ctx_lines = []
    if context:
        if context.get("ward") and context["ward"] != "all":
            ctx_lines.append(f"現在の画面フィルター区: {context['ward']}")
        if context.get("selected_meshcode"):
            ctx_lines.append(f"現在選択中の250mメッシュ: {context['selected_meshcode']}")
        if context.get("selected_building_id"):
            ctx_lines.append(f"現在選択中の建物ID: {context['selected_building_id']}")
    prompt = message if not ctx_lines else f"[画面コンテキスト: {' / '.join(ctx_lines)}]\n\n質問: {message}"

    client = genai.Client(api_key=api_key)
    tool_trace: list[dict[str, Any]] = []

    kwargs: dict[str, Any] = {
        "model": MODEL_NAME,
        "input": prompt,
        "system_instruction": SYSTEM_INSTRUCTION,
        "tools": TOOLS,
    }
    if previous_interaction_id:
        kwargs["previous_interaction_id"] = previous_interaction_id

    interaction = client.interactions.create(**kwargs)

    # Multi-step function calling loop (max 6 turns to avoid runaway loops)
    for _ in range(6):
        fc_steps = [s for s in (interaction.steps or []) if getattr(s, "type", None) == "function_call"]
        if not fc_steps:
            break

        fn_results = []
        for fc in fc_steps:
            fn_name = fc.name
            fn_args = dict(fc.arguments) if fc.arguments else {}
            result_data = _execute_tool(store, fn_name, fn_args)
            tool_trace.append({"name": fn_name, "arguments": fn_args})
            fn_results.append({
                "type": "function_result",
                "name": fn_name,
                "call_id": fc.id,
                "result": [{"type": "text", "text": json.dumps(result_data, ensure_ascii=False)}],
            })

        interaction = client.interactions.create(
            model=MODEL_NAME,
            input=fn_results,
            system_instruction=SYSTEM_INSTRUCTION,
            tools=TOOLS,
            previous_interaction_id=interaction.id,
        )

    return {
        "configured": True,
        "answer": interaction.output_text or "回答を生成できませんでした。",
        "interaction_id": interaction.id,
        "tool_calls": tool_trace,
        "model": MODEL_NAME,
    }
