"""Fetch official Kyoto City Designated Emergency Evacuation Sites (指定緊急避難場所) from GSI GeoJSON tiles."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "processed" / "kyoto_shelters.json"

GSI_LAYERS = ["skhb01", "skhb02", "skhb04", "skhb06", "skhb07"]
TILE_COORDS = [(10, 897, 404), (10, 898, 404), (10, 897, 405), (10, 898, 405)]
WARD_RE = re.compile(r"京都市([^区]+区)")


def fetch_and_build_shelters(output_path: Path = OUTPUT_PATH) -> dict[str, Any]:
    by_key: dict[tuple[str, str, float, float], dict[str, Any]] = {}

    with httpx.Client(timeout=15) as client:
        for layer in GSI_LAYERS:
            for z, x, y in TILE_COORDS:
                url = f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.geojson"
                resp = client.get(url)
                if resp.status_code != 200:
                    continue
                fc = resp.json()
                for feat in fc.get("features", []):
                    props = feat.get("properties") or {}
                    addr = str(props.get("address") or "")
                    if "京都府京都市" not in addr:
                        continue
                    coords = (feat.get("geometry") or {}).get("coordinates") or []
                    if len(coords) < 2:
                        continue
                    lon = round(float(coords[0]), 6)
                    lat = round(float(coords[1]), 6)
                    name = str(props.get("name") or "").strip()
                    if not name:
                        continue
                    key = (name, addr, lon, lat)
                    existing = by_key.get(key)
                    if existing is None:
                        ward_match = WARD_RE.search(addr)
                        ward = ward_match.group(1) if ward_match else "京都市"
                        existing = {
                            "name": name,
                            "address": addr,
                            "ward": ward,
                            "lon": lon,
                            "lat": lat,
                            "remarks": props.get("remarks"),
                            "disasters": {
                                "flood": bool(props.get("disaster1")),
                                "landslide": bool(props.get("disaster2")),
                                "storm_surge": bool(props.get("disaster3")),
                                "earthquake": bool(props.get("disaster4")),
                                "tsunami": bool(props.get("disaster5")),
                                "large_fire": bool(props.get("disaster6")),
                                "inland_flood": bool(props.get("disaster7")),
                            },
                        }
                        by_key[key] = existing
                    else:
                        d = existing["disasters"]
                        d["flood"] = d["flood"] or bool(props.get("disaster1"))
                        d["landslide"] = d["landslide"] or bool(props.get("disaster2"))
                        d["storm_surge"] = d["storm_surge"] or bool(props.get("disaster3"))
                        d["earthquake"] = d["earthquake"] or bool(props.get("disaster4"))
                        d["tsunami"] = d["tsunami"] or bool(props.get("disaster5"))
                        d["large_fire"] = d["large_fire"] or bool(props.get("disaster6"))
                        d["inland_flood"] = d["inland_flood"] or bool(props.get("disaster7"))

    sorted_items = sorted(by_key.values(), key=lambda x: (x["ward"], x["name"], x["lat"], x["lon"]))
    shelters: list[dict[str, Any]] = []
    for idx, item in enumerate(sorted_items, start=1):
        d = item["disasters"]
        disaster_labels: list[str] = []
        if d["earthquake"]:
            disaster_labels.append("地震")
        if d["large_fire"]:
            disaster_labels.append("大規模火災(広域)")
        if d["flood"]:
            disaster_labels.append("洪水")
        if d["landslide"]:
            disaster_labels.append("土砂災害")
        if d["inland_flood"]:
            disaster_labels.append("内水氾濫")
        shelters.append({
            "id": f"skhb-{idx:03d}",
            "name": item["name"],
            "address": item["address"],
            "ward": item["ward"],
            "lon": item["lon"],
            "lat": item["lat"],
            "remarks": item["remarks"],
            "disasters": d,
            "disaster_labels": disaster_labels,
            "is_wide_area": bool(d["large_fire"]),
        })

    payload = {
        "source": "国土地理院 指定緊急避難場所データ（skhb01/02/04/06/07）",
        "source_url": "https://maps.gsi.go.jp/development/ichiran.html#skhb",
        "kyoto_hazard_map_url": "https://www.bousai.city.kyoto.lg.jp/0000000196.html",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "count": len(shelters),
        "shelters": shelters,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


if __name__ == "__main__":
    res = fetch_and_build_shelters()
    print(f"Saved {res['count']} Kyoto official shelters to {OUTPUT_PATH}")
