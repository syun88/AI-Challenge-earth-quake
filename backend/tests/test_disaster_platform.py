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

    monkeypatch.setattr(main_mod, "store", s_store)
    monkeypatch.setattr(main_mod, "board_store", b_store)
    monkeypatch.setattr(main_mod, "reports_store", r_store)
    return TestClient(main_mod.app), s_store, b_store, r_store


def test_board_update_privacy_consent_and_aggregation(isolated_env) -> None:
    client, _, _, _ = isolated_env

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
    assert "fushimi_otesuji" in sim["baseline_route"]["node_ids"]
    assert "fushimi_otesuji" not in sim["alternative_route"]["node_ids"]
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
