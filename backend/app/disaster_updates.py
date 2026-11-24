"""Live updater and archive store for JMA/Kyoto earthquakes (2025-2026 + older) and Kyoto City disaster prevention updates.

Sources:
- Yahoo! Weather / JMA Kyoto Prefecture South Earthquake History (`?e=511`):
  https://typhoon.yahoo.co.jp/weather/jp/earthquake/list/?e=511
- JMA Bosai JSON feed (latest nationwide / Kyoto seismic bulletins):
  https://www.jma.go.jp/bosai/quake/data/list.json
- Kyoto City Official Disaster Prevention Portal (News 2021-2026 & Earthquake Hazard Map updates):
  https://www.bousai.city.kyoto.lg.jp/
  https://www.bousai.city.kyoto.lg.jp/news/0001.html .. 0003.html
  https://www.bousai.city.kyoto.lg.jp/0000000196.html
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

ARCHIVE_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "processed" / "kyoto_disaster_archive.json"
)

YAHOO_KYOTO_QUAKE_LIST_URL = "https://typhoon.yahoo.co.jp/weather/jp/earthquake/list/?e=511"
JMA_QUAKE_LIST_URL = "https://www.jma.go.jp/bosai/quake/data/list.json"
KYOTO_BOUSAI_NEWS_URLS = [
    "https://www.bousai.city.kyoto.lg.jp/news/0001.html",
    "https://www.bousai.city.kyoto.lg.jp/news/0002.html",
    "https://www.bousai.city.kyoto.lg.jp/news/0003.html",
]
KYOTO_HAZARD_MAP_PAGE_URL = "https://www.bousai.city.kyoto.lg.jp/0000000196.html"

RECENT_TARGET_YEARS = {2025, 2026}


def _strip_tags(raw: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", raw))).strip()


def _parse_year_month_day(text: str) -> tuple[int | None, str]:
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", text)
    if not m:
        return None, text
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return y, f"{y:04d}-{mo:02d}-{d:02d}"


def _parse_yahoo_quake_list_html(html: str) -> list[dict[str, Any]]:
    """Parse rows from Yahoo Weather Kyoto earthquake list HTML (`?e=511`)."""
    events: list[dict[str, Any]] = []
    trs = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
    for tr in trs:
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 4:
            continue
        occurred_text = _strip_tags(tds[0])
        epicenter = _strip_tags(tds[1])
        mag_text = _strip_tags(tds[2])
        maxi_text = _strip_tags(tds[3])
        year, iso_date = _parse_year_month_day(occurred_text)
        if year is None:
            continue
        hrefs = re.findall(r'href=["\']([^"\']+)["\']', tr)
        detail_url = hrefs[0] if hrefs else YAHOO_KYOTO_QUAKE_LIST_URL
        m_id = re.search(r"/earthquake/(\d+)\.html", detail_url)
        eid = f"yahoo-{m_id.group(1)}" if m_id else f"yahoo-{iso_date}-{len(events)}"
        try:
            mag = float(mag_text) if mag_text not in ("", "—", "---", "-") else None
        except ValueError:
            mag = None
        events.append(
            {
                "id": eid,
                "occurred_at": occurred_text,
                "date_iso": iso_date,
                "year": year,
                "is_recent_2y": year in RECENT_TARGET_YEARS,
                "epicenter": epicenter,
                "mag": mag,
                "maxi": maxi_text or "—",
                "depth_km": None,
                "lat": None,
                "lon": None,
                "observed_kyoto": [],
                "source": "気象庁 / Yahoo!天気・災害（京都府南部 地震履歴）",
                "url": detail_url,
            }
        )
    return events


def _parse_yahoo_quake_detail_html(html: str) -> dict[str, Any]:
    """Extract lat, lon, depth_km, and Kyoto seismic intensity stations from Yahoo detail HTML."""
    out: dict[str, Any] = {"lat": None, "lon": None, "depth_km": None, "observed_kyoto": []}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [_strip_tags(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
        if len(cells) < 2:
            continue
        k, v = cells[0], cells[1]
        if k == "深さ":
            m_d = re.search(r"(\d+(?:\.\d+)?)\s*km", v)
            if m_d:
                out["depth_km"] = float(m_d.group(1))
            elif "浅い" in v:
                out["depth_km"] = 0.0
        elif k == "緯度/経度":
            m_ll = re.search(r"北緯(\d+(?:\.\d+)?)度\s*/\s*東経(\d+(?:\.\d+)?)度", v)
            if m_ll:
                out["lat"] = float(m_ll.group(1))
                out["lon"] = float(m_ll.group(2))
        elif k.startswith("震度") and len(cells) >= 3 and "京都府" in cells[1]:
            out["observed_kyoto"].append(f"{k}: {cells[2]}")
    return out


def _categorize_kyoto_notice(title: str) -> str:
    if any(k in title for k in ("広域避難場所", "避難所", "避難施設")):
        return "避難場所・指定更新"
    if "ハザードマップ" in title:
        return "ハザードマップ更新"
    if "協定" in title or "覚書" in title:
        return "防災協定・民間連携"
    if any(k in title for k in ("計画", "マニュアル", "プログラム", "耐震", "マンション防災", "タイムライン")):
        return "計画・対策・補助"
    return "お知らせ・啓発"


def _parse_kyoto_news_html(html: str, base_url: str) -> list[dict[str, Any]]:
    """Parse dated official announcements from Kyoto City Bousai news pages."""
    notices: list[dict[str, Any]] = []
    for li_raw in re.findall(r"<li[^>]*>(.*?)</li>", html, re.S):
        text = _strip_tags(li_raw)
        year, iso_date = _parse_year_month_day(text)
        if year is None:
            continue
        hrefs = re.findall(r'href=["\']([^"\']+)["\']', li_raw)
        if not hrefs:
            continue
        full_url = urljoin(base_url, hrefs[0])
        title = re.sub(r"\[?\s*\d{4}年\d{1,2}月\d{1,2}日\s*\]?", "", text).strip()
        title = re.sub(r"別ウィンドウで開く", "", title).strip()
        if not title:
            continue
        notices.append(
            {
                "id": f"kyoto-news-{iso_date}-{abs(hash(full_url)) % 100000:05d}",
                "date_text": f"{iso_date}",
                "year": year,
                "is_recent_2y": year in RECENT_TARGET_YEARS,
                "category": _categorize_kyoto_notice(title),
                "title": title,
                "source": "京都市防災ポータルサイト 公式更新情報",
                "url": full_url,
            }
        )
    return notices


def _parse_hazard_map_page_notice(html: str) -> dict[str, Any] | None:
    """Extract the revision notice from Kyoto City's Earthquake Hazard Map portal (0000000196.html)."""
    m = re.search(r"更新日[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日)", _strip_tags(html))
    if not m:
        return None
    year, iso_date = _parse_year_month_day(m.group(1))
    if year is None:
        return None
    return {
        "id": "kyoto-hazard-map-0000000196",
        "date_text": iso_date,
        "year": year,
        "is_recent_2y": year in RECENT_TARGET_YEARS,
        "category": "ハザードマップ更新",
        "title": "京都市「地震ハザードマップ」（全11区＋京北地図面・情報面PDF）更新公開",
        "source": "京都市公式 地震ハザードマップ (0000000196.html)",
        "url": KYOTO_HAZARD_MAP_PAGE_URL,
    }


def _parse_jma_cod(cod: str | None) -> tuple[float | None, float | None, float | None]:
    if not cod:
        return None, None, None
    m = re.match(r"^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)?/?$", cod.strip())
    if not m:
        return None, None, None
    lat = float(m.group(1))
    lon = float(m.group(2))
    depth_m = abs(float(m.group(3))) if m.group(3) else None
    depth_km = round(depth_m / 1000.0, 1) if depth_m is not None else None
    return lat, lon, depth_km


def _parse_jma_recent_kyoto(raw_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract Kyoto-epicenter or recent notable JMA events from list.json, deduplicated by eid."""
    by_eid: dict[str, dict[str, Any]] = {}
    for item in raw_items:
        anm = str(item.get("anm") or "").strip()
        at_str = str(item.get("at") or "")
        lat, lon, depth_km = _parse_jma_cod(item.get("cod"))
        maxi = str(item.get("maxi") or "")
        is_kyoto = "京都" in anm
        is_strong = maxi in {"4", "5-", "5+", "6-", "6+", "7"}
        # Skip preliminary 震度速報 entries with empty epicenter when no coordinates
        if not anm or (lat is None and not is_kyoto):
            continue
        if not (is_kyoto or is_strong):
            continue
        try:
            year = int(at_str[:4]) if len(at_str) >= 4 else 2026
        except ValueError:
            year = 2026
        date_iso = at_str[:10] if len(at_str) >= 10 else ""
        try:
            mag = float(item["mag"]) if item.get("mag") not in (None, "") else None
        except (TypeError, ValueError):
            mag = None
        eid = str(item.get("eid") or f"jma-{date_iso}-{len(by_eid)}")
        candidate = {
            "id": f"jma-{eid}",
            "occurred_at": at_str.replace("T", " ").replace("+09:00", " JST"),
            "date_iso": date_iso,
            "year": year,
            "is_recent_2y": year in RECENT_TARGET_YEARS,
            "epicenter": anm,
            "mag": mag,
            "maxi": maxi or "—",
            "depth_km": depth_km,
            "lat": lat,
            "lon": lon,
            "observed_kyoto": [],
            "source": "気象庁 防災情報JSON（リアルタイム速報）",
            "url": f"https://www.jma.go.jp/bosai/map.html#contents=earthquake_map&id={eid}",
            "is_kyoto_local": is_kyoto,
        }
        prev = by_eid.get(eid)
        if prev is None or (candidate["mag"] is not None and prev["mag"] is None):
            by_eid[eid] = candidate
    return list(by_eid.values())


async def fetch_live_archive_payload(
    existing_earthquakes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Fetch live updates from Yahoo Kyoto Earthquake History, JMA JSON, and Kyoto City Bousai Portal."""
    existing_by_id = {e["id"]: e for e in (existing_earthquakes or []) if e.get("id")}

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        tasks = [
            client.get(YAHOO_KYOTO_QUAKE_LIST_URL),
            client.get(JMA_QUAKE_LIST_URL),
            client.get(KYOTO_HAZARD_MAP_PAGE_URL),
            *[client.get(u) for u in KYOTO_BOUSAI_NEWS_URLS],
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    yahoo_resp = results[0]
    jma_resp = results[1]
    hazard_resp = results[2]
    news_resps = results[3:]

    kyoto_quakes: list[dict[str, Any]] = []
    if isinstance(yahoo_resp, httpx.Response) and yahoo_resp.status_code == 200:
        kyoto_quakes = _parse_yahoo_quake_list_html(yahoo_resp.text)

    # Enrich 2025-2026 (plus any missing recent events up to 15 items) with exact lat/lon/depth
    to_enrich = [
        q
        for q in kyoto_quakes
        if q.get("is_recent_2y")
        and q.get("url", "").startswith("https://typhoon.yahoo.co.jp/weather/jp/earthquake/")
        and not (existing_by_id.get(q["id"], {}).get("lat") is not None)
    ][:15]
    if to_enrich:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            detail_resps = await asyncio.gather(
                *[client.get(q["url"]) for q in to_enrich],
                return_exceptions=True,
            )
        for q, dr in zip(to_enrich, detail_resps):
            if isinstance(dr, httpx.Response) and dr.status_code == 200:
                q.update(_parse_yahoo_quake_detail_html(dr.text))

    # Carry forward previously enriched coordinates/depth for older or cached events
    for q in kyoto_quakes:
        prev = existing_by_id.get(q["id"])
        if prev:
            for field in ("lat", "lon", "depth_km", "observed_kyoto"):
                if (q.get(field) is None or q.get(field) == []) and prev.get(field):
                    q[field] = prev[field]

    jma_live_quakes: list[dict[str, Any]] = []
    if isinstance(jma_resp, httpx.Response) and jma_resp.status_code == 200:
        try:
            jma_live_quakes = _parse_jma_recent_kyoto(jma_resp.json())
        except Exception:
            jma_live_quakes = []

    # Merge Kyoto local JMA items that might be newer than Yahoo list
    merged_quakes = list(kyoto_quakes)
    seen_q_keys = {(q.get("date_iso"), q.get("epicenter"), str(q.get("mag"))) for q in merged_quakes}
    for jq in jma_live_quakes:
        key = (jq.get("date_iso"), jq.get("epicenter"), str(jq.get("mag")))
        if key not in seen_q_keys:
            merged_quakes.append(jq)
            seen_q_keys.add(key)

    merged_quakes.sort(key=lambda x: (x.get("date_iso") or "", x.get("occurred_at") or ""), reverse=True)

    # Parse Kyoto City notices
    notices: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    if isinstance(hazard_resp, httpx.Response) and hazard_resp.status_code == 200:
        hm_notice = _parse_hazard_map_page_notice(hazard_resp.text)
        if hm_notice:
            notices.append(hm_notice)
            seen_urls.add(hm_notice["url"])

    for news_url, nr in zip(KYOTO_BOUSAI_NEWS_URLS, news_resps):
        if isinstance(nr, httpx.Response) and nr.status_code == 200:
            for item in _parse_kyoto_news_html(nr.text, news_url):
                if item["url"] not in seen_urls:
                    notices.append(item)
                    seen_urls.add(item["url"])

    notices.sort(key=lambda x: x.get("date_text") or "", reverse=True)

    return {
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "yahoo_kyoto_earthquakes": YAHOO_KYOTO_QUAKE_LIST_URL,
            "jma_bosai_json": JMA_QUAKE_LIST_URL,
            "kyoto_bousai_portal": "https://www.bousai.city.kyoto.lg.jp/",
            "kyoto_hazard_map": KYOTO_HAZARD_MAP_PAGE_URL,
        },
        "earthquakes": merged_quakes,
        "municipality_updates": notices,
    }


class DisasterUpdatesStore:
    """Thread-safe cache & updater for Kyoto seismic archive (2025-2026 + older) and municipality notices."""

    def __init__(self, archive_path: Path | None = None) -> None:
        self.archive_path = archive_path or ARCHIVE_PATH
        self._lock = threading.Lock()
        self._loaded = False
        self._payload: dict[str, Any] = {}

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            if self.archive_path.exists():
                self._payload = json.loads(self.archive_path.read_text(encoding="utf-8"))
            else:
                self._payload = {
                    "last_updated_at": None,
                    "sources": {
                        "yahoo_kyoto_earthquakes": YAHOO_KYOTO_QUAKE_LIST_URL,
                        "jma_bosai_json": JMA_QUAKE_LIST_URL,
                        "kyoto_bousai_portal": "https://www.bousai.city.kyoto.lg.jp/",
                        "kyoto_hazard_map": KYOTO_HAZARD_MAP_PAGE_URL,
                    },
                    "earthquakes": [],
                    "municipality_updates": [],
                }
            self._loaded = True

    def query_updates(
        self,
        *,
        period: str = "all",
        kind: str = "all",
    ) -> dict[str, Any]:
        """Filter cached earthquakes and municipality notices by period (`all`, `recent_2y`, `2026`, `2025`, `archive`)."""
        self.ensure_loaded()
        all_quakes: list[dict[str, Any]] = list(self._payload.get("earthquakes") or [])
        all_notices: list[dict[str, Any]] = list(self._payload.get("municipality_updates") or [])

        def _match_period(item: dict[str, Any]) -> bool:
            yr = item.get("year")
            if period == "recent_2y":
                return yr in RECENT_TARGET_YEARS
            if period == "2026":
                return yr == 2026
            if period == "2025":
                return yr == 2025
            if period == "archive":
                return yr is not None and yr < 2025
            return True

        quakes = [q for q in all_quakes if _match_period(q)] if kind in ("all", "earthquakes") else []
        notices = [n for n in all_notices if _match_period(n)] if kind in ("all", "municipality") else []

        recent_2y_quakes = sum(1 for q in all_quakes if q.get("year") in RECENT_TARGET_YEARS)
        archive_quakes = sum(1 for q in all_quakes if (q.get("year") or 9999) < 2025)
        recent_2y_notices = sum(1 for n in all_notices if n.get("year") in RECENT_TARGET_YEARS)
        archive_notices = sum(1 for n in all_notices if (n.get("year") or 9999) < 2025)

        years_available = sorted(
            {
                int(x["year"])
                for x in [*all_quakes, *all_notices]
                if isinstance(x.get("year"), int)
            },
            reverse=True,
        )

        return {
            "last_updated_at": self._payload.get("last_updated_at"),
            "sources": self._payload.get("sources") or {},
            "period": period,
            "kind": kind,
            "counts": {
                "total_earthquakes": len(all_quakes),
                "recent_2y_earthquakes": recent_2y_quakes,
                "archive_earthquakes": archive_quakes,
                "total_municipality_updates": len(all_notices),
                "recent_2y_municipality_updates": recent_2y_notices,
                "archive_municipality_updates": archive_notices,
            },
            "years_available": years_available,
            "earthquakes": quakes,
            "municipality_updates": notices,
        }

    async def refresh_live(self, *, persist: bool = True) -> dict[str, Any]:
        """Fetch latest data from JMA, Yahoo Kyoto Earthquakes, and Kyoto City Bousai Portal."""
        self.ensure_loaded()
        prev_quake_ids = {q.get("id") for q in (self._payload.get("earthquakes") or [])}
        prev_notice_urls = {n.get("url") for n in (self._payload.get("municipality_updates") or [])}

        fresh = await fetch_live_archive_payload(
            existing_earthquakes=self._payload.get("earthquakes") or [],
        )
        # Keep existing items if a live source transiently failed
        if not fresh["earthquakes"] and self._payload.get("earthquakes"):
            fresh["earthquakes"] = list(self._payload["earthquakes"])
        if not fresh["municipality_updates"] and self._payload.get("municipality_updates"):
            fresh["municipality_updates"] = list(self._payload["municipality_updates"])

        with self._lock:
            self._payload = fresh
            self._loaded = True
            if persist:
                self.archive_path.parent.mkdir(parents=True, exist_ok=True)
                self.archive_path.write_text(
                    json.dumps(fresh, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

        new_q = sum(1 for q in fresh["earthquakes"] if q.get("id") not in prev_quake_ids)
        new_n = sum(1 for n in fresh["municipality_updates"] if n.get("url") not in prev_notice_urls)
        return {
            "refreshed": True,
            "new_earthquakes_count": new_q,
            "new_municipality_updates_count": new_n,
            **self.query_updates(),
        }


updates_store = DisasterUpdatesStore()
