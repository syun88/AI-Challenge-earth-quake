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
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from app.ai_assistant import (
    _resolve_api_key,
    ask_board_mention_agent,
    ask_quakelens_ai,
    stream_quakelens_ai,
)
from app.auth import (
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    VALID_ROLES,
    AuthenticatedUser,
    auth_profile_store,
    get_current_user,
    get_firebase_claims,
    get_gov_registration_code,
    require_roles,
)
from app.bcp_site import assess_enterprise_assets, recommend_safe_enterprise_sites
from app.heritage_residential import analyze_historic_and_residential_priorities
from app.tts import (
    ALLOWED_TTS_MODELS,
    ALLOWED_TTS_VOICES,
    DEFAULT_TTS_MODEL,
    DEFAULT_TTS_VOICE,
    TtsQuotaExhaustedError,
    synthesize_speech,
)
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
from app.firebase_backend import (
    get_firebase_admin_status,
    is_firestore_persistence_enabled,
    sync_user_role_to_firebase,
)
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
    auth_profile_store.ensure_initialized()
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
    allow_headers=["Content-Type", "Authorization", "X-Gemini-Api-Key", "X-Ai-Access-Code"],
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
        "firebase_backend": get_firebase_admin_status(),
    }


class AuthRegisterRequest(BaseModel):
    role: str
    display_name: str
    organization_name: str = ""
    department: str = ""
    gov_code: str = ""


class AuthLoginRoleVerifyRequest(BaseModel):
    role: str


@app.get("/api/auth/policy")
def get_auth_policy() -> dict[str, Any]:
    return {
        "roles": [
            {
                "id": r,
                "label": ROLE_LABELS[r],
                "permissions": ROLE_PERMISSIONS[r],
            }
            for r in VALID_ROLES
        ],
        "gov_code_required": bool(get_gov_registration_code()),
    }


@app.get("/api/auth/me")
def get_auth_me(claims: dict[str, Any] = Depends(get_firebase_claims)) -> dict[str, Any]:
    uid = str(claims.get("sub") or claims.get("user_id") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="トークンにUIDが含まれていません。")
    email = str(claims.get("email") or "").strip()
    profile = auth_profile_store.get_profile(uid)
    if profile is None:
        return {
            "registered": False,
            "uid": uid,
            "email": email,
            "user": None,
        }
    role = profile["role"]
    if role == "government" and not profile.get("verified_agency"):
        raise HTTPException(status_code=403, detail="政府関連機関の認証状態が無効です。")
    firebase_meta = claims.get("firebase")
    provider = "password"
    if isinstance(firebase_meta, dict) and firebase_meta.get("sign_in_provider"):
        provider = str(firebase_meta["sign_in_provider"])
    auth_user = AuthenticatedUser(
        uid=uid,
        email=email or profile.get("email") or "",
        display_name=profile["display_name"],
        role=role,  # type: ignore[arg-type]
        organization_name=profile["organization_name"],
        department=profile["department"],
        verified_agency=bool(profile["verified_agency"]),
        email_verified=bool(claims.get("email_verified", False)),
        auth_provider=provider,
    )
    claims_synced = False
    if is_firestore_persistence_enabled():
        needs_claim_sync = claims.get("role") != role or (
            role == "government" and not claims.get("verifiedAgency")
        )
        if needs_claim_sync:
            claims_synced = sync_user_role_to_firebase(
                uid=uid,
                email=auth_user.email,
                display_name=auth_user.display_name,
                role=role,
                organization_name=auth_user.organization_name,
                department=auth_user.department,
                verified_agency=auth_user.verified_agency,
            )
    return {
        "registered": True,
        "uid": uid,
        "email": auth_user.email,
        "claims_synced": claims_synced,
        "user": auth_user.to_dict(),
    }


@app.post("/api/auth/register-profile")
def register_auth_profile(
    req: AuthRegisterRequest,
    claims: dict[str, Any] = Depends(get_firebase_claims),
) -> dict[str, Any]:
    uid = str(claims.get("sub") or claims.get("user_id") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="トークンにUIDが含まれていません。")
    email = str(claims.get("email") or "").strip()
    profile = auth_profile_store.register_or_update_profile(
        uid=uid,
        email=email,
        display_name=req.display_name,
        role=req.role,
        organization_name=req.organization_name,
        department=req.department,
        gov_code=req.gov_code,
    )
    firebase_meta = claims.get("firebase")
    provider = "password"
    if isinstance(firebase_meta, dict) and firebase_meta.get("sign_in_provider"):
        provider = str(firebase_meta["sign_in_provider"])
    auth_user = AuthenticatedUser(
        uid=uid,
        email=email or profile.get("email") or "",
        display_name=profile["display_name"],
        role=profile["role"],  # type: ignore[arg-type]
        organization_name=profile["organization_name"],
        department=profile["department"],
        verified_agency=bool(profile["verified_agency"]),
        email_verified=bool(claims.get("email_verified", False)),
        auth_provider=provider,
    )
    return {
        "registered": True,
        "claims_synced": auth_profile_store._use_firestore(),
        "user": auth_user.to_dict(),
    }


@app.post("/api/auth/verify-login-role")
def verify_auth_login_role(
    req: AuthLoginRoleVerifyRequest,
    claims: dict[str, Any] = Depends(get_firebase_claims),
) -> dict[str, Any]:
    uid = str(claims.get("sub") or claims.get("user_id") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="トークンにUIDが含まれていません。")
    profile = auth_profile_store.verify_login_role(uid=uid, expected_role=req.role)
    role = profile["role"]
    claims_synced = bool(profile.pop("claims_synced", False))
    return {
        "verified": True,
        "claims_synced": claims_synced,
        "user": {
            **profile,
            "email": str(claims.get("email") or profile.get("email") or ""),
            "email_verified": bool(claims.get("email_verified", False)),
            "permissions": dict(ROLE_PERMISSIONS.get(role, ROLE_PERMISSIONS["citizen"])),
        },
    }


@app.get("/api/metadata")
def get_metadata(_user: AuthenticatedUser = Depends(get_current_user)) -> dict[str, Any]:
    return _require_store().get_metadata()


@app.get("/api/stats")
def get_stats(
    ward: str | None = Query(default=None),
    age_categories: str | None = Query(default=None),
    hazard_tiers: str | None = Query(default=None),
    usage_group: str | None = Query(default=None),
    meshcode: str | None = Query(default=None),
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    return _require_store().get_stats(
        ward=ward,
        age_categories=_split_csv(age_categories),
        hazard_tiers=_split_csv(hazard_tiers),
        usage_group=usage_group,
        meshcode=meshcode,
    )


@app.get("/api/meshes")
def get_meshes(
    ward: str | None = Query(default=None),
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    return _require_store().get_meshes_geojson(ward=ward)


@app.get("/api/meshes/{meshcode}")
def get_mesh_detail(
    meshcode: str,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
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
    _user: AuthenticatedUser = Depends(get_current_user),
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
    _user: AuthenticatedUser = Depends(get_current_user),
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
    _user: AuthenticatedUser = Depends(get_current_user),
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
    _user: AuthenticatedUser = Depends(get_current_user),
) -> Response:
    if z < 0 or z > 20:
        raise HTTPException(status_code=400, detail="Invalid zoom level")
    s = _require_store()
    accept_enc = request.headers.get("accept-encoding", "")
    wants_gzip = "gzip" in accept_enc.lower()
    payload = s.get_building_tile_mvt(z=z, x=x, y=y, gzipped=wants_gzip)
    headers = {
        "Cache-Control": "private, max-age=3600",
        "Vary": "Accept-Encoding, Authorization",
    }
    if wants_gzip and payload:
        headers["Content-Encoding"] = "gzip"
    return Response(content=payload, media_type="application/x-protobuf", headers=headers)


@app.get("/api/buildings/{building_id}")
def get_building_detail(
    building_id: str,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    detail = _require_store().get_building_detail(building_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Building {building_id} not found")
    return detail


@app.get("/api/official-programs")
def get_official_programs(_user: AuthenticatedUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"municipality": "京都市", "programs": OFFICIAL_RETROFIT_PROGRAMS}


@app.get("/api/earthquakes")
async def get_recent_earthquakes(
    limit: int = Query(default=40, ge=1, le=100),
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
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
    user: AuthenticatedUser = Depends(get_current_user),
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
        viewer_role=user.role,
        viewer_uid=user.uid,
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
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    return board_store.summarize_entries(
        ward=ward,
        include_samples=include_samples,
        store=store if store.loaded else None,
    )


@app.post("/api/board")
def create_board_entry(
    req: BoardEntryCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    entry = board_store.create_entry(
        phone=req.phone,
        name=req.name,
        status=req.status,
        message=req.message,
        ward_name=req.ward_name,
        meshcode=req.meshcode,
        passcode=req.passcode,
        location_consent=req.location_consent,
        owner_uid=user.uid,
    )
    return {"entry": entry}


@app.patch("/api/board/{entry_id}")
def update_board_entry(
    entry_id: str,
    req: BoardEntryUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    entry = board_store.update_entry(
        entry_id=entry_id,
        passcode=req.passcode,
        status=req.status,
        message=req.message,
        ward_name=req.ward_name,
        meshcode=req.meshcode,
        location_consent=req.location_consent,
        actor_uid=user.uid,
        actor_role=user.role,
    )
    return {"entry": entry}


@app.delete("/api/board/{entry_id}")
def delete_board_entry(
    entry_id: str,
    passcode: str | None = Query(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    return board_store.delete_entry(
        entry_id=entry_id,
        passcode=passcode,
        actor_uid=user.uid,
        actor_role=user.role,
    )


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
    verification_status: str | None = None


class DamageReportUpdateRequest(BaseModel):
    passcode: str | None = None
    severity: str | None = None
    title: str | None = None
    description: str | None = None
    resolved: bool | None = None
    ward_name: str | None = None
    verification_status: str | None = None


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
    only_mine: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=300),
    user: AuthenticatedUser = Depends(get_current_user),
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
        viewer_role=user.role,
        viewer_uid=user.uid,
        only_mine=only_mine,
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
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    return reports_store.summarize_reports(
        ward=ward,
        category=category,
        include_samples=include_samples,
        include_resolved=include_resolved,
        store=store if store.loaded else None,
        viewer_role=user.role,
        viewer_uid=user.uid,
    )


@app.post("/api/reports/similar")
def find_similar_damage_reports(
    req: DamageReportSimilarRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    matches = reports_store.find_similar_reports(
        ward_name=req.ward_name,
        category=req.category,
        title=req.title,
        description=req.description,
        meshcode=req.meshcode,
        lat=req.lat,
        lon=req.lon,
        include_samples=False,
        viewer_role=user.role,
        viewer_uid=user.uid,
    )
    return {"count": len(matches), "similar_reports": matches}


@app.post("/api/reports")
def create_damage_report(
    req: DamageReportCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
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
        owner_uid=user.uid,
        owner_role=user.role,
        requested_verification_status=req.verification_status if user.role == "government" else None,
    )


@app.post("/api/reports/{report_id}/confirm")
def confirm_damage_report(
    report_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    report = reports_store.confirm_report(
        report_id,
        viewer_role=user.role,
        viewer_uid=user.uid,
    )
    return {"report": report}


@app.patch("/api/reports/{report_id}")
def update_damage_report(
    report_id: str,
    req: DamageReportUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    report = reports_store.update_report(
        report_id,
        passcode=req.passcode,
        severity=req.severity,
        title=req.title,
        description=req.description,
        resolved=req.resolved,
        ward_name=req.ward_name,
        verification_status=req.verification_status,
        actor_uid=user.uid,
        actor_role=user.role,
    )
    return {"report": report}


@app.delete("/api/reports/{report_id}")
def delete_damage_report(
    report_id: str,
    passcode: str | None = Query(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    return reports_store.delete_report(
        report_id=report_id,
        passcode=passcode,
        actor_uid=user.uid,
        actor_role=user.role,
    )


@app.get("/api/disaster-overview")
def get_disaster_overview(
    ward: str | None = Query(default=None),
    include_samples: bool = Query(default=True),
    user: AuthenticatedUser = Depends(get_current_user),
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
        viewer_role=user.role,
        viewer_uid=user.uid,
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
    viewer_role: str = "government",
    viewer_uid: str | None = None,
) -> dict[str, Any]:
    s = _require_store()
    stats = s.get_stats(ward=ward)
    board_sum = board_store.summarize_entries(ward=ward, include_samples=include_samples, store=s)
    board_entries = (
        board_store.list_entries(
            ward=ward,
            include_samples=include_samples,
            limit=200,
            viewer_role=viewer_role,
            viewer_uid=viewer_uid,
        )
        if viewer_role == "government"
        else []
    )
    rep_sum = reports_store.summarize_reports(
        ward=ward,
        category=category,
        include_samples=include_samples,
        include_resolved=False,
        store=s,
        viewer_role=viewer_role,
        viewer_uid=viewer_uid,
    )
    reports = (
        reports_store.list_reports(
            ward=ward,
            category=category,
            verification_status=verification_status,
            include_samples=include_samples,
            include_resolved=True,
            limit=300,
            viewer_role=viewer_role,
            viewer_uid=viewer_uid,
        )
        if viewer_role == "government"
        else []
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
    user: AuthenticatedUser = Depends(require_roles("government", "enterprise")),
) -> Response:
    if scope not in {"overview", "wards", "reports", "board"}:
        raise HTTPException(status_code=400, detail="Invalid export scope")
    if user.role != "government" and scope != "wards":
        raise HTTPException(
            status_code=403,
            detail="個別報告・安否明細・総合サマリーの一括出力は「政府関連機関」アカウント専用です（企業アカウントは区別集計 CSV: scope=wards のみ出力可能）。",
        )
    inputs = _gather_export_inputs(
        ward=ward,
        category=category,
        verification_status=verification_status,
        include_samples=include_samples,
        viewer_role=user.role,
        viewer_uid=user.uid,
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
    user: AuthenticatedUser = Depends(require_roles("government")),
) -> Response:
    inputs = _gather_export_inputs(
        ward=ward,
        category=category,
        verification_status=verification_status,
        include_samples=include_samples,
        viewer_role=user.role,
        viewer_uid=user.uid,
    )
    payload = generate_disaster_xlsx(**inputs)
    return Response(
        content=payload,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="quakelens_kyoto_summary.xlsx"'},
    )


@app.get("/api/routes/nodes")
def get_route_nodes(_user: AuthenticatedUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"is_simulation": True, "nodes": list_route_nodes()}


@app.get("/api/network/snap-road")
def snap_road_endpoint(
    lat: float = Query(..., ge=34.78, le=35.33),
    lon: float = Query(..., ge=135.42, le=135.95),
    _user: AuthenticatedUser = Depends(get_current_user),
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
    user: AuthenticatedUser = Depends(get_current_user),
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
        viewer_role=user.role,
        viewer_uid=user.uid,
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
def resolve_corridor_endpoint(
    req: RoadCorridorRequest,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    return resolve_road_corridor(
        start_lat=req.start_lat,
        start_lon=req.start_lon,
        end_lat=req.end_lat,
        end_lon=req.end_lon,
        store=store if store.loaded else None,
    )


@app.post("/api/network/stroke")
def resolve_stroke_endpoint(
    req: RoadStrokeRequest,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
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
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    reports = reports_store.list_reports(
        category="road_blocked",
        include_samples=include_samples,
        include_resolved=False,
        limit=300,
        viewer_role=user.role,
        viewer_uid=user.uid,
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
    user: AuthenticatedUser = Depends(require_roles("government", "enterprise")),
) -> dict[str, Any]:
    reports = reports_store.list_reports(
        category="road_blocked",
        include_samples=include_samples,
        include_resolved=False,
        limit=200,
        viewer_role=user.role,
        viewer_uid=user.uid,
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
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    if mode == "rescue" and user.role != "government":
        raise HTTPException(
            status_code=403,
            detail="救助出動ルート探索は「政府関連機関」アカウント専用です。",
        )
    if mode == "custom" and user.role not in {"government", "enterprise"}:
        raise HTTPException(
            status_code=403,
            detail="任意2拠点BCP迂回ルート探索は「政府関連機関・企業」アカウント専用です。",
        )
    if target_report_id:
        target = reports_store.get_report(
            target_report_id,
            viewer_role=user.role,
            viewer_uid=user.uid,
        )
        if target is None:
            raise HTTPException(
                status_code=403,
                detail="指定された通報を閲覧する権限がないか、存在しません。",
            )
    reports = reports_store.list_reports(
        include_samples=include_samples,
        include_resolved=False,
        limit=300,
        viewer_role=user.role,
        viewer_uid=user.uid,
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
    _user: AuthenticatedUser = Depends(get_current_user),
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
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    reports = reports_store.list_reports(
        include_samples=include_samples,
        include_resolved=False,
        limit=300,
        viewer_role=user.role,
        viewer_uid=user.uid,
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
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Return JMA/Yahoo Kyoto earthquake history (2025-2026 + older) and Kyoto City Bousai updates."""
    return updates_store.query_updates(period=period, kind=kind)


@app.post("/api/updates/disaster/refresh")
async def refresh_disaster_updates(_user: AuthenticatedUser = Depends(get_current_user)) -> dict[str, Any]:
    """Live-fetch updates from Yahoo Kyoto Earthquake list (?e=511), JMA JSON, and Kyoto City Bousai Portal."""
    return await updates_store.refresh_live(persist=True)


@app.get("/api/r8-seismic")
def get_r8_seismic_list(
    ward: str = Query(default="all"),
    grade: str = Query(default="all"),
    q: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=1000),
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Return Kyoto City R8 Municipal Building Seismic List (R8_list.pdf) and guidance for unlisted buildings."""
    return r8_seismic_store.get_summary_and_list(ward=ward, grade=grade, q=q, limit=limit)


@app.get("/api/r8-seismic/locate-unlisted")
async def locate_r8_unlisted(
    q: str = Query(default=""),
    ward: str = Query(default="all"),
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Locate an unlisted building/facility query on the map and return priority guidance."""
    return await r8_seismic_store.locate_unlisted_query(
        query=q,
        ward=ward,
        store=store if store.loaded else None,
    )


@app.get("/api/r8-seismic/{record_id}/locate")
async def locate_r8_record(
    record_id: str,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
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
    _user: AuthenticatedUser = Depends(require_roles("enterprise")),
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


@app.get("/api/priority/historic-residential")
def get_historic_residential_priorities(
    ward: str = Query(default="all"),
    focus: str = Query(default="all", pattern="^(all|historic|residential)$"),
    limit: int = Query(default=6, ge=1, le=20),
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Return P1-P4 prioritization and actionable retrofit/safety solutions for historic and residential buildings."""
    s = _require_store()
    return analyze_historic_and_residential_priorities(
        s,
        ward=ward,
        focus=focus,
        limit=limit,
    )


class EnterpriseAssetAssessItem(BaseModel):
    id: str = ""
    asset_type: str = "server_room"
    lat: float
    lon: float


class EnterpriseAssetsAssessRequest(BaseModel):
    assets: list[EnterpriseAssetAssessItem]


@app.post("/api/enterprise/assess-assets")
def assess_enterprise_assets_endpoint(
    req: EnterpriseAssetsAssessRequest,
    user: AuthenticatedUser = Depends(require_roles("enterprise")),
) -> dict[str, Any]:
    """Evaluate seismic hazard, nearby closures, and shelter distance for confidential corporate assets strictly in-memory."""
    s = _require_store()
    public_reports = reports_store.list_reports(
        include_samples=True,
        include_resolved=False,
        limit=300,
        viewer_role=user.role,
        viewer_uid=user.uid,
    )
    assessments = assess_enterprise_assets(
        s,
        assets=[a.model_dump() for a in req.assets],
        public_reports=public_reports,
    )
    return {
        "count": len(assessments),
        "assessments": assessments,
    }


@app.get("/api/geocode/search")
async def geocode_search(
    q: str = Query(..., min_length=1, max_length=160),
    limit: int = Query(default=8, ge=1, le=20),
    use_external: bool = Query(default=True),
    _user: AuthenticatedUser = Depends(get_current_user),
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
    _user: AuthenticatedUser = Depends(get_current_user),
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


class ChatTtsRequest(BaseModel):
    text: str
    voice: str | None = None
    model: str | None = None


class BoardChatRecentMessage(BaseModel):
    senderName: str = "参加者"
    senderRole: str = "citizen"
    wardName: str = ""
    text: str = ""


class BoardChatAgentRequest(BaseModel):
    channel: str = "public"
    ward_name: str = "all"
    tenant_uid: str = ""
    trigger_message: str
    recent_messages: list[BoardChatRecentMessage] = []
    model: str | None = None


@app.post("/api/chat/tts")
def chat_tts(
    req: ChatTtsRequest,
    request: Request,
    x_gemini_api_key: str | None = Header(default=None),
    x_ai_access_code: str | None = Header(default=None),
    _user: AuthenticatedUser = Depends(get_current_user),
) -> Response:
    cleaned_text = req.text.strip()
    if not cleaned_text:
        raise HTTPException(status_code=400, detail="読み上げテキストを入力してください。")
    if len(cleaned_text) > 6000:
        raise HTTPException(status_code=413, detail="読み上げテキストが長すぎます（上限 6000 文字）。")

    api_key = _resolve_api_key(x_gemini_api_key)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="音声生成には Gemini API キー（GEMINI_API_KEY または APIキー設定）が必要です。",
        )

    voice = req.voice if req.voice in ALLOWED_TTS_VOICES else DEFAULT_TTS_VOICE
    tts_model = req.model if req.model in ALLOWED_TTS_MODELS else DEFAULT_TTS_MODEL
    ticket = ai_guard.authorize_and_acquire(
        client_ip=extract_client_ip(request),
        requested_model=tts_model,
        api_key_override=x_gemini_api_key,
        access_code=x_ai_access_code,
    )
    try:
        audio_bytes, mime_type, used_model = synthesize_speech(
            text=cleaned_text,
            api_key=api_key,
            voice=voice,
            model=tts_model,
        )
        return Response(
            content=audio_bytes,
            media_type=mime_type,
            headers={
                "Cache-Control": "no-store",
                "X-TTS-Model": used_model,
            },
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TtsQuotaExhaustedError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"音声合成中にエラーが発生しました: {redact_secrets(str(exc))}",
        ) from exc
    finally:
        ai_guard.release_slot(ticket)


@app.post("/api/chat")
def chat(
    req: ChatRequest,
    request: Request,
    x_gemini_api_key: str | None = Header(default=None),
    x_ai_access_code: str | None = Header(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
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
            user_role=user.role,
            user_uid=user.uid,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
    user: AuthenticatedUser = Depends(get_current_user),
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
                    user_role=user.role,
                    user_uid=user.uid,
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


@app.post("/api/board-chat/agent")
def board_chat_agent(
    req: BoardChatAgentRequest,
    request: Request,
    x_gemini_api_key: str | None = Header(default=None),
    x_ai_access_code: str | None = Header(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    s = _require_store()
    if req.channel not in {"public", "enterprise_liaison", "government"}:
        raise HTTPException(status_code=400, detail="不正なチャットチャンネルです。")
    if req.channel == "government" and user.role != "government":
        raise HTTPException(
            status_code=403,
            detail="政府専用チャットでのAIエージェント呼び出しは政府関連機関のみ可能です。",
        )
    if req.channel == "enterprise_liaison":
        if user.role == "citizen":
            raise HTTPException(
                status_code=403,
                detail="行政連携チャットでのAIエージェント呼び出しは企業・政府機関のみ可能です。",
            )
        if user.role == "enterprise" and req.tenant_uid != user.uid:
            raise HTTPException(
                status_code=403,
                detail="他社の行政連携スレッドに対するAIエージェント操作は許可されていません。",
            )

    cleaned_trigger, _, _ = validate_chat_inputs(req.trigger_message, None, None)
    ticket = ai_guard.authorize_and_acquire(
        client_ip=extract_client_ip(request),
        requested_model=req.model,
        api_key_override=x_gemini_api_key,
        access_code=x_ai_access_code,
    )
    try:
        recent_payload = [
            {
                "senderName": m.senderName[:40],
                "senderRole": m.senderRole[:20],
                "wardName": m.wardName[:40],
                "text": m.text[:300],
            }
            for m in req.recent_messages[-12:]
        ]
        return ask_board_mention_agent(
            s,
            trigger_message=cleaned_trigger,
            channel=req.channel,
            ward_name=req.ward_name,
            tenant_uid=req.tenant_uid,
            recent_messages=recent_payload,
            caller_name=user.display_name or "ユーザー",
            caller_role=user.role,
            caller_uid=user.uid,
            model=req.model,
            api_key_override=x_gemini_api_key,
            earthquakes_cache=_quake_cache.get("data"),
            board_store=board_store,
            reports_store=reports_store,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"掲示板AIエージェントの応答生成中にエラーが発生しました: {redact_secrets(str(exc))}",
        ) from exc
    finally:
        ai_guard.release_slot(ticket)
