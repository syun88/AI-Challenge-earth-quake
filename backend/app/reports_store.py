"""SQLite-backed storage for Disaster & Damage Situation Reports in QuakeLens Japan."""

from __future__ import annotations

import hashlib
import hmac
import math
import re
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.constants import (
    KYOTO_WARDS,
    REPORT_CATEGORY_LABELS,
    REPORT_SEVERITY_LABELS,
    VERIFICATION_STATUS_LABELS,
    WARD_CENTERS,
)

JST = timezone(timedelta(hours=9))
DEFAULT_REPORTS_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "board.db"

KYOTO_LAT_MIN, KYOTO_LAT_MAX = 34.78, 35.33
KYOTO_LON_MIN, KYOTO_LON_MAX = 135.42, 135.95
RE_MESHCODE = re.compile(r"^\d{10}$")


def _now_jst_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


def _hash_passcode(passcode: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{passcode}".encode("utf-8")).hexdigest()


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute approximate great-circle distance in meters."""
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def _char_bigrams(text: str) -> set[str]:
    clean = re.sub(r"[\s\W_]+", "", text.lower())
    if len(clean) < 2:
        return {clean} if clean else set()
    return {clean[i : i + 2] for i in range(len(clean) - 1)}


def text_similarity(a: str, b: str) -> float:
    """Return Jaccard similarity of character bigrams (robust for Japanese strings)."""
    ga = _char_bigrams(a)
    gb = _char_bigrams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)


class DamageReportStore:
    """Thread-safe SQLite store for citizen/sample disaster and damage reports."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or DEFAULT_REPORTS_DB_PATH
        self._lock = threading.Lock()
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def ensure_initialized(self) -> None:
        """Create damage_reports table and seed clearly-labeled Kyoto drill sample rows."""
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            with self._connect() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS damage_reports (
                        id TEXT PRIMARY KEY,
                        category TEXT NOT NULL,
                        severity TEXT NOT NULL,
                        verification_status TEXT NOT NULL DEFAULT 'unverified',
                        title TEXT NOT NULL,
                        description TEXT NOT NULL,
                        ward_name TEXT NOT NULL,
                        meshcode TEXT,
                        location_label TEXT,
                        lat REAL,
                        lon REAL,
                        location_consent INTEGER NOT NULL DEFAULT 0,
                        reporter_alias TEXT NOT NULL DEFAULT '匿名市民',
                        corroborations INTEGER NOT NULL DEFAULT 1,
                        is_sample INTEGER NOT NULL DEFAULT 0,
                        resolved INTEGER NOT NULL DEFAULT 0,
                        passcode_salt TEXT,
                        passcode_hash TEXT,
                        reported_at TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_reports_ward ON damage_reports (ward_name)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_reports_cat ON damage_reports (category)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_reports_created ON damage_reports (reported_at DESC)"
                )

                cnt_row = conn.execute("SELECT COUNT(*) AS cnt FROM damage_reports").fetchone()
                if cnt_row and int(cnt_row["cnt"]) == 0:
                    now = datetime.now(JST)
                    samples = [
                        (
                            "rep-sample01",
                            "road_blocked",
                            "high",
                            "demo_sample",
                            "【訓練サンプル】竹田街道・大手筋付近 通行止め想定",
                            "【防災訓練サンプル】緊急車両の通行に支障が出る段差・沿道ブロック塀の倒壊を想定した訓練データです。実在の規制情報ではありません。",
                            "伏見区",
                            "5235362024",
                            "伏見区・大手筋通周辺（訓練想定地点）",
                            34.9355,
                            135.7615,
                            1,
                            "訓練シナリオ",
                            1,
                            1,
                            0,
                            None,
                            None,
                            (now - timedelta(minutes=24)).isoformat(timespec="seconds"),
                            (now - timedelta(minutes=24)).isoformat(timespec="seconds"),
                            (now - timedelta(minutes=24)).isoformat(timespec="seconds"),
                        ),
                        (
                            "rep-sample02",
                            "building_damage",
                            "critical",
                            "demo_sample",
                            "【訓練サンプル】木造住宅 外壁破損・傾斜想定",
                            "【防災訓練サンプル】旧耐震木造住宅密集エリアにおける屋根瓦落下・外壁破損の訓練想定レポートです。",
                            "山科区",
                            "5235367414",
                            "山科区・椥辻周辺（訓練想定メッシュ）",
                            34.9781,
                            135.8047,
                            1,
                            "訓練シナリオ",
                            1,
                            1,
                            0,
                            None,
                            None,
                            (now - timedelta(minutes=38)).isoformat(timespec="seconds"),
                            (now - timedelta(minutes=38)).isoformat(timespec="seconds"),
                            (now - timedelta(minutes=38)).isoformat(timespec="seconds"),
                        ),
                        (
                            "rep-sample03",
                            "shelter_status",
                            "info",
                            "demo_sample",
                            "【訓練サンプル】中京区 指定避難所 開設・受入可想定",
                            "【防災訓練サンプル】指定避難所の開設訓練シナリオです。飲料水・非常用電源の確認済みという想定で掲載しています。",
                            "中京区",
                            "5235461024",
                            "中京区・御池周辺（訓練想定）",
                            35.0116,
                            135.7601,
                            1,
                            "訓練シナリオ",
                            1,
                            1,
                            0,
                            None,
                            None,
                            (now - timedelta(minutes=52)).isoformat(timespec="seconds"),
                            (now - timedelta(minutes=52)).isoformat(timespec="seconds"),
                            (now - timedelta(minutes=52)).isoformat(timespec="seconds"),
                        ),
                        (
                            "rep-sample04",
                            "rescue_support",
                            "critical",
                            "demo_sample",
                            "【訓練サンプル】要配慮者安否確認・給水支援要請想定",
                            "【防災訓練サンプル】狭隘街路沿いの高齢者世帯に対する安否確認および生活用水支援の要請想定です。",
                            "東山区",
                            "5235368211",
                            "東山区・五条坂周辺（訓練想定）",
                            34.9844,
                            135.7766,
                            1,
                            "訓練シナリオ",
                            1,
                            1,
                            0,
                            None,
                            None,
                            (now - timedelta(hours=1, minutes=10)).isoformat(timespec="seconds"),
                            (now - timedelta(hours=1, minutes=10)).isoformat(timespec="seconds"),
                            (now - timedelta(hours=1, minutes=10)).isoformat(timespec="seconds"),
                        ),
                        (
                            "rep-sample05",
                            "other_disaster",
                            "moderate",
                            "demo_sample",
                            "【訓練サンプル】五条通 路面冠水・断水情報想定",
                            "【防災訓練サンプル】配水管損傷に伴う路面冠水と一部地域の断水発生を想定した訓練用サンプルです。",
                            "下京区",
                            "5235369034",
                            "下京区・五条堀川付近（訓練想定）",
                            34.9990,
                            135.7547,
                            1,
                            "訓練シナリオ",
                            1,
                            1,
                            0,
                            None,
                            None,
                            (now - timedelta(hours=1, minutes=30)).isoformat(timespec="seconds"),
                            (now - timedelta(hours=1, minutes=30)).isoformat(timespec="seconds"),
                            (now - timedelta(hours=1, minutes=30)).isoformat(timespec="seconds"),
                        ),
                    ]
                    conn.executemany(
                        """
                        INSERT INTO damage_reports (
                            id, category, severity, verification_status, title, description,
                            ward_name, meshcode, location_label, lat, lon, location_consent,
                            reporter_alias, corroborations, is_sample, resolved,
                            passcode_salt, passcode_hash, reported_at, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        samples,
                    )
                conn.commit()
            self._initialized = True

    @staticmethod
    def _serialize_row(row: sqlite3.Row) -> dict[str, Any]:
        cat = str(row["category"])
        sev = str(row["severity"])
        ver = str(row["verification_status"])
        return {
            "id": str(row["id"]),
            "category": cat,
            "category_label": REPORT_CATEGORY_LABELS.get(cat, cat),
            "severity": sev,
            "severity_label": REPORT_SEVERITY_LABELS.get(sev, sev),
            "verification_status": ver,
            "verification_label": VERIFICATION_STATUS_LABELS.get(ver, ver),
            "title": str(row["title"]),
            "description": str(row["description"]),
            "ward_name": str(row["ward_name"]),
            "meshcode": str(row["meshcode"]) if row["meshcode"] else None,
            "location_label": str(row["location_label"]) if row["location_label"] else None,
            "lat": float(row["lat"]) if row["lat"] is not None else None,
            "lon": float(row["lon"]) if row["lon"] is not None else None,
            "location_consent": bool(row["location_consent"]),
            "reporter_alias": str(row["reporter_alias"]),
            "corroborations": int(row["corroborations"]),
            "is_sample": bool(row["is_sample"]),
            "resolved": bool(row["resolved"]),
            "has_passcode": bool(row["passcode_hash"]),
            "reported_at": str(row["reported_at"]),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }

    def list_reports(
        self,
        ward: str | None = None,
        category: str | None = None,
        severity: str | None = None,
        verification_status: str | None = None,
        meshcode: str | None = None,
        q: str | None = None,
        include_samples: bool = True,
        include_resolved: bool = True,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """List disaster/damage reports with filters."""
        self.ensure_initialized()
        clauses: list[str] = []
        params: list[Any] = []

        if not include_samples:
            clauses.append("is_sample = 0")
        if not include_resolved:
            clauses.append("resolved = 0")
        if ward and ward != "all":
            clauses.append("ward_name = ?")
            params.append(ward)
        if category and category != "all":
            clauses.append("category = ?")
            params.append(category)
        if severity and severity != "all":
            clauses.append("severity = ?")
            params.append(severity)
        if verification_status and verification_status != "all":
            clauses.append("verification_status = ?")
            params.append(verification_status)
        if meshcode and meshcode.strip():
            clauses.append("meshcode = ?")
            params.append(meshcode.strip())
        if q and q.strip():
            kw = f"%{q.strip()}%"
            clauses.append("(title LIKE ? OR description LIKE ? OR ward_name LIKE ? OR location_label LIKE ?)")
            params.extend([kw, kw, kw, kw])

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT * FROM damage_reports
            {where_sql}
            ORDER BY resolved ASC, reported_at DESC, created_at DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 300)))

        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._serialize_row(r) for r in rows]

    def find_similar_reports(
        self,
        *,
        ward_name: str,
        category: str,
        title: str = "",
        description: str = "",
        meshcode: str | None = None,
        lat: float | None = None,
        lon: float | None = None,
        include_samples: bool = False,
    ) -> list[dict[str, Any]]:
        """Detect potentially duplicate or co-located unresolved reports within the same ward & category."""
        self.ensure_initialized()
        clauses = ["ward_name = ?", "category = ?", "resolved = 0"]
        params: list[Any] = [ward_name, category]
        if not include_samples:
            clauses.append("is_sample = 0")

        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM damage_reports WHERE {' AND '.join(clauses)} ORDER BY reported_at DESC LIMIT 50",
                params,
            ).fetchall()

        matches: list[dict[str, Any]] = []
        target_text = f"{title} {description}".strip()
        for r in rows:
            reasons: list[str] = []
            if meshcode and r["meshcode"] and meshcode == str(r["meshcode"]):
                reasons.append("同一250mメッシュ")
            if lat is not None and lon is not None and r["lat"] is not None and r["lon"] is not None:
                dist = haversine_meters(lat, lon, float(r["lat"]), float(r["lon"]))
                if dist <= 400.0:
                    reasons.append(f"近接地点（約{int(dist)}m）")
            if target_text:
                sim = text_similarity(target_text, f"{r['title']} {r['description']}")
                if sim >= 0.35:
                    reasons.append("類似内容")
            if reasons:
                serialized = self._serialize_row(r)
                serialized["duplicate_reasons"] = reasons
                matches.append(serialized)
        return matches[:5]

    @staticmethod
    def _validate_location(
        ward_name: str,
        meshcode: str | None,
        lat: float | None,
        lon: float | None,
        location_consent: bool,
    ) -> tuple[str, str | None, float | None, float | None, bool]:
        clean_ward = (ward_name or "京都市全域").strip()[:32] or "京都市全域"
        if clean_ward not in KYOTO_WARDS and clean_ward != "京都市全域":
            raise HTTPException(status_code=400, detail=f"対象外の地域名です: {clean_ward}")

        clean_mesh: str | None = None
        if meshcode and meshcode.strip():
            m = meshcode.strip()
            if not RE_MESHCODE.match(m):
                raise HTTPException(status_code=400, detail="メッシュコードは10桁の数字で指定してください。")
            clean_mesh = m

        if (lat is not None) != (lon is not None):
            raise HTTPException(status_code=400, detail="緯度と経度はセットで指定してください。")

        clean_lat: float | None = None
        clean_lon: float | None = None
        if lat is not None and lon is not None:
            if not location_consent:
                raise HTTPException(
                    status_code=400,
                    detail="地図上の位置座標を登録するには、位置情報提供への明示的な同意（location_consent=true）が必要です。",
                )
            if not (KYOTO_LAT_MIN <= lat <= KYOTO_LAT_MAX and KYOTO_LON_MIN <= lon <= KYOTO_LON_MAX):
                raise HTTPException(
                    status_code=400,
                    detail="指定された座標が京都市域の範囲外です。",
                )
            # Round to 5 decimal places (~1.1m) and never capture device background GPS silently
            clean_lat = round(float(lat), 5)
            clean_lon = round(float(lon), 5)

        return clean_ward, clean_mesh, clean_lat, clean_lon, bool(location_consent)

    def create_report(
        self,
        *,
        category: str,
        severity: str,
        title: str,
        description: str,
        ward_name: str = "京都市全域",
        meshcode: str | None = None,
        location_label: str | None = None,
        lat: float | None = None,
        lon: float | None = None,
        location_consent: bool = False,
        reporter_alias: str | None = None,
        passcode: str | None = None,
        reported_at: str | None = None,
        force_duplicate: bool = False,
    ) -> dict[str, Any]:
        """Validate and persist a new user disaster report (strictly tagged 'unverified')."""
        self.ensure_initialized()
        if category not in REPORT_CATEGORY_LABELS:
            raise HTTPException(status_code=400, detail=f"不正な被害カテゴリです: {category}")
        if severity not in REPORT_SEVERITY_LABELS:
            raise HTTPException(status_code=400, detail=f"不正な緊急度です: {severity}")

        clean_title = title.strip()
        if not clean_title or len(clean_title) > 80:
            raise HTTPException(status_code=400, detail="見出しは1〜80文字で入力してください。")

        clean_desc = description.strip()
        if not clean_desc or len(clean_desc) > 600:
            raise HTTPException(status_code=400, detail="報告内容は1〜600文字で入力してください。")

        clean_ward, clean_mesh, clean_lat, clean_lon, consent_bool = self._validate_location(
            ward_name, meshcode, lat, lon, location_consent
        )

        clean_loc_label = location_label.strip()[:80] if location_label and location_label.strip() else None
        clean_alias = (reporter_alias or "匿名市民").strip()[:32] or "匿名市民"

        clean_pass = (passcode or "").strip()
        if clean_pass and len(clean_pass) > 32:
            raise HTTPException(status_code=400, detail="編集・削除用暗証番号は32文字以内にしてください。")
        salt = secrets.token_hex(8) if clean_pass else None
        p_hash = _hash_passcode(clean_pass, salt) if (clean_pass and salt) else None

        now_iso = _now_jst_iso()
        eff_reported_at = now_iso
        if reported_at and reported_at.strip():
            try:
                dt = datetime.fromisoformat(reported_at.strip())
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=JST)
                eff_reported_at = dt.isoformat(timespec="seconds")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="発生日時の形式が不正です（ISO8601形式）。") from exc

        similar = []
        if not force_duplicate:
            similar = self.find_similar_reports(
                ward_name=clean_ward,
                category=category,
                title=clean_title,
                description=clean_desc,
                meshcode=clean_mesh,
                lat=clean_lat,
                lon=clean_lon,
                include_samples=False,
            )

        report_id = f"rep-{uuid.uuid4().hex[:10]}"
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO damage_reports (
                    id, category, severity, verification_status, title, description,
                    ward_name, meshcode, location_label, lat, lon, location_consent,
                    reporter_alias, corroborations, is_sample, resolved,
                    passcode_salt, passcode_hash, reported_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'unverified', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?, ?, ?)
                """,
                (
                    report_id,
                    category,
                    severity,
                    clean_title,
                    clean_desc,
                    clean_ward,
                    clean_mesh,
                    clean_loc_label,
                    clean_lat,
                    clean_lon,
                    1 if consent_bool else 0,
                    clean_alias,
                    salt,
                    p_hash,
                    eff_reported_at,
                    now_iso,
                    now_iso,
                ),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM damage_reports WHERE id = ?", (report_id,)).fetchone()

        assert row is not None
        out = self._serialize_row(row)
        return {"report": out, "similar_reports": similar}

    def confirm_report(self, report_id: str) -> dict[str, Any]:
        """Increment corroboration count on an existing unresolved report (remains unverified)."""
        self.ensure_initialized()
        clean_id = report_id.strip()
        if not clean_id:
            raise HTTPException(status_code=400, detail="report_id is required")
        updated_at = _now_jst_iso()

        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM damage_reports WHERE id = ?", (clean_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="指定された被害報告が見つかりません。")
            if int(row["is_sample"]) == 1:
                raise HTTPException(status_code=403, detail="訓練用サンプルには追加確認できません。")
            conn.execute(
                "UPDATE damage_reports SET corroborations = corroborations + 1, updated_at = ? WHERE id = ?",
                (updated_at, clean_id),
            )
            conn.commit()
            updated = conn.execute("SELECT * FROM damage_reports WHERE id = ?", (clean_id,)).fetchone()

        assert updated is not None
        return self._serialize_row(updated)

    def _verify_mutation_auth(self, row: sqlite3.Row, passcode: str | None) -> None:
        if int(row["is_sample"]) == 1:
            raise HTTPException(status_code=403, detail="訓練サンプルデータは編集・削除できません。")
        stored_hash = row["passcode_hash"]
        stored_salt = row["passcode_salt"]
        if stored_hash and stored_salt:
            candidate = _hash_passcode((passcode or "").strip(), str(stored_salt))
            if not hmac.compare_digest(candidate, str(stored_hash)):
                raise HTTPException(status_code=403, detail="編集・削除用暗証番号が一致しません。")

    def update_report(
        self,
        report_id: str,
        *,
        passcode: str | None = None,
        severity: str | None = None,
        title: str | None = None,
        description: str | None = None,
        resolved: bool | None = None,
        ward_name: str | None = None,
    ) -> dict[str, Any]:
        """Update an existing user report after passcode verification."""
        self.ensure_initialized()
        clean_id = report_id.strip()
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM damage_reports WHERE id = ?", (clean_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="指定された被害報告が見つかりません。")
            self._verify_mutation_auth(row, passcode)

            next_sev = str(row["severity"])
            if severity is not None:
                if severity not in REPORT_SEVERITY_LABELS:
                    raise HTTPException(status_code=400, detail=f"不正な緊急度です: {severity}")
                next_sev = severity

            next_title = str(row["title"])
            if title is not None:
                t = title.strip()
                if not t or len(t) > 80:
                    raise HTTPException(status_code=400, detail="見出しは1〜80文字で入力してください。")
                next_title = t

            next_desc = str(row["description"])
            if description is not None:
                d = description.strip()
                if not d or len(d) > 600:
                    raise HTTPException(status_code=400, detail="報告内容は1〜600文字で入力してください。")
                next_desc = d

            next_ward = str(row["ward_name"])
            if ward_name is not None:
                w = ward_name.strip()[:32]
                if w not in KYOTO_WARDS and w != "京都市全域":
                    raise HTTPException(status_code=400, detail=f"対象外の地域名です: {w}")
                next_ward = w

            next_resolved = int(row["resolved"]) if resolved is None else (1 if resolved else 0)
            updated_at = _now_jst_iso()

            conn.execute(
                """
                UPDATE damage_reports
                SET severity = ?, title = ?, description = ?, ward_name = ?, resolved = ?, updated_at = ?
                WHERE id = ?
                """,
                (next_sev, next_title, next_desc, next_ward, next_resolved, updated_at, clean_id),
            )
            conn.commit()
            updated = conn.execute("SELECT * FROM damage_reports WHERE id = ?", (clean_id,)).fetchone()

        assert updated is not None
        return self._serialize_row(updated)

    def delete_report(self, report_id: str, passcode: str | None = None) -> dict[str, Any]:
        """Delete a user report after passcode verification."""
        self.ensure_initialized()
        clean_id = report_id.strip()
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM damage_reports WHERE id = ?", (clean_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="指定された被害報告が見つかりません。")
            self._verify_mutation_auth(row, passcode)
            conn.execute("DELETE FROM damage_reports WHERE id = ?", (clean_id,))
            conn.commit()
        return {"deleted": True, "id": clean_id}

    def summarize_reports(
        self,
        ward: str | None = None,
        category: str | None = None,
        include_samples: bool = True,
        include_resolved: bool = False,
        store: Any | None = None,
    ) -> dict[str, Any]:
        """Aggregate damage reports by ward, category, severity, and verification tier."""
        self.ensure_initialized()
        clauses: list[str] = []
        params: list[Any] = []
        if not include_samples:
            clauses.append("is_sample = 0")
        if not include_resolved:
            clauses.append("resolved = 0")
        if ward and ward != "all":
            clauses.append("ward_name = ?")
            params.append(ward)
        if category and category != "all":
            clauses.append("category = ?")
            params.append(category)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM damage_reports {where_sql} ORDER BY reported_at DESC",
                params,
            ).fetchall()

        by_cat: dict[str, int] = {k: 0 for k in REPORT_CATEGORY_LABELS}
        by_sev: dict[str, int] = {k: 0 for k in REPORT_SEVERITY_LABELS}
        by_ver: dict[str, int] = {k: 0 for k in VERIFICATION_STATUS_LABELS}
        ward_agg: dict[str, dict[str, Any]] = {}

        for r in rows:
            cat = str(r["category"])
            sev = str(r["severity"])
            ver = str(r["verification_status"])
            wn = str(r["ward_name"] or "京都市全域")

            by_cat[cat] = by_cat.get(cat, 0) + 1
            by_sev[sev] = by_sev.get(sev, 0) + 1
            by_ver[ver] = by_ver.get(ver, 0) + 1

            if wn not in ward_agg:
                center = WARD_CENTERS.get(wn) or WARD_CENTERS["京都市全域"]
                ward_agg[wn] = {
                    "ward_name": wn,
                    "lon": center["lon"],
                    "lat": center["lat"],
                    "total_count": 0,
                    "unverified_count": 0,
                    "verified_or_official_count": 0,
                    "sample_count": 0,
                    "critical_or_high_count": 0,
                    "by_category": {k: 0 for k in REPORT_CATEGORY_LABELS},
                }
            w_row = ward_agg[wn]
            w_row["total_count"] += 1
            w_row["by_category"][cat] = w_row["by_category"].get(cat, 0) + 1
            if ver == "unverified":
                w_row["unverified_count"] += 1
            elif ver in {"verified", "official"}:
                w_row["verified_or_official_count"] += 1
            elif ver == "demo_sample":
                w_row["sample_count"] += 1
            if sev in {"critical", "high"}:
                w_row["critical_or_high_count"] += 1

        by_ward = sorted(
            ward_agg.values(),
            key=lambda x: (-x["critical_or_high_count"], -x["total_count"], x["ward_name"]),
        )

        # Attach optional mesh hazard context for top linked meshes when store is loaded
        linked_meshes: list[dict[str, Any]] = []
        if store is not None and getattr(store, "loaded", False):
            seen_meshes: set[str] = set()
            for r in rows:
                mc = r["meshcode"]
                if mc and str(mc) not in seen_meshes:
                    seen_meshes.add(str(mc))
                    md = store.get_mesh_detail(str(mc))
                    if md:
                        linked_meshes.append({
                            "meshcode": str(mc),
                            "ward_name": md["ward_name"],
                            "pre_1981_count": md["pre_1981_count"],
                            "t30_i55_ps": md["t30_i55_ps"],
                            "arv": md["arv"],
                        })
                if len(linked_meshes) >= 10:
                    break

        return {
            "scope": {
                "ward": ward or "all",
                "category": category or "all",
                "include_samples": include_samples,
                "include_resolved": include_resolved,
            },
            "total_reports": len(rows),
            "unverified_count": by_ver.get("unverified", 0),
            "verified_count": by_ver.get("verified", 0),
            "official_count": by_ver.get("official", 0),
            "demo_sample_count": by_ver.get("demo_sample", 0),
            "by_category": [
                {"key": k, "label": REPORT_CATEGORY_LABELS[k], "count": by_cat[k]}
                for k in REPORT_CATEGORY_LABELS
            ],
            "by_severity": [
                {"key": k, "label": REPORT_SEVERITY_LABELS[k], "count": by_sev[k]}
                for k in REPORT_SEVERITY_LABELS
            ],
            "by_verification_status": [
                {"key": k, "label": VERIFICATION_STATUS_LABELS[k], "count": by_ver[k]}
                for k in VERIFICATION_STATUS_LABELS
            ],
            "by_ward": by_ward,
            "linked_mesh_risks": linked_meshes,
            "verification_notice": (
                "市民から投稿された情報（unverified）は未確認情報です。訓練用サンプル（demo_sample）や"
                "公的機関の確定情報（official / 気象庁）と混同せず、参考情報としてお取り扱いください。"
            ),
        }
