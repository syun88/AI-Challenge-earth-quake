"""Integration and unit tests for Disaster Message Board upgrades, Damage Reporting, Exports, AI aggregation, and Route Simulation."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import geopandas as gpd
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from shapely.geometry import Polygon

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app import main as main_mod  # noqa: E402
from app.ai_assistant import ask_quakelens_ai  # noqa: E402
from app.auth import AuthProfileStore  # noqa: E402
from app.board_store import DisasterBoardStore  # noqa: E402
from app.data_store import QuakeLensDataStore  # noqa: E402
from app.grounding import verify_grounded_response  # noqa: E402
from app.reports_store import DamageReportStore  # noqa: E402


@pytest.fixture()
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide isolated SQLite board/reports stores and minimal synthetic Kyoto spatial store."""
    db_file = tmp_path / "platform.db"
    b_store = DisasterBoardStore(db_path=db_file)
    r_store = DamageReportStore(db_path=db_file)
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
                "building_id": "26100-bldg-1001",
                "ward_name": "伏見区",
                "year_built": 1974,
                "age_category": "pre_1981",
                "usage_code": "411",
                "usage_label": "住宅",
                "usage_group": "residential",
                "structure_code": "601",
                "structure_label": "木造",
                "measured_height": 7.5,
                "storeys_above": 2,
                "footprint_area_m2": 82.0,
                "meshcode": "5235362024",
                "t30_i55_ps": 0.54,
                "t30_i60_ps": 0.14,
                "t30_i50_ps": 0.82,
                "hazard_tier": "very_high",
                "arv": 2.05,
                "avs": 175.0,
                "jname": "後背湿地",
                "centroid_lon": 135.7615,
                "centroid_lat": 34.9355,
                "geometry": poly,
            },
            {
                "building_id": "26100-bldg-1002",
                "ward_name": "中京区",
                "year_built": 2005,
                "age_category": "post_2001",
                "usage_code": "411",
                "usage_label": "住宅",
                "usage_group": "residential",
                "structure_code": "602",
                "structure_label": "鉄骨造",
                "measured_height": 11.2,
                "storeys_above": 3,
                "footprint_area_m2": 110.0,
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
            },
        ],
        crs="EPSG:4326",
    )
    meshes = gpd.GeoDataFrame(
        [
            {
                "meshcode": "5235362024",
                "ward_name": "伏見区",
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
                "t30_i45_ps": 0.94,
                "t30_i50_ps": 0.82,
                "t30_i55_ps": 0.54,
                "t30_i60_ps": 0.14,
                "hazard_tier": "very_high",
                "arv": 2.05,
                "avs": 175.0,
                "jname": "後背湿地",
                "centroid_lon": 135.7615,
                "centroid_lat": 34.9355,
                "geometry": poly,
            },
            {
                "meshcode": "5235461024",
                "ward_name": "中京区",
                "total_buildings": 1,
                "known_year_count": 1,
                "unknown_year_count": 0,
                "known_year_rate": 1.0,
                "pre_1981_count": 0,
                "b1982_2000_count": 0,
                "post_2001_count": 1,
                "residential_count": 1,
                "pre_1981_residential_count": 0,
                "wooden_pre_1981_count": 0,
                "pre_1981_share_total": 0.0,
                "pre_1981_share_known": 0.0,
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
            },
        ],
        crs="EPSG:4326",
    )

    s_store = QuakeLensDataStore(processed_dir=tmp_path)
    s_store.buildings = buildings
    s_store.meshes = meshes
    s_store.summary = {
        "municipality": {"code": "26100", "name": "京都市", "name_en": "Kyoto City"},
        "counts": {"total_buildings": 2, "known_year_count": 2, "unknown_year_count": 0, "mesh_count": 2},
        "data_sources": [],
    }
    s_store.loaded = True

    a_store = AuthProfileStore(db_path=db_file)
    a_store.ensure_initialized()
    monkeypatch.setenv("GOV_REGISTRATION_CODE", "kyoto-gov-2026-test")
    monkeypatch.setattr(main_mod, "store", s_store)
    monkeypatch.setattr(main_mod, "board_store", b_store)
    monkeypatch.setattr(main_mod, "reports_store", r_store)
    monkeypatch.setattr(main_mod, "auth_profile_store", a_store)
    monkeypatch.setattr("app.auth.auth_profile_store", a_store)

    a_store.register_or_update_profile(
        uid="uid-gov",
        email="gov@example.go.jp",
        display_name="政府機関担当",
        role="government",
        organization_name="京都市防災室",
        gov_code="kyoto-gov-2026-test",
    )
    a_store.register_or_update_profile(
        uid="uid-cit",
        email="cit@example.com",
        display_name="一般市民テスト",
        role="citizen",
    )
    a_store.register_or_update_profile(
        uid="uid-ent",
        email="ent@example.co.jp",
        display_name="企業担当テスト",
        role="enterprise",
        organization_name="京都BCP株式会社",
    )

    def _fake_verify(token: str) -> dict[str, object]:
        mapping = {
            "tok-gov": {"sub": "uid-gov", "email": "gov@example.go.jp", "email_verified": True},
            "tok-cit": {"sub": "uid-cit", "email": "cit@example.com", "email_verified": True},
            "tok-ent": {"sub": "uid-ent", "email": "ent@example.co.jp", "email_verified": True},
        }
        if token in mapping:
            return mapping[token]
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="invalid test token")

    monkeypatch.setattr("app.auth.verify_firebase_id_token", _fake_verify)
    client = TestClient(main_mod.app, headers={"Authorization": "Bearer tok-gov"})
    return client, s_store, b_store, r_store


def test_board_update_privacy_consent_and_aggregation(isolated_env) -> None:
    client, _, _, _ = isolated_env
    client.headers.update({"Authorization": "Bearer tok-cit"})

    # Create without location consent -> meshcode must be stripped and not stored
    r_no_consent = client.post(
        "/api/board",
        json={
            "phone": "090-1111-2222",
            "name": "匿名 太郎",
            "status": "waiting",
            "ward_name": "伏見区",
            "meshcode": "5235362024",
            "location_consent": False,
            "message": "連絡待ちです。",
            "passcode": "7788",
        },
    )
    assert r_no_consent.status_code == 200
    created = r_no_consent.json()["entry"]
    assert created["meshcode"] is None
    assert created["location_consent"] is False
    assert created["phone_masked"] == "090-****-2222"

    # Wrong passcode rejected on PATCH
    r_bad_patch = client.patch(
        f"/api/board/{created['id']}",
        json={"passcode": "0000", "status": "safe"},
    )
    assert r_bad_patch.status_code == 403

    # Correct passcode updates status & message
    r_ok_patch = client.patch(
        f"/api/board/{created['id']}",
        json={
            "passcode": "7788",
            "status": "shelter",
            "message": "避難所に移動し無事です。",
            "meshcode": "5235362024",
            "location_consent": True,
        },
    )
    assert r_ok_patch.status_code == 200
    updated = r_ok_patch.json()["entry"]
    assert updated["status"] == "shelter"
    assert updated["meshcode"] == "5235362024"
    assert updated["location_consent"] is True

    # Sample rows cannot be edited
    r_sample_patch = client.patch(
        "/api/board/sample-001",
        json={"status": "safe"},
    )
    assert r_sample_patch.status_code == 403

    # Summary separates sample vs user counts and joins mesh centroid
    r_sum = client.get("/api/board/summary?ward=伏見区")
    assert r_sum.status_code == 200
    s_data = r_sum.json()
    assert s_data["user_entries_count"] == 1
    assert s_data["sample_entries_count"] == 1
    assert s_data["total_entries"] == 2
    assert any(m["meshcode"] == "5235362024" and m["centroid_lon"] == 135.7615 for m in s_data["by_mesh"])


def test_damage_reports_validation_duplicates_corroboration_and_lifecycle(isolated_env) -> None:
    client, _, _, _ = isolated_env
    client.headers.update({"Authorization": "Bearer tok-cit"})

    # Coordinates without explicit consent must be rejected (400)
    r_no_consent = client.post(
        "/api/reports",
        json={
            "category": "road_blocked",
            "severity": "high",
            "title": "通行止めテスト",
            "description": "同意なしで座標を送信",
            "ward_name": "伏見区",
            "lat": 34.936,
            "lon": 135.762,
            "location_consent": False,
        },
    )
    assert r_no_consent.status_code == 400

    # Coordinates outside Kyoto must be rejected (400)
    r_oob = client.post(
        "/api/reports",
        json={
            "category": "road_blocked",
            "severity": "high",
            "title": "範囲外座標",
            "description": "東京の座標",
            "ward_name": "伏見区",
            "lat": 35.68,
            "lon": 139.76,
            "location_consent": True,
        },
    )
    assert r_oob.status_code == 400

    # Valid report MUST always force verification_status='unverified' (even if payload ignores it)
    r_create = client.post(
        "/api/reports",
        json={
            "category": "rescue_support",
            "severity": "critical",
            "title": "=HYPERLINK(\"http://bad.example\",\"要救助テスト\")",
            "description": "伏見区で高齢者への給水支援が必要です。",
            "ward_name": "伏見区",
            "meshcode": "5235362024",
            "lat": 34.9355,
            "lon": 135.7615,
            "location_consent": True,
            "passcode": "9876",
        },
    )
    assert r_create.status_code == 200
    rep = r_create.json()["report"]
    assert rep["id"].startswith("rep-")
    assert rep["verification_status"] == "unverified"
    assert rep["is_sample"] is False

    # Similar/duplicate pre-check detects near-identical report in same ward + category + mesh
    r_sim = client.post(
        "/api/reports/similar",
        json={
            "ward_name": "伏見区",
            "category": "rescue_support",
            "title": "要救助テスト 高齢者給水",
            "description": "伏見区で高齢者への給水支援要請",
            "meshcode": "5235362024",
        },
    )
    assert r_sim.status_code == 200
    assert r_sim.json()["count"] == 1
    assert r_sim.json()["similar_reports"][0]["id"] == rep["id"]

    # Confirm/corroborate increments counter WITHOUT falsely elevating status to verified/official
    r_conf = client.post(f"/api/reports/{rep['id']}/confirm")
    assert r_conf.status_code == 200
    assert r_conf.json()["report"]["corroborations"] == 2
    assert r_conf.json()["report"]["verification_status"] == "unverified"

    # Update requires correct passcode
    assert client.patch(f"/api/reports/{rep['id']}", json={"passcode": "1111", "resolved": True}).status_code == 403
    r_patch = client.patch(
        f"/api/reports/{rep['id']}",
        json={"passcode": "9876", "resolved": True},
    )
    assert r_patch.status_code == 200
    assert r_patch.json()["report"]["resolved"] is True

    # Delete sample rejected (403); delete user report succeeds
    assert client.delete("/api/reports/rep-sample01").status_code == 403
    assert client.delete(f"/api/reports/{rep['id']}?passcode=9876").status_code == 200


def test_csv_and_excel_exports_and_formula_sanitization(isolated_env) -> None:
    client, _, _, _ = isolated_env

    # Insert report starting with '=' to check CSV/Excel formula injection guard
    client.post(
        "/api/reports",
        json={
            "category": "building_damage",
            "severity": "high",
            "title": "=SUM(1,1) 外壁ひび割れ",
            "description": "+cmd|' /C calc'!A0 壁面に亀裂",
            "ward_name": "伏見区",
            "passcode": "1234",
        },
    )

    r_csv = client.get("/api/exports/disaster-summary.csv?scope=reports&ward=伏見区")
    assert r_csv.status_code == 200
    assert r_csv.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM for Excel JP compatibility
    csv_text = r_csv.content.decode("utf-8-sig")
    assert "未確認（市民報告）" in csv_text
    assert "'=SUM(1,1)" in csv_text
    assert "'+cmd|" in csv_text

    r_xlsx = client.get("/api/exports/disaster-summary.xlsx?ward=伏見区")
    assert r_xlsx.status_code == 200
    wb = load_workbook(io.BytesIO(r_xlsx.content))
    assert "地域別統合サマリー" in wb.sheetnames
    assert "被害状況報告一覧" in wb.sheetnames
    assert "安否伝言板一覧" in wb.sheetnames
    assert "前提・注記" in wb.sheetnames

    ws_rep = wb["被害状況報告一覧"]
    titles = [cell.value for cell in ws_rep["H"]]
    assert any(isinstance(t, str) and t.startswith("'=SUM(1,1)") for t in titles)


def test_ai_aggregation_grounding_and_route_simulation(isolated_env, monkeypatch: pytest.MonkeyPatch) -> None:
    client, s_store, b_store, r_store = isolated_env

    # Add an unverified Fushimi rescue report so AI & grounding surface unverified notice
    created = r_store.create_report(
        category="rescue_support",
        severity="critical",
        title="伏見区 支援要請テスト",
        description="高齢者宅の飲料水支援が必要です。",
        ward_name="伏見区",
        meshcode="5235362024",
    )["report"]

    # 1) Unconfigured AI fallback answers disaster situation + CSV export cleanly without fabricating data
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    fb = ask_quakelens_ai(
        s_store,
        "伏見区の被害報告と支援要請をCSVにまとめて",
        context={"ward": "伏見区"},
        board_store=b_store,
        reports_store=r_store,
    )
    assert fb["configured"] is False
    assert created["id"] in fb["answer"]
    assert fb["verification"]["contains_unverified_reports"] is True
    assert fb["verification"]["contains_sample_data"] is True
    assert any(a["type"] == "download_export" and a["format"] == "csv" for a in fb["map_actions"])

    # 2) Grounding detects hallucinated report ID
    bad_ver = verify_grounded_response(
        f"確認済み報告 {created['id']} と 架空報告 rep-9999999999 があります。",
        [{"name": "get_damage_reports_summary", "arguments": {}, "result": {"reports": [created]}}],
    )
    assert bad_ver["status"] == "warning"
    assert "rep-9999999999" in bad_ver["unverified_claims"]

    # 3) Gemini Function Calling mock verifies end-to-end tool loop for new disaster tools
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    call_idx = {"n": 0}

    def fake_client(**_):
        class FakeInteractions:
            def create(self, **kwargs):
                call_idx["n"] += 1
                if call_idx["n"] == 1:
                    return SimpleNamespace(
                        id="inter_1",
                        status="completed",
                        steps=[
                            SimpleNamespace(
                                type="function_call",
                                id="fc_1",
                                name="get_damage_reports_summary",
                                arguments={"ward": "伏見区"},
                            )
                        ],
                        output_text=None,
                    )
                return SimpleNamespace(
                    id="inter_2",
                    status="completed",
                    steps=[],
                    output_text=(
                        f"伏見区の報告は2件で、未確認の市民報告が1件（`{created['id']}`）、"
                        "訓練用サンプルが1件（`rep-sample01`）です。未確認情報として扱ってください。"
                    ),
                )

        return SimpleNamespace(interactions=FakeInteractions())

    monkeypatch.setattr("app.ai_assistant.genai.Client", fake_client)
    ai_res = ask_quakelens_ai(
        s_store,
        "伏見区の被害状況は？",
        board_store=b_store,
        reports_store=r_store,
    )
    assert ai_res["verification"]["status"] == "verified"
    assert ai_res["verification"]["contains_unverified_reports"] is True

    # 4) Route simulation detours around rep-sample01 blocking Takeda->Otesuji corridor in Fushimi
    r_nodes = client.get("/api/routes/nodes")
    assert r_nodes.status_code == 200
    assert any(n["id"] == "takeda_st" for n in r_nodes.json()["nodes"])

    r_sim = client.get("/api/routes/simulate?origin_id=takeda_st&destination_id=chushojima&include_samples=true")
    assert r_sim.status_code == 200
    sim = r_sim.json()
    assert sim["is_simulation"] is True
    assert "訓練・研究用" in sim["simulation_disclaimer"]
    assert sim["rerouted"] is True
    assert sim["alternative_route"]["reachable"] is True
    assert len(sim["alternative_route"]["coordinates"]) >= 10
    assert sim["alternative_route"]["coordinates"] != sim["baseline_route"]["coordinates"]
    assert sim["baseline_route"]["distance_km"] <= sim["alternative_route"]["distance_km"]
    assert any(
        any(h["report_id"] == "rep-sample01" for h in seg["triggered_by"])
        for seg in sim["blocked_segments"]
    )

    # 5) Live road closure network status & shelter-hub evacuation / rescue dispatch navigation
    r_net = client.get("/api/network/status?include_samples=true")
    assert r_net.status_code == 200
    net_data = r_net.json()
    assert net_data["blocked_count"] >= 1
    assert any(e["status"] == "blocked" for e in net_data["edges"])
    assert len(net_data["hubs"]) == 11

    # Building-linked report persists building_id cleanly with consent
    r_bldg_rep = client.post(
        "/api/reports",
        json={
            "category": "building_damage",
            "severity": "critical",
            "title": "木造住宅 倒壊テスト",
            "description": "建物ポリゴン紐付けテスト",
            "ward_name": "伏見区",
            "meshcode": "5235362024",
            "building_id": "26100-bldg-1001",
            "lat": 34.9355,
            "lon": 135.7615,
            "location_consent": True,
        },
    )
    assert r_bldg_rep.status_code == 200
    bldg_rep = r_bldg_rep.json()["report"]
    assert bldg_rep["building_id"] == "26100-bldg-1001"

    # Evacuation route from map click -> nearest open shelter/relief hub
    r_evac = client.get("/api/routes/navigate?mode=evacuate&start_lat=34.936&start_lon=135.756")
    assert r_evac.status_code == 200
    evac = r_evac.json()
    assert evac["is_simulation"] is True
    assert evac["mode"] == "evacuate"
    assert evac["alternative_route"]["reachable"] is True
    assert len(evac["alternative_route"]["coordinates"]) >= 2

    # Rescue dispatch route from nearest clear shelter/hub -> incident report
    r_resc = client.get(f"/api/routes/navigate?mode=rescue&target_report_id={bldg_rep['id']}")
    assert r_resc.status_code == 200
    resc = r_resc.json()
    assert resc["mode"] == "rescue"
    assert resc["alternative_route"]["reachable"] is True
    assert "出動元拠点" in (resc.get("note") or "")

    # 6) Snap road endpoint + interactive user road-block creation & resolution lifecycle
    r_snap = client.get("/api/network/snap-road?lat=34.9404&lon=135.7640")
    assert r_snap.status_code == 200
    snap_data = r_snap.json()
    assert snap_data["matched"] is True
    assert len(snap_data["preview_segments"]) >= 1
    assert snap_data["road_name"]

    r_road_rep = client.post(
        "/api/reports",
        json={
            "category": "road_blocked",
            "severity": "critical",
            "title": f"{snap_data['road_name']} 路面陥没による通行止め",
            "description": "地図から設定された道路被害テスト",
            "ward_name": snap_data["ward_name"],
            "lat": snap_data["snap_lat"],
            "lon": snap_data["snap_lon"],
            "location_consent": True,
            "passcode": "9988",
        },
    )
    assert r_road_rep.status_code == 200
    road_rep_id = r_road_rep.json()["report"]["id"]
    r_net_after = client.get("/api/network/status?include_samples=true")
    assert r_net_after.json()["blocked_count"] >= 2
    assert any(cm["id"] == road_rep_id for cm in r_net_after.json().get("closure_markers", []))

    r_road_res = client.patch(
        f"/api/reports/{road_rep_id}",
        json={"passcode": "9988", "resolved": True},
    )
    assert r_road_res.status_code == 200
    r_net_reopened = client.get("/api/network/status?include_samples=true")
    assert not any(cm["id"] == road_rep_id for cm in r_net_reopened.json().get("closure_markers", []))


def test_interactive_roads_corridor_stroke_and_consent(isolated_env) -> None:
    client, _, _, _ = isolated_env

    # 1) Bbox road listing returns GeoJSON FeatureCollection with edge_id & status
    r_bbox = client.get("/api/network/roads?bbox=135.752,34.930,135.764,34.940")
    assert r_bbox.status_code == 200
    bbox_fc = r_bbox.json()
    assert bbox_fc["type"] == "FeatureCollection"
    assert bbox_fc["count"] >= 20
    first_feat = bbox_fc["features"][0]
    assert "edge_id" in first_feat["properties"]
    assert first_feat["properties"]["status"] in ("open", "blocked")
    assert first_feat["geometry"]["type"] == "LineString"

    # 2) Start->End corridor resolution & consent guard on blocked_edge_ids
    r_corr = client.post(
        "/api/network/corridor",
        json={
            "start_lat": 34.9352,
            "start_lon": 135.7568,
            "end_lat": 34.9395,
            "end_lon": 135.7625,
        },
    )
    assert r_corr.status_code == 200
    corr = r_corr.json()
    assert corr["matched"] is True
    assert len(corr["edge_ids"]) >= 3
    assert len(corr["preview_segments"]) == len(corr["edge_ids"])

    # Submitting blocked_edge_ids without location_consent is rejected
    r_denied = client.post(
        "/api/reports",
        json={
            "category": "road_blocked",
            "severity": "critical",
            "title": "同意なし区間テスト",
            "description": "同意なしで拒否されること",
            "ward_name": corr["ward_name"],
            "location_consent": False,
            "blocked_edge_ids": corr["edge_ids"],
        },
    )
    assert r_denied.status_code == 400

    # With explicit location_consent=True, all edge_ids in the corridor become blocked
    r_corr_rep = client.post(
        "/api/reports",
        json={
            "category": "road_blocked",
            "severity": "critical",
            "title": f"{corr['road_name']} 区間通行止め",
            "description": "始点・終点区間選択による道路閉鎖テスト",
            "ward_name": corr["ward_name"],
            "lat": corr["snap_lat"],
            "lon": corr["snap_lon"],
            "location_consent": True,
            "blocked_edge_ids": corr["edge_ids"],
            "passcode": "5544",
            "force_duplicate": True,
        },
    )
    assert r_corr_rep.status_code == 200
    corr_rep = r_corr_rep.json()["report"]
    assert corr_rep["verification_status"] == "unverified"
    assert corr_rep["blocked_edge_ids"] == corr["edge_ids"]

    r_status = client.get("/api/network/status?include_samples=true")
    blocked_ids_in_status = {e["edge_id"] for e in r_status.json()["edges"]}
    assert set(corr["edge_ids"]).issubset(blocked_ids_in_status)

    # 3) Canvas freehand stroke resolution matches touched streets
    r_stroke = client.post(
        "/api/network/stroke",
        json={
            "points": [
                {"lat": 34.9310, "lon": 135.7550},
                {"lat": 34.9316, "lon": 135.7565},
                {"lat": 34.9322, "lon": 135.7580},
            ]
        },
    )
    assert r_stroke.status_code == 200
    stroke = r_stroke.json()
    assert stroke["matched"] is True
    assert len(stroke["edge_ids"]) >= 1
    assert len(stroke["preview_segments"]) >= 1

    # Delete corridor report restores clear state
    assert client.delete(f"/api/reports/{corr_rep['id']}?passcode=5544").status_code == 200
    r_status_clean = client.get("/api/network/status?include_samples=true")
    assert not any(cm["id"] == corr_rep["id"] for cm in r_status_clean.json()["closure_markers"])


def test_official_shelters_and_hazard_map_recommendations(isolated_env) -> None:
    client, s_store, _, r_store = isolated_env

    # 1) Official GSI Kyoto City designated emergency evacuation sites list
    r_list = client.get("/api/shelters")
    assert r_list.status_code == 200
    data_list = r_list.json()
    assert data_list["count"] >= 500
    assert "0000000196.html" in data_list["kyoto_hazard_map_url"]
    assert len(data_list["shelters"]) == data_list["count"]

    r_fire_list = client.get("/api/shelters?wide_area_only=true")
    assert r_fire_list.status_code == 200
    fire_shelters = r_fire_list.json()["shelters"]
    assert 50 <= len(fire_shelters) <= 100
    assert all(s["is_wide_area"] is True for s in fire_shelters)

    # 2) Earthquake scenario inside synthetic mesh polygon (35.0116, 135.7601)
    r_eq = client.get(
        "/api/shelters/recommend?lat=35.0116&lon=135.7601&scenario=earthquake&limit=5"
    )
    assert r_eq.status_code == 200
    eq_rec = r_eq.json()
    assert eq_rec["scenario"] == "earthquake"
    assert eq_rec["origin"]["hazard"] is not None
    assert eq_rec["origin"]["hazard"]["meshcode"] in ("5235362024", "5235461024")
    links = eq_rec["origin"]["hazard_map_links"]
    assert "0000000196.html" in links["earthquake_page_url"]
    assert links["ward_map_pdf"].endswith(".pdf")
    assert links["ward_info_pdf"].endswith(".pdf")
    assert len(eq_rec["recommendations"]) == 5
    first_rec = eq_rec["recommendations"][0]
    assert first_rec["rank"] == 1
    assert first_rec["disasters"]["earthquake"] is True
    assert first_rec["road_distance_km"] is not None and first_rec["road_distance_km"] > 0
    assert first_rec["walk_minutes"] is not None and first_rec["walk_minutes"] >= 1
    assert len(first_rec["reasons"]) >= 1
    assert len(first_rec["nav_route"]["alternative_route"]["coordinates"]) >= 2

    # 3) Post-quake fire scenario prioritizes large-fire wide-area sites
    r_fire = client.get(
        "/api/shelters/recommend?lat=35.0116&lon=135.7681&scenario=post_quake_fire&limit=5"
    )
    assert r_fire.status_code == 200
    fire_rec = r_fire.json()
    assert len(fire_rec["recommendations"]) == 5
    assert all(item["disasters"]["large_fire"] is True for item in fire_rec["recommendations"])
    assert all(item["is_wide_area"] is True for item in fire_rec["recommendations"])

    # 4) Road closure triggers detour-aware shelter recommendation
    top_coords = first_rec["nav_route"]["alternative_route"]["coordinates"]
    mid_lon, mid_lat = top_coords[len(top_coords) // 2]
    r_blk = client.post(
        "/api/reports",
        json={
            "category": "road_blocked",
            "severity": "critical",
            "title": "避難ルート途中の道路損壊",
            "description": "建物倒壊による通行止めテスト",
            "ward_name": "伏見区",
            "lat": mid_lat,
            "lon": mid_lon,
            "location_consent": True,
            "passcode": "2468",
            "force_duplicate": True,
        },
    )
    assert r_blk.status_code == 200
    blk_id = r_blk.json()["report"]["id"]
    r_eq_detour = client.get(
        "/api/shelters/recommend?lat=34.9355&lon=135.7615&scenario=earthquake&avoid_unverified=true&limit=5"
    )
    assert r_eq_detour.status_code == 200
    assert r_eq_detour.json()["active_blocked_count"] >= 1
    assert client.delete(f"/api/reports/{blk_id}?passcode=2468").status_code == 200

    # 5) AI assistant tool recommend_evacuation_shelters works end-to-end
    from app import ai_assistant

    tool_out = ai_assistant._execute_tool(
        s_store,
        "recommend_evacuation_shelters",
        {"lat": 35.0116, "lon": 135.7681, "scenario": "earthquake"},
        reports_store=r_store,
    )
    assert tool_out["scenario"] == "earthquake"
    assert len(tool_out["recommendations"]) == 5
    assert "ward_map_pdf" in tool_out["origin"]["hazard_map_links"]


def test_disaster_updates_recent_and_archive(isolated_env, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    client, s_store, _, r_store = isolated_env

    # 1) Default listing includes both 2025-2026 AND older archive (<2025)
    r_all = client.get("/api/updates/disaster?period=all")
    assert r_all.status_code == 200
    all_data = r_all.json()
    assert all_data["counts"]["recent_2y_earthquakes"] >= 5
    assert all_data["counts"]["archive_earthquakes"] >= 20
    assert all("京都" in q["epicenter"] for q in all_data["earthquakes"])
    assert all_data["counts"]["recent_2y_municipality_updates"] >= 5
    assert all_data["counts"]["archive_municipality_updates"] >= 10
    assert "typhoon.yahoo.co.jp/weather/jp/earthquake/list/?e=511" in (
        all_data["sources"].get("yahoo_kyoto_earthquakes") or ""
    )

    from app import disaster_updates as du_mod

    # Ensure JMA parser drops non-Kyoto epicenters (e.g. Kumamoto / Shizuoka) even if maxi >= 4
    jma_filtered = du_mod._parse_jma_recent_kyoto([
        {"eid": "1", "at": "2026-11-20T21:46:00+09:00", "anm": "熊本県天草・芦北地方", "mag": "4.1", "maxi": "4", "cod": "+32.3+130.5-10000/"},
        {"eid": "2", "at": "2026-11-21T10:00:00+09:00", "anm": "京都府南部", "mag": "3.1", "maxi": "2", "cod": "+35.0+135.7-10000/"},
    ])
    assert len(jma_filtered) == 1
    assert jma_filtered[0]["epicenter"] == "京都府南部"

    # 2) Period filtering cleanly separates recent_2y vs archive
    r_2y = client.get("/api/updates/disaster?period=recent_2y")
    assert r_2y.status_code == 200
    d2y = r_2y.json()
    assert all(q["year"] in (2025, 2026) for q in d2y["earthquakes"])
    assert all(n["year"] in (2025, 2026) for n in d2y["municipality_updates"])

    r_2025 = client.get("/api/updates/disaster?period=2025")
    assert r_2025.status_code == 200
    assert all(q["year"] == 2025 for q in r_2025.json()["earthquakes"])
    assert len(r_2025.json()["earthquakes"]) >= 1

    r_arch = client.get("/api/updates/disaster?period=archive")
    assert r_arch.status_code == 200
    d_arch = r_arch.json()
    assert all(q["year"] < 2025 for q in d_arch["earthquakes"])
    assert all(n["year"] < 2025 for n in d_arch["municipality_updates"])

    # 3) Live refresh parses HTML/JSON cleanly into isolated temp store & returns diff
    from app import disaster_updates as du_mod

    temp_archive = tmp_path / "archive.json"
    isolated_updates = du_mod.DisasterUpdatesStore(archive_path=temp_archive)
    monkeypatch.setattr(du_mod, "updates_store", isolated_updates)
    monkeypatch.setattr(main_mod, "updates_store", isolated_updates)

    async def fake_fetch_live(existing_earthquakes=None):
        return {
            "last_updated_at": "2026-11-24T09:00:00+00:00",
            "sources": {
                "yahoo_kyoto_earthquakes": du_mod.YAHOO_KYOTO_QUAKE_LIST_URL,
                "jma_bosai_json": du_mod.JMA_QUAKE_LIST_URL,
                "kyoto_bousai_portal": "https://www.bousai.city.kyoto.lg.jp/",
                "kyoto_hazard_map": du_mod.KYOTO_HAZARD_MAP_PAGE_URL,
            },
            "earthquakes": [
                {
                    "id": "yahoo-20261124000001",
                    "occurred_at": "2026年11月24日 10時00分ごろ",
                    "date_iso": "2026-11-24",
                    "year": 2026,
                    "is_recent_2y": True,
                    "epicenter": "京都府南部",
                    "mag": 3.2,
                    "maxi": "2",
                    "depth_km": 10.0,
                    "lat": 35.0,
                    "lon": 135.75,
                    "observed_kyoto": ["震度2: 京都市中京区"],
                    "source": "気象庁 / Yahoo!天気・災害",
                    "url": du_mod.YAHOO_KYOTO_QUAKE_LIST_URL,
                }
            ],
            "municipality_updates": [
                {
                    "id": "kyoto-news-test-1",
                    "date_text": "2026-11-20",
                    "year": 2026,
                    "is_recent_2y": True,
                    "category": "ハザードマップ更新",
                    "title": "テスト防災更新",
                    "source": "京都市公式",
                    "url": "https://www.bousai.city.kyoto.lg.jp/0000000196.html",
                }
            ],
        }

    monkeypatch.setattr(du_mod, "fetch_live_archive_payload", fake_fetch_live)
    r_ref = client.post("/api/updates/disaster/refresh")
    assert r_ref.status_code == 200
    ref_data = r_ref.json()
    assert ref_data["refreshed"] is True
    assert ref_data["new_earthquakes_count"] == 1
    assert ref_data["new_municipality_updates_count"] == 1
    assert temp_archive.exists()

    # 4) AI assistant tool get_kyoto_disaster_updates_and_history works
    from app import ai_assistant

    t_res = ai_assistant._execute_tool(
        s_store,
        "get_kyoto_disaster_updates_and_history",
        {"period": "recent_2y"},
        reports_store=r_store,
    )
    assert t_res["period"] == "recent_2y"
    assert len(t_res["earthquakes"]) == 1


def test_r8_seismic_list_and_unlisted_priority(isolated_env) -> None:
    client, s_store, _, _ = isolated_env

    # 1) R8 list endpoint exposes 949 municipal wings + unlisted policy
    r_list = client.get("/api/r8-seismic")
    assert r_list.status_code == 200
    r8_data = r_list.json()
    assert r8_data["total_listed"] >= 900
    assert "R8_list.pdf" in r8_data["pdf_url"]
    assert r8_data["grade_counts"]["新耐震"] > 0

    # Searching a listed municipal building matches, whereas unlisted private building returns 0
    r_hit = client.get("/api/r8-seismic?q=京都市役所")
    assert r_hit.status_code == 200
    assert r_hit.json()["filtered_count"] >= 1

    r_miss = client.get("/api/r8-seismic?q=未掲載民間テスト建物")
    assert r_miss.status_code == 200
    assert r_miss.json()["filtered_count"] == 0

    # 2) Pre-1981 high-hazard residential building NOT in R8_list.pdf gets critical retrofit priority
    r_b1 = client.get("/api/buildings/26100-bldg-1001")
    assert r_b1.status_code == 200
    assess1 = r_b1.json()["r8_seismic_assessment"]
    assert assess1["listed_in_r8"] is False
    assert assess1["priority_tier"] == "critical"
    assert "R8_list.pdf" in assess1["r8_pdf_url"]
    assert "未掲載" in assess1["priority_badge"]

    # Post-2001 residential building NOT in R8_list.pdf still clearly marked unlisted
    r_b2 = client.get("/api/buildings/26100-bldg-1002")
    assert r_b2.status_code == 200
    assess2 = r_b2.json()["r8_seismic_assessment"]
    assert assess2["listed_in_r8"] is False
    assert assess2["priority_tier"] == "standard"

    # 3) AI tool reports unlisted priority counts & facility check
    from app import ai_assistant

    t_r8 = ai_assistant._execute_tool(
        s_store,
        "get_r8_seismic_unlisted_priority",
        {"ward": "伏見区", "facility_name": "未掲載民間住宅"},
    )
    assert t_r8["unlisted_pre_1981_count"] >= 1
    assert t_r8["facility_lookup"]["listed_in_r8"] is False

    # 4) Locate endpoint resolves coordinates & hazard for searched R8 facilities and unlisted queries
    first_r8 = r_hit.json()["records"][0]
    r_loc = client.get(f"/api/r8-seismic/{first_r8['id']}/locate")
    assert r_loc.status_code == 200
    loc_data = r_loc.json()
    assert loc_data["record"]["id"] == first_r8["id"]
    assert 34.8 < loc_data["lat"] < 35.3
    assert 135.5 < loc_data["lon"] < 135.9

    r_unlisted_loc = client.get("/api/r8-seismic/locate-unlisted?q=岡崎公園&ward=左京区")
    assert r_unlisted_loc.status_code == 200
    u_data = r_unlisted_loc.json()
    assert u_data["listed_in_r8"] is False
    assert "R8_list.pdf" in u_data["priority_message"]
    assert 34.8 < u_data["lat"] < 35.3


def test_enterprise_bcp_safe_sites_and_r8_integration(isolated_env) -> None:
    """Enterprise BCP safe-site recommendation ranks Kyoto wards and 250m meshes using J-SHIS + R8 list."""
    client, s_store, _, _ = isolated_env
    client.headers.update({"Authorization": "Bearer tok-ent"})
    r = client.get("/api/enterprise/safe-sites?purpose=datacenter_server&avoid_mountain=true&limit=5")
    assert r.status_code == 200
    data = r.json()
    assert data["purpose"] == "datacenter_server"
    assert "R8_list.pdf" in data["r8_pdf_url"]
    assert data["r8_total_listed"] >= 900
    assert len(data["ward_ranking"]) >= 2
    assert data["ward_ranking"][0]["ward_name"] == "中京区"
    assert len(data["recommendations"]) >= 1

    top_site = data["recommendations"][0]
    assert top_site["rank"] == 1
    assert top_site["ward_name"] == "中京区"
    assert 0 < top_site["safety_score"] <= 100
    assert top_site["jname"] not in ("山地", "山麓地")
    assert len(top_site["reasons"]) >= 1
    assert top_site["r8_ward_stats"]["total"] > 0
    assert 0.0 < top_site["r8_ward_stats"]["safe_rate"] <= 1.0
    assert "R8_list.pdf" in top_site["bcp_guidance"]

    # Switch scenario & ward filter
    r_hq = client.get("/api/enterprise/safe-sites?ward=中京区&purpose=bcp_hq&limit=3")
    assert r_hq.status_code == 200
    hq_data = r_hq.json()
    assert len(hq_data["recommendations"]) >= 1
    assert all(rec["ward_name"] == "中京区" for rec in hq_data["recommendations"])

    # AI tool + map action extraction works seamlessly
    from app import ai_assistant

    t_bcp = ai_assistant._execute_tool(
        s_store,
        "recommend_enterprise_bcp_sites",
        {"ward": "all", "purpose": "datacenter_server", "avoid_mountain": True, "limit": 3},
        user_role="enterprise",
    )
    assert len(t_bcp["recommendations"]) >= 1
    actions = ai_assistant._extract_map_actions("recommend_enterprise_bcp_sites", t_bcp)
    assert any(act["type"] == "fly_to_mesh" for act in actions)


def test_chat_tts_sanitizer_and_endpoint(isolated_env, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import tts as tts_mod

    client, _, _, _ = isolated_env

    # 1) Spoken text sanitizer strips markdown tables, URLs, and formats cleanly
    raw = (
        "### 伏見区の分析結果\n"
        "- **1981年以前**: `1,234棟`\n"
        "| 項目 | 数値 |\n| --- | --- |\n| 棟数 | 1234 |\n"
        "詳細: [京都市公式サイト](https://www.city.kyoto.lg.jp/example)\n"
        "⚠️ 未確認の市民報告を含みます。"
    )
    spoken = tts_mod.prepare_spoken_text(raw)
    assert "https://" not in spoken
    assert "|" not in spoken
    assert "**" not in spoken
    assert "京都市公式サイト" in spoken
    assert "ご注意です" in spoken

    # 2) Unconfigured Gemini key returns 503 cleanly
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r_no_key = client.post("/api/chat/tts", json={"text": "こんにちは"})
    assert r_no_key.status_code == 503

    # 3) Configured Gemini key calls google-genai with response_modalities=["AUDIO"] & returns WAV
    captured: dict[str, object] = {}

    class DummyModels:
        def generate_content(self, *, model, contents, config):
            captured["model"] = model
            captured["contents"] = contents
            captured["modalities"] = list(config.response_modalities)
            captured["voice"] = config.speech_config.voice_config.prebuilt_voice_config.voice_name
            part = SimpleNamespace(inline_data=SimpleNamespace(data=b"\x01\x00\x02\x00", mime_type="audio/L16;codec=pcm;rate=24000"))
            return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])

    class DummyClient:
        def __init__(self, **kwargs):
            captured["client_kwargs"] = kwargs
            self.models = DummyModels()

    monkeypatch.setattr(tts_mod.genai, "Client", DummyClient)
    r_ok = client.post(
        "/api/chat/tts",
        json={"text": "**こんにちは！** もちまもです。", "voice": "Leda"},
        headers={"X-Gemini-Api-Key": "AIza-test-byok-key-123456"},
    )
    assert r_ok.status_code == 200
    assert r_ok.headers["content-type"].startswith("audio/wav")
    assert r_ok.headers["x-tts-model"] == tts_mod.DEFAULT_TTS_MODEL
    assert r_ok.content.startswith(b"RIFF")
    assert captured["modalities"] == ["AUDIO"]
    assert captured["voice"] == "Leda"
    assert captured["model"] == tts_mod.DEFAULT_TTS_MODEL == "gemini-3.8-flash-tts"
    assert "**" not in str(captured["contents"])

    # 4) Fallback to gemini-3.8-flash-lite-tts when primary hits 429 RESOURCE_EXHAUSTED
    attempts: list[str] = []

    class FallbackModels:
        def generate_content(self, *, model, contents, config):
            attempts.append(model)
            if model == "gemini-3.8-flash-tts":
                raise RuntimeError("429 RESOURCE_EXHAUSTED: FreeTier limit: 10")
            part = SimpleNamespace(inline_data=SimpleNamespace(data=b"\x01\x00\x02\x00", mime_type="audio/wav"))
            return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])

    class FallbackClient:
        def __init__(self, **kwargs):
            self.models = FallbackModels()

    monkeypatch.setattr(tts_mod.genai, "Client", FallbackClient)
    r_fb = client.post(
        "/api/chat/tts",
        json={"text": "フォールバック確認です。"},
        headers={"X-Gemini-Api-Key": "AIza-test-byok-key-123456"},
    )
    assert r_fb.status_code == 200
    assert attempts == ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]
    assert r_fb.headers["x-tts-model"] == "gemini-3.8-flash-lite-tts"

    # 5) All models 429 -> clean HTTP 429 with Japanese guidance instead of raw JSON 500
    class AllExhaustedModels:
        def generate_content(self, *, model, contents, config):
            raise RuntimeError(
                "429 RESOURCE_EXHAUSTED. QuotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier, "
                "retryDelay': '3665s'"
            )

    class AllExhaustedClient:
        def __init__(self, **kwargs):
            self.models = AllExhaustedModels()

    monkeypatch.setattr(tts_mod.genai, "Client", AllExhaustedClient)
    r_429 = client.post(
        "/api/chat/tts",
        json={"text": "上限テスト"},
        headers={"X-Gemini-Api-Key": "AIza-test-byok-key-123456"},
    )
    assert r_429.status_code == 429
    detail_429 = r_429.json()["detail"]
    assert "無料枠上限" in detail_429
    assert "約1時間1分後" in detail_429
    assert "RESOURCE_EXHAUSTED" not in detail_429


def test_ai_tools_definitions_validate_for_interactions() -> None:
    from pydantic import TypeAdapter
    from google.genai._gaos.types.interactions import CreateModelInteraction

    from app import ai_assistant

    assert len(ai_assistant.TOOLS) >= 14
    for tool in ai_assistant.TOOLS:
        assert tool.get("type") == "function", f"Missing type='function' on tool: {tool.get('name')}"
        assert isinstance(tool.get("name"), str) and tool["name"]
        assert isinstance(tool.get("description"), str) and tool["description"]
        assert isinstance(tool.get("parameters"), dict)

    validated = TypeAdapter(CreateModelInteraction).validate_python(
        {
            "model": ai_assistant.DEFAULT_MODEL,
            "input": "テスト",
            "system_instruction": ai_assistant.SYSTEM_INSTRUCTION,
            "tools": ai_assistant.TOOLS,
            "generation_config": {"max_output_tokens": 1536},
            "stream": True,
        }
    )
    assert len(validated.tools or []) == len(ai_assistant.TOOLS)


def test_historic_and_residential_priority_and_solutions(isolated_env) -> None:
    """Historic and residential prioritization ranks P1-P4 tiers, solutions, ward hotspots, and AI actions."""
    client, s_store, _, _ = isolated_env
    # Accessible by citizen role as well as enterprise/government
    r = client.get("/api/priority/historic-residential?focus=all&limit=5")
    assert r.status_code == 200
    data = r.json()
    assert data["focus"] == "all"
    assert [t["tier"] for t in data["priority_tiers"]] == ["P1", "P2", "P3", "P4"]
    assert all(len(t["solutions"]) >= 2 for t in data["priority_tiers"])
    assert len(data["official_programs"]) >= 3
    assert len(data["ward_ranking"]) >= 2
    assert len(data["priority_meshes"]) >= 1
    assert len(data["sample_buildings"]) >= 1

    # Historic focus & ward filter
    r_hist = client.get("/api/priority/historic-residential?ward=伏見区&focus=historic&limit=3")
    assert r_hist.status_code == 200
    h_data = r_hist.json()
    assert h_data["focus"] == "historic"
    assert all(m["ward_name"] == "伏見区" for m in h_data["priority_meshes"])

    # Building detail endpoint attaches priority_solution
    b_id = data["sample_buildings"][0]["building_id"]
    r_b = client.get(f"/api/buildings/{b_id}")
    assert r_b.status_code == 200
    b_detail = r_b.json()
    assert "priority_solution" in b_detail
    assert b_detail["priority_solution"]["priority_tier"] in ("P1", "P2", "P3", "P4", "OK")
    assert len(b_detail["priority_solution"]["recommended_actions"]) >= 1

    # AI tool & map action extraction work for citizen role too
    from app import ai_assistant

    assert "get_historic_and_residential_priorities" in ai_assistant.get_allowed_tool_names("citizen")
    t_res = ai_assistant._execute_tool(
        s_store,
        "get_historic_and_residential_priorities",
        {"ward": "all", "focus": "residential"},
    )
    assert t_res["focus"] == "residential"
    actions = ai_assistant._extract_map_actions("get_historic_and_residential_priorities", t_res)
    assert any(act["type"] in ("fly_to_mesh", "focus_building") for act in actions)
