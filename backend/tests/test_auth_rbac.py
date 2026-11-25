"""Comprehensive Authentication and Role-Based Access Control (RBAC) security tests."""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app import ai_assistant  # noqa: E402
from app import main as main_mod  # noqa: E402
from app.auth import AuthProfileStore  # noqa: E402
from app.board_store import DisasterBoardStore  # noqa: E402
from app.data_store import QuakeLensDataStore  # noqa: E402
from app.reports_store import DamageReportStore  # noqa: E402


@pytest.fixture()
def rbac_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "rbac.db"
    a_store = AuthProfileStore(db_path=db_file)
    b_store = DisasterBoardStore(db_path=db_file)
    r_store = DamageReportStore(db_path=db_file)
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
                "building_id": "26100-bldg-2001",
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

    monkeypatch.setenv("GOV_REGISTRATION_CODE", "kyoto-secret-gov-code")
    monkeypatch.setattr(main_mod, "store", s_store)
    monkeypatch.setattr(main_mod, "board_store", b_store)
    monkeypatch.setattr(main_mod, "reports_store", r_store)
    monkeypatch.setattr(main_mod, "auth_profile_store", a_store)
    monkeypatch.setattr("app.auth.auth_profile_store", a_store)

    tokens = {
        "tok-cit-a": {"sub": "uid-cit-a", "email": "cit-a@example.com", "email_verified": True},
        "tok-cit-b": {"sub": "uid-cit-b", "email": "cit-b@example.com", "email_verified": True},
        "tok-ent": {"sub": "uid-ent", "email": "ent@example.co.jp", "email_verified": True},
        "tok-gov": {"sub": "uid-gov", "email": "gov@kyoto.lg.jp", "email_verified": True},
        "tok-unreg": {"sub": "uid-unreg", "email": "newuser@example.com", "email_verified": True},
    }

    def _fake_verify(token: str) -> dict[str, object]:
        if token in tokens:
            return dict(tokens[token])
        raise HTTPException(status_code=401, detail="invalid token")

    monkeypatch.setattr("app.auth.verify_firebase_id_token", _fake_verify)

    client = TestClient(main_mod.app)
    # Pre-register Citizen A, Citizen B, Enterprise, and Government
    assert (
        client.post(
            "/api/auth/register-profile",
            headers={"Authorization": "Bearer tok-cit-a"},
            json={"role": "citizen", "display_name": "市民A"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/auth/register-profile",
            headers={"Authorization": "Bearer tok-cit-b"},
            json={"role": "citizen", "display_name": "市民B"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/auth/register-profile",
            headers={"Authorization": "Bearer tok-ent"},
            json={
                "role": "enterprise",
                "display_name": "企業担当",
                "organization_name": "株式会社京都DC",
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/auth/register-profile",
            headers={"Authorization": "Bearer tok-gov"},
            json={
                "role": "government",
                "display_name": "行政担当",
                "organization_name": "京都市防災室",
                "gov_code": "kyoto-secret-gov-code",
            },
        ).status_code
        == 200
    )

    return client, s_store, b_store, r_store


def test_unauthenticated_blocked_everywhere_except_health_and_policy(rbac_env) -> None:
    client, _, _, _ = rbac_env
    assert client.get("/").status_code == 200
    assert client.get("/api/health").status_code == 200
    pol = client.get("/api/auth/policy")
    assert pol.status_code == 200
    assert pol.json()["gov_code_required"] is True

    for method, path in [
        ("GET", "/api/stats"),
        ("GET", "/api/buildings"),
        ("GET", "/api/tiles/buildings/14/14370/6489.pbf"),
        ("GET", "/api/reports"),
        ("GET", "/api/board"),
        ("GET", "/api/routes/navigate?mode=evacuate&start_lat=35.01&start_lon=135.76"),
        ("GET", "/api/enterprise/safe-sites"),
        ("POST", "/api/enterprise/assess-assets"),
        ("GET", "/api/exports/disaster-summary.csv"),
        ("POST", "/api/chat"),
    ]:
        r = client.post(path, json={}) if method == "POST" else client.get(path)
        assert r.status_code == 401, f"Expected 401 for unauthenticated {method} {path}, got {r.status_code}"

    # Authenticated Firebase user who has not completed profile registration cannot access protected data routes
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer tok-unreg"}).json()["registered"] is False
    assert client.get("/api/reports", headers={"Authorization": "Bearer tok-unreg"}).status_code == 403


def test_registration_gov_code_role_mismatch_and_no_privilege_escalation(
    rbac_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _, _, _ = rbac_env

    # Wrong government code rejected (403)
    bad_gov = client.post(
        "/api/auth/register-profile",
        headers={"Authorization": "Bearer tok-unreg"},
        json={
            "role": "government",
            "display_name": "偽装",
            "organization_name": "偽機関",
            "gov_code": "wrong-code",
        },
    )
    assert bad_gov.status_code == 403

    # Missing server GOV_REGISTRATION_CODE disables gov registration
    monkeypatch.delenv("GOV_REGISTRATION_CODE", raising=False)
    disabled_gov = client.post(
        "/api/auth/register-profile",
        headers={"Authorization": "Bearer tok-unreg"},
        json={
            "role": "government",
            "display_name": "行政2",
            "organization_name": "京都市",
            "gov_code": "kyoto-secret-gov-code",
        },
    )
    assert disabled_gov.status_code == 403
    monkeypatch.setenv("GOV_REGISTRATION_CODE", "kyoto-secret-gov-code")

    # Existing citizen CANNOT escalate role to government even with valid gov_code
    escalate = client.post(
        "/api/auth/register-profile",
        headers={"Authorization": "Bearer tok-cit-a"},
        json={
            "role": "government",
            "display_name": "市民A",
            "organization_name": "京都市",
            "gov_code": "kyoto-secret-gov-code",
        },
    )
    assert escalate.status_code == 403

    # Logging in with wrong role tab fails (403)
    wrong_tab = client.post(
        "/api/auth/verify-login-role",
        headers={"Authorization": "Bearer tok-cit-a"},
        json={"role": "enterprise"},
    )
    assert wrong_tab.status_code == 403

    right_tab = client.post(
        "/api/auth/verify-login-role",
        headers={"Authorization": "Bearer tok-gov"},
        json={"role": "government"},
    )
    assert right_tab.status_code == 200
    assert right_tab.json()["user"]["verified_agency"] is True


def test_reports_and_board_visibility_separation_and_redaction(rbac_env) -> None:
    client, _, _, _ = rbac_env
    h_cit_a = {"Authorization": "Bearer tok-cit-a"}
    h_cit_b = {"Authorization": "Bearer tok-cit-b"}
    h_ent = {"Authorization": "Bearer tok-ent"}
    h_gov = {"Authorization": "Bearer tok-gov"}

    # Citizen A tries forcing verification_status="official" -> server ignores & sets unverified
    r_rescue = client.post(
        "/api/reports",
        headers=h_cit_a,
        json={
            "category": "rescue_support",
            "severity": "critical",
            "title": "要救助要請: 1階に高齢者",
            "description": "住所詳細と連絡先 090-1111-9999 ですぐ救助願います。",
            "ward_name": "中京区",
            "lat": 35.0116,
            "lon": 135.7601,
            "location_consent": True,
            "reporter_alias": "佐藤個人名",
            "verification_status": "official",
        },
    )
    assert r_rescue.status_code == 200
    rescue_rep = r_rescue.json()["report"]
    assert rescue_rep["verification_status"] == "unverified"
    assert rescue_rep["is_mine"] is True

    # Citizen A submits a common public-layer report (building_damage)
    r_bldg = client.post(
        "/api/reports",
        headers=h_cit_a,
        json={
            "category": "building_damage",
            "severity": "high",
            "title": "中京区 外壁剥落の恐れ",
            "description": "東側壁面が崩落しそうで危険。投稿者携帯 080-5555-1234",
            "ward_name": "中京区",
            "lat": 35.0112,
            "lon": 135.7608,
            "location_consent": True,
            "reporter_alias": "山田花子",
        },
    )
    assert r_bldg.status_code == 200
    bldg_rep = r_bldg.json()["report"]

    # Citizen B & Enterprise: CANNOT see Citizen A's private rescue_support report,
    # CAN see building_damage but WITH description & alias redacted
    for headers in (h_cit_b, h_ent):
        res = client.get("/api/reports?include_samples=false", headers=headers)
        assert res.status_code == 200
        rows = {r["id"]: r for r in res.json()["reports"]}
        assert rescue_rep["id"] not in rows
        assert bldg_rep["id"] in rows
        pub = rows[bldg_rep["id"]]
        assert pub["details_redacted"] is True
        assert "080-5555-1234" not in pub["description"]
        assert "山田花子" not in pub["reporter_alias"]

        # Direct rescue category query does not leak Citizen A's rescue report
        res_rescue_only = client.get(
            "/api/reports?category=rescue_support&include_samples=false",
            headers=headers,
        )
        assert all(r["id"] != rescue_rep["id"] for r in res_rescue_only.json()["reports"])

    # Government sees BOTH reports UNREDACTED and can promote verification_status
    gov_res = client.get("/api/reports?include_samples=false", headers=h_gov)
    assert gov_res.status_code == 200
    gov_rows = {r["id"]: r for r in gov_res.json()["reports"]}
    assert rescue_rep["id"] in gov_rows
    assert gov_rows[rescue_rep["id"]]["details_redacted"] is False
    assert "090-1111-9999" in gov_rows[rescue_rep["id"]]["description"]
    assert gov_rows[bldg_rep["id"]]["reporter_alias"] == "山田花子"

    # Non-government cannot verify or mutate another user's report
    assert (
        client.patch(
            f"/api/reports/{bldg_rep['id']}",
            headers=h_cit_a,
            json={"verification_status": "verified"},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/reports/{bldg_rep['id']}",
            headers=h_cit_b,
            json={"resolved": True},
        ).status_code
        == 403
    )
    assert (
        client.delete(f"/api/reports/{bldg_rep['id']}", headers=h_cit_b).status_code == 403
    )

    # Government CAN verify and resolve any report
    ver = client.patch(
        f"/api/reports/{bldg_rep['id']}",
        headers=h_gov,
        json={"verification_status": "official", "resolved": True},
    )
    assert ver.status_code == 200
    assert ver.json()["report"]["verification_status"] == "official"
    assert ver.json()["report"]["resolved"] is True

    # Board entry privacy: non-gov cannot list strangers' personal board posts without phone lookup
    b_post = client.post(
        "/api/board",
        headers=h_cit_a,
        json={
            "phone": "090-9999-0001",
            "name": "田中 個人",
            "status": "minor_injury",
            "ward_name": "中京区",
            "message": "自宅で軽傷、助けが必要です。",
        },
    )
    assert b_post.status_code == 200
    entry_id = b_post.json()["entry"]["id"]

    b_cit_b = client.get("/api/board?include_samples=false", headers=h_cit_b).json()
    assert all(e["id"] != entry_id for e in b_cit_b["entries"])
    b_cit_b_phone = client.get(
        "/api/board?phone=09099990001&include_samples=false", headers=h_cit_b
    ).json()
    assert any(e["id"] == entry_id for e in b_cit_b_phone["entries"])
    b_gov = client.get("/api/board?include_samples=false", headers=h_gov).json()
    assert any(e["id"] == entry_id for e in b_gov["entries"])


def test_routing_enterprise_exports_and_ai_tool_rbac(rbac_env) -> None:
    client, s_store, _, r_store = rbac_env
    h_cit_a = {"Authorization": "Bearer tok-cit-a"}
    h_cit_b = {"Authorization": "Bearer tok-cit-b"}
    h_ent = {"Authorization": "Bearer tok-ent"}
    h_gov = {"Authorization": "Bearer tok-gov"}

    # Citizen A posts a private rescue report + common road_blocked report
    rep_rescue = client.post(
        "/api/reports",
        headers=h_cit_a,
        json={
            "category": "rescue_support",
            "severity": "high",
            "title": "救助テスト",
            "description": "非公開救助",
            "ward_name": "中京区",
            "lat": 35.011,
            "lon": 135.760,
            "location_consent": True,
        },
    ).json()["report"]
    client.post(
        "/api/reports",
        headers=h_cit_a,
        json={
            "category": "road_blocked",
            "severity": "high",
            "title": "通行止めテスト",
            "description": "路線閉鎖",
            "ward_name": "中京区",
            "lat": 35.0115,
            "lon": 135.7602,
            "location_consent": True,
        },
    )

    # Routing RBAC
    assert (
        client.get(
            "/api/routes/navigate?mode=evacuate&start_lat=35.01&start_lon=135.76",
            headers=h_cit_b,
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/routes/navigate?mode=rescue&target_lat=35.01&target_lon=135.76",
            headers=h_cit_b,
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/api/routes/navigate?mode=custom&origin_id=takeda_st&destination_id=chushojima",
            headers=h_cit_b,
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/api/routes/simulate?origin_id=takeda_st&destination_id=chushojima",
            headers=h_cit_b,
        ).status_code
        == 403
    )
    # Stranger cannot target another user's private rescue report even via navigate
    assert (
        client.get(
            f"/api/routes/navigate?mode=evacuate&start_lat=35.01&start_lon=135.76&target_report_id={rep_rescue['id']}",
            headers=h_cit_b,
        ).status_code
        == 403
    )

    assert (
        client.get(
            "/api/routes/navigate?mode=custom&origin_id=takeda_st&destination_id=chushojima",
            headers=h_ent,
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/routes/navigate?mode=rescue&target_lat=35.01&target_lon=135.76",
            headers=h_ent,
        ).status_code
        == 403
    )
    assert (
        client.get(
            f"/api/routes/navigate?mode=rescue&target_report_id={rep_rescue['id']}",
            headers=h_gov,
        ).status_code
        == 200
    )

    # Enterprise BCP & in-memory asset assessment strictly restricted to Enterprise
    assert client.get("/api/enterprise/safe-sites", headers=h_cit_a).status_code == 403
    assert client.get("/api/enterprise/safe-sites", headers=h_gov).status_code == 403
    assert client.get("/api/enterprise/safe-sites", headers=h_ent).status_code == 200

    assess_payload = {
        "assets": [{"id": "asset-1", "asset_type": "server_room", "lat": 35.0116, "lon": 135.7601}]
    }
    assert (
        client.post("/api/enterprise/assess-assets", headers=h_cit_a, json=assess_payload).status_code
        == 403
    )
    assert (
        client.post("/api/enterprise/assess-assets", headers=h_gov, json=assess_payload).status_code
        == 403
    )
    r_assess = client.post("/api/enterprise/assess-assets", headers=h_ent, json=assess_payload)
    assert r_assess.status_code == 200
    assert r_assess.json()["assessments"][0]["nearby_road_closures_600m"] >= 1

    # Exports RBAC
    assert client.get("/api/exports/disaster-summary.csv?scope=wards", headers=h_cit_a).status_code == 403
    assert client.get("/api/exports/disaster-summary.xlsx", headers=h_cit_a).status_code == 403
    assert client.get("/api/exports/disaster-summary.csv?scope=reports", headers=h_ent).status_code == 403
    assert client.get("/api/exports/disaster-summary.xlsx", headers=h_ent).status_code == 403
    assert client.get("/api/exports/disaster-summary.csv?scope=wards", headers=h_ent).status_code == 200
    assert client.get("/api/exports/disaster-summary.csv?scope=reports", headers=h_gov).status_code == 200
    assert client.get("/api/exports/disaster-summary.xlsx", headers=h_gov).status_code == 200

    # AI Tool RBAC
    cit_bcp = ai_assistant._execute_tool(
        s_store,
        "recommend_enterprise_bcp_sites",
        {},
        reports_store=r_store,
        user_role="citizen",
        user_uid="uid-cit-b",
    )
    assert "error" in cit_bcp
    cit_export = ai_assistant._execute_tool(
        s_store,
        "prepare_disaster_export",
        {},
        reports_store=r_store,
        user_role="citizen",
        user_uid="uid-cit-b",
    )
    assert "error" in cit_export
    cit_rep_sum = ai_assistant._execute_tool(
        s_store,
        "get_damage_reports_summary",
        {"include_samples": False},
        reports_store=r_store,
        user_role="citizen",
        user_uid="uid-cit-b",
    )
    assert all(r["id"] != rep_rescue["id"] for r in cit_rep_sum["reports"])
    assert "privacy_note" in ai_assistant._execute_tool(
        s_store,
        "get_disaster_board_summary",
        {},
        user_role="citizen",
        user_uid="uid-cit-b",
    )
