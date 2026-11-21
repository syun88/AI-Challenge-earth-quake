"""CSV (UTF-8 BOM) and Excel (.xlsx) export generators for QuakeLens Japan."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from app.constants import (
    KYOTO_WARDS,
    REPORT_CATEGORY_LABELS,
    VERIFICATION_STATUS_LABELS,
)

JST = timezone(timedelta(hours=9))
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _safe_cell(value: Any) -> Any:
    """Neutralize spreadsheet formula injection on string cells."""
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    if text and text[0] in _FORMULA_PREFIXES:
        return f"'{text}"
    return text


def build_ward_combined_rows(
    *,
    stats: dict[str, Any],
    board_summary: dict[str, Any],
    report_summary: dict[str, Any],
    ward_filter: str | None = None,
) -> list[dict[str, Any]]:
    """Combine building hazard stats, safety board counts, and damage report counts per ward."""
    risk_by_ward = {r["ward_name"]: r for r in (stats.get("ward_summary") or [])}
    board_by_ward = {r["ward_name"]: r for r in (board_summary.get("by_ward") or [])}
    rep_by_ward = {r["ward_name"]: r for r in (report_summary.get("by_ward") or [])}

    target_wards = (
        [ward_filter]
        if ward_filter and ward_filter != "all"
        else [*KYOTO_WARDS, "京都市全域"]
    )
    rows: list[dict[str, Any]] = []
    for wn in target_wards:
        rk = risk_by_ward.get(wn, {})
        bd = board_by_ward.get(wn, {})
        rp = rep_by_ward.get(wn, {})
        if wn == "京都市全域" and not bd and not rp:
            continue
        bd_sc = bd.get("status_counts") or {}
        rp_cat = rp.get("by_category") or {}
        rows.append({
            "ward_name": wn,
            "total_buildings": rk.get("total_buildings", 0),
            "known_year_rate_pct": (
                round(float(rk["known_year_rate"]) * 100.0, 1)
                if rk.get("known_year_rate") is not None
                else ""
            ),
            "pre_1981_count": rk.get("pre_1981_count", 0),
            "overlap_high_pre1981": rk.get("overlap_high_pre1981", 0),
            "avg_t30_i55_pct": (
                round(float(rk["avg_t30_i55_ps"]) * 100.0, 1)
                if rk.get("avg_t30_i55_ps") is not None
                else ""
            ),
            "safety_total": bd.get("total_count", 0),
            "safety_user_only": bd.get("user_count", 0),
            "safety_sample": bd.get("sample_count", 0),
            "safety_safe": bd_sc.get("safe", 0),
            "safety_shelter": bd_sc.get("shelter", 0),
            "safety_home": bd_sc.get("home", 0),
            "safety_minor_injury": bd_sc.get("minor_injury", 0),
            "safety_waiting": bd_sc.get("waiting", 0),
            "reports_total": rp.get("total_count", 0),
            "reports_unverified": rp.get("unverified_count", 0),
            "reports_verified_official": rp.get("verified_or_official_count", 0),
            "reports_sample": rp.get("sample_count", 0),
            "reports_critical_high": rp.get("critical_or_high_count", 0),
            "cat_building_damage": rp_cat.get("building_damage", 0),
            "cat_road_blocked": rp_cat.get("road_blocked", 0),
            "cat_shelter_status": rp_cat.get("shelter_status", 0),
            "cat_rescue_support": rp_cat.get("rescue_support", 0),
            "cat_other_disaster": rp_cat.get("other_disaster", 0),
        })
    return rows


def generate_disaster_csv(
    *,
    scope: str,
    stats: dict[str, Any],
    board_summary: dict[str, Any],
    board_entries: list[dict[str, Any]],
    report_summary: dict[str, Any],
    reports: list[dict[str, Any]],
    ward_filter: str | None = None,
) -> bytes:
    """Render UTF-8 BOM CSV bytes for the requested scope ('overview'|'wards'|'reports'|'board')."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")

    if scope == "reports":
        writer.writerow([
            "報告ID",
            "確認ステータス",
            "サンプル区分",
            "被害カテゴリ",
            "緊急度",
            "区・地域",
            "メッシュコード",
            "周辺場所メモ",
            "見出し",
            "詳細説明",
            "同種確認数",
            "解決済",
            "発生報告日時",
            "更新日時",
        ])
        for r in reports:
            writer.writerow([
                _safe_cell(r["id"]),
                _safe_cell(r["verification_label"]),
                _safe_cell("訓練サンプル" if r["is_sample"] else "一般報告"),
                _safe_cell(r["category_label"]),
                _safe_cell(r["severity_label"]),
                _safe_cell(r["ward_name"]),
                _safe_cell(r.get("meshcode") or ""),
                _safe_cell(r.get("location_label") or ""),
                _safe_cell(r["title"]),
                _safe_cell(r["description"]),
                r.get("corroborations", 1),
                "解決済" if r.get("resolved") else "継続中",
                _safe_cell(r["reported_at"]),
                _safe_cell(r["updated_at"]),
            ])
    elif scope == "board":
        writer.writerow([
            "伝言ID",
            "情報区分",
            "区・地域",
            "メッシュコード",
            "安否状況",
            "お名前",
            "連絡キー（伏せ字）",
            "伝言内容",
            "登録日時",
            "更新日時",
        ])
        for e in board_entries:
            writer.writerow([
                _safe_cell(e["id"]),
                _safe_cell("訓練サンプル" if e["is_sample"] else "市民登録"),
                _safe_cell(e["ward_name"]),
                _safe_cell(e.get("meshcode") or ""),
                _safe_cell(e["status_label"]),
                _safe_cell(e["name"]),
                _safe_cell(e["phone_masked"]),
                _safe_cell(e["message"]),
                _safe_cell(e["created_at"]),
                _safe_cell(e.get("updated_at") or e["created_at"]),
            ])
    else:
        # Combined ward overview (default for 'overview' / 'wards')
        rows = build_ward_combined_rows(
            stats=stats,
            board_summary=board_summary,
            report_summary=report_summary,
            ward_filter=ward_filter,
        )
        writer.writerow([
            "行政区",
            "総建物数(PLATEAU)",
            "建築年判明率(%)",
            "1981年以前建築棟数",
            "高ハザード6%以上×1981以前重複数",
            "平均30年震度6弱+確率(%)",
            "安否登録総数",
            "安否_一般登録数",
            "安否_訓練サンプル数",
            "安否_無事",
            "安否_避難所",
            "安否_自宅",
            "安否_軽傷支援要",
            "安否_連絡待ち",
            "被害報告総数(継続中)",
            "被害_未確認市民報告",
            "被害_確認済/公式",
            "被害_訓練サンプル",
            "被害_緊急・警戒件数",
            f"内訳_{REPORT_CATEGORY_LABELS['building_damage']}",
            f"内訳_{REPORT_CATEGORY_LABELS['road_blocked']}",
            f"内訳_{REPORT_CATEGORY_LABELS['shelter_status']}",
            f"内訳_{REPORT_CATEGORY_LABELS['rescue_support']}",
            f"内訳_{REPORT_CATEGORY_LABELS['other_disaster']}",
        ])
        for row in rows:
            writer.writerow([_safe_cell(v) for v in row.values()])

        # Append detail table separator if overview
        if scope == "overview" and reports:
            writer.writerow([])
            writer.writerow(["# 以下、抽出対象の被害・災害報告詳細（未確認報告・訓練サンプル含む）"])
            writer.writerow([
                "報告ID",
                "確認ステータス",
                "被害カテゴリ",
                "緊急度",
                "区・地域",
                "メッシュ",
                "見出し",
                "詳細",
                "発生日時",
            ])
            for r in reports:
                writer.writerow([
                    _safe_cell(r["id"]),
                    _safe_cell(r["verification_label"]),
                    _safe_cell(r["category_label"]),
                    _safe_cell(r["severity_label"]),
                    _safe_cell(r["ward_name"]),
                    _safe_cell(r.get("meshcode") or ""),
                    _safe_cell(r["title"]),
                    _safe_cell(r["description"]),
                    _safe_cell(r["reported_at"]),
                ])

    return buf.getvalue().encode("utf-8-sig")


def _style_header(ws: Any, headers: list[str]) -> None:
    ws.append(headers)
    fill = PatternFill("solid", fgColor="0F172A")
    font = Font(bold=True, color="F8FAFC")
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = fill
        cell.font = font
        cell.alignment = Alignment(horizontal="center", vertical="center")


def _autofit_columns(ws: Any) -> None:
    for col in ws.columns:
        max_len = 10
        col_letter = col[0].column_letter
        for cell in col:
            val = str(cell.value or "")
            # Japanese characters count wider than ASCII
            w = sum(2 if ord(ch) > 127 else 1 for ch in val[:60])
            if w + 3 > max_len:
                max_len = w + 3
        ws.column_dimensions[col_letter].width = min(max_len, 46)


def generate_disaster_xlsx(
    *,
    stats: dict[str, Any],
    board_summary: dict[str, Any],
    board_entries: list[dict[str, Any]],
    report_summary: dict[str, Any],
    reports: list[dict[str, Any]],
    ward_filter: str | None = None,
) -> bytes:
    """Generate a multi-sheet .xlsx workbook combining ward summary, reports, safety board, and notes."""
    wb = Workbook()

    # Sheet 1: Regional Summary
    ws_ward = wb.active
    ws_ward.title = "地域別統合サマリー"
    ward_rows = build_ward_combined_rows(
        stats=stats,
        board_summary=board_summary,
        report_summary=report_summary,
        ward_filter=ward_filter,
    )
    _style_header(
        ws_ward,
        [
            "行政区",
            "総建物数",
            "判明率(%)",
            "1981以前棟数",
            "高ハザード重複",
            "平均震度6弱+(%)",
            "安否登録計",
            "安否_一般",
            "安否_訓練",
            "無事",
            "避難所",
            "自宅",
            "軽傷・支援要",
            "連絡待ち",
            "被害報告計",
            "未確認報告",
            "確認済/公式",
            "訓練サンプル",
            "緊急・警戒",
            "建物損傷",
            "道路通行止",
            "避難所状況",
            "救助・支援",
            "その他",
        ],
    )
    for r in ward_rows:
        ws_ward.append([_safe_cell(v) for v in r.values()])
    _autofit_columns(ws_ward)

    # Sheet 2: Damage Reports
    ws_rep = wb.create_sheet("被害状況報告一覧")
    _style_header(
        ws_rep,
        [
            "報告ID",
            "確認ステータス",
            "カテゴリ",
            "緊急度",
            "区・地域",
            "メッシュコード",
            "場所メモ",
            "見出し",
            "詳細内容",
            "同種確認数",
            "解決状況",
            "報告日時",
        ],
    )
    for rep in reports:
        ws_rep.append([
            _safe_cell(rep["id"]),
            _safe_cell(rep["verification_label"]),
            _safe_cell(rep["category_label"]),
            _safe_cell(rep["severity_label"]),
            _safe_cell(rep["ward_name"]),
            _safe_cell(rep.get("meshcode") or ""),
            _safe_cell(rep.get("location_label") or ""),
            _safe_cell(rep["title"]),
            _safe_cell(rep["description"]),
            rep.get("corroborations", 1),
            "解決済" if rep.get("resolved") else "継続中",
            _safe_cell(rep["reported_at"]),
        ])
    _autofit_columns(ws_rep)

    # Sheet 3: Safety Board (masked, no PII GPS)
    ws_board = wb.create_sheet("安否伝言板一覧")
    _style_header(
        ws_board,
        [
            "伝言ID",
            "種別",
            "区・地域",
            "メッシュコード",
            "安否状況",
            "お名前",
            "連絡先(伏せ字)",
            "伝言メッセージ",
            "登録日時",
        ],
    )
    for b in board_entries:
        ws_board.append([
            _safe_cell(b["id"]),
            "訓練サンプル" if b.get("is_sample") else "市民登録",
            _safe_cell(b["ward_name"]),
            _safe_cell(b.get("meshcode") or ""),
            _safe_cell(b["status_label"]),
            _safe_cell(b["name"]),
            _safe_cell(b["phone_masked"]),
            _safe_cell(b["message"]),
            _safe_cell(b["created_at"]),
        ])
    _autofit_columns(ws_board)

    # Sheet 4: Notes & Verification Definitions
    ws_notes = wb.create_sheet("前提・注記")
    _style_header(ws_notes, ["項目", "内容"])
    notes = [
        ("出力日時(JST)", datetime.now(JST).isoformat(timespec="seconds")),
        ("対象フィルター(区)", ward_filter or "京都市全域"),
        (
            "未確認情報の扱い",
            f"確認ステータス「{VERIFICATION_STATUS_LABELS['unverified']}」は市民投稿による未確認情報です。確定事実・公式指示として扱わないでください。",
        ),
        (
            "訓練サンプルの扱い",
            f"「{VERIFICATION_STATUS_LABELS['demo_sample']}」はシステムの動作確認・防災訓練用の模擬データです。",
        ),
        (
            "建物・ハザード出典",
            "国土交通省 Project PLATEAU 京都市(2025年度) × 防災科研 J-SHIS(2024年版・表層地盤V4)",
        ),
        (
            "個人情報保護",
            "電話番号は伏せ字処理され、個人の精密GPS座標は記録・出力されません。",
        ),
    ]
    for k, v in notes:
        ws_notes.append([_safe_cell(k), _safe_cell(v)])
    _autofit_columns(ws_notes)

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
