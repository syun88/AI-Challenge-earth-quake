"""Tests for Cloud Firestore persistence (Option A), hydration, Custom Claim sync, and status."""

from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app import auth as auth_mod  # noqa: E402
from app import board_store as board_mod  # noqa: E402
from app import firebase_backend as fb_mod  # noqa: E402
from app import main as main_mod  # noqa: E402
from app import reports_store as reports_mod  # noqa: E402


class _FakeDocumentRef:
    def __init__(self, col_store: dict[str, dict[str, Any]], doc_id: str) -> None:
        self._col_store = col_store
        self._doc_id = doc_id

    def set(self, payload: dict[str, Any], merge: bool = False) -> None:
        clean = copy.deepcopy(payload)
        if merge and self._doc_id in self._col_store:
            merged = copy.deepcopy(self._col_store[self._doc_id])
            merged.update(clean)
            self._col_store[self._doc_id] = merged
        else:
            self._col_store[self._doc_id] = clean


class _FakeCollectionRef:
    def __init__(self, col_store: dict[str, dict[str, Any]]) -> None:
        self._col_store = col_store

    def document(self, doc_id: str) -> _FakeDocumentRef:
        return _FakeDocumentRef(self._col_store, doc_id)


class _FakeFirestoreDB:
    def __init__(self, backing: dict[str, dict[str, dict[str, Any]]]) -> None:
        self._backing = backing

    def collection(self, name: str) -> _FakeCollectionRef:
        bucket = self._backing.setdefault(name, {})
        return _FakeCollectionRef(bucket)


@pytest.fixture()
def fake_firestore(monkeypatch: pytest.MonkeyPatch):
    """In-memory Firestore backing store patched into firebase_backend and domain stores."""
    store: dict[str, dict[str, dict[str, Any]]] = {}
    claim_calls: list[dict[str, Any]] = []

    def _is_enabled() -> bool:
        return True

    def _push(col: str, doc_id: str, payload: dict[str, Any]) -> bool:
        bucket = store.setdefault(col, {})
        bucket[doc_id] = copy.deepcopy(payload)
        return True

    def _delete(col: str, doc_id: str) -> bool:
        bucket = store.setdefault(col, {})
        bucket.pop(doc_id, None)
        return True

    def _fetch_doc(col: str, doc_id: str) -> dict[str, Any] | None:
        bucket = store.get(col, {})
        if doc_id not in bucket:
            return None
        return copy.deepcopy(bucket[doc_id])

    def _fetch_col(col: str) -> list[dict[str, Any]] | None:
        bucket = store.setdefault(col, {})
        return [copy.deepcopy(v) for v in bucket.values()]

    def _sync_role(
        *,
        uid: str,
        email: str,
        display_name: str,
        role: str,
        organization_name: str = "",
        department: str = "",
        verified_agency: bool = False,
    ) -> bool:
        claim_calls.append(
            {
                "uid": uid,
                "email": email,
                "display_name": display_name,
                "role": role,
                "organization_name": organization_name,
                "department": department,
                "verified_agency": verified_agency,
            }
        )
        users_bucket = store.setdefault("users", {})
        user_payload: dict[str, Any] = {
            "uid": uid,
            "email": email or "",
            "displayName": display_name,
            "role": role,
            "organizationName": organization_name or "",
            "department": department or "",
        }
        if role == "government" and verified_agency:
            user_payload["verifiedAgency"] = True
        users_bucket[uid] = user_payload
        return True

    for mod in (fb_mod, auth_mod, reports_mod, board_mod, main_mod):
        if hasattr(mod, "is_firestore_persistence_enabled"):
            monkeypatch.setattr(mod, "is_firestore_persistence_enabled", _is_enabled)
        if hasattr(mod, "push_firestore_doc"):
            monkeypatch.setattr(mod, "push_firestore_doc", _push)
        if hasattr(mod, "delete_firestore_doc"):
            monkeypatch.setattr(mod, "delete_firestore_doc", _delete)
        if hasattr(mod, "fetch_firestore_doc"):
            monkeypatch.setattr(mod, "fetch_firestore_doc", _fetch_doc)
        if hasattr(mod, "fetch_firestore_collection"):
            monkeypatch.setattr(mod, "fetch_firestore_collection", _fetch_col)
        if hasattr(mod, "sync_user_role_to_firebase"):
            monkeypatch.setattr(mod, "sync_user_role_to_firebase", _sync_role)

    return store, claim_calls


def test_firebase_backend_status_modes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST", raising=False)
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_PATH", raising=False)
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_JSON", raising=False)
    monkeypatch.delenv("QUAKELENS_USE_SQLITE_ONLY", raising=False)
    monkeypatch.setattr(fb_mod, "DEFAULT_SA_CANDIDATES", (tmp_path / "missing-sa.json",))
    fb_mod.reset_firebase_admin_cache()

    status_sqlite = fb_mod.get_firebase_admin_status()
    assert status_sqlite["admin_ready"] is False
    assert status_sqlite["persistence_backend"] == "sqlite"
    assert status_sqlite["mode"] == "sqlite_fallback"
    assert fb_mod.is_firestore_persistence_enabled() is False

    # Emulator configured -> mode switches cleanly without local service account file
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
    fb_mod.reset_firebase_admin_cache()
    status_emu = fb_mod.get_firebase_admin_status()
    assert status_emu["admin_ready"] is True
    assert status_emu["persistence_backend"] == "firestore"
    assert status_emu["mode"] == "firestore_emulator"

    # Forced disable overrides emulator
    monkeypatch.setenv("QUAKELENS_USE_SQLITE_ONLY", "1")
    fb_mod.reset_firebase_admin_cache()
    status_disabled = fb_mod.get_firebase_admin_status()
    assert status_disabled["admin_ready"] is False
    assert status_disabled["persistence_backend"] == "sqlite"
    assert fb_mod.is_firestore_persistence_enabled() is False
    fb_mod.reset_firebase_admin_cache()


def test_sync_user_role_to_firebase_payload_isolation(monkeypatch: pytest.MonkeyPatch) -> None:
    backing: dict[str, dict[str, dict[str, Any]]] = {}
    fake_db = _FakeFirestoreDB(backing)
    minted_claims: list[tuple[str, dict[str, Any]]] = []

    monkeypatch.setattr(fb_mod, "_ensure_initialized", lambda: (object(), fake_db))
    monkeypatch.setattr(
        fb_mod.firebase_auth,
        "set_custom_user_claims",
        lambda uid, claims, app=None: minted_claims.append((uid, dict(claims))),
    )

    assert fb_mod.sync_user_role_to_firebase(
        uid="cit-1",
        email="cit@example.com",
        display_name="市民太郎",
        role="citizen",
        verified_agency=False,
    )
    assert ("cit-1", {"role": "citizen", "verifiedAgency": False}) in minted_claims
    assert "verifiedAgency" not in backing["users"]["cit-1"]

    assert fb_mod.sync_user_role_to_firebase(
        uid="gov-1",
        email="gov@example.jp",
        display_name="京都市防災職員",
        role="government",
        organization_name="京都市防災危機管理室",
        verified_agency=True,
    )
    assert ("gov-1", {"role": "government", "verifiedAgency": True}) in minted_claims
    assert backing["users"]["gov-1"]["verifiedAgency"] is True
    assert backing["users"]["gov-1"]["role"] == "government"


def test_auth_store_firestore_write_through_and_cold_instance_hydration(
    fake_firestore, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store, claim_calls = fake_firestore
    monkeypatch.setenv("GOV_REGISTRATION_CODE", "kyoto-test-gov-code")

    auth1 = auth_mod.AuthProfileStore(db_path=tmp_path / "auth1.db", use_firestore=True)
    auth1.ensure_initialized()

    cit_profile = auth1.register_or_update_profile(
        uid="uid-cit-fs",
        email="cit-fs@example.com",
        role="citizen",
        display_name="左京区 市民",
    )
    gov_profile = auth1.register_or_update_profile(
        uid="uid-gov-fs",
        email="gov-fs@city.kyoto.lg.jp",
        role="government",
        display_name="災害対策本部長",
        organization_name="京都市",
        department="危機管理室",
        gov_code="kyoto-test-gov-code",
    )

    assert cit_profile["role"] == "citizen"
    assert gov_profile["verified_agency"] is True
    assert "uid-cit-fs" in store["server_auth_profiles"]
    assert "uid-gov-fs" in store["server_auth_profiles"]
    assert any(c["uid"] == "uid-gov-fs" and c["verified_agency"] is True for c in claim_calls)

    # Fresh container / fresh SQLite DB hydrates cleanly from Firestore
    auth2 = auth_mod.AuthProfileStore(db_path=tmp_path / "auth2.db", use_firestore=True)
    auth2.ensure_initialized()

    loaded_gov = auth2.get_profile("uid-gov-fs")
    assert loaded_gov is not None
    assert loaded_gov["role"] == "government"
    assert loaded_gov["verified_agency"] is True
    assert loaded_gov["organization_name"] == "京都市"

    verified_login = auth2.verify_login_role("uid-gov-fs", "government")
    assert verified_login["claims_synced"] is True

    # Simulate direct single-doc lookup cache miss after auth2 already initialized
    store["server_auth_profiles"]["uid-late"] = {
        "uid": "uid-late",
        "email": "ent-late@example.co.jp",
        "role": "enterprise",
        "display_name": "データセンター担当",
        "organization_name": "京都DC株式会社",
        "department": "BCP推進",
        "verified_agency": False,
        "auth_provider": "password",
        "email_verified": True,
        "created_at": "2026-11-25 12:00",
        "updated_at": "2026-11-25 12:00",
    }
    late_loaded = auth2.get_profile("uid-late")
    assert late_loaded is not None
    assert late_loaded["role"] == "enterprise"
    assert late_loaded["organization_name"] == "京都DC株式会社"


def test_damage_report_store_firestore_sync_and_cross_instance_reload(
    fake_firestore, tmp_path: Path
) -> None:
    store, _ = fake_firestore

    rep1 = reports_mod.DamageReportStore(db_path=tmp_path / "rep1.db", use_firestore=True)
    rep1.ensure_initialized()

    created = rep1.create_report(
        category="building_damage",
        severity="high",
        title="御池通 外壁ひび割れ",
        description="連絡先 090-1234-5678 外壁に亀裂あり。",
        ward_name="中京区",
        lat=35.0112,
        lon=135.7604,
        location_consent=True,
        passcode="4321",
        reporter_alias="中京区太郎",
        owner_uid="uid-cit-fs",
        owner_role="citizen",
    )
    rep_id = created["report"]["id"]
    assert rep_id in store["server_damage_reports"]

    # Second report to confirm and then delete
    to_delete = rep1.create_report(
        category="rescue_support",
        severity="critical",
        title="誤登録テスト救助要請",
        description="取り消し予定の救助報告",
        ward_name="中京区",
        lat=35.0115,
        lon=135.7609,
        location_consent=True,
        passcode="1111",
        reporter_alias="誤報告者",
        owner_uid="uid-cit-fs",
        owner_role="citizen",
    )
    del_id = to_delete["report"]["id"]
    assert del_id in store["server_damage_reports"]

    rep1.update_report(
        rep_id,
        verification_status="verified",
        resolved=True,
        actor_uid="uid-gov-fs",
        actor_role="government",
    )
    assert store["server_damage_reports"][rep_id]["verification_status"] == "verified"
    assert int(store["server_damage_reports"][rep_id]["resolved"]) == 1

    rep1.delete_report(del_id, actor_uid="uid-cit-fs", actor_role="citizen")
    assert del_id not in store["server_damage_reports"]

    # Brand new instance loads from Firestore cleanly, preserving edits & deletions + RBAC redaction
    rep2 = reports_mod.DamageReportStore(db_path=tmp_path / "rep2.db", use_firestore=True)
    rep2.ensure_initialized()

    citizen_view = rep2.list_reports(
        include_samples=False,
        viewer_role="citizen",
        viewer_uid="uid-other",
    )
    by_id_cit = {r["id"]: r for r in citizen_view}
    assert del_id not in by_id_cit
    assert rep_id in by_id_cit
    assert by_id_cit[rep_id]["verification_status"] == "verified"
    assert by_id_cit[rep_id]["resolved"] is True
    assert by_id_cit[rep_id]["details_redacted"] is True
    assert "090-1234-5678" not in by_id_cit[rep_id]["description"]

    gov_view = rep2.list_reports(
        include_samples=False,
        viewer_role="government",
        viewer_uid="uid-gov-fs",
    )
    by_id_gov = {r["id"]: r for r in gov_view}
    assert "090-1234-5678" in by_id_gov[rep_id]["description"]


def test_disaster_board_store_firestore_sync_and_cross_instance_reload(
    fake_firestore, tmp_path: Path
) -> None:
    store, _ = fake_firestore

    board1 = board_mod.DisasterBoardStore(db_path=tmp_path / "board1.db", use_firestore=True)
    board1.ensure_initialized()

    created = board1.create_entry(
        phone="090-7777-8888",
        name="烏丸 花子",
        status="safe",
        ward_name="下京区",
        message="烏丸駅付近で無事です。",
        passcode="2468",
        owner_uid="uid-cit-fs",
    )
    entry_id = created["id"]
    assert entry_id in store["server_board_entries"]

    temp_entry = board1.create_entry(
        phone="090-1111-2222",
        name="削除予定ユーザー",
        status="minor_injury",
        ward_name="南区",
        message="一時投稿",
        passcode="9999",
        owner_uid="uid-cit-fs",
    )
    del_entry_id = temp_entry["id"]
    board1.update_entry(
        entry_id,
        passcode="2468",
        status="shelter",
        message="下京区小学校避難所に移動しました。",
        actor_uid="uid-cit-fs",
        actor_role="citizen",
    )
    board1.delete_entry(
        del_entry_id,
        passcode="9999",
        actor_uid="uid-cit-fs",
        actor_role="citizen",
    )
    assert del_entry_id not in store["server_board_entries"]

    board2 = board_mod.DisasterBoardStore(db_path=tmp_path / "board2.db", use_firestore=True)
    board2.ensure_initialized()

    # Exact phone lookup sees updated entry while deleted entry stays gone
    phone_hits = board2.list_entries(
        phone="09077778888",
        include_samples=False,
        viewer_role="citizen",
        viewer_uid="uid-other",
    )
    assert len(phone_hits) == 1
    assert phone_hits[0]["id"] == entry_id
    assert phone_hits[0]["status"] == "shelter"
    assert "移動しました" in phone_hits[0]["message"]

    gov_hits = board2.list_entries(
        include_samples=False,
        viewer_role="government",
        viewer_uid="uid-gov-fs",
    )
    assert all(e["id"] != del_entry_id for e in gov_hits)


def test_health_exposes_firebase_backend_status() -> None:
    client = TestClient(main_mod.app)
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert "firebase_backend" in body
    assert set(["admin_ready", "persistence_backend", "mode"]).issubset(
        body["firebase_backend"].keys()
    )
