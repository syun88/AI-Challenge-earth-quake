"""FastAPI application for QuakeLens Japan."""

from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from app.ai_assistant import ask_quakelens_ai, stream_quakelens_ai
from app.bcp_site import recommend_safe_enterprise_sites
from app.board_store import BOARD_STATUS_LABELS, DisasterBoardStore
from app.constants import (
    OFFICIAL_RETROFIT_PROGRAMS,
    REPORT_CATEGORY_LABELS,
    REPORT_SEVERITY_LABELS,
    VERIFICATION_STATUS_LABELS,
)
from app.data_store import QuakeLensDataStore
from app.disaster_updates import updates_store
from app.export_utils import generate_disaster_csv, generate_disaster_xlsx
from app.geocoding import reverse_geocode, search_locations
from app.r8_seismic import r8_seismic_store
from app.reports_store import DamageReportStore
from app.route_sim import (
    _evaluate_network,
    get_network_status,
    get_roads_in_bbox,
    list_route_nodes,
    resolve_road_corridor,
    resolve_road_stroke,
    simulate_alternative_route,
    simulate_navigation,
    snap_road_info,
)
from app.security import (
    ai_guard,
    extract_client_ip,
    get_cors_allow_origins,
    redact_secrets,
    validate_chat_inputs,
)
from app.shelter_rec import recommend_shelters, shelter_store

# Load .env from repo root or backend directory
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

JMA_QUAKE_LIST_URL = "https://www.jma.go.jp/bosai/quake/data/list.json"
COD_RE = re.compile(r"^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?/")

store = QuakeLensDataStore()
board_store = DisasterBoardStore()
reports_store = DamageReportStore()
_quake_cache: dict[str, Any] = {"fetched_at": 0.0, "data": []}


@asynccontextmanager
async def lifespan(_: FastAPI):
    board_store.ensure_initialized()
    reports_store.ensure_initialized()
    shelter_store.ensure_loaded()
    updates_store.ensure_loaded()
    r8_seismic_store.ensure_loaded()
    if store.buildings_path.exists() and store.meshes_path.exists():
        store.load()
    yield


app = FastAPI(
    title="QuakeLens Japan API",
    description="PLATEAU建築年データ × J-SHIS地震ハザード・表層地盤 × 災害伝言板・被害報告 × Gemini Function Calling API",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_allow_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Gemini-Api-Key", "X-Ai-Access-Code"],
)


def _require_store() -> QuakeLensDataStore:
    if not store.loaded:
        if store.buildings_path.exists() and store.meshes_path.exists():
            store.load()
        else:
            raise HTTPException(
                status_code=503,
                detail="Processed spatial data is not built yet. Run `uv run python scripts/fetch_and_build.py`.",
            )
    return store


def _split_csv(val: str | None) -> list[str] | None:
    if not val:
        return None
    parts = [p.strip() for p in val.split(",") if p.strip()]
    return parts or None


def _parse_jma_cod(cod: str | None) -> tuple[float | None, float | None, float | None]:
    if not cod:
        return None, None, None
    m = COD_RE.match(cod)
    if not m:
        return None, None, None
    lat = float(m.group(1))
    lon = float(m.group(2))
    depth_m = abs(float(m.group(3))) if m.group(3) else None
    depth_km = round(depth_m / 1000.0, 1) if depth_m is not None else None
    return lat, lon, depth_km


@app.get("/", response_class=HTMLResponse)
def root() -> str:
    return """<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>QuakeLens Japan API</title></head>
<body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;line-height:1.7;">
  <h1>QuakeLens Japan Backend API</h1>
  <p>このポート（8000）は <strong>FastAPI バックエンドAPI</strong> です。</p>
  <p>地図・ダッシュボード・AI解説のWeb画面は、別ターミナルでフロントエンドを起動して <a href="http://localhost:3000" style="color:#38bdf8;">http://localhost:3000</a> を開いてください。</p>
  <ul>
    <li>API ドキュメント: <a href="/docs" style="color:#38bdf8;">/docs</a></li>
    <li>ヘルスチェック: <a href="/api/health" style="color:#38bdf8;">/api/health</a></li>
  </ul>
</body>
</html>"""


@app.get("/api/health")
def health() -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    server_key_usable = bool(
        api_key and api_key != "your_gemini_api_key_here" and ai_guard.server_key_public_enabled()
    )
    return {
        "status": "ok",
        "data_loaded": store.loaded,
        "building_count": int(len(store.buildings)) if store.loaded else 0,
        "mesh_count": int(len(store.meshes)) if store.loaded else 0,
        "gemini_configured": server_key_usable,
        "ai_protection": ai_guard.get_protection_status(),
    }


@app.get("/api/metadata")
def get_metadata() -> dict[str, Any]:
    return _require_store().get_metadata()


@app.get("/api/stats")
def get_stats(
    ward: str | None = Query(default=None),
    age_categories: str | None = Query(default=None),
    hazard_tiers: str | None = Query(default=None),
    usage_group: str | None = Query(default=None),
    meshcode: str | None = Query(default=None),
) -> dict[str, Any]:
    return _require_store().get_stats(
        ward=ward,
        age_categories=_split_csv(age_categories),
        hazard_tiers=_split_csv(hazard_tiers),
        usage_group=usage_group,
        meshcode=meshcode,
    )


@app.get("/api/meshes")
def get_meshes(ward: str | None = Query(default=None)) -> dict[str, Any]:
    return _require_store().get_meshes_geojson(ward=ward)


@app.get("/api/meshes/{meshcode}")
def get_mesh_detail(meshcode: str) -> dict[str, Any]:
    detail = _require_store().get_mesh_detail(meshcode)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Mesh {meshcode} not found")
    return detail


@app.get("/api/priority-areas")
def get_priority_areas(
    ward: str | None = Query(default=None),
    hazard_tiers: str | None = Query(default=None),
    usage_group: str | None = Query(default=None),
    min_t30_i55: float = Query(default=0.0, ge=0.0, le=1.0),
    min_buildings: int = Query(default=20, ge=1),
    sort_by: str = Query(default="pre_1981_high_hazard"),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    areas = _require_store().get_priority_areas(
        ward=ward,
        hazard_tiers=_split_csv(hazard_tiers),
        usage_group=usage_group,
        min_t30_i55=min_t30_i55,
        min_buildings=min_buildings,
        sort_by=sort_by,
        limit=limit,
    )
    return {"count": len(areas), "sort_by": sort_by, "areas": areas}


@app.get("/api/buildings")
def get_buildings(
    bbox: str | None = Query(default=None, description="minx,miny,maxx,maxy in EPSG:4326"),
    ward: str | None = Query(default=None),
    age_categories: str | None = Query(default=None),
    hazard_tiers: str | None = Query(default=None),
    usage_group: str | None = Query(default=None),
    meshcode: str | None = Query(default=None),
    limit: int = Query(default=20000, ge=1, le=100000),
) -> dict[str, Any]:
    parsed_bbox: tuple[float, float, float, float] | None = None
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError
            parsed_bbox = (parts[0], parts[1], parts[2], parts[3])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bbox must be minx,miny,maxx,maxy") from exc

    return _require_store().get_buildings_geojson(
        bbox=parsed_bbox,
        ward=ward,
        age_categories=_split_csv(age_categories),
        hazard_tiers=_split_csv(hazard_tiers),
        usage_group=usage_group,
        meshcode=meshcode,
        limit=limit,
    )


@app.get("/api/buildings/count")
def count_buildings(
    bbox: str | None = Query(default=None, description="minx,miny,maxx,maxy in EPSG:4326"),
    ward: str | None = Query(default=None),
    age_categories: str | None = Query(default=None),
    hazard_tiers: str | None = Query(default=None),
    usage_group: str | None = Query(default=None),
    meshcode: str | None = Query(default=None),
) -> dict[str, Any]:
    parsed_bbox: tuple[float, float, float, float] | None = None
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError
            parsed_bbox = (parts[0], parts[1], parts[2], parts[3])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bbox must be minx,miny,maxx,maxy") from exc

    return _require_store().count_buildings_in_bbox(
        bbox=parsed_bbox,
        ward=ward,
        age_categories=_split_csv(age_categories),
        hazard_tiers=_split_csv(hazard_tiers),
        usage_group=usage_group,
        meshcode=meshcode,
    )


@app.get("/api/tiles/buildings/{z}/{x}/{y}.pbf")
def get_buildings_tile(
    z: int,
    x: int,
    y: int,
    request: Request,
) -> Response:
    if z < 0 or z > 20:
        raise HTTPException(status_code=400, detail="Invalid zoom level")
    s = _require_store()
    accept_enc = request.headers.get("accept-encoding", "")
    wants_gzip = "gzip" in accept_enc.lower()
    payload = s.get_building_tile_mvt(z=z, x=x, y=y, gzipped=wants_gzip)
    headers = {
        "Cache-Control": "public, max-age=3600",
        "Vary": "Accept-Encoding",
    }
    if wants_gzip and payload:
        headers["Content-Encoding"] = "gzip"
    return Response(content=payload, media_type="application/x-protobuf", headers=headers)


@app.get("/api/buildings/{building_id}")
def get_building_detail(building_id: str) -> dict[str, Any]:
    detail = _require_store().get_building_detail(building_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Building {building_id} not found")
    return detail


@app.get("/api/official-programs")
def get_official_programs() -> dict[str, Any]:
    return {"municipality": "京都市", "programs": OFFICIAL_RETROFIT_PROGRAMS}


@app.get("/api/earthquakes")
async def get_recent_earthquakes(limit: int = Query(default=40, ge=1, le=100)) -> dict[str, Any]:
    """Fetch Kyoto-epicenter earthquakes from JMA Bosai JSON API (5-min cache) + Kyoto archive."""
    now = time.time()
    if now - _quake_cache["fetched_at"] > 300 or not _quake_cache["data"]:
        parsed: list[dict[str, Any]] = []
        seen_keys: set[tuple[str, str]] = set()
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(JMA_QUAKE_LIST_URL)
                resp.raise_for_status()
                raw = resp.json()
            for item in raw:
                anm = str(item.get("anm") or "")
                if "京都" not in anm:
                    continue
                lat, lon, depth_km = _parse_jma_cod(item.get("cod"))
                if lat is None or lon is None:
                    continue
                try:
                    mag = float(item["mag"]) if item.get("mag") not in (None, "") else None
                except (TypeError, ValueError):
                    mag = None
                at_val = str(item.get("at") or "")
                parsed.append({
                    "eid": item.get("eid"),
                    "at": at_val,
                    "anm": anm,
                    "en_anm": item.get("en_anm"),
                    "ttl": item.get("ttl"),
                    "mag": mag,
                    "maxi": item.get("maxi"),
                    "lat": lat,
                    "lon": lon,
                    "depth_km": depth_km,
                })
                seen_keys.add((at_val[:10], anm))
        except Exception:
            pass

        # Include Kyoto-epicenter earthquakes with coordinates from the Kyoto archive (2025-2026 + history)
        for q in updates_store.query_updates(period="all", kind="earthquakes").get("earthquakes", []):
            if q.get("lat") is None or q.get("lon") is None:
                continue
            key = (str(q.get("date_iso") or ""), str(q.get("epicenter") or ""))
            if key in seen_keys:
                continue
            parsed.append({
                "eid": q.get("id"),
                "at": q.get("occurred_at"),
                "anm": q.get("epicenter"),
                "ttl": q.get("source"),
                "mag": q.get("mag"),
                "maxi": q.get("maxi"),
                "lat": q.get("lat"),
                "lon": q.get("lon"),
                "depth_km": q.get("depth_km"),
            })
            seen_keys.add(key)

        _quake_cache["data"] = parsed
        _quake_cache["fetched_at"] = now

    return {
        "source": "気象庁 地震情報 / 京都府震源アーカイブ（震源地：京都のみ）",
        "earthquakes": _quake_cache["data"][:limit],
    }


class BoardEntryCreateRequest(BaseModel):
    phone: str
    name: str
    status: str
    message: str
    ward_name: str = "京都市全域"
    meshcode: str | None = None
    passcode: str | None = None
    location_consent: bool | None = None


class BoardEntryUpdateRequest(BaseModel):
    passcode: str | None = None
    status: str | None = None
    message: str | None = None
    ward_name: str | None = None
    meshcode: str | None = None
    location_consent: bool | None = None


@app.get("/api/board")
def list_board_entries(
    phone: str | None = Query(default=None),
    q: str | None = Query(default=None),
    ward: str | None = Query(default=None),
    meshcode: str | None = Query(default=None),
    status: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
    ids: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    entries = board_store.list_entries(
        phone=phone,
        q=q,
        ward=ward,
        meshcode=meshcode,
        status=status,
        include_samples=include_samples,
        ids=_split_csv(ids),
        limit=limit,
    )
    return {
        "count": len(entries),
        "status_labels": BOARD_STATUS_LABELS,
        "entries": entries,
    }


@app.get("/api/board/summary")
def summarize_board_entries(
    ward: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
) -> dict[str, Any]:
    return board_store.summarize_entries(
        ward=ward,
        include_samples=include_samples,
        store=store if store.loaded else None,
    )


@app.post("/api/board")
def create_board_entry(req: BoardEntryCreateRequest) -> dict[str, Any]:
    entry = board_store.create_entry(
        phone=req.phone,
        name=req.name,
        status=req.status,
        message=req.message,
        ward_name=req.ward_name,
        meshcode=req.meshcode,
        passcode=req.passcode,
        location_consent=req.location_consent,
    )
    return {"entry": entry}


@app.patch("/api/board/{entry_id}")
def update_board_entry(entry_id: str, req: BoardEntryUpdateRequest) -> dict[str, Any]:
    entry = board_store.update_entry(
        entry_id=entry_id,
        passcode=req.passcode,
        status=req.status,
        message=req.message,
        ward_name=req.ward_name,
        meshcode=req.meshcode,
        location_consent=req.location_consent,
    )
    return {"entry": entry}


@app.delete("/api/board/{entry_id}")
def delete_board_entry(
    entry_id: str,
    passcode: str | None = Query(default=None),
) -> dict[str, Any]:
    return board_store.delete_entry(entry_id=entry_id, passcode=passcode)


class DamageReportCreateRequest(BaseModel):
    category: str
    severity: str = "moderate"
    title: str
    description: str
    ward_name: str = "京都市全域"
    meshcode: str | None = None
    building_id: str | None = None
    location_label: str | None = None
    lat: float | None = None
    lon: float | None = None
    location_consent: bool = False
    blocked_edge_ids: list[int] | None = None
    reporter_alias: str | None = None
    passcode: str | None = None
    reported_at: str | None = None
    force_duplicate: bool = False


class DamageReportUpdateRequest(BaseModel):
    passcode: str | None = None
    severity: str | None = None
    title: str | None = None
    description: str | None = None
    resolved: bool | None = None
    ward_name: str | None = None


class DamageReportSimilarRequest(BaseModel):
    ward_name: str
    category: str
    title: str = ""
    description: str = ""
    meshcode: str | None = None
    lat: float | None = None
    lon: float | None = None


@app.get("/api/reports")
def list_damage_reports(
    ward: str | None = Query(default=None),
    category: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    verification_status: str | None = Query(default=None),
    meshcode: str | None = Query(default=None),
    q: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
    include_resolved: bool = Query(default=True),
    limit: int = Query(default=100, ge=1, le=300),
) -> dict[str, Any]:
    reports = reports_store.list_reports(
        ward=ward,
        category=category,
        severity=severity,
        verification_status=verification_status,
        meshcode=meshcode,
        q=q,
        include_samples=include_samples,
        include_resolved=include_resolved,
        limit=limit,
    )
    return {
        "count": len(reports),
        "category_labels": REPORT_CATEGORY_LABELS,
        "severity_labels": REPORT_SEVERITY_LABELS,
        "verification_labels": VERIFICATION_STATUS_LABELS,
        "reports": reports,
    }


@app.get("/api/reports/summary")
def summarize_damage_reports(
    ward: str | None = Query(default=None),
    category: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
    include_resolved: bool = Query(default=False),
) -> dict[str, Any]:
    return reports_store.summarize_reports(
        ward=ward,
        category=category,
        include_samples=include_samples,
        include_resolved=include_resolved,
        store=store if store.loaded else None,
    )


@app.post("/api/reports/similar")
def find_similar_damage_reports(req: DamageReportSimilarRequest) -> dict[str, Any]:
    matches = reports_store.find_similar_reports(
        ward_name=req.ward_name,
        category=req.category,
        title=req.title,
        description=req.description,
        meshcode=req.meshcode,
        lat=req.lat,
        lon=req.lon,
        include_samples=False,
    )
    return {"count": len(matches), "similar_reports": matches}


@app.post("/api/reports")
def create_damage_report(req: DamageReportCreateRequest) -> dict[str, Any]:
    return reports_store.create_report(
        category=req.category,
        severity=req.severity,
        title=req.title,
        description=req.description,
        ward_name=req.ward_name,
        meshcode=req.meshcode,
        building_id=req.building_id,
        location_label=req.location_label,
        lat=req.lat,
        lon=req.lon,
        location_consent=req.location_consent,
        blocked_edge_ids=req.blocked_edge_ids,
        reporter_alias=req.reporter_alias,
        passcode=req.passcode,
        reported_at=req.reported_at,
        force_duplicate=req.force_duplicate,
    )


@app.post("/api/reports/{report_id}/confirm")
def confirm_damage_report(report_id: str) -> dict[str, Any]:
    report = reports_store.confirm_report(report_id)
    return {"report": report}


@app.patch("/api/reports/{report_id}")
def update_damage_report(report_id: str, req: DamageReportUpdateRequest) -> dict[str, Any]:
    report = reports_store.update_report(
        report_id,
        passcode=req.passcode,
        severity=req.severity,
        title=req.title,
        description=req.description,
        resolved=req.resolved,
        ward_name=req.ward_name,
    )
    return {"report": report}


@app.delete("/api/reports/{report_id}")
def delete_damage_report(
    report_id: str,
    passcode: str | None = Query(default=None),
) -> dict[str, Any]:
    return reports_store.delete_report(report_id=report_id, passcode=passcode)


@app.get("/api/disaster-overview")
def get_disaster_overview(
    ward: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
) -> dict[str, Any]:
    board_sum = board_store.summarize_entries(
        ward=ward,
        include_samples=include_samples,
        store=store if store.loaded else None,
    )
    rep_sum = reports_store.summarize_reports(
        ward=ward,
        include_samples=include_samples,
        include_resolved=False,
        store=store if store.loaded else None,
    )
    return {
        "ward": ward or "all",
        "include_samples": include_samples,
        "board_summary": board_sum,
        "report_summary": rep_sum,
    }


def _gather_export_inputs(
    *,
    ward: str | None,
    category: str | None,
    verification_status: str | None,
    include_samples: bool,
) -> dict[str, Any]:
    s = _require_store()
    stats = s.get_stats(ward=ward)
    board_sum = board_store.summarize_entries(ward=ward, include_samples=include_samples, store=s)
    board_entries = board_store.list_entries(ward=ward, include_samples=include_samples, limit=200)
    rep_sum = reports_store.summarize_reports(
        ward=ward,
        category=category,
        include_samples=include_samples,
        include_resolved=False,
        store=s,
    )
    reports = reports_store.list_reports(
        ward=ward,
        category=category,
        verification_status=verification_status,
        include_samples=include_samples,
        include_resolved=True,
        limit=300,
    )
    return {
        "stats": stats,
        "board_summary": board_sum,
        "board_entries": board_entries,
        "report_summary": rep_sum,
        "reports": reports,
        "ward_filter": ward,
    }


@app.get("/api/exports/disaster-summary.csv")
def export_disaster_csv(
    scope: str = Query(default="overview"),
    ward: str | None = Query(default=None),
    category: str | None = Query(default=None),
    verification_status: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
) -> Response:
    if scope not in {"overview", "wards", "reports", "board"}:
        raise HTTPException(status_code=400, detail="Invalid export scope")
    inputs = _gather_export_inputs(
        ward=ward,
        category=category,
        verification_status=verification_status,
        include_samples=include_samples,
    )
    payload = generate_disaster_csv(scope=scope, **inputs)
    filename = f"quakelens_kyoto_{scope}.csv"
    return Response(
        content=payload,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/exports/disaster-summary.xlsx")
def export_disaster_xlsx(
    ward: str | None = Query(default=None),
    category: str | None = Query(default=None),
    verification_status: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
) -> Response:
    inputs = _gather_export_inputs(
        ward=ward,
        category=category,
        verification_status=verification_status,
        include_samples=include_samples,
    )
    payload = generate_disaster_xlsx(**inputs)
    return Response(
        content=payload,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="quakelens_kyoto_summary.xlsx"'},
    )


@app.get("/api/routes/nodes")
def get_route_nodes() -> dict[str, Any]:
    return {"is_simulation": True, "nodes": list_route_nodes()}


@app.get("/api/network/snap-road")
def snap_road_endpoint(
    lat: float = Query(..., ge=34.78, le=35.33),
    lon: float = Query(..., ge=135.42, le=135.95),
) -> dict[str, Any]:
    return snap_road_info(lat=lat, lon=lon, store=store if store.loaded else None)


class RoadCorridorRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float


class StrokePoint(BaseModel):
    lat: float
    lon: float


class RoadStrokeRequest(BaseModel):
    points: list[StrokePoint]


@app.get("/api/network/roads")
def read_roads_in_bbox(
    bbox: str = Query(..., description="min_lon,min_lat,max_lon,max_lat"),
    include_samples: bool = Query(default=True),
    avoid_unverified: bool = Query(default=True),
    block_radius_m: float = Query(default=48.0, ge=20.0, le=500.0),
) -> dict[str, Any]:
    parts = [p.strip() for p in bbox.split(",")]
    if len(parts) != 4:
        raise HTTPException(status_code=400, detail="bbox must be min_lon,min_lat,max_lon,max_lat")
    try:
        min_lon, min_lat, max_lon, max_lat = (float(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid numeric values in bbox") from exc
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(status_code=400, detail="Invalid bbox ordering")
    reports = reports_store.list_reports(
        category="road_blocked",
        include_samples=include_samples,
        include_resolved=False,
        limit=300,
    )
    ev = _evaluate_network(
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store if store.loaded else None,
    )
    return get_roads_in_bbox(
        min_lon=min_lon,
        min_lat=min_lat,
        max_lon=max_lon,
        max_lat=max_lat,
        blocked_edge_ids=ev["blocked_edge_ids"],
    )


@app.post("/api/network/corridor")
def resolve_corridor_endpoint(req: RoadCorridorRequest) -> dict[str, Any]:
    return resolve_road_corridor(
        start_lat=req.start_lat,
        start_lon=req.start_lon,
        end_lat=req.end_lat,
        end_lon=req.end_lon,
        store=store if store.loaded else None,
    )


@app.post("/api/network/stroke")
def resolve_stroke_endpoint(req: RoadStrokeRequest) -> dict[str, Any]:
    if len(req.points) > 1500:
        raise HTTPException(status_code=400, detail="stroke points count must be <= 1500")
    return resolve_road_stroke(
        points=[(pt.lon, pt.lat) for pt in req.points],
        store=store if store.loaded else None,
    )


@app.get("/api/network/status")
def read_network_status(
    include_samples: bool = Query(default=True),
    avoid_unverified: bool = Query(default=True),
    block_radius_m: float = Query(default=420.0, ge=100.0, le=1500.0),
) -> dict[str, Any]:
    reports = reports_store.list_reports(
        include_samples=include_samples,
        include_resolved=False,
        limit=300,
    )
    return get_network_status(
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store if store.loaded else None,
    )


@app.get("/api/routes/simulate")
def get_route_simulation(
    origin_id: str = Query(...),
    destination_id: str = Query(...),
    include_samples: bool = Query(default=True),
    avoid_unverified: bool = Query(default=True),
    block_radius_m: float = Query(default=420.0, ge=100.0, le=1500.0),
) -> dict[str, Any]:
    reports = reports_store.list_reports(
        category="road_blocked",
        include_samples=include_samples,
        include_resolved=False,
        limit=200,
    )
    return simulate_alternative_route(
        origin_id=origin_id,
        destination_id=destination_id,
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store if store.loaded else None,
    )


@app.get("/api/routes/navigate")
def get_navigation_simulation(
    mode: str = Query(default="evacuate"),
    origin_id: str | None = Query(default=None),
    destination_id: str | None = Query(default=None),
    start_lat: float | None = Query(default=None),
    start_lon: float | None = Query(default=None),
    target_lat: float | None = Query(default=None),
    target_lon: float | None = Query(default=None),
    target_report_id: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
    avoid_unverified: bool = Query(default=True),
    block_radius_m: float = Query(default=420.0, ge=100.0, le=1500.0),
) -> dict[str, Any]:
    reports = reports_store.list_reports(
        include_samples=include_samples,
        include_resolved=False,
        limit=300,
    )
    return simulate_navigation(
        mode=mode,
        reports=reports,
        origin_id=origin_id,
        destination_id=destination_id,
        start_lat=start_lat,
        start_lon=start_lon,
        target_lat=target_lat,
        target_lon=target_lon,
        target_report_id=target_report_id,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        store=store if store.loaded else None,
    )


@app.get("/api/shelters")
def list_official_shelters(
    ward: str | None = Query(default=None),
    disaster_type: str | None = Query(default=None),
    wide_area_only: bool = Query(default=False),
) -> dict[str, Any]:
    shelters = shelter_store.list_shelters(
        ward=ward,
        disaster_type=disaster_type,
        wide_area_only=wide_area_only,
        store=store if store.loaded else None,
    )
    meta = shelter_store.get_meta()
    return {
        **meta,
        "returned": len(shelters),
        "shelters": shelters,
    }


@app.get("/api/shelters/recommend")
def get_shelter_recommendations(
    lat: float | None = Query(default=None, ge=34.5, le=35.5),
    lon: float | None = Query(default=None, ge=135.0, le=136.5),
    ward: str | None = Query(default=None),
    scenario: str = Query(default="earthquake"),
    include_samples: bool = Query(default=True),
    avoid_unverified: bool = Query(default=True),
    block_radius_m: float = Query(default=420.0, ge=100.0, le=1500.0),
    limit: int = Query(default=5, ge=1, le=10),
) -> dict[str, Any]:
    reports = reports_store.list_reports(
        include_samples=include_samples,
        include_resolved=False,
        limit=300,
    )
    return recommend_shelters(
        lat=lat,
        lon=lon,
        ward=ward,
        scenario=scenario,
        reports=reports,
        include_samples=include_samples,
        avoid_unverified=avoid_unverified,
        block_radius_m=block_radius_m,
        limit=limit,
        store=store if store.loaded else None,
    )


@app.get("/api/updates/disaster")
def get_disaster_updates(
    period: str = Query(
        default="all",
        pattern="^(all|recent_2y|2026|2025|archive)$",
    ),
    kind: str = Query(
        default="all",
        pattern="^(all|earthquakes|municipality)$",
    ),
) -> dict[str, Any]:
    """Return JMA/Yahoo Kyoto earthquake history (2025-2026 + older) and Kyoto City Bousai updates."""
    return updates_store.query_updates(period=period, kind=kind)


@app.post("/api/updates/disaster/refresh")
async def refresh_disaster_updates() -> dict[str, Any]:
    """Live-fetch updates from Yahoo Kyoto Earthquake list (?e=511), JMA JSON, and Kyoto City Bousai Portal."""
    return await updates_store.refresh_live(persist=True)


@app.get("/api/r8-seismic")
def get_r8_seismic_list(
    ward: str = Query(default="all"),
    grade: str = Query(default="all"),
    q: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, Any]:
    """Return Kyoto City R8 Municipal Building Seismic List (R8_list.pdf) and guidance for unlisted buildings."""
    return r8_seismic_store.get_summary_and_list(ward=ward, grade=grade, q=q, limit=limit)


@app.get("/api/r8-seismic/locate-unlisted")
async def locate_r8_unlisted(
    q: str = Query(default=""),
    ward: str = Query(default="all"),
) -> dict[str, Any]:
    """Locate an unlisted building/facility query on the map and return priority guidance."""
    return await r8_seismic_store.locate_unlisted_query(
        query=q,
        ward=ward,
        store=store if store.loaded else None,
    )


@app.get("/api/r8-seismic/{record_id}/locate")
async def locate_r8_record(record_id: str) -> dict[str, Any]:
    """Locate an R8_list.pdf record on the Kyoto map with hazard context."""
    res = await r8_seismic_store.locate_record(
        record_id=record_id,
        store=store if store.loaded else None,
    )
    if res is None:
        raise HTTPException(status_code=404, detail="指定されたR8リスト建築物が見つかりません。")
    return res


@app.get("/api/enterprise/safe-sites")
def get_enterprise_safe_sites(
    ward: str = Query(default="all"),
    purpose: str = Query(
        default="datacenter_server",
        pattern="^(datacenter_server|bcp_hq|logistics_storage)$",
    ),
    avoid_mountain: bool = Query(default=True),
    limit: int = Query(default=6, ge=1, le=20),
) -> dict[str, Any]:
    """Recommend comparatively safer Kyoto locations for corporate critical facilities / BCP sites."""
    s = _require_store()
    return recommend_safe_enterprise_sites(
        s,
        ward=ward,
        purpose=purpose,
        avoid_mountain=avoid_mountain,
        limit=limit,
    )


@app.get("/api/geocode/search")
async def geocode_search(
    q: str = Query(..., min_length=1, max_length=160),
    limit: int = Query(default=8, ge=1, le=20),
    use_external: bool = Query(default=True),
) -> dict[str, Any]:
    return await search_locations(
        q=q,
        limit=limit,
        store=store if store.loaded else None,
        use_external=use_external,
    )


@app.get("/api/geocode/reverse")
async def geocode_reverse(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    use_external: bool = Query(default=True),
) -> dict[str, Any]:
    return await reverse_geocode(
        lat=lat,
        lon=lon,
        store=store if store.loaded else None,
        use_external=use_external,
    )


class ChatRequest(BaseModel):
    message: str
    context: dict[str, Any] | None = None
    previous_interaction_id: str | None = None
    model: str | None = None


@app.post("/api/chat")
def chat(
    req: ChatRequest,
    request: Request,
    x_gemini_api_key: str | None = Header(default=None),
    x_ai_access_code: str | None = Header(default=None),
) -> dict[str, Any]:
    s = _require_store()
    cleaned_msg, cleaned_prev_id, cleaned_ctx = validate_chat_inputs(
        req.message, req.previous_interaction_id, req.context
    )
    ticket = ai_guard.authorize_and_acquire(
        client_ip=extract_client_ip(request),
        requested_model=req.model,
        api_key_override=x_gemini_api_key,
        access_code=x_ai_access_code,
    )
    try:
        return ask_quakelens_ai(
            store=s,
            message=cleaned_msg,
            context=cleaned_ctx,
            previous_interaction_id=cleaned_prev_id,
            model=req.model,
            api_key_override=x_gemini_api_key,
            earthquakes_cache=_quake_cache.get("data"),
            board_store=board_store,
            reports_store=reports_store,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"AI解説の生成中にエラーが発生しました: {redact_secrets(str(exc))}",
        ) from exc
    finally:
        ai_guard.release_slot(ticket)


@app.post("/api/chat/stream")
def chat_stream(
    req: ChatRequest,
    request: Request,
    x_gemini_api_key: str | None = Header(default=None),
    x_ai_access_code: str | None = Header(default=None),
) -> StreamingResponse:
    s = _require_store()
    cleaned_msg, cleaned_prev_id, cleaned_ctx = validate_chat_inputs(
        req.message, req.previous_interaction_id, req.context
    )
    ticket = ai_guard.authorize_and_acquire(
        client_ip=extract_client_ip(request),
        requested_model=req.model,
        api_key_override=x_gemini_api_key,
        access_code=x_ai_access_code,
    )

    def event_generator():
        q: queue.Queue[dict[str, Any] | None] = queue.Queue()
        stop_flag = threading.Event()

        def worker() -> None:
            terminal_emitted = False
            try:
                for ev in stream_quakelens_ai(
                    store=s,
                    message=cleaned_msg,
                    context=cleaned_ctx,
                    previous_interaction_id=cleaned_prev_id,
                    model=req.model,
                    api_key_override=x_gemini_api_key,
                    earthquakes_cache=_quake_cache.get("data"),
                    board_store=board_store,
                    reports_store=reports_store,
                ):
                    if stop_flag.is_set():
                        break
                    if ev.get("type") in {"done", "error"}:
                        terminal_emitted = True
                    q.put(ev)
                if not terminal_emitted and not stop_flag.is_set():
                    q.put({
                        "type": "error",
                        "message": "AIストリーミングが完了イベントを受信する前に終了しました（未完了）。",
                    })
            except Exception as exc:
                q.put({
                    "type": "error",
                    "message": f"AI解説の生成中にエラーが発生しました: {redact_secrets(str(exc))}",
                })
            finally:
                q.put(None)

        threading.Thread(target=worker, daemon=True).start()

        try:
            while True:
                try:
                    item = q.get(timeout=4.0)
                except queue.Empty:
                    # Keep HTTP chunked connection alive across proxies while Gemini is thinking
                    yield ": keepalive\n\n"
                    continue
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            stop_flag.set()
            ai_guard.release_slot(ticket)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
