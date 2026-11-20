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
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from app.ai_assistant import ask_quakelens_ai, stream_quakelens_ai
from app.constants import OFFICIAL_RETROFIT_PROGRAMS
from app.data_store import QuakeLensDataStore

# Load .env from repo root or backend directory
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

JMA_QUAKE_LIST_URL = "https://www.jma.go.jp/bosai/quake/data/list.json"
COD_RE = re.compile(r"^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?/")

store = QuakeLensDataStore()
_quake_cache: dict[str, Any] = {"fetched_at": 0.0, "data": []}


@asynccontextmanager
async def lifespan(_: FastAPI):
    if store.buildings_path.exists() and store.meshes_path.exists():
        store.load()
    yield


app = FastAPI(
    title="QuakeLens Japan API",
    description="PLATEAU建築年データ × J-SHIS地震ハザード・表層地盤 × Gemini Function Calling API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
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
    return {
        "status": "ok",
        "data_loaded": store.loaded,
        "building_count": int(len(store.buildings)) if store.loaded else 0,
        "mesh_count": int(len(store.meshes)) if store.loaded else 0,
        "gemini_configured": bool(api_key and api_key != "your_gemini_api_key_here"),
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
    min_t30_i55: float = Query(default=0.0, ge=0.0, le=1.0),
    min_buildings: int = Query(default=20, ge=1),
    sort_by: str = Query(default="pre_1981_high_hazard"),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    areas = _require_store().get_priority_areas(
        ward=ward,
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
    limit: int = Query(default=3500, ge=1, le=8000),
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
    """Fetch recent earthquakes from JMA Bosai JSON API (5-minute cache)."""
    now = time.time()
    if now - _quake_cache["fetched_at"] > 300 or not _quake_cache["data"]:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(JMA_QUAKE_LIST_URL)
                resp.raise_for_status()
                raw = resp.json()
            parsed = []
            for item in raw:
                lat, lon, depth_km = _parse_jma_cod(item.get("cod"))
                if lat is None or lon is None:
                    continue
                try:
                    mag = float(item["mag"]) if item.get("mag") not in (None, "") else None
                except (TypeError, ValueError):
                    mag = None
                parsed.append({
                    "eid": item.get("eid"),
                    "at": item.get("at"),
                    "anm": item.get("anm"),
                    "en_anm": item.get("en_anm"),
                    "ttl": item.get("ttl"),
                    "mag": mag,
                    "maxi": item.get("maxi"),
                    "lat": lat,
                    "lon": lon,
                    "depth_km": depth_km,
                })
            _quake_cache["data"] = parsed
            _quake_cache["fetched_at"] = now
        except Exception as exc:
            if not _quake_cache["data"]:
                return {
                    "source": "気象庁 地震情報 (取得失敗)",
                    "error": str(exc),
                    "earthquakes": [],
                }

    return {
        "source": "気象庁 地震情報 (https://www.jma.go.jp/bosai/quake/data/list.json)",
        "earthquakes": _quake_cache["data"][:limit],
    }


class ChatRequest(BaseModel):
    message: str
    context: dict[str, Any] | None = None
    previous_interaction_id: str | None = None
    model: str | None = None


@app.post("/api/chat")
def chat(
    req: ChatRequest,
    x_gemini_api_key: str | None = Header(default=None),
) -> dict[str, Any]:
    s = _require_store()
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")
    try:
        return ask_quakelens_ai(
            store=s,
            message=req.message.strip(),
            context=req.context,
            previous_interaction_id=req.previous_interaction_id,
            model=req.model,
            api_key_override=x_gemini_api_key,
            earthquakes_cache=_quake_cache.get("data"),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI解説の生成中にエラーが発生しました: {exc}") from exc


@app.post("/api/chat/stream")
def chat_stream(
    req: ChatRequest,
    x_gemini_api_key: str | None = Header(default=None),
) -> StreamingResponse:
    s = _require_store()
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")

    def event_generator():
        q: queue.Queue[dict[str, Any] | None] = queue.Queue()
        stop_flag = threading.Event()

        def worker() -> None:
            try:
                for ev in stream_quakelens_ai(
                    store=s,
                    message=req.message.strip(),
                    context=req.context,
                    previous_interaction_id=req.previous_interaction_id,
                    model=req.model,
                    api_key_override=x_gemini_api_key,
                    earthquakes_cache=_quake_cache.get("data"),
                ):
                    if stop_flag.is_set():
                        break
                    q.put(ev)
            except Exception as exc:
                q.put({"type": "error", "message": f"AI解説の生成中にエラーが発生しました: {exc}"})
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

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
