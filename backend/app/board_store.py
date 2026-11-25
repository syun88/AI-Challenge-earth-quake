"""SQLite-backed storage for QuakeLens Japan Disaster Message Board (災害用伝言板)."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.constants import WARD_CENTERS
from app.firebase_backend import (
    delete_firestore_doc,
    fetch_firestore_collection,
    get_firestore_sync_ttl_seconds,
    is_firestore_persistence_enabled,
    push_firestore_doc,
)

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
    """Thread-safe SQLite + optional Cloud Firestore write-through store for disaster safety message board entries."""

    def __init__(self, db_path: Path | None = None, *, use_firestore: bool | None = None) -> None:
        self.db_path = db_path or DEFAULT_BOARD_DB_PATH
        self._use_firestore_override = use_firestore
        self._lock = threading.Lock()
        self._initialized = False
        self._last_fs_sync = 0.0

    def _use_firestore(self) -> bool:
        if self._use_firestore_override is not None:
            return self._use_firestore_override and is_firestore_persistence_enabled()
        return self.db_path == DEFAULT_BOARD_DB_PATH and is_firestore_persistence_enabled()

    @staticmethod
    def _row_to_firestore_doc(row: sqlite3.Row) -> dict[str, Any]:
        keys = row.keys()
        return {
            "id": str(row["id"]),
            "phone": str(row["phone"]),
            "name": str(row["name"]),
            "status": str(row["status"]),
            "ward_name": str(row["ward_name"]),
            "meshcode": row["meshcode"],
            "message": str(row["message"]),
            "passcode_salt": row["passcode_salt"],
            "passcode_hash": row["passcode_hash"],
            "is_sample": int(row["is_sample"]),
            "location_consent": int(row["location_consent"]) if "location_consent" in keys else 0,
            "owner_uid": row["owner_uid"] if "owner_uid" in keys else None,
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]) if ("updated_at" in keys and row["updated_at"]) else str(row["created_at"]),
        }

    def _hydrate_firestore_conn(
        self, conn: sqlite3.Connection, *, initial_migration: bool = False
    ) -> None:
        fs_docs = fetch_firestore_collection("server_board_entries")
        if fs_docs is None:
            return
        if fs_docs:
            fs_ids: list[str] = []
            for doc in fs_docs:
                bid = str(doc.get("id") or "").strip()
                if not bid:
                    continue
                fs_ids.append(bid)
                conn.execute(
                    """
                    INSERT OR REPLACE INTO board_entries (
                        id, phone, name, status, ward_name, meshcode, message,
                        passcode_salt, passcode_hash, is_sample, location_consent, owner_uid,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
                    """,
                    (
                        bid,
                        str(doc.get("phone") or ""),
                        str(doc.get("name") or ""),
                        str(doc.get("status") or "safe"),
                        str(doc.get("ward_name") or "京都市全域"),
                        doc.get("meshcode"),
                        str(doc.get("message") or ""),
                        doc.get("passcode_salt"),
                        doc.get("passcode_hash"),
                        1 if doc.get("location_consent") else 0,
                        doc.get("owner_uid"),
                        str(doc.get("created_at") or _now_jst_iso()),
                        str(doc.get("updated_at") or _now_jst_iso()),
                    ),
                )
            if fs_ids:
                placeholders = ",".join("?" for _ in fs_ids)
                conn.execute(
                    f"DELETE FROM board_entries WHERE is_sample = 0 AND id NOT IN ({placeholders})",
                    fs_ids,
                )
        elif initial_migration:
            local_rows = conn.execute("SELECT * FROM board_entries WHERE is_sample = 0").fetchall()
            for r in local_rows:
                push_firestore_doc("server_board_entries", str(r["id"]), self._row_to_firestore_doc(r))
        else:
            conn.execute("DELETE FROM board_entries WHERE is_sample = 0")
        self._last_fs_sync = time.monotonic()

    def _sync_from_firestore_if_needed(self) -> None:
        if not self._use_firestore():
            return
        if time.monotonic() - self._last_fs_sync < get_firestore_sync_ttl_seconds():
            return
        with self._lock, self._connect() as conn:
            if time.monotonic() - self._last_fs_sync < get_firestore_sync_ttl_seconds():
                return
            self._hydrate_firestore_conn(conn, initial_migration=False)
            conn.commit()

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
                        location_consent INTEGER NOT NULL DEFAULT 0,
                        owner_uid TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT
                    )
                    """
                )
                existing_cols = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(board_entries)").fetchall()
                }
                if "location_consent" not in existing_cols:
                    conn.execute(
                        "ALTER TABLE board_entries ADD COLUMN location_consent INTEGER NOT NULL DEFAULT 0"
                    )
                if "updated_at" not in existing_cols:
                    conn.execute("ALTER TABLE board_entries ADD COLUMN updated_at TEXT")
                if "owner_uid" not in existing_cols:
                    conn.execute("ALTER TABLE board_entries ADD COLUMN owner_uid TEXT")
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_board_owner ON board_entries (owner_uid)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_board_phone ON board_entries (phone)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_board_ward ON board_entries (ward_name)"
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
                if self._use_firestore():
                    self._hydrate_firestore_conn(conn, initial_migration=True)
                conn.commit()
            self._initialized = True

    @staticmethod
    def _serialize_row(
        row: sqlite3.Row,
        reveal_exact_phone: bool = False,
        *,
        viewer_role: str = "government",
        viewer_uid: str | None = None,
        allow_message_detail: bool = True,
    ) -> dict[str, Any]:
        status = str(row["status"])
        phone = str(row["phone"])
        keys = row.keys()
        updated_at = row["updated_at"] if "updated_at" in keys and row["updated_at"] else row["created_at"]
        location_consent = bool(row["location_consent"]) if "location_consent" in keys else bool(row["meshcode"])
        owner_uid = str(row["owner_uid"]) if ("owner_uid" in keys and row["owner_uid"]) else None
        is_sample = bool(row["is_sample"])
        is_mine = bool(viewer_uid and owner_uid and owner_uid == viewer_uid)
        can_read_detail = viewer_role == "government" or is_mine or is_sample or allow_message_detail

        return {
            "id": str(row["id"]),
            "phone_masked": phone if reveal_exact_phone else mask_phone(phone),
            "name": str(row["name"]) if can_read_detail else "登録者（非公開）",
            "status": status,
            "status_label": BOARD_STATUS_LABELS.get(status, status),
            "ward_name": str(row["ward_name"]),
            "meshcode": str(row["meshcode"]) if row["meshcode"] else None,
            "location_consent": location_consent,
            "message": (
                str(row["message"])
                if can_read_detail
                else "※安否メッセージ本文は登録者本人・電話番号照会・政府関連機関のみ閲覧できます。"
            ),
            "has_passcode": bool(row["passcode_hash"]),
            "is_sample": is_sample,
            "is_mine": is_mine,
            "created_at": str(row["created_at"]),
            "updated_at": str(updated_at),
        }

    def list_entries(
        self,
        phone: str | None = None,
        q: str | None = None,
        ward: str | None = None,
        meshcode: str | None = None,
        status: str | None = None,
        include_samples: bool = True,
        ids: list[str] | None = None,
        limit: int = 50,
        viewer_role: str = "government",
        viewer_uid: str | None = None,
    ) -> list[dict[str, Any]]:
        """Query disaster message board entries with optional filters and privacy protection."""
        self.ensure_initialized()
        self._sync_from_firestore_if_needed()
        clauses: list[str] = []
        params: list[Any] = []
        exact_phone_lookup = False

        if not include_samples:
            clauses.append("is_sample = 0")

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
            if viewer_role == "government":
                if norm_kw and norm_kw.isdigit() and len(norm_kw) >= 4:
                    clauses.append("(name LIKE ? OR message LIKE ? OR ward_name LIKE ? OR phone LIKE ?)")
                    params.extend([f"%{kw}%", f"%{kw}%", f"%{kw}%", f"%{norm_kw}%"])
                else:
                    clauses.append("(name LIKE ? OR message LIKE ? OR ward_name LIKE ?)")
                    params.extend([f"%{kw}%", f"%{kw}%", f"%{kw}%"])
            elif viewer_uid:
                clauses.append(
                    "(ward_name LIKE ? OR is_sample = 1 AND (name LIKE ? OR message LIKE ?) OR (owner_uid = ? AND (name LIKE ? OR message LIKE ?)))"
                )
                params.extend([f"%{kw}%", f"%{kw}%", f"%{kw}%", viewer_uid, f"%{kw}%", f"%{kw}%"])
            else:
                clauses.append("(ward_name LIKE ? OR (is_sample = 1 AND (name LIKE ? OR message LIKE ?)))")
                params.extend([f"%{kw}%", f"%{kw}%", f"%{kw}%"])

        if ward and ward != "all":
            clauses.append("ward_name = ?")
            params.append(ward)

        if meshcode and meshcode.strip():
            clauses.append("meshcode = ?")
            params.append(meshcode.strip())

        if status and status != "all":
            clauses.append("status = ?")
            params.append(status)

        id_lookup = False
        if ids:
            clean_ids = [i.strip() for i in ids if i and i.strip()][:50]
            if not clean_ids:
                return []
            placeholders = ",".join("?" for _ in clean_ids)
            clauses.append(f"id IN ({placeholders})")
            params.extend(clean_ids)
            id_lookup = True

        if viewer_role != "government" and not exact_phone_lookup:
            if viewer_uid:
                clauses.append("(is_sample = 1 OR owner_uid = ?)")
                params.append(viewer_uid)
            else:
                clauses.append("is_sample = 1")

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT id, phone, name, status, ward_name, meshcode, message, passcode_hash, is_sample, location_consent, owner_uid, created_at, updated_at
            FROM board_entries
            {where_sql}
            ORDER BY created_at DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 200)))

        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        allow_detail = viewer_role == "government" or exact_phone_lookup or id_lookup
        return [
            self._serialize_row(
                r,
                reveal_exact_phone=exact_phone_lookup,
                viewer_role=viewer_role,
                viewer_uid=viewer_uid,
                allow_message_detail=allow_detail,
            )
            for r in rows
        ]

    def create_entry(
        self,
        phone: str,
        name: str,
        status: str,
        message: str,
        ward_name: str = "京都市全域",
        meshcode: str | None = None,
        passcode: str | None = None,
        location_consent: bool | None = None,
        owner_uid: str | None = None,
    ) -> dict[str, Any]:
        """Validate and store a new disaster safety registration without storing personal GPS coordinates."""
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
        raw_mesh = meshcode.strip()[:20] if meshcode and meshcode.strip() else None
        if location_consent is False:
            clean_mesh = None
            consent_flag = 0
        else:
            clean_mesh = raw_mesh
            consent_flag = 1 if (location_consent or raw_mesh) else 0

        clean_pass = (passcode or "").strip()
        if clean_pass and len(clean_pass) > 32:
            raise HTTPException(status_code=400, detail="削除用暗証番号は32文字以内にしてください。")

        salt = secrets.token_hex(8) if clean_pass else None
        p_hash = _hash_passcode(clean_pass, salt) if (clean_pass and salt) else None
        clean_owner_uid = owner_uid.strip()[:128] if owner_uid and owner_uid.strip() else None
        entry_id = uuid.uuid4().hex[:12]
        created_at = _now_jst_iso()

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO board_entries
                (id, phone, name, status, ward_name, meshcode, message, passcode_salt, passcode_hash, is_sample, location_consent, owner_uid, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
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
                    consent_flag,
                    clean_owner_uid,
                    created_at,
                    created_at,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM board_entries WHERE id = ?",
                (entry_id,),
            ).fetchone()

        assert row is not None
        if self._use_firestore():
            push_firestore_doc("server_board_entries", entry_id, self._row_to_firestore_doc(row))
            self._last_fs_sync = time.monotonic()
        return self._serialize_row(
            row,
            reveal_exact_phone=False,
            viewer_role="government" if not clean_owner_uid else "citizen",
            viewer_uid=clean_owner_uid,
            allow_message_detail=True,
        )

    @staticmethod
    def _verify_board_mutation(
        row: sqlite3.Row,
        passcode: str | None,
        *,
        actor_uid: str | None = None,
        actor_role: str = "citizen",
    ) -> None:
        if int(row["is_sample"]) == 1:
            raise HTTPException(
                status_code=403,
                detail="訓練サンプルデータは編集・削除できません。",
            )
        if actor_role == "government":
            return
        keys = row.keys()
        owner_uid = str(row["owner_uid"]) if ("owner_uid" in keys and row["owner_uid"]) else None
        if owner_uid and (not actor_uid or owner_uid != actor_uid):
            raise HTTPException(
                status_code=403,
                detail="他者が登録した安否情報を編集・削除することはできません。",
            )
        stored_hash = row["passcode_hash"]
        stored_salt = row["passcode_salt"]
        if stored_hash and stored_salt:
            candidate = _hash_passcode((passcode or "").strip(), str(stored_salt))
            if not hmac.compare_digest(candidate, str(stored_hash)):
                raise HTTPException(
                    status_code=403,
                    detail="編集・削除用暗証番号が一致しません。",
                )

    def update_entry(
        self,
        entry_id: str,
        passcode: str | None = None,
        status: str | None = None,
        message: str | None = None,
        ward_name: str | None = None,
        meshcode: str | None = None,
        location_consent: bool | None = None,
        actor_uid: str | None = None,
        actor_role: str = "citizen",
    ) -> dict[str, Any]:
        """Update an existing user-registered safety entry after verifying owner/passcode."""
        self.ensure_initialized()
        clean_id = entry_id.strip()
        if not clean_id:
            raise HTTPException(status_code=400, detail="entry_id is required")

        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM board_entries WHERE id = ?",
                (clean_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="指定された伝言が見つかりません。")
            self._verify_board_mutation(row, passcode, actor_uid=actor_uid, actor_role=actor_role)

            next_status = str(row["status"])
            if status is not None:
                if status not in BOARD_STATUS_LABELS:
                    raise HTTPException(status_code=400, detail=f"不正な安否区分です: {status}")
                next_status = status

            next_msg = str(row["message"])
            if message is not None:
                trimmed = message.strip()
                if not trimmed or len(trimmed) > 400:
                    raise HTTPException(
                        status_code=400,
                        detail="伝言メッセージは1〜400文字で入力してください。",
                    )
                next_msg = trimmed

            next_ward = str(row["ward_name"])
            if ward_name is not None:
                next_ward = ward_name.strip()[:32] or "京都市全域"

            next_mesh = row["meshcode"]
            next_consent = int(row["location_consent"]) if "location_consent" in row.keys() else 0
            if location_consent is False:
                next_mesh = None
                next_consent = 0
            else:
                if meshcode is not None:
                    next_mesh = meshcode.strip()[:20] if meshcode.strip() else None
                if location_consent is True:
                    next_consent = 1

            updated_at = _now_jst_iso()
            conn.execute(
                """
                UPDATE board_entries
                SET status = ?, message = ?, ward_name = ?, meshcode = ?, location_consent = ?, updated_at = ?
                WHERE id = ?
                """,
                (next_status, next_msg, next_ward, next_mesh, next_consent, updated_at, clean_id),
            )
            conn.commit()
            updated_row = conn.execute(
                "SELECT * FROM board_entries WHERE id = ?",
                (clean_id,),
            ).fetchone()

        assert updated_row is not None
        if self._use_firestore():
            push_firestore_doc("server_board_entries", clean_id, self._row_to_firestore_doc(updated_row))
            self._last_fs_sync = time.monotonic()
        return self._serialize_row(
            updated_row,
            reveal_exact_phone=False,
            viewer_role=actor_role,
            viewer_uid=actor_uid,
            allow_message_detail=True,
        )

    def delete_entry(
        self,
        entry_id: str,
        passcode: str | None = None,
        *,
        actor_uid: str | None = None,
        actor_role: str = "citizen",
    ) -> dict[str, Any]:
        """Delete a user-registered entry after verifying owner/passcode."""
        self.ensure_initialized()
        clean_id = entry_id.strip()
        if not clean_id:
            raise HTTPException(status_code=400, detail="entry_id is required")

        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT id, passcode_salt, passcode_hash, is_sample, owner_uid FROM board_entries WHERE id = ?",
                (clean_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="指定された伝言が見つかりません。")
            self._verify_board_mutation(row, passcode, actor_uid=actor_uid, actor_role=actor_role)
            conn.execute("DELETE FROM board_entries WHERE id = ?", (clean_id,))
            conn.commit()
        if self._use_firestore():
            delete_firestore_doc("server_board_entries", clean_id)
            self._last_fs_sync = time.monotonic()

        return {"deleted": True, "id": clean_id}

    def summarize_entries(
        self,
        ward: str | None = None,
        include_samples: bool = True,
        store: Any | None = None,
    ) -> dict[str, Any]:
        """Aggregate safety status counts by ward and 250m mesh without exposing personal coordinates."""
        self.ensure_initialized()
        self._sync_from_firestore_if_needed()
        clauses: list[str] = []
        params: list[Any] = []
        if not include_samples:
            clauses.append("is_sample = 0")
        if ward and ward != "all":
            clauses.append("ward_name = ?")
            params.append(ward)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT id, name, status, ward_name, meshcode, message, is_sample, created_at, updated_at FROM board_entries {where_sql} ORDER BY created_at DESC",
                params,
            ).fetchall()

        status_counts: dict[str, int] = {k: 0 for k in BOARD_STATUS_LABELS}
        user_status_counts: dict[str, int] = {k: 0 for k in BOARD_STATUS_LABELS}
        ward_agg: dict[str, dict[str, Any]] = {}
        mesh_agg: dict[str, dict[str, Any]] = {}
        user_entries_count = 0
        sample_entries_count = 0

        for r in rows:
            st = str(r["status"])
            wn = str(r["ward_name"] or "京都市全域")
            mc = str(r["meshcode"]) if r["meshcode"] else None
            is_smp = int(r["is_sample"]) == 1

            status_counts[st] = status_counts.get(st, 0) + 1
            if is_smp:
                sample_entries_count += 1
            else:
                user_entries_count += 1
                user_status_counts[st] = user_status_counts.get(st, 0) + 1

            if wn not in ward_agg:
                center = WARD_CENTERS.get(wn) or WARD_CENTERS["京都市全域"]
                ward_agg[wn] = {
                    "ward_name": wn,
                    "lon": center["lon"],
                    "lat": center["lat"],
                    "total_count": 0,
                    "user_count": 0,
                    "sample_count": 0,
                    "support_needed_count": 0,
                    "status_counts": {k: 0 for k in BOARD_STATUS_LABELS},
                    "latest_at": str(r["created_at"]),
                }
            w_item = ward_agg[wn]
            w_item["total_count"] += 1
            if is_smp:
                w_item["sample_count"] += 1
            else:
                w_item["user_count"] += 1
            w_item["status_counts"][st] = w_item["status_counts"].get(st, 0) + 1
            if st in {"minor_injury", "waiting"}:
                w_item["support_needed_count"] += 1

            if mc:
                if mc not in mesh_agg:
                    lon = None
                    lat = None
                    m_ward = wn
                    if store is not None and getattr(store, "loaded", False):
                        detail = store.get_mesh_detail(mc)
                        if detail:
                            lon = detail.get("centroid_lon")
                            lat = detail.get("centroid_lat")
                            m_ward = detail.get("ward_name") or wn
                    mesh_agg[mc] = {
                        "meshcode": mc,
                        "ward_name": m_ward,
                        "centroid_lon": lon,
                        "centroid_lat": lat,
                        "total_count": 0,
                        "user_count": 0,
                        "sample_count": 0,
                        "status_counts": {k: 0 for k in BOARD_STATUS_LABELS},
                    }
                m_item = mesh_agg[mc]
                m_item["total_count"] += 1
                if is_smp:
                    m_item["sample_count"] += 1
                else:
                    m_item["user_count"] += 1
                m_item["status_counts"][st] = m_item["status_counts"].get(st, 0) + 1

        by_ward = sorted(
            ward_agg.values(),
            key=lambda x: (-x["support_needed_count"], -x["total_count"], x["ward_name"]),
        )
        by_mesh = sorted(
            mesh_agg.values(),
            key=lambda x: (-x["total_count"], x["meshcode"]),
        )

        return {
            "scope": {"ward": ward or "all", "include_samples": include_samples},
            "total_entries": len(rows),
            "user_entries_count": user_entries_count,
            "sample_entries_count": sample_entries_count,
            "status_labels": BOARD_STATUS_LABELS,
            "status_counts": status_counts,
            "user_status_counts": user_status_counts,
            "by_ward": by_ward,
            "by_mesh": by_mesh,
            "privacy_note": "個人の電話番号は一覧では伏せ字表示され、個人の正確なGPS座標は取得・保存しません（任意同意時のみ区・250mメッシュ単位で集計）。",
        }
