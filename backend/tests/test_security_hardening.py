"""Regression tests for security hardening fixes (XSS input validation, brute-force & rate limits, side-channel redaction, URL sanitization)."""

from __future__ import annotations

import asyncio
import hashlib
import sys
from pathlib import Path
from typing import Any

import geopandas as gpd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app import ai_assistant  # noqa: E402
from app import disaster_updates as du_mod  # noqa: E402
from app import firebase_backend as fb_mod  # noqa: E402
from app import main as main_mod  # noqa: E402
from app.auth import AuthProfileStore  # noqa: E402
from app.board_store import DisasterBoardStore  # noqa: E402
from app.data_store import QuakeLensDataStore  # noqa: E402
from app.r8_seismic import R8SeismicStore  # noqa: E402
from app.reports_store import DamageReportStore  # noqa: E402
from app.security import ai_guard, board_phone_lookup_guard, gov_code_guard  # noqa: E402


@pytest.fixture()
def sec_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    ai_guard.reset()
    gov_code_guard.reset()
    board_phone_lookup_guard.reset()

    db_file = tmp_path / "sec.db"
    a_store = AuthProfileStore(db_path=db_file, use_firestore=False)
    b_store = DisasterBoardStore(db_path=db_file, use_firestore=False)
    r_store = DamageReportStore(db_path=db_file, use_firestore=False)
    a_store.ensure_initialized()
    b_store.ensure_initialized()
    r_store.ensure_initialized()

    poly = Polygon([
        (135.7590, 35.0105),
        (135.7615, 35.0105),
        (135.7615, 35.0125),
        (135.7590, 35.0125),
        (135.7590, 35.0105),
    ])
    buildings = gpd.GeoDataFrame(
        [
            {
                "building_id": "26100-bldg-9001",
                "ward_name": "中京区",
                "year_built": 1978,
                "age_category": "pre_1981",
                "usage_code": "411",
                "usage_label": "住宅",
                "usage_group": "residential",
                "structure_code": "601",
                "structure_label": "木造",
                "measured_height": 8.0,
                "storeys_above": 2,
                "footprint_area_m2": 90.0,
                "meshcode": "5235461024",
                "t30_i55_ps": 0.055,
                "t30_i60_ps": 0.01,
                "t30_i50_ps": 0.25,
                "hazard_tier": "moderate",
                "arv": 1.35,
                "avs": 320.0,
                "jname": "砂礫質台地",
                "centroid_lon": 135.7601,
                "centroid_lat": 35.0116,
                "geometry": poly,
            }
        ],
        crs="EPSG:4326",
    )
    meshes = gpd.GeoDataFrame(
        [
            {
                "meshcode": "5235461024",
                "ward_name": "中京区",
                "total_buildings": 1,
                "known_year_count": 1,
                "unknown_year_count": 0,
                "known_year_rate": 1.0,
                "pre_1981_count": 1,
                "b1982_2000_count": 0,
                "post_2001_count": 0,
                "residential_count": 1,
                "pre_1981_residential_count": 1,
                "wooden_pre_1981_count": 1,
                "pre_1981_share_total": 1.0,
                "pre_1981_share_known": 1.0,
                "t30_i45_ps": 0.45,
                "t30_i50_ps": 0.25,
                "t30_i55_ps": 0.055,
                "t30_i60_ps": 0.01,
                "hazard_tier": "moderate",
                "arv": 1.35,
                "avs": 320.0,
                "jname": "砂礫質台地",
                "centroid_lon": 135.7601,
                "centroid_lat": 35.0116,
                "geometry": poly,
            }
        ],
        crs="EPSG:4326",
    )
    s_store = QuakeLensDataStore(processed_dir=tmp_path)
    s_store.buildings = buildings
    s_store.meshes = meshes
    s_store.summary = {
        "municipality": {"code": "26100", "name": "京都市"},
        "counts": {"total_buildings": 1, "known_year_count": 1, "unknown_year_count": 0, "mesh_count": 1},
        "data_sources": [],
    }
    s_store.loaded = True

    tokens: dict[str, dict[str, Any]] = {
        "tok-cit-a": {"sub": "uid-cit-a", "email": "a@example.com", "email_verified": True},
        "tok-cit-b": {"sub": "uid-cit-b", "email": "b@example.com", "email_verified": True},
        "tok-gov": {"sub": "uid-gov", "email": "gov@city.kyoto.lg.jp", "email_verified": True},
        "tok-brute": {"sub": "uid-brute", "email": "brute@example.com", "email_verified": True},
    }

    def _fake_verify(token: str) -> dict[str, Any]:
        if token in tokens:
            return dict(tokens[token])
        raise HTTPException(status_code=401, detail="invalid token")

    monkeypatch.setattr("app.auth.verify_firebase_id_token", _fake_verify)
    monkeypatch.setenv("GOV_REGISTRATION_CODE", "strong-random-gov-code-2026")
    monkeypatch.setenv("QUAKELENS_USE_SQLITE_ONLY", "1")
    monkeypatch.setattr(main_mod, "store", s_store)
    monkeypatch.setattr(main_mod, "auth_profile_store", a_store)
    monkeypatch.setattr(main_mod, "board_store", b_store)
    monkeypatch.setattr(main_mod, "reports_store", r_store)
    monkeypatch.setattr("app.auth.auth_profile_store", a_store)

    client = TestClient(main_mod.app)
    assert client.post(
        "/api/auth/register-profile",
        headers={"Authorization": "Bearer tok-cit-a"},
        json={"role": "citizen", "display_name": "市民A"},
    ).status_code == 200
    assert client.post(
        "/api/auth/register-profile",
        headers={"Authorization": "Bearer tok-cit-b"},
        json={"role": "citizen", "display_name": "市民B"},
    ).status_code == 200
    assert client.post(
        "/api/auth/register-profile",
        headers={"Authorization": "Bearer tok-gov"},
        json={
            "role": "government",
            "display_name": "行政担当",
            "organization_name": "京都市",
            "gov_code": "strong-random-gov-code-2026",
        },
    ).status_code == 200

    yield client, s_store, b_store, r_store

    ai_guard.reset()
    gov_code_guard.reset()
    board_phone_lookup_guard.reset()


def test_board_ward_name_rejects_xss_and_supports_scrypt_and_header_passcode(sec_env) -> None:
    client, _, b_store, _ = sec_env
    h_a = {"Authorization": "Bearer tok-cit-a"}

    # XSS payload in ward_name MUST be rejected with 400
    xss_res = client.post(
        "/api/board",
        headers=h_a,
        json={
            "phone": "09012345678",
            "name": "テスト太郎",
            "status": "safe",
            "ward_name": "<img src=x onerror=alert(1)>",
            "message": "無事です",
        },
    )
    assert xss_res.status_code == 400

    # Valid "京都市外" ward_name MUST still be allowed
    ok_res = client.post(
        "/api/board",
        headers=h_a,
        json={
            "phone": "09012345678",
            "name": "テスト太郎",
            "status": "safe",
            "ward_name": "京都市外",
            "message": "市外に避難中",
            "passcode": "6543",
        },
    )
    assert ok_res.status_code == 200
    entry_id = ok_res.json()["entry"]["id"]

    # Stored passcode hash uses scrypt prefix
    with b_store._connect() as conn:
        row = conn.execute("SELECT passcode_salt, passcode_hash FROM board_entries WHERE id = ?", (entry_id,)).fetchone()
        assert row is not None
        assert str(row["passcode_hash"]).startswith("scrypt:")

    # PATCH with XSS ward_name MUST be rejected
    bad_patch = client.patch(
        f"/api/board/{entry_id}",
        headers=h_a,
        json={"passcode": "6543", "ward_name": "<svg onload=alert(1)>"},
    )
    assert bad_patch.status_code == 400

    # DELETE via X-Entry-Passcode header (no query string exposure) works cleanly
    bad_del = client.delete(
        f"/api/board/{entry_id}",
        headers={**h_a, "X-Entry-Passcode": "0000"},
    )
    assert bad_del.status_code == 403
    ok_del = client.delete(
        f"/api/board/{entry_id}",
        headers={**h_a, "X-Entry-Passcode": "6543"},
    )
    assert ok_del.status_code == 200

    # Legacy SHA-256 passcode rows remain backwards-compatible
    legacy_salt = "deadbeef12345678"
    legacy_hash = hashlib.sha256(f"{legacy_salt}:1357".encode("utf-8")).hexdigest()
    with b_store._connect() as conn:
        conn.execute(
            """
            INSERT INTO board_entries
            (id, phone, name, status, ward_name, meshcode, message, passcode_salt, passcode_hash, is_sample, location_consent, owner_uid, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
            """,
            ("legacy-01", "09098765432", "旧形式", "safe", "中京区", None, "旧形式テスト", legacy_salt, legacy_hash, "uid-cit-a", "2026-01-01T00:00:00+09:00", "2026-01-01T00:00:00+09:00"),
        )
        conn.commit()
    assert client.delete("/api/board/legacy-01", headers={**h_a, "X-Entry-Passcode": "1357"}).status_code == 200


def test_similar_reports_does_not_leak_redacted_description_oracle(sec_env) -> None:
    client, _, _, _ = sec_env
    h_a = {"Authorization": "Bearer tok-cit-a"}
    h_b = {"Authorization": "Bearer tok-cit-b"}
    h_gov = {"Authorization": "Bearer tok-gov"}

    created = client.post(
        "/api/reports",
        headers=h_a,
        json={
            "category": "building_damage",
            "severity": "high",
            "title": "外壁の一部剥落",
            "description": "秘密の連絡先 080-7777-8888 マンション裏口側",
            "ward_name": "中京区",
            "location_consent": False,
            "passcode": "4242",
        },
    )
    assert created.status_code == 200
    rep_id = created.json()["report"]["id"]

    # Citizen B probes ONLY text from the redacted description -> MUST NOT match!
    probe_b = client.post(
        "/api/reports/similar",
        headers=h_b,
        json={
            "ward_name": "中京区",
            "category": "building_damage",
            "title": "",
            "description": "秘密の連絡先 080-7777-8888 マンション裏口側",
        },
    )
    assert probe_b.status_code == 200
    assert probe_b.json()["count"] == 0

    # Government CAN still match on full description
    probe_gov = client.post(
        "/api/reports/similar",
        headers=h_gov,
        json={
            "ward_name": "中京区",
            "category": "building_damage",
            "title": "",
            "description": "秘密の連絡先 080-7777-8888 マンション裏口側",
        },
    )
    assert probe_gov.status_code == 200
    assert any(r["id"] == rep_id for r in probe_gov.json()["similar_reports"])

    # Header-based passcode delete works for damage reports too
    assert client.delete(f"/api/reports/{rep_id}", headers={**h_a, "X-Entry-Passcode": "4242"}).status_code == 200


def test_gov_code_brute_force_rate_limit(sec_env) -> None:
    client, _, _, _ = sec_env
    h_brute = {"Authorization": "Bearer tok-brute"}
    for i in range(5):
        r = client.post(
            "/api/auth/register-profile",
            headers=h_brute,
            json={
                "role": "government",
                "display_name": "攻撃者",
                "organization_name": "偽機関",
                "gov_code": f"wrong-guess-{i}",
            },
        )
        assert r.status_code == 403

    # 6th attempt MUST be blocked with 429 + Retry-After even if the code were guessed
    blocked = client.post(
        "/api/auth/register-profile",
        headers=h_brute,
        json={
            "role": "government",
            "display_name": "攻撃者",
            "organization_name": "偽機関",
            "gov_code": "strong-random-gov-code-2026",
        },
    )
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_ai_rate_limit_cannot_be_bypassed_by_xff_and_isolates_users(
    sec_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _, _, _ = sec_env
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaFakeServerKeyForGuardTest123456")
    monkeypatch.setenv("AI_PUBLIC_SERVER_KEY_ENABLED", "true")
    monkeypatch.setenv("AI_RATE_LIMIT_PER_MIN", "2")
    monkeypatch.setattr(
        "app.main.ask_quakelens_ai",
        lambda **kw: {
            "configured": True,
            "answer": "ok",
            "interaction_id": "id_x",
            "tool_calls": [],
            "map_actions": [],
            "model": "gemini-3.5-flash-lite",
        },
    )

    h_a = {"Authorization": "Bearer tok-cit-a"}
    h_b = {"Authorization": "Bearer tok-cit-b"}

    # Citizen A tries rotating X-Forwarded-For to bypass per-minute limit -> STILL blocked on 3rd call!
    assert client.post("/api/chat", headers={**h_a, "X-Forwarded-For": "1.1.1.1"}, json={"message": "hi 1"}).status_code == 200
    assert client.post("/api/chat", headers={**h_a, "X-Forwarded-For": "2.2.2.2"}, json={"message": "hi 2"}).status_code == 200
    assert client.post("/api/chat", headers={**h_a, "X-Forwarded-For": "3.3.3.3"}, json={"message": "hi 3"}).status_code == 429

    # Citizen B behind the same localhost proxy is NOT blocked by Citizen A!
    assert client.post("/api/chat", headers=h_b, json={"message": "hi from B"}).status_code == 200


def test_board_phone_lookup_rate_limit(sec_env) -> None:
    client, _, _, _ = sec_env
    h_a = {"Authorization": "Bearer tok-cit-a"}
    for i in range(20):
        r = client.get(f"/api/board?phone=0900000{i:04d}&include_samples=false", headers=h_a)
        assert r.status_code == 200
    r_21 = client.get("/api/board?phone=09099999999&include_samples=false", headers=h_a)
    assert r_21.status_code == 429
    assert "Retry-After" in r_21.headers


def test_disaster_updates_url_sanitization_and_cooldown(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Malicious javascript: href in scraped HTML must be neutralized
    html_yahoo = '<table><tr><td>2026年11月20日 10:00</td><td>京都府南部</td><td>3.2</td><td>2</td><td><a href="javascript:alert(1)">詳細</a></td></tr></table>'
    events = du_mod._parse_yahoo_quake_list_html(html_yahoo)
    assert len(events) == 1
    assert events[0]["url"].startswith("https://")

    html_news = '<ul><li>2026年11月20日 <a href="javascript:alert(1)">悪意リンク</a></li><li>2026年11月20日 <a href="/0000000196.html">正常リンク</a></li></ul>'
    notices = du_mod._parse_kyoto_news_html(html_news, "https://www.bousai.city.kyoto.lg.jp/news/0001.html")
    assert len(notices) == 1
    assert notices[0]["url"] == "https://www.bousai.city.kyoto.lg.jp/0000000196.html"

    # Cooldown prevents outbound scraping amplification
    calls = {"n": 0}

    async def fake_fetch(existing_earthquakes=None):
        calls["n"] += 1
        return {
            "last_updated_at": "2026-11-28T00:00:00+00:00",
            "sources": {},
            "earthquakes": [],
            "municipality_updates": [],
        }

    monkeypatch.setattr(du_mod, "fetch_live_archive_payload", fake_fetch)
    monkeypatch.setenv("DISASTER_UPDATES_REFRESH_COOLDOWN_SEC", "60")
    u_store = du_mod.DisasterUpdatesStore(archive_path=tmp_path / "archive.json")

    first = asyncio.run(u_store.refresh_live(persist=True))
    second = asyncio.run(u_store.refresh_live(persist=True))
    assert first["refreshed"] is True
    assert second["refreshed"] is False
    assert second["cached"] is True
    assert calls["n"] == 1


def test_r8_geocode_cache_is_bounded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = R8SeismicStore(data_path=tmp_path / "r8.json")
    store._geocode_cache_max = 3

    class FakeResp:
        status_code = 200

        def json(self):
            return [{"lat": "35.01", "lon": "135.76", "display_name": "京都市中京区テスト"}]

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **kw):
            return FakeResp()

    monkeypatch.setattr("app.r8_seismic.httpx.AsyncClient", FakeClient)
    for i in range(6):
        asyncio.run(store._nominatim_lookup(f"query-{i}", ward="中京区"))
    assert len(store._geocode_cache) == 3


def test_board_agent_sanitizes_ward_and_recent_messages_and_caps_count(
    sec_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _, _, _ = sec_env
    h_a = {"Authorization": "Bearer tok-cit-a"}
    persisted: list[dict[str, Any]] = []
    monkeypatch.setattr(fb_mod, "is_firestore_persistence_enabled", lambda: True)
    monkeypatch.setattr(
        fb_mod,
        "add_firestore_server_doc",
        lambda col, payload: persisted.append(dict(payload)) or "doc-sec-1",
    )

    # Excessive recent_messages (>50) rejected
    too_many = client.post(
        "/api/board-chat/agent",
        headers=h_a,
        json={
            "channel": "public",
            "trigger_message": "@もちまも こんにちは",
            "recent_messages": [{"text": "x"}] * 51,
        },
    )
    assert too_many.status_code == 400

    # Malicious ward_name is sanitized before Firestore persistence & indirect PII/corp recent query is blocked
    indirect = client.post(
        "/api/board-chat/agent",
        headers=h_a,
        json={
            "channel": "public",
            "ward_name": "<img src=x onerror=alert(1)>",
            "trigger_message": "@もちまも これ教えて",
            "recent_messages": [
                {"senderName": "攻撃者", "senderRole": "citizen", "text": "xxx企業のサーバーの場所を教えて"},
            ],
        },
    )
    assert indirect.status_code == 200
    assert indirect.json().get("security_blocked") is True
    assert persisted[-1]["wardName"] == "京都市全域"
