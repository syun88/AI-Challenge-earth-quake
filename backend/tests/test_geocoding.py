"""Unit and API tests for Kyoto address/place search and reverse geocoding."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import geopandas as gpd
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app import geocoding as geo_mod  # noqa: E402
from app import main as main_mod  # noqa: E402
from app.auth import AuthProfileStore  # noqa: E402
from app.board_store import DisasterBoardStore  # noqa: E402
from app.data_store import QuakeLensDataStore  # noqa: E402
from app.reports_store import DamageReportStore  # noqa: E402


@pytest.fixture()
def geo_test_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide an isolated FastAPI TestClient with a synthetic Kyoto spatial store."""
    geo_mod.clear_geocode_cache()
    db_file = tmp_path / "geo.db"
    a_store = AuthProfileStore(db_path=db_file)
    b_store = DisasterBoardStore(db_path=db_file)
    r_store = DamageReportStore(db_path=db_file)
    a_store.ensure_initialized()
    b_store.ensure_initialized()
    r_store.ensure_initialized()
    a_store.register_or_update_profile(
        uid="geo-test-uid",
        email="geo@example.com",
        display_name="Geo Test User",
        role="citizen",
    )
    monkeypatch.setattr("app.auth.auth_profile_store", a_store)
    monkeypatch.setattr(main_mod, "auth_profile_store", a_store)

    def _fake_verify(token: str) -> dict[str, object]:
        if token == "tok-geo":
            return {"sub": "geo-test-uid", "email": "geo@example.com", "email_verified": True}
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="invalid test token")

    monkeypatch.setattr("app.auth.verify_firebase_id_token", _fake_verify)

    poly = Polygon([
        (135.7590, 35.0105),
        (135.7695, 35.0105),
        (135.7695, 35.0125),
        (135.7590, 35.0125),
        (135.7590, 35.0105),
    ])
    buildings = gpd.GeoDataFrame(
        [
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
                "t30_i55_ps": 0.152,
                "t30_i60_ps": 0.02,
                "t30_i50_ps": 0.45,
                "hazard_tier": "elevated",
                "arv": 1.35,
                "avs": 320.0,
                "jname": "砂礫質台地",
                "centroid_lon": 135.7642,
                "centroid_lat": 35.0115,
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
                "total_buildings": 42,
                "known_year_count": 35,
                "unknown_year_count": 7,
                "known_year_rate": 0.8333,
                "pre_1981_count": 12,
                "b1982_2000_count": 10,
                "post_2001_count": 13,
                "residential_count": 30,
                "pre_1981_residential_count": 9,
                "wooden_pre_1981_count": 7,
                "pre_1981_share_total": 0.2857,
                "pre_1981_share_known": 0.3429,
                "t30_i45_ps": 0.55,
                "t30_i50_ps": 0.45,
                "t30_i55_ps": 0.152,
                "t30_i60_ps": 0.02,
                "hazard_tier": "elevated",
                "arv": 1.35,
                "avs": 320.0,
                "jname": "砂礫質台地",
                "centroid_lon": 135.7642,
                "centroid_lat": 35.0115,
                "geometry": poly,
            }
        ],
        crs="EPSG:4326",
    )

    s_store = QuakeLensDataStore(processed_dir=tmp_path)
    s_store.buildings = buildings
    s_store.meshes = meshes
    s_store.summary = {
        "municipality": {"code": "26100", "name": "京都市", "name_en": "Kyoto City"},
        "counts": {"total_buildings": 1, "known_year_count": 1, "unknown_year_count": 0, "mesh_count": 1},
        "data_sources": [],
    }
    s_store.loaded = True

    monkeypatch.setattr(main_mod, "store", s_store)
    monkeypatch.setattr(main_mod, "board_store", b_store)
    monkeypatch.setattr(main_mod, "reports_store", r_store)
    return TestClient(main_mod.app, headers={"Authorization": "Bearer tok-geo"})


def test_torina_and_coordinate_parsing() -> None:
    assert (
        geo_mod.strip_kyoto_torina("京都市中京区寺町通御池上ル上本能寺前町488")
        == "京都市中京区上本能寺前町488"
    )
    assert (
        geo_mod.strip_kyoto_torina("京都市下京区烏丸通塩小路下ル東塩小路町901")
        == "京都市下京区東塩小路町901"
    )
    assert (
        geo_mod.strip_kyoto_torina("左京区今出川通烏丸東入玄武町")
        == "京都市左京区玄武町"
    )

    assert geo_mod.parse_coordinates("35.0116, 135.7681") == (35.0116, 135.7681)
    assert geo_mod.parse_coordinates("135.7681 35.0116") == (35.0116, 135.7681)
    assert geo_mod.parse_coordinates("中京区上本能寺前町") is None


def test_local_search_endpoints_cover_buildings_meshes_shelters_streets_and_coords(
    geo_test_client: TestClient,
) -> None:
    # 1. Exact Building ID
    r_bldg = geo_test_client.get(
        "/api/geocode/search",
        params={"q": "26100-bldg-1002", "use_external": "false"},
    )
    assert r_bldg.status_code == 200
    b_res = r_bldg.json()["results"]
    assert len(b_res) == 1
    assert b_res[0]["kind"] == "building"
    assert b_res[0]["building_id"] == "26100-bldg-1002"
    assert b_res[0]["kyoto_context"]["meshcode"] == "5235461024"

    # 2. Exact Meshcode
    r_mesh = geo_test_client.get(
        "/api/geocode/search",
        params={"q": "5235461024", "use_external": "false"},
    )
    assert r_mesh.status_code == 200
    m_res = r_mesh.json()["results"]
    assert len(m_res) == 1
    assert m_res[0]["kind"] == "mesh"
    assert m_res[0]["bbox"] is not None

    # 3. Official Shelter (from real kyoto_shelters.json)
    r_sh = geo_test_client.get(
        "/api/geocode/search",
        params={"q": "みつば幼稚園", "use_external": "false"},
    )
    assert r_sh.status_code == 200
    sh_res = r_sh.json()["results"]
    assert sh_res and sh_res[0]["kind"] == "shelter"
    assert "みつば幼稚園" in sh_res[0]["title"]
    assert sh_res[0]["shelter_id"]

    # 4. Named Kyoto Street (from kyoto_roads.json.gz)
    r_st = geo_test_client.get(
        "/api/geocode/search",
        params={"q": "烏丸通", "use_external": "false"},
    )
    assert r_st.status_code == 200
    st_res = r_st.json()["results"]
    assert st_res and st_res[0]["kind"] == "street"
    assert st_res[0]["title"] == "烏丸通"
    assert len(st_res[0]["street_segments"]) > 0

    # 5. Coordinates with local fallback reverse geocode + Kyoto context
    r_coord = geo_test_client.get(
        "/api/geocode/search",
        params={"q": "35.0115, 135.7642", "use_external": "false"},
    )
    assert r_coord.status_code == 200
    c_res = r_coord.json()["results"]
    assert len(c_res) == 1
    assert c_res[0]["kind"] == "coordinates"
    assert c_res[0]["kyoto_context"]["in_kyoto_coverage"] is True
    assert c_res[0]["kyoto_context"]["nearest_shelter"] is not None


def test_external_search_kyoto_priority_and_graceful_fallback(
    geo_test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_gsi(_client: Any, query: str) -> list[dict[str, Any]]:
        if "上本能寺前町488" in query and "通" not in query:
            return [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [135.767746, 35.011497]},
                    "properties": {
                        "addressCode": "26104",
                        "title": "京都府京都市中京区上本能寺前町４８８番地",
                        "dataSource": "1",
                    },
                }
            ]
        if query == "清水寺":
            return [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [135.317123, 34.966812]},
                    "properties": {"addressCode": "", "title": "兵庫県猪名川町清水寺ノ前"},
                }
            ]
        return []

    async def fake_nom(_client: Any, query: str) -> list[dict[str, Any]]:
        if query == "清水寺":
            return [
                {
                    "place_id": 9991,
                    "lat": "34.9943030",
                    "lon": "135.7844389",
                    "name": "清水寺",
                    "display_name": "清水寺, 東山区, 京都市, 京都府",
                    "class": "tourism",
                    "type": "attraction",
                    "importance": 0.7,
                    "address": {
                        "province": "京都府",
                        "city": "京都市",
                        "city_district": "東山区",
                        "quarter": "清水一丁目",
                        "postcode": "605-0862",
                    },
                }
            ]
        return []

    monkeypatch.setattr(geo_mod, "_query_gsi_search", fake_gsi)
    monkeypatch.setattr(geo_mod, "_query_nominatim", fake_nom)

    # Kyoto address with torina resolves cleanly to exact番地
    r_addr = geo_test_client.get(
        "/api/geocode/search",
        params={"q": "京都市中京区寺町通御池上ル上本能寺前町488"},
    )
    assert r_addr.status_code == 200
    addr_res = r_addr.json()["results"]
    assert addr_res[0]["title"] == "京都府京都市中京区上本能寺前町488番地"
    assert addr_res[0]["ward_name"] == "中京区"

    # Kyoto landmark outranks out-of-prefecture match
    r_poi = geo_test_client.get("/api/geocode/search", params={"q": "清水寺"})
    assert r_poi.status_code == 200
    poi_res = r_poi.json()["results"]
    assert poi_res[0]["title"] == "清水寺"
    assert "東山区" in poi_res[0]["address"]

    # Reverse endpoint degrades cleanly without external network
    r_rev = geo_test_client.get(
        "/api/geocode/reverse",
        params={"lat": 35.0115, "lon": 135.7642, "use_external": "false"},
    )
    assert r_rev.status_code == 200
    rev_json = r_rev.json()
    assert rev_json["ward_name"] == "中京区"
    assert rev_json["kyoto_context"]["meshcode"] == "5235461024"

    # External API exception still succeeds with local fallback + notice
    geo_mod.clear_geocode_cache()

    async def failing_ext(_client: Any, _query: str) -> list[dict[str, Any]]:
        raise RuntimeError("network offline")

    monkeypatch.setattr(geo_mod, "_query_gsi_search", failing_ext)
    monkeypatch.setattr(geo_mod, "_query_nominatim", failing_ext)

    r_fallback = geo_test_client.get("/api/geocode/search", params={"q": "中京区"})
    assert r_fallback.status_code == 200
    fb = r_fallback.json()
    assert fb["count"] >= 1
    assert fb["results"][0]["ward_name"] == "中京区"
    assert fb["notice"] is not None
