"""Reproducible Phase 2 data pipeline for QuakeLens Japan.

Downloads Project PLATEAU CityGML building footprints and attributes for Kyoto City
(plateau-26100-kyoto-shi-2025) via CKAN + RemoteZip, queries J-SHIS Web API
(Y2024 PSHM & V4 Surface Soil), unifies CRS to EPSG:6674 (JGD2011 CS VI) for spatial
join, and exports normalized GeoParquet, GeoJSON, and summary JSON.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import httpx
import pandas as pd
from lxml import etree
from remotezip import RemoteZip
from shapely.geometry import Polygon
from shapely.validation import make_valid

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.constants import (  # noqa: E402
    AGE_CATEGORY_ORDER,
    DATA_SOURCES,
    HAZARD_TIER_ORDER,
    NON_RESIDENTIAL_USAGE_CODES,
    RESIDENTIAL_USAGE_CODES,
    TARGET_MUNICIPALITY,
    WARD_NAMES,
    classify_age_category,
    classify_hazard_tier,
)

CKAN_PACKAGE_URL = "https://www.geospatial.jp/ckan/api/3/action/package_show"
JSHIS_PSHM_URL = "https://www.j-shis.bosai.go.jp/map/api/pshm/Y2024/AVR/TTL_MTTL/meshinfo.geojson"
JSHIS_SSTRCT_URL = "https://www.j-shis.bosai.go.jp/map/api/sstrct/V4/meshinfo.geojson"

DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
JSHIS_CACHE_DIR = DATA_DIR / "jshis_cache"
PROCESSED_DIR = DATA_DIR / "processed"


def latlon_to_mesh250(lat: float, lon: float) -> str:
    """Compute JIS X 0410 5th-order (250m) mesh code from WGS84/JGD2011 lat, lon."""
    p = int(lat * 1.5)
    u = int(lon - 100)
    lat_rem = lat * 1.5 - p
    lon_rem = (lon - 100) - u

    q = int(lat_rem * 8)
    v = int(lon_rem * 8)
    lat_rem2 = lat_rem * 8 - q
    lon_rem2 = lon_rem * 8 - v

    r = int(lat_rem2 * 10)
    w = int(lon_rem2 * 10)
    lat_rem3 = lat_rem2 * 10 - r
    lon_rem3 = lon_rem2 * 10 - w

    m4_lat = int(lat_rem3 * 2)
    m4_lon = int(lon_rem3 * 2)
    m4 = m4_lat * 2 + m4_lon + 1
    lat_rem4 = lat_rem3 * 2 - m4_lat
    lon_rem4 = lon_rem3 * 2 - m4_lon

    m5_lat = int(lat_rem4 * 2)
    m5_lon = int(lon_rem4 * 2)
    m5 = m5_lat * 2 + m5_lon + 1
    return f"{p:02d}{u:02d}{q}{v}{r}{w}{m4}{m5}"


def parse_codelist(xml_bytes: bytes) -> dict[str, str]:
    """Parse a GML Dictionary codelist mapping code -> Japanese description."""
    root = etree.fromstring(xml_bytes)
    mapping: dict[str, str] = {}
    for entry in root.xpath(".//*[local-name()='Definition']"):
        name_el = entry.xpath("./*[local-name()='name']")
        desc_el = entry.xpath("./*[local-name()='description']")
        if name_el and desc_el and name_el[0].text and desc_el[0].text:
            mapping[name_el[0].text.strip()] = desc_el[0].text.strip()
    return mapping


def parse_poslist_to_ring(text: str, srs_dim: int = 3) -> list[tuple[float, float]] | None:
    """Convert EPSG:6697 (lat, lon, [z]) posList string into (lon, lat) ring coords."""
    nums = text.strip().split()
    if len(nums) < srs_dim * 3:
        return None
    coords: list[tuple[float, float]] = []
    step = srs_dim
    for i in range(0, len(nums) - step + 1, step):
        lat = float(nums[i])
        lon = float(nums[i + 1])
        coords.append((lon, lat))
    if len(coords) < 3:
        return None
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def extract_footprint(bldg_elem: etree._Element) -> Polygon | None:
    """Extract 2D footprint polygon (lon, lat) from lod0RoofEdge or lod0FootPrint."""
    for lod_tag in ("lod0RoofEdge", "lod0FootPrint"):
        lod_nodes = bldg_elem.xpath(f"./*[local-name()='{lod_tag}']")
        if not lod_nodes:
            continue
        pos_lists = lod_nodes[0].xpath(".//*[local-name()='exterior']//*[local-name()='posList']")
        if not pos_lists:
            pos_lists = lod_nodes[0].xpath(".//*[local-name()='posList']")
        if not pos_lists:
            continue
        best_poly: Polygon | None = None
        best_area = -1.0
        for pl in pos_lists:
            if not pl.text:
                continue
            dim_attr = pl.get("srsDimension")
            dim = int(dim_attr) if dim_attr and dim_attr.isdigit() else 3
            ring = parse_poslist_to_ring(pl.text, dim)
            if ring is None:
                continue
            try:
                poly = Polygon(ring)
                if not poly.is_valid:
                    poly = make_valid(poly)
                if poly.geom_type == "MultiPolygon":
                    poly = max(poly.geoms, key=lambda g: g.area)
                if poly.geom_type == "Polygon" and not poly.is_empty and poly.area > best_area:
                    best_poly = poly
                    best_area = poly.area
            except Exception:
                continue
        if best_poly is not None:
            return best_poly.simplify(0.000003, preserve_topology=True)
    return None


def parse_citygml_bytes(
    gml_bytes: bytes,
    usage_map: dict[str, str],
    struct_map: dict[str, str],
    ward_map: dict[str, str],
) -> list[dict[str, Any]]:
    """Stream-parse Building elements from a single CityGML file."""
    rows: list[dict[str, Any]] = []
    bldg_tag = "{http://www.opengis.net/citygml/building/2.0}Building"
    context = etree.iterparse(io.BytesIO(gml_bytes), events=("end",), tag=bldg_tag)

    for _, elem in context:
        poly = extract_footprint(elem)
        if poly is None or poly.is_empty:
            elem.clear()
            continue

        gml_id = elem.get("{http://www.opengis.net/gml}id") or ""
        bldg_id_nodes = elem.xpath(".//*[local-name()='buildingID']")
        bldg_id = bldg_id_nodes[0].text.strip() if bldg_id_nodes and bldg_id_nodes[0].text else gml_id

        # Construction year (strictly validated; sentinel values like 0001/9999 -> None)
        year_built: int | None = None
        yoc_nodes = elem.xpath("./*[local-name()='yearOfConstruction']")
        if yoc_nodes and yoc_nodes[0].text:
            raw_y = yoc_nodes[0].text.strip()[:4]
            if raw_y.isdigit():
                y_val = int(raw_y)
                if 1850 <= y_val <= 2026:
                    year_built = y_val

        # Usage
        usage_nodes = elem.xpath("./*[local-name()='usage']")
        usage_code = usage_nodes[0].text.strip() if usage_nodes and usage_nodes[0].text else None
        usage_label = usage_map.get(usage_code, "不明") if usage_code else "不明"
        if usage_code in RESIDENTIAL_USAGE_CODES:
            usage_group = "residential"
        elif usage_code in NON_RESIDENTIAL_USAGE_CODES:
            usage_group = "non_residential"
        else:
            usage_group = "unknown"

        # Structure type
        struct_nodes = elem.xpath(".//*[local-name()='buildingStructureType']")
        struct_code = struct_nodes[0].text.strip() if struct_nodes and struct_nodes[0].text else None
        if struct_code == "611" or not struct_code:
            structure_label = "不明"
        else:
            structure_label = struct_map.get(struct_code, "不明")

        # Height & storeys
        height_nodes = elem.xpath("./*[local-name()='measuredHeight']")
        measured_height: float | None = None
        if height_nodes and height_nodes[0].text:
            try:
                h = float(height_nodes[0].text.strip())
                if 0.0 < h < 1000.0:
                    measured_height = round(h, 2)
            except ValueError:
                pass

        storey_nodes = elem.xpath("./*[local-name()='storeysAboveGround']")
        storeys_above: int | None = None
        if storey_nodes and storey_nodes[0].text:
            raw_s = storey_nodes[0].text.strip()
            if raw_s.isdigit():
                s_val = int(raw_s)
                if 1 <= s_val <= 200:
                    storeys_above = s_val

        # Ward code from uro:buildingIDAttribute/uro:BuildingIDAttribute/uro:city
        ward_nodes = elem.xpath(".//*[local-name()='BuildingIDAttribute']/*[local-name()='city']")
        ward_code = ward_nodes[0].text.strip() if ward_nodes and ward_nodes[0].text else None
        ward_name = WARD_NAMES.get(ward_code or "", ward_map.get(ward_code or "", "不明"))
        if ward_name.startswith("京都府京都市"):
            ward_name = ward_name.replace("京都府京都市", "")

        centroid = poly.centroid
        mesh250_hint = latlon_to_mesh250(centroid.y, centroid.x)

        rows.append({
            "building_id": bldg_id,
            "ward_code": ward_code or "unknown",
            "ward_name": ward_name,
            "year_built": year_built,
            "age_category": classify_age_category(year_built),
            "usage_code": usage_code or "unknown",
            "usage_label": usage_label,
            "usage_group": usage_group,
            "structure_code": struct_code or "unknown",
            "structure_label": structure_label,
            "measured_height": measured_height,
            "storeys_above": storeys_above,
            "mesh250_hint": mesh250_hint,
            "geometry": poly,
        })

        elem.clear()
        while elem.getprevious() is not None:
            del elem.getparent()[0]

    return rows


def fetch_plateau_metadata() -> dict[str, Any]:
    """Query Geospatial Information Center CKAN API for package metadata."""
    resp = httpx.get(
        CKAN_PACKAGE_URL,
        params={"id": TARGET_MUNICIPALITY["plateau_package_id"]},
        timeout=20,
    )
    resp.raise_for_status()
    pkg = resp.json()["result"]
    citygml_url = next(
        res["url"]
        for res in pkg["resources"]
        if "citygml" in (res.get("name") or "").lower() and (res.get("url") or "").endswith(".zip")
    )
    return {
        "title": pkg.get("title"),
        "license_title": pkg.get("license_title"),
        "license_url": pkg.get("license_url"),
        "metadata_modified": pkg.get("metadata_modified"),
        "citygml_url": citygml_url,
    }


async def fetch_single_jshis_mesh(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    meshcode: str,
) -> dict[str, Any] | None:
    """Fetch PSHM (Y2024) + SSTRCT (V4) GeoJSON for a 250m mesh with retries."""
    async with sem:
        for attempt in range(3):
            try:
                r1, r2 = await asyncio.gather(
                    client.get(JSHIS_PSHM_URL, params={"meshcode": meshcode}),
                    client.get(JSHIS_SSTRCT_URL, params={"meshcode": meshcode}),
                )
                if r1.status_code != 200 or r2.status_code != 200:
                    if attempt < 2:
                        await asyncio.sleep(0.5 * (attempt + 1))
                        continue
                    return None
                d1 = r1.json()
                d2 = r2.json()
                f1 = (d1.get("features") or [None])[0]
                f2 = (d2.get("features") or [None])[0]
                if not f1:
                    return None
                p1 = f1.get("properties", {})
                p2 = f2.get("properties", {}) if f2 else {}

                def to_float(val: Any) -> float | None:
                    try:
                        return float(val) if val is not None else None
                    except (TypeError, ValueError):
                        return None

                t30_i55 = to_float(p1.get("T30_I55_PS"))
                return {
                    "meshcode": meshcode,
                    "geometry": f1["geometry"],
                    "t30_i45_ps": to_float(p1.get("T30_I45_PS")),
                    "t30_i50_ps": to_float(p1.get("T30_I50_PS")),
                    "t30_i55_ps": t30_i55,
                    "t30_i60_ps": to_float(p1.get("T30_I60_PS")),
                    "t50_p02_si": to_float(p1.get("T50_P02_SI")),
                    "hazard_tier": classify_hazard_tier(t30_i55),
                    "arv": to_float(p2.get("ARV")),
                    "avs": to_float(p2.get("AVS")),
                    "jcode": p2.get("JCODE"),
                    "jname": p2.get("JNAME") or "不明",
                }
            except Exception:
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                else:
                    return None
    return None


async def fetch_all_jshis_meshes(meshcodes: list[str], cache_file: Path) -> dict[str, dict[str, Any]]:
    """Load cached J-SHIS meshes and fetch any missing ones concurrently."""
    cached: dict[str, dict[str, Any]] = {}
    if cache_file.exists():
        cached = json.loads(cache_file.read_text(encoding="utf-8"))

    missing = [m for m in meshcodes if m not in cached]
    if missing:
        print(f"Fetching {len(missing)} J-SHIS 250m meshes (cached: {len(cached)})...")
        sem = asyncio.Semaphore(12)
        limits = httpx.Limits(max_connections=20, max_keepalive_connections=15)
        async with httpx.AsyncClient(timeout=20, limits=limits) as client:
            for i in range(0, len(missing), 100):
                batch = missing[i : i + 100]
                results = await asyncio.gather(
                    *(fetch_single_jshis_mesh(client, sem, m) for m in batch)
                )
                for m, res in zip(batch, results):
                    if res is not None:
                        cached[m] = res
                print(f"  J-SHIS progress: {min(i + 100, len(missing))}/{len(missing)}")
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(cached, ensure_ascii=False), encoding="utf-8")
    else:
        print(f"All {len(meshcodes)} J-SHIS meshes loaded from cache.")

    return cached


def run_pipeline(max_files: int = 0) -> None:
    t_start = time.time()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    JSHIS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    print("1. Fetching PLATEAU metadata from geospatial.jp CKAN...")
    meta = fetch_plateau_metadata()
    citygml_url = meta["citygml_url"]
    print(f"   Package: {meta['title']} (modified: {meta['metadata_modified']})")

    print("2. Streaming PLATEAU CityGML building files via RemoteZip...")
    all_rows: list[dict[str, Any]] = []
    with RemoteZip(citygml_url) as z:
        usage_map = parse_codelist(z.read("codelists/Building_usage.xml"))
        struct_map = parse_codelist(z.read("codelists/BuildingDetailAttribute_buildingStructureType.xml"))
        ward_map = parse_codelist(z.read("codelists/Common_localPublicAuthorities.xml"))

        bldg_files = sorted(n for n in z.namelist() if "/bldg/" in n and n.endswith(".gml"))
        if max_files > 0:
            # Sample spread across the city when testing
            step = max(1, len(bldg_files) // max_files)
            bldg_files = bldg_files[::step][:max_files]

        print(f"   Processing {len(bldg_files)} CityGML files...")
        for idx, fn in enumerate(bldg_files, 1):
            cache_gml = RAW_DIR / Path(fn).name
            if cache_gml.exists():
                gml_bytes = cache_gml.read_bytes()
            else:
                gml_bytes = z.read(fn)
                cache_gml.write_bytes(gml_bytes)

            file_rows = parse_citygml_bytes(gml_bytes, usage_map, struct_map, ward_map)
            all_rows.extend(file_rows)
            if idx % 25 == 0 or idx == len(bldg_files):
                print(f"   Parsed {idx}/{len(bldg_files)} files -> {len(all_rows):,} buildings")

    gdf_bldgs = gpd.GeoDataFrame(all_rows, geometry="geometry", crs="EPSG:4326")
    print(f"   Total extracted buildings: {len(gdf_bldgs):,}")

    print("3. Fetching J-SHIS Y2024 hazard & V4 surface soil meshes...")
    unique_meshes = sorted(gdf_bldgs["mesh250_hint"].unique().tolist())
    jshis_cache_file = JSHIS_CACHE_DIR / "kyoto_meshes_y2024_v4.json"
    jshis_data = asyncio.run(fetch_all_jshis_meshes(unique_meshes, jshis_cache_file))

    mesh_rows = []
    for mc in unique_meshes:
        item = jshis_data.get(mc)
        if not item:
            continue
        coords = item["geometry"]["coordinates"][0]
        mesh_rows.append({
            "meshcode": mc,
            "t30_i45_ps": item["t30_i45_ps"],
            "t30_i50_ps": item["t30_i50_ps"],
            "t30_i55_ps": item["t30_i55_ps"],
            "t30_i60_ps": item["t30_i60_ps"],
            "t50_p02_si": item["t50_p02_si"],
            "hazard_tier": item["hazard_tier"],
            "arv": item["arv"],
            "avs": item["avs"],
            "jcode": item["jcode"],
            "jname": item["jname"],
            "geometry": Polygon(coords),
        })

    gdf_meshes = gpd.GeoDataFrame(mesh_rows, geometry="geometry", crs="EPSG:4326")
    print(f"   Loaded {len(gdf_meshes):,} J-SHIS 250m mesh polygons")

    print("4. Unifying CRS to EPSG:6674 (JGD2011 CS VI) and running spatial join...")
    metric_crs = TARGET_MUNICIPALITY["metric_crs"]
    meshes_metric = gdf_meshes.to_crs(metric_crs)

    bldgs_metric = gdf_bldgs.to_crs(metric_crs)
    bldgs_metric["footprint_area_m2"] = bldgs_metric.geometry.area.round(1)
    centroids_metric = bldgs_metric.copy()
    centroids_metric["geometry"] = bldgs_metric.geometry.centroid

    joined = gpd.sjoin(
        centroids_metric[["building_id", "geometry"]],
        meshes_metric[["meshcode", "t30_i55_ps", "t30_i60_ps", "t30_i50_ps", "hazard_tier", "arv", "avs", "jname", "geometry"]],
        how="left",
        predicate="intersects",
    )
    # Deduplicate if centroid fell exactly on mesh border
    joined = joined.drop_duplicates(subset=["building_id"]).drop(columns=["index_right", "geometry"])

    gdf_bldgs["footprint_area_m2"] = bldgs_metric["footprint_area_m2"].values
    gdf_bldgs = gdf_bldgs.merge(joined, on="building_id", how="left")
    gdf_bldgs["meshcode"] = gdf_bldgs["meshcode"].fillna(gdf_bldgs["mesh250_hint"])
    gdf_bldgs["hazard_tier"] = gdf_bldgs["hazard_tier"].fillna("unknown")
    gdf_bldgs["jname"] = gdf_bldgs["jname"].fillna("不明")
    gdf_bldgs = gdf_bldgs.drop(columns=["mesh250_hint"])

    print("5. Aggregating mesh & city-wide statistics...")
    df_b = pd.DataFrame(gdf_bldgs.drop(columns=["geometry"]))

    def agg_mesh(g: pd.DataFrame) -> pd.Series:
        total = len(g)
        known = int((g["age_category"] != "unknown").sum())
        unknown = total - known
        pre81 = int((g["age_category"] == "pre_1981").sum())
        b82_00 = int((g["age_category"] == "1982_2000").sum())
        post01 = int((g["age_category"] == "post_2001").sum())
        res_total = int((g["usage_group"] == "residential").sum())
        pre81_res = int(((g["age_category"] == "pre_1981") & (g["usage_group"] == "residential")).sum())
        wooden_pre81 = int(((g["age_category"] == "pre_1981") & (g["structure_code"] == "601")).sum())
        ward_mode = g["ward_name"].mode().iloc[0] if not g["ward_name"].mode().empty else "不明"
        return pd.Series({
            "ward_name": ward_mode,
            "total_buildings": total,
            "known_year_count": known,
            "unknown_year_count": unknown,
            "pre_1981_count": pre81,
            "b1982_2000_count": b82_00,
            "post_2001_count": post01,
            "residential_count": res_total,
            "pre_1981_residential_count": pre81_res,
            "wooden_pre_1981_count": wooden_pre81,
            "known_year_rate": round(known / total, 4) if total else 0.0,
            "pre_1981_share_total": round(pre81 / total, 4) if total else 0.0,
            "pre_1981_share_known": round(pre81 / known, 4) if known else None,
        })

    mesh_stats = df_b.groupby("meshcode").apply(agg_mesh).reset_index()
    gdf_meshes_out = gdf_meshes.merge(mesh_stats, on="meshcode", how="inner")
    mesh_centroids_wgs84 = gdf_meshes_out.to_crs(metric_crs).geometry.centroid.to_crs("EPSG:4326")
    gdf_meshes_out["centroid_lon"] = mesh_centroids_wgs84.x.round(6)
    gdf_meshes_out["centroid_lat"] = mesh_centroids_wgs84.y.round(6)

    # Save GeoParquet (EPSG:4326) and GeoJSON
    buildings_parquet = PROCESSED_DIR / "buildings.parquet"
    meshes_geojson = PROCESSED_DIR / "meshes.geojson"
    summary_json = PROCESSED_DIR / "summary.json"

    gdf_bldgs.to_parquet(buildings_parquet, index=False, compression="zstd")
    gdf_meshes_out.to_file(meshes_geojson, driver="GeoJSON")

    # Compute summary metadata
    total_b = len(df_b)
    known_y = int((df_b["year_built"].notna()).sum())
    unknown_y = total_b - known_y
    pre81_total = int((df_b["age_category"] == "pre_1981").sum())
    overlap_high_pre81 = int(
        ((df_b["age_category"] == "pre_1981") & (df_b["hazard_tier"].isin(["very_high", "elevated"]))).sum()
    )
    overlap_very_high_pre81 = int(
        ((df_b["age_category"] == "pre_1981") & (df_b["hazard_tier"] == "very_high")).sum()
    )

    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "is_partial_sample": max_files > 0,
        "municipality": TARGET_MUNICIPALITY,
        "plateau_metadata": meta,
        "data_sources": DATA_SOURCES,
        "counts": {
            "total_buildings": total_b,
            "known_year_count": known_y,
            "unknown_year_count": unknown_y,
            "known_year_rate": round(known_y / total_b, 4) if total_b else 0.0,
            "unknown_year_rate": round(unknown_y / total_b, 4) if total_b else 0.0,
            "known_usage_rate": round(float((df_b["usage_group"] != "unknown").mean()), 4) if total_b else 0.0,
            "known_structure_rate": round(float((df_b["structure_label"] != "不明").mean()), 4) if total_b else 0.0,
            "known_storeys_rate": round(float((df_b["storeys_above"].notna()).mean()), 4) if total_b else 0.0,
            "pre_1981_high_or_elevated_hazard_count": overlap_high_pre81,
            "pre_1981_very_high_hazard_count": overlap_very_high_pre81,
            "mesh_count": len(gdf_meshes_out),
            "age_breakdown": {cat: int((df_b["age_category"] == cat).sum()) for cat in AGE_CATEGORY_ORDER},
            "hazard_breakdown": {tier: int((df_b["hazard_tier"] == tier).sum()) for tier in HAZARD_TIER_ORDER},
        },
    }
    summary_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    dt = time.time() - t_start
    print(f"Done in {dt:.1f}s!")
    print(f"  buildings.parquet: {buildings_parquet.stat().st_size / 1e6:.2f} MB")
    print(f"  meshes.geojson:    {meshes_geojson.stat().st_size / 1e6:.2f} MB")
    print(f"  summary: total={total_b:,}, known_year={known_y:,} ({summary['counts']['known_year_rate']*100:.1f}%), pre1981={pre81_total:,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-files", type=int, default=0, help="Limit CityGML files (0 = all)")
    args = parser.parse_args()
    run_pipeline(max_files=args.max_files)
