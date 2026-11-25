"""Optional Firebase Admin SDK integration for Spark-plan Cloud Firestore persistence and Custom Claims."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials as firebase_credentials
from firebase_admin import firestore as firebase_firestore
from google.auth.credentials import AnonymousCredentials

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SA_CANDIDATES = (
    BACKEND_ROOT / "firebase-service-account.json",
    BACKEND_ROOT.parent / "firebase-service-account.json",
)


class _EmulatorCredential(firebase_credentials.Base):
    """Anonymous credential for connecting firebase-admin to local Auth/Firestore emulators."""

    def get_credential(self) -> AnonymousCredentials:
        return AnonymousCredentials()


_init_lock = threading.Lock()
_cached_app: firebase_admin.App | None = None
_cached_db: Any = None
_cached_mode: str = "uninitialized"


def _sqlite_only_forced() -> bool:
    return os.getenv("QUAKELENS_USE_SQLITE_ONLY", "").strip().lower() in {"1", "true", "yes"}


def _is_emulator_configured() -> bool:
    return bool(
        os.getenv("FIRESTORE_EMULATOR_HOST", "").strip()
        or os.getenv("FIREBASE_AUTH_EMULATOR_HOST", "").strip()
    )


def _find_service_account_json() -> dict[str, Any] | Path | None:
    raw_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw_json:
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, dict) and parsed.get("private_key") and parsed.get("client_email"):
                return parsed
        except Exception:
            pass

    for env_key in ("FIREBASE_SERVICE_ACCOUNT_PATH", "GOOGLE_APPLICATION_CREDENTIALS"):
        raw_path = os.getenv(env_key, "").strip()
        if raw_path:
            p = Path(raw_path).expanduser()
            if not p.is_absolute():
                p = (BACKEND_ROOT.parent / p).resolve()
            if p.is_file():
                return p

    for candidate in DEFAULT_SA_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def _ensure_initialized() -> tuple[firebase_admin.App | None, Any]:
    global _cached_app, _cached_db, _cached_mode

    if _sqlite_only_forced():
        return None, None

    if _cached_db is not None and _cached_app is not None:
        return _cached_app, _cached_db

    with _init_lock:
        if _sqlite_only_forced():
            return None, None
        if _cached_db is not None and _cached_app is not None:
            return _cached_app, _cached_db

        project_id = (
            os.getenv("FIREBASE_PROJECT_ID", "").strip()
            or os.getenv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "").strip()
            or ("demo-quakelens" if _is_emulator_configured() else "")
        )

        app_name = "quakelens-firestore"
        try:
            existing_app = firebase_admin.get_app(app_name)
        except ValueError:
            existing_app = None

        if existing_app is not None:
            _cached_app = existing_app
            _cached_db = firebase_firestore.client(app=_cached_app)
            return _cached_app, _cached_db

        cred_source = _find_service_account_json()
        if cred_source is not None:
            cred = firebase_credentials.Certificate(
                str(cred_source) if isinstance(cred_source, Path) else cred_source
            )
            options = {"projectId": project_id} if project_id else None
            _cached_app = firebase_admin.initialize_app(cred, options=options, name=app_name)
            _cached_db = firebase_firestore.client(app=_cached_app)
            _cached_mode = "firestore_service_account"
            return _cached_app, _cached_db

        if os.getenv("FIRESTORE_EMULATOR_HOST", "").strip():
            # Emulator mode works cleanly without cloud credentials
            options = {"projectId": project_id or "demo-quakelens"}
            _cached_app = firebase_admin.initialize_app(
                _EmulatorCredential(), options=options, name=app_name
            )
            _cached_db = firebase_firestore.client(app=_cached_app)
            _cached_mode = "firestore_emulator"
            return _cached_app, _cached_db

        _cached_mode = "sqlite_fallback"
        return None, None


def reset_firebase_admin_cache() -> None:
    """Clear cached Firebase Admin handles (useful for isolated unit tests)."""
    global _cached_app, _cached_db, _cached_mode
    with _init_lock:
        if _cached_app is not None:
            try:
                firebase_admin.delete_app(_cached_app)
            except Exception:
                pass
        _cached_app = None
        _cached_db = None
        _cached_mode = "uninitialized"


def is_firestore_persistence_enabled() -> bool:
    _, db = _ensure_initialized()
    return db is not None


def get_firestore_client() -> Any:
    _, db = _ensure_initialized()
    return db


def get_firebase_admin_app() -> firebase_admin.App | None:
    app, _ = _ensure_initialized()
    return app


def get_firebase_admin_status() -> dict[str, Any]:
    app, db = _ensure_initialized()
    return {
        "admin_ready": app is not None and db is not None,
        "persistence_backend": "firestore" if (app is not None and db is not None) else "sqlite",
        "mode": _cached_mode,
    }


def sync_user_role_to_firebase(
    *,
    uid: str,
    email: str,
    display_name: str,
    role: str,
    organization_name: str = "",
    department: str = "",
    verified_agency: bool = False,
) -> bool:
    """Set authoritative Custom Claims and mirror users/{uid} in Cloud Firestore cleanly."""
    app, db = _ensure_initialized()
    if app is None or db is None:
        return False

    try:
        firebase_auth.set_custom_user_claims(
            uid,
            {"role": role, "verifiedAgency": bool(verified_agency)},
            app=app,
        )
    except Exception:
        # Custom claims sync may fail in Auth-less tests while Firestore still succeeds
        pass

    try:
        user_payload: dict[str, Any] = {
            "uid": uid,
            "email": email or "",
            "displayName": display_name,
            "role": role,
            "organizationName": organization_name or "",
            "department": department or "",
            "updatedAt": firebase_firestore.SERVER_TIMESTAMP,
        }
        # Only verified government records include verifiedAgency on users/{uid},
        # keeping citizen/enterprise client rules' allowedKeys strictly clean.
        if role == "government" and verified_agency:
            user_payload["verifiedAgency"] = True
        db.collection("users").document(uid).set(user_payload, merge=True)
        return True
    except Exception:
        return False


def get_firestore_sync_ttl_seconds() -> float:
    raw = os.getenv("FIRESTORE_SYNC_TTL_SECONDS", "").strip()
    if raw:
        try:
            return max(5.0, float(raw))
        except ValueError:
            pass
    return 60.0


def push_firestore_doc(collection_name: str, doc_id: str, payload: dict[str, Any]) -> bool:
    """Persist or overwrite a server-owned document in Cloud Firestore cleanly."""
    db = get_firestore_client()
    if db is None:
        return False
    try:
        db.collection(collection_name).document(doc_id).set(payload, merge=False)
        return True
    except Exception:
        return False


def delete_firestore_doc(collection_name: str, doc_id: str) -> bool:
    """Delete a server-owned document from Cloud Firestore cleanly."""
    db = get_firestore_client()
    if db is None:
        return False
    try:
        db.collection(collection_name).document(doc_id).delete()
        return True
    except Exception:
        return False


def fetch_firestore_doc(collection_name: str, doc_id: str) -> dict[str, Any] | None:
    """Fetch a single document dict by ID, or None if unavailable/missing."""
    db = get_firestore_client()
    if db is None:
        return None
    try:
        snap = db.collection(collection_name).document(doc_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        data.setdefault("id", snap.id)
        return data
    except Exception:
        return None


def fetch_firestore_collection(collection_name: str) -> list[dict[str, Any]] | None:
    """Fetch all documents from a bounded server-owned Firestore collection, or None on unavailability."""
    db = get_firestore_client()
    if db is None:
        return None
    try:
        out: list[dict[str, Any]] = []
        for snap in db.collection(collection_name).stream():
            data = snap.to_dict() or {}
            data.setdefault("id", snap.id)
            out.append(data)
        return out
    except Exception:
        return None


def query_firestore_collection(
    collection_name: str,
    *,
    filters: list[tuple[str, str, Any]] | None = None,
    limit_n: int = 30,
) -> list[dict[str, Any]] | None:
    """Run a bounded filtered Firestore query via Admin SDK, returning None when unavailable."""
    db = get_firestore_client()
    if db is None:
        return None
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter

        ref: Any = db.collection(collection_name)
        for field, op, val in filters or []:
            ref = ref.where(filter=FieldFilter(field, op, val))
        bounded = max(1, min(int(limit_n), 50))
        ref = ref.limit(bounded)
        out: list[dict[str, Any]] = []
        for snap in ref.stream():
            data = snap.to_dict() or {}
            data.setdefault("id", snap.id)
            out.append(data)
        return out
    except Exception:
        return None


def add_firestore_server_doc(collection_name: str, payload: dict[str, Any]) -> str | None:
    """Create a new server-authored Firestore document with server timestamp."""
    db = get_firestore_client()
    if db is None:
        return None
    try:
        doc_payload = dict(payload)
        doc_payload.setdefault("createdAt", firebase_firestore.SERVER_TIMESTAMP)
        _, doc_ref = db.collection(collection_name).add(doc_payload)
        return str(doc_ref.id)
    except Exception:
        return None
