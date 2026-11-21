"""SQLite-backed storage for QuakeLens Japan Disaster Message Board (災害用伝言板)."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

JST = timezone(timedelta(hours=9))
DEFAULT_BOARD_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "board.db"

BOARD_STATUS_LABELS: dict[str, str] = {
    "safe": "無事です",
    "shelter": "避難所にいます",
    "home": "自宅にいます",
    "minor_injury": "軽傷・支援が必要",
    "waiting": "連絡待ち・安否確認中",
}

_FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９－―ー（）　", "0123456789---() ")


def normalize_phone(raw: str) -> str:
    """Normalize Japanese phone numbers / contact keys to compact alphanumeric/digits."""
    translated = raw.translate(_FULLWIDTH_DIGITS).strip()
    cleaned = re.sub(r"[\s\-()]+", "", translated)
    return cleaned


def mask_phone(phone: str) -> str:
    """Mask middle digits of a phone number for safe public display."""
    if len(phone) >= 10 and phone.isdigit():
        return f"{phone[:3]}-****-{phone[-4:]}"
    if len(phone) >= 6:
        return f"{phone[:2]}{'*' * (len(phone) - 4)}{phone[-2:]}"
    return phone


def _hash_passcode(passcode: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{passcode}".encode("utf-8")).hexdigest()


def _now_jst_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


class DisasterBoardStore:
    """Thread-safe SQLite store for disaster safety message board entries."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or DEFAULT_BOARD_DB_PATH
        self._lock = threading.Lock()
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def ensure_initialized(self) -> None:
        """Create schema and seed clearly-labeled Kyoto drill sample rows if empty."""
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            with self._connect() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS board_entries (
                        id TEXT PRIMARY KEY,
                        phone TEXT NOT NULL,
                        name TEXT NOT NULL,
                        status TEXT NOT NULL,
                        ward_name TEXT NOT NULL,
                        meshcode TEXT,
                        message TEXT NOT NULL,
                        passcode_salt TEXT,
                        passcode_hash TEXT,
                        is_sample INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_board_phone ON board_entries (phone)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_board_created ON board_entries (created_at DESC)"
                )
                count_row = conn.execute("SELECT COUNT(*) AS cnt FROM board_entries").fetchone()
                if count_row and int(count_row["cnt"]) == 0:
                    now = datetime.now(JST)
                    samples = [
                        (
                            "sample-001",
                            "09000000001",
                            "【訓練サンプル】京都 花子",
                            "shelter",
                            "中京区",
                            "5235461024",
                            "【防災訓練サンプル】家族全員無事です。近くの指定避難所に避難しています。",
                            None,
                            None,
                            1,
                            (now - timedelta(minutes=18)).isoformat(timespec="seconds"),
                        ),
                        (
                            "sample-002",
                            "09000000002",
                            "【訓練サンプル】鴨川 健太",
                            "safe",
                            "東山区",
                            None,
                            "【防災訓練サンプル】自宅にて安全を確保しています。停電はなく連絡可能です。",
                            None,
                            None,
                            1,
                            (now - timedelta(minutes=42)).isoformat(timespec="seconds"),
                        ),
                        (
                            "sample-003",
                            "0750000003",
                            "【訓練サンプル】伏見 さくら",
                            "home",
                            "伏見区",
                            None,
                            "【防災訓練サンプル】大きな揺れがありましたが怪我はありません。余震に備えて待機中です。",
                            None,
                            None,
                            1,
                            (now - timedelta(hours=1, minutes=15)).isoformat(timespec="seconds"),
                        ),
                    ]
                    conn.executemany(
                        """
                        INSERT INTO board_entries
                        (id, phone, name, status, ward_name, meshcode, message, passcode_salt, passcode_hash, is_sample, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        samples,
                    )
                conn.commit()
            self._initialized = True

    @staticmethod
    def _serialize_row(row: sqlite3.Row, reveal_exact_phone: bool = False) -> dict[str, Any]:
        status = str(row["status"])
        phone = str(row["phone"])
        return {
            "id": str(row["id"]),
            "phone_masked": phone if reveal_exact_phone else mask_phone(phone),
            "name": str(row["name"]),
            "status": status,
            "status_label": BOARD_STATUS_LABELS.get(status, status),
            "ward_name": str(row["ward_name"]),
            "meshcode": str(row["meshcode"]) if row["meshcode"] else None,
            "message": str(row["message"]),
            "has_passcode": bool(row["passcode_hash"]),
            "is_sample": bool(row["is_sample"]),
            "created_at": str(row["created_at"]),
        }

    def list_entries(
        self,
        phone: str | None = None,
        q: str | None = None,
        ward: str | None = None,
        ids: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Query disaster message board entries with optional phone, keyword, ward, or ID filters."""
        self.ensure_initialized()
        clauses: list[str] = []
        params: list[Any] = []
        exact_phone_lookup = False

        if phone and phone.strip():
            norm = normalize_phone(phone)
            if not norm:
                return []
            if len(norm) >= 6:
                clauses.append("phone = ?")
                params.append(norm)
                exact_phone_lookup = True
            else:
                clauses.append("phone LIKE ?")
                params.append(f"%{norm}%")

        if q and q.strip():
            kw = q.strip()
            norm_kw = normalize_phone(kw)
            if norm_kw and norm_kw.isdigit() and len(norm_kw) >= 4:
                clauses.append("(name LIKE ? OR message LIKE ? OR ward_name LIKE ? OR phone LIKE ?)")
                params.extend([f"%{kw}%", f"%{kw}%", f"%{kw}%", f"%{norm_kw}%"])
            else:
                clauses.append("(name LIKE ? OR message LIKE ? OR ward_name LIKE ?)")
                params.extend([f"%{kw}%", f"%{kw}%", f"%{kw}%"])

        if ward and ward != "all":
            clauses.append("ward_name = ?")
            params.append(ward)

        if ids:
            clean_ids = [i.strip() for i in ids if i and i.strip()][:50]
            if not clean_ids:
                return []
            placeholders = ",".join("?" for _ in clean_ids)
            clauses.append(f"id IN ({placeholders})")
            params.extend(clean_ids)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT id, phone, name, status, ward_name, meshcode, message, passcode_hash, is_sample, created_at
            FROM board_entries
            {where_sql}
            ORDER BY created_at DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 100)))

        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._serialize_row(r, reveal_exact_phone=exact_phone_lookup) for r in rows]

    def create_entry(
        self,
        phone: str,
        name: str,
        status: str,
        message: str,
        ward_name: str = "京都市全域",
        meshcode: str | None = None,
        passcode: str | None = None,
    ) -> dict[str, Any]:
        """Validate and store a new disaster safety registration."""
        self.ensure_initialized()
        norm_phone = normalize_phone(phone)
        if not re.fullmatch(r"[A-Za-z0-9]{6,20}", norm_phone):
            raise HTTPException(
                status_code=400,
                detail="電話番号（または連絡ID）は6〜20文字の半角英数字で入力してください。",
            )

        clean_name = name.strip()
        if not clean_name or len(clean_name) > 40:
            raise HTTPException(
                status_code=400,
                detail="お名前は1〜40文字で入力してください。",
            )

        if status not in BOARD_STATUS_LABELS:
            raise HTTPException(
                status_code=400,
                detail=f"不正な安否区分です: {status}",
            )

        clean_msg = message.strip()
        if not clean_msg or len(clean_msg) > 400:
            raise HTTPException(
                status_code=400,
                detail="伝言メッセージは1〜400文字で入力してください。",
            )

        clean_ward = (ward_name or "京都市全域").strip()[:32] or "京都市全域"
        clean_mesh = meshcode.strip()[:20] if meshcode and meshcode.strip() else None

        clean_pass = (passcode or "").strip()
        if clean_pass and len(clean_pass) > 32:
            raise HTTPException(status_code=400, detail="削除用暗証番号は32文字以内にしてください。")

        salt = secrets.token_hex(8) if clean_pass else None
        p_hash = _hash_passcode(clean_pass, salt) if (clean_pass and salt) else None
        entry_id = uuid.uuid4().hex[:12]
        created_at = _now_jst_iso()

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO board_entries
                (id, phone, name, status, ward_name, meshcode, message, passcode_salt, passcode_hash, is_sample, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    entry_id,
                    norm_phone,
                    clean_name,
                    status,
                    clean_ward,
                    clean_mesh,
                    clean_msg,
                    salt,
                    p_hash,
                    created_at,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT id, phone, name, status, ward_name, meshcode, message, passcode_hash, is_sample, created_at FROM board_entries WHERE id = ?",
                (entry_id,),
            ).fetchone()

        assert row is not None
        return self._serialize_row(row, reveal_exact_phone=False)

    def delete_entry(self, entry_id: str, passcode: str | None = None) -> dict[str, Any]:
        """Delete a user-registered entry after verifying its passcode."""
        self.ensure_initialized()
        clean_id = entry_id.strip()
        if not clean_id:
            raise HTTPException(status_code=400, detail="entry_id is required")

        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT id, passcode_salt, passcode_hash, is_sample FROM board_entries WHERE id = ?",
                (clean_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="指定された伝言が見つかりません。")
            if int(row["is_sample"]) == 1:
                raise HTTPException(
                    status_code=403,
                    detail="訓練サンプルデータは削除できません。",
                )
            stored_hash = row["passcode_hash"]
            stored_salt = row["passcode_salt"]
            if stored_hash and stored_salt:
                candidate = _hash_passcode((passcode or "").strip(), str(stored_salt))
                if not hmac.compare_digest(candidate, str(stored_hash)):
                    raise HTTPException(
                        status_code=403,
                        detail="削除用暗証番号が一致しません。",
                    )
            conn.execute("DELETE FROM board_entries WHERE id = ?", (clean_id,))
            conn.commit()

        return {"deleted": True, "id": clean_id}
