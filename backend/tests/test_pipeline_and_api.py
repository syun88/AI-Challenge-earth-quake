"""Unit and integration tests for QuakeLens Japan data pipeline and FastAPI backend."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.constants import classify_age_category, classify_hazard_tier  # noqa: E402
from app.data_store import QuakeLensDataStore  # noqa: E402
from app.main import app, store  # noqa: E402
from scripts.fetch_and_build import latlon_to_mesh250, parse_citygml_bytes  # noqa: E402


def test_age_and_hazard_classification() -> None:
    assert classify_age_category(None) == "unknown"
    assert classify_age_category(1975) == "pre_1981"
    assert classify_age_category(1981) == "pre_1981"
    assert classify_age_category(1982) == "1982_2000"
    assert classify_age_category(2000) == "1982_2000"
    assert classify_age_category(2001) == "post_2001"

    assert classify_hazard_tier(None) == "unknown"
    assert classify_hazard_tier(0.35) == "very_high"
    assert classify_hazard_tier(0.26) == "very_high"
    assert classify_hazard_tier(0.15) == "elevated"
    assert classify_hazard_tier(0.06) == "elevated"
    assert classify_hazard_tier(0.045) == "moderate"
    assert classify_hazard_tier(0.01) == "low"


def test_mesh250_calculation_matches_jshis() -> None:
    # Verified against J-SHIS meshinfo API for Kyoto City coordinates
    assert latlon_to_mesh250(35.0116, 135.7601) == "5235461024"
    assert latlon_to_mesh250(34.9355, 135.7615) == "5235362024"


def test_parse_citygml_strict_missingness_and_axis_order() -> None:
    sample_gml = b"""<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0"
                xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
                xmlns:gml="http://www.opengis.net/gml"
                xmlns:uro="https://www.geospatial.jp/iur/uro/3.2">
  <core:cityObjectMember>
    <bldg:Building gml:id="bldg_valid_old">
      <bldg:usage>411</bldg:usage>
      <bldg:yearOfConstruction>1978</bldg:yearOfConstruction>
      <bldg:measuredHeight>7.5</bldg:measuredHeight>
      <bldg:storeysAboveGround>2</bldg:storeysAboveGround>
      <bldg:lod0RoofEdge>
        <gml:MultiSurface>
          <gml:surfaceMember>
            <gml:Polygon>
              <gml:exterior>
                <gml:LinearRing>
                  <gml:posList srsDimension="3">35.0000 135.7500 0 35.0000 135.7502 0 35.0002 135.7502 0 35.0002 135.7500 0 35.0000 135.7500 0</gml:posList>
                </gml:LinearRing>
              </gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember>
        </gml:MultiSurface>
      </bldg:lod0RoofEdge>
      <uro:buildingIDAttribute>
        <uro:BuildingIDAttribute>
          <uro:buildingID>26100-bldg-1</uro:buildingID>
          <uro:city>26104</uro:city>
        </uro:BuildingIDAttribute>
      </uro:buildingIDAttribute>
    </bldg:Building>
  </core:cityObjectMember>
  <core:cityObjectMember>
    <bldg:Building gml:id="bldg_sentinel_unknown">
      <bldg:usage>461</bldg:usage>
      <bldg:yearOfConstruction>0001</bldg:yearOfConstruction>
      <bldg:storeysAboveGround>9999</bldg:storeysAboveGround>
      <bldg:lod0FootPrint>
        <gml:MultiSurface>
          <gml:surfaceMember>
            <gml:Polygon>
              <gml:exterior>
                <gml:LinearRing>
                  <gml:posList srsDimension="3">35.0010 135.7510 0 35.0010 135.7512 0 35.0012 135.7512 0 35.0012 135.7510 0 35.0010 135.7510 0</gml:posList>
                </gml:LinearRing>
              </gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember>
        </gml:MultiSurface>
      </bldg:lod0FootPrint>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>"""

    rows = parse_citygml_bytes(
        sample_gml,
        usage_map={"411": "住宅", "461": "不明"},
        struct_map={"601": "木造・土蔵造"},
        ward_map={"26104": "中京区"},
    )
    assert len(rows) == 2

    b1, b2 = rows[0], rows[1]
    assert b1["building_id"] == "26100-bldg-1"
    assert b1["ward_name"] == "中京区"
    assert b1["year_built"] == 1978
    assert b1["age_category"] == "pre_1981"
    assert b1["usage_group"] == "residential"
    assert b1["storeys_above"] == 2
    # Verify (lon, lat) order in EPSG:4326
    cx, cy = b1["geometry"].centroid.x, b1["geometry"].centroid.y
    assert 135.0 < cx < 136.0
    assert 34.0 < cy < 36.0

    # Sentinel year 0001 & 9999 storeys & usage 461 must remain unknown
    assert b2["year_built"] is None
    assert b2["age_category"] == "unknown"
    assert b2["storeys_above"] is None
    assert b2["usage_group"] == "unknown"


@pytest.fixture()
def synthetic_store(tmp_path: Path) -> QuakeLensDataStore:
    """Create a small self-contained processed dataset for API endpoint testing."""
    b_poly1 = Polygon([(135.750, 35.000), (135.7502, 35.000), (135.7502, 35.0002), (135.750, 35.0002)])
    b_poly2 = Polygon([(135.751, 35.001), (135.7512, 35.001), (135.7512, 35.0012), (135.751, 35.0012)])
    mesh_poly = Polygon([(135.749, 34.999), (135.753, 34.999), (135.753, 35.003), (135.749, 35.003)])

    bldgs = gpd.GeoDataFrame(
        [
            {
                "building_id": "26100-bldg-100",
                "ward_code": "26109",
                "ward_name": "伏見区",
                "year_built": 1974,
                "age_category": "pre_1981",
                "usage_code": "411",
                "usage_label": "住宅",
                "usage_group": "residential",
                "structure_code": "601",
                "structure_label": "木造・土蔵造",
                "measured_height": 7.2,
                "storeys_above": 2,
                "footprint_area_m2": 80.5,
                "meshcode": "5235362024",
                "t30_i55_ps": 0.54,
                "t30_i60_ps": 0.13,
                "t30_i50_ps": 0.84,
                "hazard_tier": "very_high",
                "arv": 2.1,
                "avs": 167.4,
                "jname": "後背湿地",
                "geometry": b_poly1,
            },
            {
                "building_id": "26100-bldg-200",
                "ward_code": "26109",
                "ward_name": "伏見区",
                "year_built": None,
                "age_category": "unknown",
                "usage_code": "401",
                "usage_label": "業務施設",
                "usage_group": "non_residential",
                "structure_code": "603",
                "structure_label": "鉄筋コンクリート造",
                "measured_height": 15.0,
                "storeys_above": 4,
                "footprint_area_m2": 210.0,
                "meshcode": "5235362024",
                "t30_i55_ps": 0.54,
                "t30_i60_ps": 0.13,
                "t30_i50_ps": 0.84,
                "hazard_tier": "very_high",
                "arv": 2.1,
                "avs": 167.4,
                "jname": "後背湿地",
                "geometry": b_poly2,
            },
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )
    bldgs.to_parquet(tmp_path / "buildings.parquet", index=False)

    meshes = gpd.GeoDataFrame(
        [
            {
                "meshcode": "5235362024",
                "ward_name": "伏見区",
                "total_buildings": 2,
                "known_year_count": 1,
                "unknown_year_count": 1,
                "pre_1981_count": 1,
                "b1982_2000_count": 0,
                "post_2001_count": 0,
                "residential_count": 1,
                "pre_1981_residential_count": 1,
                "wooden_pre_1981_count": 1,
                "known_year_rate": 0.5,
                "pre_1981_share_total": 0.5,
                "pre_1981_share_known": 1.0,
                "t30_i45_ps": 0.99,
                "t30_i50_ps": 0.84,
                "t30_i55_ps": 0.54,
                "t30_i60_ps": 0.13,
                "hazard_tier": "very_high",
                "arv": 2.1,
                "avs": 167.4,
                "jname": "後背湿地",
                "centroid_lon": 135.751,
                "centroid_lat": 35.001,
                "geometry": mesh_poly,
            }
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )
    meshes.to_file(tmp_path / "meshes.geojson", driver="GeoJSON")
    (tmp_path / "summary.json").write_text(
        json.dumps({"municipality": {"name": "京都市"}, "counts": {"total_buildings": 2}}),
        encoding="utf-8",
    )

    s = QuakeLensDataStore(processed_dir=tmp_path)
    s.load()
    return s


def test_api_endpoints_with_store(synthetic_store: QuakeLensDataStore, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.main.store", synthetic_store)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(app)

    root_resp = client.get("/")
    assert root_resp.status_code == 200
    assert "QuakeLens Japan" in root_resp.text

    assert client.get("/api/health").json()["building_count"] == 2

    stats = client.get("/api/stats").json()
    assert stats["total_buildings"] == 2
    assert stats["known_year_count"] == 1
    assert stats["unknown_year_count"] == 1
    assert stats["pre_1981_count"] == 1
    assert stats["overlap_very_high_pre1981"] == 1

    bldgs = client.get("/api/buildings?bbox=135.74,34.99,135.76,35.01").json()
    assert len(bldgs["features"]) == 2

    detail = client.get("/api/buildings/26100-bldg-100").json()
    assert detail["year_built"] == 1974
    assert detail["t30_i55_ps"] == 0.54

    areas = client.get("/api/priority-areas?min_buildings=1").json()
    assert areas["areas"][0]["meshcode"] == "5235362024"

    # Chat should gracefully handle missing GEMINI_API_KEY while still executing real data tools
    chat_resp = client.post(
        "/api/chat",
        json={
            "message": "古い建物は何棟？",
            "context": {"ward": "中京区", "selected_meshcode": "5235362024"},
        },
    ).json()
    assert chat_resp["configured"] is False
    assert "GEMINI_API_KEY" in chat_resp["answer"]
    assert len(chat_resp["tool_calls"]) >= 2
    assert any(tc["name"] == "get_area_statistics" for tc in chat_resp["tool_calls"])
    assert any(tc["name"] == "get_mesh_details" for tc in chat_resp["tool_calls"])
    assert any(a["type"] == "fly_to_mesh" for a in chat_resp.get("map_actions", []))
    assert any(a["type"] == "fly_to_ward" for a in chat_resp.get("map_actions", []))

    # SSE streaming endpoint in unconfigured mode should emit tool events, text_delta, and done
    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"message": "伏見区の状況を教えて", "model": "gemini-4-argon", "context": {"ward": "中京区"}},
    ) as stream_resp:
        assert stream_resp.status_code == 200
        assert "text/event-stream" in stream_resp.headers["content-type"]
        raw_lines = [line for line in stream_resp.iter_lines() if line.startswith("data: ")]

    events = [json.loads(line.removeprefix("data: ")) for line in raw_lines]
    event_types = [ev["type"] for ev in events]
    assert "tool_result" in event_types
    assert events[-1]["type"] == "done"
    assert events[-1]["configured"] is False
    assert events[-1]["model"] == "gemini-4-argon"
    assert "GEMINI_API_KEY" in events[-1]["answer"]


def test_ai_tools_compare_wards_earthquakes_and_map_actions(synthetic_store: QuakeLensDataStore) -> None:
    from app.ai_assistant import _execute_tool, _extract_map_actions, _resolve_model

    assert _resolve_model(None) == "gemini-3.5-flash-lite"
    assert _resolve_model("gemini-4-hydrogen") == "gemini-4-hydrogen"
    assert _resolve_model("gemini-4-argon") == "gemini-4-argon"
    assert _resolve_model("unknown-model") == "gemini-3.5-flash-lite"

    ward_cmp = _execute_tool(synthetic_store, "compare_wards", {"usage_group": "all"})
    assert len(ward_cmp["wards"]) >= 1
    first_ward = ward_cmp["wards"][0]["ward_name"]
    ward_actions = _extract_map_actions("compare_wards", ward_cmp)
    assert ward_actions[0]["type"] == "fly_to_ward"
    assert ward_actions[0]["ward"] == first_ward

    sample_eq = [{"eid": "eq1", "at": "2026-01-01T00:00:00+09:00", "anm": "京都府南部", "mag": 3.2, "maxi": "2"}]
    eq_res = _execute_tool(
        synthetic_store,
        "get_recent_earthquakes_summary",
        {"limit": 5},
        earthquakes_cache=sample_eq,
    )
    assert eq_res["count"] == 1
    assert eq_res["earthquakes"][0]["anm"] == "京都府南部"

    bldg_res = _execute_tool(synthetic_store, "get_building_details", {"building_id": "26100-bldg-100"})
    bldg_actions = _extract_map_actions("get_building_details", bldg_res)
    assert bldg_actions[0]["type"] == "focus_building"
    assert bldg_actions[0]["building_id"] == "26100-bldg-100"


def test_real_processed_data_consistency_and_ai_tools() -> None:
    """Verify consistency of the full Kyoto City processed dataset and AI tool outputs."""
    from app.ai_assistant import _execute_tool

    real_store = QuakeLensDataStore()
    if not real_store.buildings_path.exists():
        pytest.skip("Full processed Kyoto City dataset not built")

    real_store.load()
    stats = real_store.get_stats()
    assert stats["total_buildings"] > 500_000
    assert stats["known_year_count"] + stats["unknown_year_count"] == stats["total_buildings"]
    assert sum(item["count"] for item in stats["age_breakdown"]) == stats["total_buildings"]
    assert sum(item["count"] for item in stats["hazard_breakdown"]) == stats["total_buildings"]

    # Verify AI tools return exact matching figures from the real DataStore
    ai_stats = _execute_tool(real_store, "get_area_statistics", {"ward": "伏見区"})
    fushimi_stats = real_store.get_stats(ward="伏見区")
    assert ai_stats["total_buildings"] == fushimi_stats["total_buildings"]
    assert ai_stats["pre_1981_count"] == fushimi_stats["pre_1981_count"]

    ai_areas = _execute_tool(real_store, "get_priority_confirmation_areas", {"limit": 5})
    assert len(ai_areas["areas"]) == 5
    top_mc = ai_areas["areas"][0]["meshcode"]

    ai_mesh = _execute_tool(real_store, "get_mesh_details", {"meshcode": top_mc})
    assert ai_mesh["meshcode"] == top_mc
    assert ai_mesh["pre_1981_count"] == ai_areas["areas"][0]["pre_1981_count"]

    ai_programs = _execute_tool(real_store, "get_data_methodology_and_programs", {})
    assert len(ai_programs["official_retrofit_programs"]) >= 3

