"""Firebase ID Token verification, SQLite user role authority store, and RBAC dependencies."""

from __future__ import annotations

import base64
import hmac
import json
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import Depends, HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.firebase_backend import (
    fetch_firestore_collection,
    fetch_firestore_doc,
    is_firestore_persistence_enabled,
    push_firestore_doc,
    sync_user_role_to_firebase,
)

JST = timezone(timedelta(hours=9))
DEFAULT_AUTH_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "board.db"

UserRole = Literal["government", "citizen", "enterprise"]
VALID_ROLES: tuple[str, ...] = ("government", "citizen", "enterprise")

ROLE_LABELS: dict[str, str] = {
    "government": "政府関連機関",
    "citizen": "一般市民",
    "enterprise": "企業",
}

ROLE_PERMISSIONS: dict[str, dict[str, bool]] = {
    "government": {
        "view_all_reports": True,
        "view_private_report_details": True,
        "verify_reports": True,
        "manage_any_report": True,
        "use_rescue_routing": True,
        "use_custom_routing": True,
        "use_evacuate_routing": True,
        "access_enterprise_bcp": False,
        "manage_enterprise_assets": False,
        "view_gov_shared_assets": True,
        "export_full_reports": True,
        "export_summary_stats": True,
        "view_r8_admin": True,
    },
    "citizen": {
        "view_all_reports": False,
        "view_private_report_details": False,
        "verify_reports": False,
        "manage_any_report": False,
        "use_rescue_routing": False,
        "use_custom_routing": False,
        "use_evacuate_routing": True,
        "access_enterprise_bcp": False,
        "manage_enterprise_assets": False,
        "view_gov_shared_assets": False,
        "export_full_reports": False,
        "export_summary_stats": False,
        "view_r8_admin": False,
    },
    "enterprise": {
        "view_all_reports": False,
        "view_private_report_details": False,
        "verify_reports": False,
        "manage_any_report": False,
        "use_rescue_routing": False,
        "use_custom_routing": True,
        "use_evacuate_routing": True,
        "access_enterprise_bcp": True,
        "manage_enterprise_assets": True,
        "view_gov_shared_assets": False,
        "export_full_reports": False,
        "export_summary_stats": True,
        "view_r8_admin": False,
    },
}


def _now_jst_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


def get_firebase_project_id() -> str:
    return (
        os.getenv("FIREBASE_PROJECT_ID", "").strip()
        or os.getenv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "").strip()
    )


def get_gov_registration_code() -> str:
    return os.getenv("GOV_REGISTRATION_CODE", "").strip()


_thread_local = threading.local()


def _get_google_request() -> google_requests.Request:
    req = getattr(_thread_local, "google_req", None)
    if req is None:
        req = google_requests.Request()
        _thread_local.google_req = req
    return req


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _verify_emulator_token(token: str, project_id: str, emulator_host: str) -> dict[str, Any]:
    """Verify an unsigned Firebase Auth Emulator JWT and confirm user exists on emulator."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed JWT")
    header = json.loads(_b64url_decode(parts[0]))
    payload = json.loads(_b64url_decode(parts[1]))

    if header.get("alg") != "none":
        raise ValueError("Unexpected algorithm for emulator token")

    aud = payload.get("aud")
    if project_id and aud != project_id:
        raise ValueError("Token audience mismatch")

    expected_iss = f"https://securetoken.google.com/{aud}"
    if payload.get("iss") != expected_iss:
        raise ValueError("Token issuer mismatch")

    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise ValueError("Token missing sub")

    now = time.time()
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or exp < now - 5:
        raise ValueError("Token expired")

    # Confirm the token against the local Auth Emulator accounts:lookup endpoint
    try:
        resp = httpx.post(
            f"http://{emulator_host}/identitytoolkit.googleapis.com/v1/accounts:lookup",
            json={"idToken": token},
            timeout=4.0,
        )
        if resp.status_code != 200:
            raise ValueError("Emulator rejected token")
        users = (resp.json() or {}).get("users") or []
        if not users or users[0].get("localId") != sub:
            raise ValueError("Emulator user mismatch")
    except httpx.HTTPError as exc:
        raise ValueError(f"Auth emulator unreachable: {exc}") from exc

    return payload


def verify_firebase_id_token(token: str) -> dict[str, Any]:
    """Verify a Firebase ID token (Google RS256 certs in prod; strict emulator check in dev)."""
    clean_token = (token or "").strip()
    if not clean_token:
        raise HTTPException(
            status_code=401,
            detail="認証トークンが必要です。ログインしてください。",
            headers={"WWW-Authenticate": "Bearer"},
        )

    project_id = get_firebase_project_id()
    emulator_host = os.getenv("FIREBASE_AUTH_EMULATOR_HOST", "").strip()

    if emulator_host:
        try:
            return _verify_emulator_token(clean_token, project_id, emulator_host)
        except Exception as exc:
            raise HTTPException(
                status_code=401,
                detail=f"エミュレータ認証トークンが無効です: {exc}",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    if not project_id:
        raise HTTPException(
            status_code=503,
            detail="サーバーの Firebase プロジェクトID（FIREBASE_PROJECT_ID）が設定されていません。",
        )

    try:
        claims = google_id_token.verify_firebase_token(
            clean_token,
            _get_google_request(),
            audience=project_id,
            clock_skew_in_seconds=5,
        )
        return dict(claims)
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail="認証セッションが無効または期限切れです。再ログインしてください。",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


@dataclass(frozen=True)
class AuthenticatedUser:
    uid: str
    email: str
    display_name: str
    role: UserRole
    organization_name: str
    department: str
    verified_agency: bool
    email_verified: bool = False
    auth_provider: str = "password"

    @property
    def role_label(self) -> str:
        return ROLE_LABELS.get(self.role, self.role)

    @property
    def permissions(self) -> dict[str, bool]:
        return dict(ROLE_PERMISSIONS.get(self.role, ROLE_PERMISSIONS["citizen"]))

    def to_dict(self) -> dict[str, Any]:
        return {
            "uid": self.uid,
            "email": self.email,
            "display_name": self.display_name,
            "role": self.role,
            "role_label": self.role_label,
            "organization_name": self.organization_name,
            "department": self.department,
            "verified_agency": self.verified_agency,
            "email_verified": self.email_verified,
            "auth_provider": self.auth_provider,
            "permissions": self.permissions,
        }


class AuthProfileStore:
    """Thread-safe SQLite + optional Firestore store holding authoritative user role & agency verification records."""

    def __init__(self, db_path: Path | None = None, *, use_firestore: bool | None = None) -> None:
        self.db_path = db_path or DEFAULT_AUTH_DB_PATH
        self._use_firestore_override = use_firestore
        self._lock = threading.Lock()
        self._initialized = False

    def _use_firestore(self) -> bool:
        if self._use_firestore_override is not None:
            return self._use_firestore_override and is_firestore_persistence_enabled()
        return self.db_path == DEFAULT_AUTH_DB_PATH and is_firestore_persistence_enabled()

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def ensure_initialized(self) -> None:
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            with self._connect() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS auth_profiles (
                        uid TEXT PRIMARY KEY,
                        email TEXT NOT NULL,
                        display_name TEXT NOT NULL,
                        role TEXT NOT NULL CHECK(role IN ('government', 'citizen', 'enterprise')),
                        organization_name TEXT NOT NULL DEFAULT '',
                        department TEXT NOT NULL DEFAULT '',
                        verified_agency INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_auth_role ON auth_profiles (role)"
                )
                if self._use_firestore():
                    fs_docs = fetch_firestore_collection("server_auth_profiles")
                    if fs_docs:
                        for doc in fs_docs:
                            uid = str(doc.get("uid") or doc.get("id") or "").strip()
                            role = str(doc.get("role") or "")
                            if not uid or role not in VALID_ROLES:
                                continue
                            conn.execute(
                                """
                                INSERT OR REPLACE INTO auth_profiles (
                                    uid, email, display_name, role, organization_name, department,
                                    verified_agency, created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    uid,
                                    str(doc.get("email") or ""),
                                    str(doc.get("display_name") or ""),
                                    role,
                                    str(doc.get("organization_name") or ""),
                                    str(doc.get("department") or ""),
                                    1 if doc.get("verified_agency") else 0,
                                    str(doc.get("created_at") or _now_jst_iso()),
                                    str(doc.get("updated_at") or _now_jst_iso()),
                                ),
                            )
                    elif fs_docs is not None:
                        # One-time migration of existing local SQLite profiles into Firestore
                        local_rows = conn.execute("SELECT * FROM auth_profiles").fetchall()
                        for r in local_rows:
                            prof = self._serialize(r)
                            push_firestore_doc("server_auth_profiles", prof["uid"], prof)
                            sync_user_role_to_firebase(
                                uid=prof["uid"],
                                email=prof["email"],
                                display_name=prof["display_name"],
                                role=prof["role"],
                                organization_name=prof["organization_name"],
                                department=prof["department"],
                                verified_agency=prof["verified_agency"],
                            )
                conn.commit()
            self._initialized = True

    @staticmethod
    def _serialize(row: sqlite3.Row) -> dict[str, Any]:
        role = str(row["role"])
        return {
            "uid": str(row["uid"]),
            "email": str(row["email"]),
            "display_name": str(row["display_name"]),
            "role": role,
            "role_label": ROLE_LABELS.get(role, role),
            "organization_name": str(row["organization_name"] or ""),
            "department": str(row["department"] or ""),
            "verified_agency": bool(row["verified_agency"]),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }

    def get_profile(self, uid: str) -> dict[str, Any] | None:
        self.ensure_initialized()
        clean_uid = (uid or "").strip()
        if not clean_uid:
            return None
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM auth_profiles WHERE uid = ?",
                (clean_uid,),
            ).fetchone()
            if row is not None:
                return self._serialize(row)
            if self._use_firestore():
                doc = fetch_firestore_doc("server_auth_profiles", clean_uid)
                if doc and doc.get("role") in VALID_ROLES:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO auth_profiles (
                            uid, email, display_name, role, organization_name, department,
                            verified_agency, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            clean_uid,
                            str(doc.get("email") or ""),
                            str(doc.get("display_name") or ""),
                            str(doc["role"]),
                            str(doc.get("organization_name") or ""),
                            str(doc.get("department") or ""),
                            1 if doc.get("verified_agency") else 0,
                            str(doc.get("created_at") or _now_jst_iso()),
                            str(doc.get("updated_at") or _now_jst_iso()),
                        ),
                    )
                    conn.commit()
                    fetched = conn.execute(
                        "SELECT * FROM auth_profiles WHERE uid = ?",
                        (clean_uid,),
                    ).fetchone()
                    if fetched is not None:
                        return self._serialize(fetched)
        return None

    def register_or_update_profile(
        self,
        *,
        uid: str,
        email: str,
        display_name: str,
        role: str,
        organization_name: str = "",
        department: str = "",
        gov_code: str = "",
    ) -> dict[str, Any]:
        """Register initial user role (preventing self-escalation) or update same-role profile fields."""
        self.ensure_initialized()
        clean_uid = (uid or "").strip()
        if not clean_uid:
            raise HTTPException(status_code=400, detail="UIDが不正です。")
        if role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="アカウント区分が不正です。")

        clean_email = (email or "").strip()[:160]
        clean_name = (display_name or "").strip()[:60]
        if not clean_name:
            raise HTTPException(status_code=400, detail="お名前（担当者名）を入力してください。")

        clean_org = (organization_name or "").strip()[:120]
        clean_dept = (department or "").strip()[:80]

        if role in {"enterprise", "government"} and not clean_org:
            label = "企業・組織名" if role == "enterprise" else "政府・自治体機関名"
            raise HTTPException(status_code=400, detail=f"{label}を入力してください。")

        with self._lock, self._connect() as conn:
            existing = conn.execute(
                "SELECT * FROM auth_profiles WHERE uid = ?",
                (clean_uid,),
            ).fetchone()

            now_iso = _now_jst_iso()

            if existing is not None:
                existing_role = str(existing["role"])
                if existing_role != role:
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            f"このアカウントは既に「{ROLE_LABELS.get(existing_role, existing_role)}」として登録済みです。"
                            "登録後のアカウント区分変更・権限昇格はできません。"
                        ),
                    )
                conn.execute(
                    """
                    UPDATE auth_profiles
                    SET email = ?, display_name = ?, organization_name = ?, department = ?, updated_at = ?
                    WHERE uid = ?
                    """,
                    (
                        clean_email or str(existing["email"]),
                        clean_name,
                        clean_org,
                        clean_dept,
                        now_iso,
                        clean_uid,
                    ),
                )
                conn.commit()
                updated = conn.execute(
                    "SELECT * FROM auth_profiles WHERE uid = ?", (clean_uid,)
                ).fetchone()
                assert updated is not None
                out_profile = self._serialize(updated)
                if self._use_firestore():
                    push_firestore_doc("server_auth_profiles", clean_uid, out_profile)
                    sync_user_role_to_firebase(
                        uid=out_profile["uid"],
                        email=out_profile["email"],
                        display_name=out_profile["display_name"],
                        role=out_profile["role"],
                        organization_name=out_profile["organization_name"],
                        department=out_profile["department"],
                        verified_agency=out_profile["verified_agency"],
                    )
                return out_profile

            verified_agency = 0
            if role == "government":
                expected_code = get_gov_registration_code()
                if not expected_code:
                    raise HTTPException(
                        status_code=403,
                        detail="サーバー側に政府関連機関認証コード（GOV_REGISTRATION_CODE）が設定されていないため登録できません。",
                    )
                provided = (gov_code or "").strip()
                if not provided or not hmac.compare_digest(provided, expected_code):
                    raise HTTPException(
                        status_code=403,
                        detail="政府関連機関の機関認証コードが正しくありません。",
                    )
                verified_agency = 1

            conn.execute(
                """
                INSERT INTO auth_profiles (
                    uid, email, display_name, role, organization_name, department,
                    verified_agency, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    clean_uid,
                    clean_email,
                    clean_name,
                    role,
                    clean_org,
                    clean_dept,
                    verified_agency,
                    now_iso,
                    now_iso,
                ),
            )
            conn.commit()
            created = conn.execute(
                "SELECT * FROM auth_profiles WHERE uid = ?", (clean_uid,)
            ).fetchone()

        assert created is not None
        out_profile = self._serialize(created)
        if self._use_firestore():
            push_firestore_doc("server_auth_profiles", clean_uid, out_profile)
            sync_user_role_to_firebase(
                uid=out_profile["uid"],
                email=out_profile["email"],
                display_name=out_profile["display_name"],
                role=out_profile["role"],
                organization_name=out_profile["organization_name"],
                department=out_profile["department"],
                verified_agency=out_profile["verified_agency"],
            )
        return out_profile

    def verify_login_role(self, uid: str, expected_role: str) -> dict[str, Any]:
        if expected_role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="アカウント区分が不正です。")
        profile = self.get_profile(uid)
        if profile is None:
            raise HTTPException(
                status_code=404,
                detail="アカウント区分が未登録です。新規登録ページからアカウント区分を設定してください。",
            )
        actual_role = profile["role"]
        if actual_role != expected_role:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"このアカウントは「{ROLE_LABELS.get(actual_role, actual_role)}」として登録されています。"
                    f"「{ROLE_LABELS.get(expected_role, expected_role)}」区分ではログインできません。"
                ),
            )
        if self._use_firestore():
            claims_synced = sync_user_role_to_firebase(
                uid=profile["uid"],
                email=profile["email"],
                display_name=profile["display_name"],
                role=profile["role"],
                organization_name=profile["organization_name"],
                department=profile["department"],
                verified_agency=bool(profile["verified_agency"]),
            )
            profile = {**profile, "claims_synced": claims_synced}
        return profile


auth_profile_store = AuthProfileStore()


def _extract_bearer_token(request: Request) -> str:
    auth_header = (request.headers.get("authorization") or "").strip()
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="認証が必要です。ログインしてからご利用ください。",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = auth_header[7:].strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail="認証トークンが空です。",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def get_firebase_claims(request: Request) -> dict[str, Any]:
    token = _extract_bearer_token(request)
    return verify_firebase_id_token(token)


def get_current_user(
    claims: dict[str, Any] = Depends(get_firebase_claims),
) -> AuthenticatedUser:
    uid = str(claims.get("sub") or claims.get("user_id") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="トークンにUIDが含まれていません。")

    profile = auth_profile_store.get_profile(uid)
    if profile is None:
        raise HTTPException(
            status_code=403,
            detail="PROFILE_NOT_REGISTERED: 利用区分の初期登録が完了していません。登録ページで完了してください。",
        )

    firebase_meta = claims.get("firebase")
    provider = "password"
    if isinstance(firebase_meta, dict) and firebase_meta.get("sign_in_provider"):
        provider = str(firebase_meta["sign_in_provider"])

    role = profile["role"]
    if role == "government" and not profile.get("verified_agency"):
        raise HTTPException(
            status_code=403,
            detail="政府関連機関の認証状態が無効です。",
        )

    return AuthenticatedUser(
        uid=uid,
        email=str(claims.get("email") or profile.get("email") or ""),
        display_name=profile["display_name"],
        role=role,  # type: ignore[arg-type]
        organization_name=profile["organization_name"],
        department=profile["department"],
        verified_agency=bool(profile["verified_agency"]),
        email_verified=bool(claims.get("email_verified", False)),
        auth_provider=provider,
    )


def require_roles(*allowed_roles: UserRole):
    """FastAPI dependency factory enforcing role-based access control."""

    def _checker(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if user.role not in allowed_roles:
            allowed_labels = "・".join(ROLE_LABELS.get(r, r) for r in allowed_roles)
            raise HTTPException(
                status_code=403,
                detail=f"この機能は「{allowed_labels}」アカウント専用です（現在: {user.role_label}）。",
            )
        return user

    return _checker
