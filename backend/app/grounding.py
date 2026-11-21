"""Deterministic grounding verification for Gemini AI responses against tool outputs."""

from __future__ import annotations

import re
from typing import Any

from app.constants import DATA_SOURCES, OFFICIAL_RETROFIT_PROGRAMS

# Allowed domain/methodological constants that may appear cleanly in explanations
# without originating from a specific tool payload.
EXEMPT_INTEGERS = {
    0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 15, 20, 24, 30, 56, 171, 250,
    1981, 1982, 1999, 2000, 2001, 2020, 2022, 2024, 2025, 2026,
    461, 611, 6674, 26100, 100,
}
EXEMPT_PERCENTS = {0.0, 3.0, 6.0, 26.0, 100.0}

URL_RE = re.compile(r"https?://[^\s)\]>「」『』、。\"']+")
REPORT_ID_RE = re.compile(r"rep-[A-Za-z0-9]{4,20}")
MESHCODE_RE = re.compile(r"(?<!\d)(\d{10})(?!\d)")
BUILDING_ID_RE = re.compile(r"26100-bldg-\d+")
QUANT_RE = re.compile(
    r"(?P<num>\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?P<unit>棟|%|％|m/s|km|m(?![A-Za-z])|件|箇所|ヶ所|か所|区|階|人|回)"
)
PAREN_NUM_RE = re.compile(r"(?:[:：]\s*\*{0,2}|[（(])\s*(?P<num>\d{1,3}(?:,\d{3})+|\d+\.\d+)\s*(?:[）)]|\*{0,2})")
METRIC_PREFIX_RE = re.compile(r"(?:ARV|AVS|M|震度|倍率|平均S波速度)[^0-9\n]{0,10}(?P<num>\d+(?:\.\d+)?)", re.IGNORECASE)

RATE_FLOAT_KEYS = {
    "known_year_rate",
    "unknown_year_rate",
    "pre_1981_share_total",
    "pre_1981_share_known",
    "pre_1981_share_of_total",
    "pre_1981_share_of_known",
    "t30_i45_ps",
    "t30_i50_ps",
    "t30_i55_ps",
    "t30_i60_ps",
    "avg_t30_i55_ps",
    "share",
}

DERIVED_RATIO_PAIRS = [
    ("known_year_count", "total_buildings"),
    ("unknown_year_count", "total_buildings"),
    ("pre_1981_count", "total_buildings"),
    ("pre_1981_count", "known_year_count"),
    ("b1982_2000_count", "total_buildings"),
    ("b1982_2000_count", "known_year_count"),
    ("post_2001_count", "total_buildings"),
    ("post_2001_count", "known_year_count"),
    ("residential_count", "total_buildings"),
    ("pre_1981_residential_count", "total_buildings"),
    ("wooden_pre_1981_count", "total_buildings"),
    ("wooden_pre_1981_count", "pre_1981_count"),
    ("overlap_very_high_pre1981", "total_buildings"),
    ("overlap_elevated_or_higher_pre1981", "total_buildings"),
    ("overlap_very_high_pre1981_26pct_plus", "total_buildings"),
    ("overlap_elevated_or_higher_pre1981_6pct_plus", "total_buildings"),
    ("overlap_high_pre1981", "total_buildings"),
    ("unverified_count", "total_reports"),
    ("demo_sample_count", "total_reports"),
    ("user_entries_count", "total_entries"),
    ("sample_entries_count", "total_entries"),
]


def _collect_grounding_universe(tool_records: list[dict[str, Any]]) -> dict[str, Any]:
    ints: set[int] = set()
    floats: set[float] = set()
    percents: set[float] = set()
    meshcodes: set[str] = set()
    building_ids: set[str] = set()
    report_ids: set[str] = set()
    urls: set[str] = set()
    source_flags = {
        "has_unverified_reports": False,
        "has_sample_data": False,
    }

    def register_dict_ratios(obj: dict[str, Any]) -> None:
        for num_key, den_key in DERIVED_RATIO_PAIRS:
            num = obj.get(num_key)
            den = obj.get(den_key)
            if isinstance(num, (int, float)) and isinstance(den, (int, float)) and den > 0:
                percents.add((float(num) / float(den)) * 100.0)
        if isinstance(obj.get("known_year_rate"), (int, float)):
            percents.add((1.0 - float(obj["known_year_rate"])) * 100.0)
        if obj.get("verification_status") == "unverified" or (
            isinstance(obj.get("unverified_count"), int) and obj["unverified_count"] > 0
        ):
            source_flags["has_unverified_reports"] = True
        if (
            obj.get("is_sample") is True
            or obj.get("verification_status") == "demo_sample"
            or (isinstance(obj.get("demo_sample_count"), int) and obj["demo_sample_count"] > 0)
            or (isinstance(obj.get("sample_entries_count"), int) and obj["sample_entries_count"] > 0)
        ):
            source_flags["has_sample_data"] = True

    def walk(val: Any, parent_key: str = "") -> None:
        if isinstance(val, bool) or val is None:
            return
        if isinstance(val, int):
            ints.add(val)
            floats.add(float(val))
            return
        if isinstance(val, float):
            floats.add(val)
            if parent_key in RATE_FLOAT_KEYS or 0.0 <= val <= 1.0:
                percents.add(val * 100.0)
            return
        if isinstance(val, str):
            s = val.strip()
            if s.startswith("http://") or s.startswith("https://") or s.startswith("/api/exports/"):
                urls.add(s.rstrip("/"))
                urls.add(s)
            for mc in MESHCODE_RE.findall(s):
                meshcodes.add(mc)
            for bid in BUILDING_ID_RE.findall(s):
                building_ids.add(bid)
            for rid in REPORT_ID_RE.findall(s):
                report_ids.add(rid)
            return
        if isinstance(val, dict):
            register_dict_ratios(val)
            for k, v in val.items():
                walk(v, str(k))
            return
        if isinstance(val, list):
            for item in val:
                walk(item, parent_key)

    for rec in tool_records:
        walk(rec.get("arguments"))
        walk(rec.get("result"))

    return {
        "ints": ints,
        "floats": floats,
        "percents": percents,
        "meshcodes": meshcodes,
        "building_ids": building_ids,
        "report_ids": report_ids,
        "urls": urls,
        "has_unverified_reports": source_flags["has_unverified_reports"],
        "has_sample_data": source_flags["has_sample_data"],
    }


def _strip_exempt_markdown_lines(text: str) -> str:
    """Remove Markdown list numbering, heading numbering, and dates so they aren't flagged as stats."""
    cleaned_lines = []
    for line in text.splitlines():
        line = re.sub(r"^\s*(?:#{1,6}\s*)?\d+[.)]\s+", "", line)
        line = re.sub(r"\d{4}年\d{1,2}月\d{1,2}日", "", line)
        line = re.sub(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?", "", line)
        line = re.sub(r"昭和\d+年(?:\d+月\d+日)?", "", line)
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines)


def _is_exempt_literal(num_str: str, unit: str) -> bool:
    clean = num_str.replace(",", "")
    try:
        val = float(clean)
    except ValueError:
        return True
    is_int_literal = "." not in clean
    if is_int_literal and int(val) in EXEMPT_INTEGERS:
        return True
    if unit in {"%", "％"} and val in EXEMPT_PERCENTS:
        return True
    if unit in {"階", "区"} and is_int_literal and int(val) <= 100:
        return True
    return False


def _match_numeric_claim(num_str: str, unit: str, universe: dict[str, Any]) -> bool:
    clean = num_str.replace(",", "")
    try:
        val = float(clean)
    except ValueError:
        return True

    if _is_exempt_literal(num_str, unit):
        return True

    is_int_literal = "." not in clean
    if is_int_literal and int(val) in universe["ints"]:
        return True

    # Floating tolerance for display rounding (e.g. 0.5039 -> 50.4% or 50.39%)
    decimals = len(clean.split(".")[1]) if "." in clean else 0
    step_tol = 0.6 if decimals == 0 else (0.15 if decimals == 1 else 0.05)

    for fv in universe["floats"]:
        if abs(val - fv) <= max(step_tol, 0.02):
            return True

    if unit in {"%", "％", ""}:
        for pv in universe["percents"]:
            if abs(val - pv) <= step_tol:
                return True

    return False


def verify_grounded_response(answer: str, tool_records: list[dict[str, Any]]) -> dict[str, Any]:
    """Verify numbers, meshcodes, building IDs, and URLs in an AI answer against tool outputs."""
    if not answer.strip():
        return {
            "status": "warning",
            "tool_count": len(tool_records),
            "checked_claims_count": 0,
            "verified_claims": [],
            "unverified_claims": [],
            "unverified_urls": [],
            "contains_unverified_reports": False,
            "contains_sample_data": False,
            "note": "回答テキストが空です。",
        }

    universe = _collect_grounding_universe(tool_records)

    verified: list[str] = []
    unverified: list[str] = []
    unverified_urls: list[str] = []
    seen_verified: set[str] = set()
    seen_unverified: set[str] = set()

    def add_verified(label: str) -> None:
        if label not in seen_verified:
            seen_verified.add(label)
            verified.append(label)

    def add_unverified(label: str) -> None:
        if label not in seen_unverified:
            seen_unverified.add(label)
            unverified.append(label)

    # 1. Check URLs strictly against URLs returned by tools
    for raw_url in URL_RE.findall(answer):
        norm = raw_url.rstrip(".,;:/)」』").rstrip("/")
        if norm in universe["urls"] or raw_url in universe["urls"]:
            add_verified(norm)
        else:
            if norm not in unverified_urls:
                unverified_urls.append(norm)

    # 2. Check 10-digit meshcodes
    for mc in MESHCODE_RE.findall(answer):
        if mc in universe["meshcodes"]:
            add_verified(f"メッシュ {mc}")
        else:
            add_unverified(f"メッシュ {mc}")

    # 3. Check PLATEAU building IDs & disaster report IDs
    for bid in BUILDING_ID_RE.findall(answer):
        if bid in universe["building_ids"]:
            add_verified(bid)
        else:
            add_unverified(bid)

    for rid in REPORT_ID_RE.findall(answer):
        if rid in universe["report_ids"]:
            add_verified(rid)
        else:
            add_unverified(rid)

    # 4. Check quantitative data claims
    scrubbed = _strip_exempt_markdown_lines(answer)
    scrubbed = MESHCODE_RE.sub("", scrubbed)
    scrubbed = BUILDING_ID_RE.sub("", scrubbed)
    scrubbed = REPORT_ID_RE.sub("", scrubbed)
    scrubbed = URL_RE.sub("", scrubbed)

    for m in QUANT_RE.finditer(scrubbed):
        num_str = m.group("num")
        unit = m.group("unit")
        if _is_exempt_literal(num_str, unit):
            continue
        label = f"{num_str}{unit}"
        if _match_numeric_claim(num_str, unit, universe):
            add_verified(label)
        else:
            add_unverified(label)

    for m in METRIC_PREFIX_RE.finditer(scrubbed):
        num_str = m.group("num")
        if _is_exempt_literal(num_str, ""):
            continue
        if _match_numeric_claim(num_str, "", universe):
            add_verified(num_str)
        else:
            add_unverified(num_str)

    for m in PAREN_NUM_RE.finditer(scrubbed):
        num_str = m.group("num")
        if _is_exempt_literal(num_str, ""):
            continue
        if _match_numeric_claim(num_str, "", universe):
            add_verified(num_str)
        else:
            add_unverified(num_str)

    checked_total = len(verified) + len(unverified) + len(unverified_urls)

    if not tool_records and checked_total > 0:
        status = "no_tools"
        note = "実データ照会ツールを呼び出さずに数値・識別子・URLが出力されたため、根拠が保証されていません。"
    elif unverified or unverified_urls:
        status = "warning"
        note = "一部の数値・識別子またはURLがツール返却値内で直接照合できませんでした。参照根拠カードをご確認ください。"
    elif not tool_records:
        status = "no_numeric_claims"
        note = "定量データを含まない一般的な案内として回答されました。"
    else:
        status = "verified"
        if verified:
            note = f"回答内の数値・識別子・URL（{len(verified)}件）はすべて実データツールの返却値と照合済みです。"
        else:
            note = "実データ照会ツールを実行して回答を生成しました。"

    return {
        "status": status,
        "tool_count": len(tool_records),
        "checked_claims_count": checked_total,
        "verified_claims": verified[:12],
        "unverified_claims": unverified[:10],
        "unverified_urls": unverified_urls[:5],
        "contains_unverified_reports": universe["has_unverified_reports"],
        "contains_sample_data": universe["has_sample_data"],
        "note": note,
    }
