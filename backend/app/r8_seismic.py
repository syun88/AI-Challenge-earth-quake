"""Parser, store, and priority seismic-retrofit recommender based on Kyoto City's official
'市有建築物耐震性能リスト（令和8年4月1日時点）' (R8_list.pdf).

Buildings NOT listed in R8_list.pdf (private residential/commercial/older wooden structures
and unlisted facilities outside the municipal asset list) are prioritized for seismic
inspection and retrofitting, especially pre-1981 or unknown-era buildings in high-hazard meshes.
"""

from __future__ import annotations

import io
import json
import re
import threading
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader

R8_PDF_URL = "https://www.city.kyoto.lg.jp/tokei/cmsfiles/contents/0000128/128082/R8_list.pdf"
R8_PAGE_URL = "https://www.city.kyoto.lg.jp/tokei/page/0000128082.html"
R8_DATA_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "processed" / "kyoto_r8_seismic_list.json"
)

KYOTO_WARDS = (
    "北区",
    "上京区",
    "左京区",
    "中京区",
    "東山区",
    "山科区",
    "下京区",
    "南区",
    "右京区",
    "西京区",
    "伏見区",
)
VALID_GRADES = ("新耐震", "Ⅲ", "Ⅱ", "Ⅰ", "未診断")
ROW_TAIL_RE = re.compile(
    r"^(?P<prefix>.*?)\s+"
    r"(?P<ward>" + "|".join(KYOTO_WARDS) + r")\s+"
    r"(?P<structure>[A-Za-z・煉瓦\-\u3000]+)\s+"
    r"(?P<storeys>\d+|-)\s+"
    r"(?P<area>[\d,]+|-)\s+"
    r"(?P<era>(?:明治|大正|昭和|平成|令和|元治|慶応)[0-9元]+年|-)\s+"
    r"(?P<grade>新耐震|Ⅲ|Ⅱ|Ⅰ|未診断)$"
)


def _era_to_ad_year(era_text: str) -> int | None:
    if not era_text or era_text == "-":
        return None
    m = re.match(r"^(明治|大正|昭和|平成|令和|元治|慶応)(元|\d+)年$", era_text.strip())
    if not m:
        return None
    era, yr_s = m.group(1), m.group(2)
    num = 1 if yr_s == "元" else int(yr_s)
    offsets = {
        "元治": 1864,
        "慶応": 1865,
        "明治": 1868,
        "大正": 1912,
        "昭和": 1926,
        "平成": 1989,
        "令和": 2019,
    }
    return offsets[era] + num - 1


def _normalize_name(text: str) -> str:
    s = re.sub(r"[\s　・\-\(\)（）「」『』]+", "", str(text or ""))
    # Strip common prefixes/suffixes for fuzzy facility matching
    for tok in ("京都市立", "京都市", "元", "庁舎", "本館", "校舎", "体育館"):
        s = s.replace(tok, "")
    return s.lower()


def parse_r8_pdf_bytes(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """Parse all building wing rows from Kyoto City R8_list.pdf."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    records: list[dict[str, Any]] = []
    pending_lines: list[str] = []

    for page_idx, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        pending_lines = []
        for raw_line in text.splitlines():
            line = re.sub(r"\s+", " ", raw_line).strip()
            if not line:
                continue
            # Skip repeated page headers & footers
            if line == "建築物" or any(
                skip in line
                for skip in (
                    "地震時に防災",
                    "活動拠点とな",
                    "る建築物",
                    "災害時の要配",
                    "慮者が利用す",
                    "不特定多数の",
                    "者が利用する",
                    "棟名称 行政区",
                    "建築 年次",
                    "耐震 性能",
                    "延べ面積",
                    "市有建築物耐震性能リスト",
                    "ページ",
                )
            ) or re.fullmatch(r"\d+\s*/\s*\d+\s*ページ", line):
                continue

            combined = " ".join([*pending_lines, line]).strip()
            m = ROW_TAIL_RE.match(combined)
            if not m:
                # Some multi-line building names wrap across 2-3 lines before the tail
                pending_lines.append(line)
                if len(pending_lines) > 4:
                    pending_lines = pending_lines[-2:]
                continue

            pending_lines = []
            prefix = m.group("prefix").strip()
            circle_count = prefix.count("○")
            name = prefix.replace("○", "").strip()
            name = re.sub(r"\s+", " ", name).strip()
            ward = m.group("ward")
            structure = m.group("structure").strip()
            storeys_raw = m.group("storeys")
            storeys = int(storeys_raw) if storeys_raw.isdigit() else None
            area_raw = m.group("area").replace(",", "")
            area_m2 = int(area_raw) if area_raw.isdigit() else None
            era = m.group("era")
            year_ad = _era_to_ad_year(era)
            grade = m.group("grade")

            records.append(
                {
                    "id": f"r8-{len(records) + 1:04d}",
                    "page": page_idx,
                    "role_marks": circle_count,
                    "name": name,
                    "ward": ward,
                    "structure": structure,
                    "storeys": storeys,
                    "area_m2": area_m2,
                    "era": era,
                    "year_built": year_ad,
                    "seismic_grade": grade,
                    "needs_retrofit": grade in ("Ⅰ", "Ⅱ", "未診断"),
                }
            )
    return records


class R8SeismicStore:
    """Thread-safe store for Kyoto City's R8 Municipal Building Seismic List (R8_list.pdf)."""

    def __init__(self, data_path: Path | None = None) -> None:
        self.data_path = data_path or R8_DATA_PATH
        self._lock = threading.Lock()
        self._loaded = False
        self._records: list[dict[str, Any]] = []
        self._meta: dict[str, Any] = {}
        self._geocode_cache: dict[str, tuple[float, float, str]] = {}

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            if self.data_path.exists():
                payload = json.loads(self.data_path.read_text(encoding="utf-8"))
                self._records = list(payload.get("records") or [])
                self._meta = {
                    "source": payload.get("source"),
                    "pdf_url": payload.get("pdf_url", R8_PDF_URL),
                    "page_url": payload.get("page_url", R8_PAGE_URL),
                    "as_of": payload.get("as_of", "令和8年4月1日時点"),
                }
            else:
                self._records = []
                self._meta = {
                    "source": "京都市 市有建築物耐震性能リスト（R8_list.pdf）",
                    "pdf_url": R8_PDF_URL,
                    "page_url": R8_PAGE_URL,
                    "as_of": "令和8年4月1日時点",
                }
            self._loaded = True

    def get_summary_and_list(
        self,
        *,
        ward: str | None = None,
        grade: str | None = None,
        q: str | None = None,
        limit: int = 120,
    ) -> dict[str, Any]:
        self.ensure_loaded()
        records = self._records

        grade_counts: dict[str, int] = {g: 0 for g in VALID_GRADES}
        by_ward: dict[str, dict[str, int]] = {}
        for r in records:
            g = r.get("seismic_grade") or "不明"
            if g in grade_counts:
                grade_counts[g] += 1
            w = r.get("ward") or "不明"
            wb = by_ward.setdefault(w, {"total": 0, "safe": 0, "needs_retrofit": 0})
            wb["total"] += 1
            if r.get("needs_retrofit"):
                wb["needs_retrofit"] += 1
            else:
                wb["safe"] += 1

        filtered: list[dict[str, Any]] = []
        q_norm = (q or "").strip().lower()
        for r in records:
            if ward and ward != "all" and r.get("ward") != ward:
                continue
            if grade and grade != "all" and r.get("seismic_grade") != grade:
                continue
            if q_norm and q_norm not in str(r.get("name") or "").lower() and q_norm not in str(r.get("ward") or "").lower():
                continue
            filtered.append(r)

        return {
            **self._meta,
            "total_listed": len(records),
            "filtered_count": len(filtered),
            "grade_counts": grade_counts,
            "by_ward": [
                {"ward": w, **vals}
                for w, vals in sorted(by_ward.items(), key=lambda kv: kv[1]["total"], reverse=True)
            ],
            "records": filtered[:limit],
            "unlisted_policy": (
                "この表（R8_list.pdf）は京都市の防災拠点等の市有建築物を対象としています。"
                "表に掲載されていない一般住宅・民間建築物・未掲載施設（特に1981年以前の旧耐震および建築年不明）は"
                "公的耐震リストの枠外にあるため、優先的に耐震診断・耐震改修を実施することを推奨します。"
            ),
        }

    def match_facility_name(self, name: str, ward: str | None = None) -> dict[str, Any]:
        """Cross-reference a named facility (e.g., official shelter or hub) against R8_list.pdf."""
        self.ensure_loaded()
        norm_target = _normalize_name(name)
        if not norm_target or len(norm_target) < 2:
            return {
                "listed_in_r8": False,
                "matched_entries": [],
                "seismic_grade": None,
                "priority_note": "R8市有耐震性能リスト未掲載（個別確認・優先耐震確認対象）",
            }

        matches: list[dict[str, Any]] = []
        for r in self._records:
            if ward and ward != "all" and r.get("ward") != ward:
                continue
            r_norm = _normalize_name(r.get("name") or "")
            if not r_norm or len(r_norm) < 2:
                continue
            if norm_target in r_norm or r_norm in norm_target:
                matches.append(r)

        if not matches:
            return {
                "listed_in_r8": False,
                "matched_entries": [],
                "seismic_grade": None,
                "priority_note": (
                    "R8市有建築物耐震性能リスト（R8_list.pdf）に未掲載の施設です。"
                    "市有耐震リスト対象外（学校別管理・民有・公園等）のため、建物を使用する場合は優先的な耐震確認・補強検討を推奨します。"
                ),
            }

        grades = [m["seismic_grade"] for m in matches]
        needs_work = any(m.get("needs_retrofit") for m in matches)
        worst = next((g for g in ("Ⅰ", "未診断", "Ⅱ", "Ⅲ", "新耐震") if g in grades), grades[0])
        return {
            "listed_in_r8": True,
            "matched_entries": matches[:4],
            "seismic_grade": worst,
            "priority_note": (
                f"R8市有耐震リスト掲載（区分: {worst}）— 区分Ⅰ/Ⅱ/未診断が含まれるため優先耐震改修対象"
                if needs_work
                else f"R8市有耐震リスト掲載確認済（耐震区分: {worst}）"
            ),
        }

    def assess_building(self, building: dict[str, Any]) -> dict[str, Any]:
        """Assess a PLATEAU building against R8_list.pdf and prioritize unlisted buildings for retrofitting."""
        self.ensure_loaded()
        ward = str(building.get("ward_name") or "")
        age_cat = str(building.get("age_category") or "unknown")
        usage_code = str(building.get("usage_code") or "")
        usage_group = str(building.get("usage_group") or "unknown")
        year_built = building.get("year_built")
        storeys = building.get("storeys_above")
        fp_area = building.get("footprint_area_m2")
        est_total_area = (
            float(fp_area) * float(storeys or 1)
            if fp_area is not None
            else None
        )
        hazard_tier = str(building.get("hazard_tier") or "unknown")

        # Only public/governmental/educational/welfare PLATEAU usages (421/422) could possibly be R8 municipal facilities
        # Private residences (411/412) and private commercial buildings are NEVER in R8_list.pdf.
        candidates: list[dict[str, Any]] = []
        if usage_code in ("421", "422") or usage_group == "non_residential":
            for r in self._records:
                if ward and r.get("ward") != ward:
                    continue
                if storeys and r.get("storeys") and int(r["storeys"]) != int(storeys):
                    continue
                if year_built and r.get("year_built") and abs(int(r["year_built"]) - int(year_built)) > 1:
                    continue
                if est_total_area and r.get("area_m2"):
                    ratio = abs(float(r["area_m2"]) - est_total_area) / max(float(r["area_m2"]), 1.0)
                    if ratio > 0.20:
                        continue
                if usage_code in ("421", "422"):
                    candidates.append(r)

        # Even if geometric candidates exist for 421/422, private buildings remain unlisted.
        has_strong_municipal_candidate = usage_code in ("421", "422") and len(candidates) > 0

        if has_strong_municipal_candidate:
            worst = next(
                (
                    g
                    for g in ("Ⅰ", "未診断", "Ⅱ", "Ⅲ", "新耐震")
                    if any(c.get("seismic_grade") == g for c in candidates)
                ),
                candidates[0]["seismic_grade"],
            )
            needs_work = worst in ("Ⅰ", "Ⅱ", "未診断")
            return {
                "listed_in_r8": True,
                "status_label": f"R8市有耐震リスト掲載候補あり（区分: {worst}）",
                "priority_tier": "listed_needs_work" if needs_work else "listed_ok",
                "priority_badge": (
                    f"R8リスト掲載候補・要耐震対策({worst})"
                    if needs_work
                    else f"R8リスト掲載候補({worst})"
                ),
                "recommendation": (
                    f"同区・同規模の市有施設候補がR8リストに存在します（区分: {worst}）。"
                    + (
                        "区分Ⅰ・Ⅱ・未診断のため耐震補強・診断が推奨されます。"
                        if needs_work
                        else "施設名称を公式PDFと最終照合のうえご確認ください。なお表に載っていない一般・民間建物はより優先的に耐震対策が必要です。"
                    )
                ),
                "r8_pdf_url": R8_PDF_URL,
                "r8_page_url": R8_PAGE_URL,
                "matched_r8_candidates": candidates[:3],
            }

        # Building NOT listed in R8_list.pdf -> prioritize seismic retrofitting!
        is_old_or_unknown = age_cat in ("pre_1981", "unknown")
        is_high_hazard = hazard_tier in ("very_high", "elevated")

        if is_old_or_unknown and is_high_hazard:
            tier = "critical"
            badge = "最優先耐震改修・診断推奨（R8表未掲載）"
            rec = (
                "この建物は京都市『市有建築物耐震性能リスト（R8_list.pdf）』に載っていない対象外建物であり、"
                "かつ旧耐震（1981年以前）または建築年不明・地震ハザード上位エリアのため【最優先で耐震診断・耐震改修】を強く推奨します。"
            )
        elif is_old_or_unknown:
            tier = "high"
            badge = "優先耐震診断・補強推奨（R8表未掲載）"
            rec = (
                "この建物は『R8_list.pdf（市有建築物耐震性能リスト）』に掲載されていない一般・民有等建物です。"
                "公的耐震リストの枠外であり建築時期も古い/不明なため、優先的に耐震診断・耐震改修をご検討ください。"
            )
        else:
            tier = "standard"
            badge = "R8表未掲載（個別耐震確認対象）"
            rec = (
                "この建物は『R8_list.pdf』未掲載の一般・民有等建物です。"
                "リスト記載の市有建築物（新耐震/Ⅲ管理下）とは異なり所有者側での耐震管理が必要となるため、接合部・壁量等の耐震確認を推奨します。"
            )

        return {
            "listed_in_r8": False,
            "status_label": "R8市有耐震性能リスト未掲載（優先耐震対象）",
            "priority_tier": tier,
            "priority_badge": badge,
            "recommendation": rec,
            "r8_pdf_url": R8_PDF_URL,
            "r8_page_url": R8_PAGE_URL,
            "matched_r8_candidates": [],
        }

    async def _nominatim_lookup(self, query: str, ward: str | None = None) -> tuple[float, float, str] | None:
        cache_key = f"{ward or 'all'}::{query}"
        if cache_key in self._geocode_cache:
            return self._geocode_cache[cache_key]
        search_q = f"京都市{ward} {query}" if ward and ward != "all" else f"京都市 {query}"
        try:
            async with httpx.AsyncClient(
                timeout=6.0,
                headers={"User-Agent": "QuakeLensJapan/1.0 (Kyoto disaster safety app)"},
            ) as client:
                resp = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={
                        "q": search_q,
                        "format": "json",
                        "limit": 3,
                        "countrycodes": "jp",
                        "viewbox": "135.55,35.32,135.90,34.87",
                        "bounded": 1,
                    },
                )
            if resp.status_code != 200:
                return None
            rows = resp.json()
            for item in rows:
                disp = str(item.get("display_name") or "")
                if ward and ward != "all" and ward not in disp:
                    continue
                lat = float(item["lat"])
                lon = float(item["lon"])
                res = (lat, lon, disp)
                self._geocode_cache[cache_key] = res
                return res
        except Exception:
            return None
        return None

    async def locate_record(self, record_id: str, store: Any | None = None) -> dict[str, Any] | None:
        """Resolve real map coordinates, hazard mesh, and nearby PLATEAU building for an R8_list.pdf entry."""
        self.ensure_loaded()
        rec = next((r for r in self._records if r.get("id") == record_id), None)
        if rec is None:
            return None

        from app.constants import WARD_CENTERS
        from app.route_sim import SHELTER_RELIEF_HUBS, _dist_km
        from app.shelter_rec import _lookup_mesh_hazard, shelter_store

        ward = str(rec.get("ward") or "")
        name = str(rec.get("name") or "")
        base_name = re.split(r"[\s　]+", name)[0]
        norm_base = _normalize_name(base_name)
        norm_full = _normalize_name(name)

        lat: float | None = None
        lon: float | None = None
        geocode_source = "ward_center"
        matched_address: str | None = None
        matched_shelter_id: str | None = None

        # 1) Match against official 514 Kyoto shelters
        shelter_store.ensure_loaded()
        for s in shelter_store.list_shelters(ward=ward or None):
            s_norm = _normalize_name(s.get("name") or "")
            if not s_norm:
                continue
            if (norm_full and (norm_full in s_norm or s_norm in norm_full)) or (
                len(norm_base) >= 3 and (norm_base in s_norm or s_norm in norm_base)
            ):
                lat, lon = float(s["lat"]), float(s["lon"])
                geocode_source = "official_shelter"
                matched_address = s.get("address")
                matched_shelter_id = s.get("id")
                break

        # 2) Match against municipal relief hubs
        if lat is None:
            for hub in SHELTER_RELIEF_HUBS.values():
                if ward and hub.get("ward") != ward:
                    continue
                h_norm = _normalize_name(hub.get("name") or "")
                if (norm_base and norm_base in h_norm) or ("区役所" in name and "総合庁舎" in name and hub.get("ward") == ward):
                    lat, lon = float(hub["lat"]), float(hub["lon"])
                    geocode_source = "municipal_hub"
                    matched_address = f"{hub['ward']} {hub['name']}"
                    break

        # 3) Nominatim Kyoto-bounded geocoding for exact municipal facility location
        if lat is None:
            nom = await self._nominatim_lookup(base_name or name, ward=ward)
            if nom is None and base_name != name:
                nom = await self._nominatim_lookup(name, ward=ward)
            if nom is not None:
                lat, lon, matched_address = nom
                geocode_source = "osm_nominatim"

        # 4) Fallback to PLATEAU public building geometric match in the same ward
        matched_building_id: str | None = None
        if store is not None and getattr(store, "loaded", False) and hasattr(store, "buildings"):
            df = store.buildings
            if lat is not None and lon is not None:
                try:
                    sub = df.cx[lon - 0.0012 : lon + 0.0012, lat - 0.0012 : lat + 0.0012]
                    if not sub.empty:
                        best_d = 999.0
                        for _, brow in sub.head(30).iterrows():
                            d = _dist_km(lon, lat, float(brow["centroid_lon"]), float(brow["centroid_lat"]))
                            if d < best_d:
                                best_d = d
                                matched_building_id = str(brow["building_id"])
                except Exception:
                    pass
            else:
                try:
                    wdf = df[df["ward_name"] == ward]
                    pub = wdf[wdf["usage_code"].isin(["421", "422"])]
                    cand_df = pub if not pub.empty else wdf
                    if rec.get("storeys") and not cand_df.empty:
                        s_df = cand_df[cand_df["storeys_above"] == rec["storeys"]]
                        if not s_df.empty:
                            cand_df = s_df
                    if rec.get("year_built") and not cand_df.empty:
                        y_df = cand_df[cand_df["year_built"].sub(rec["year_built"]).abs() <= 2]
                        if not y_df.empty:
                            cand_df = y_df
                    if not cand_df.empty:
                        pick = cand_df.iloc[0]
                        lat = float(pick["centroid_lat"])
                        lon = float(pick["centroid_lon"])
                        matched_building_id = str(pick["building_id"])
                        geocode_source = "plateau_ward_match"
                except Exception:
                    pass

        # 5) Final fallback to ward center
        if lat is None or lon is None:
            wc = WARD_CENTERS.get(ward) or WARD_CENTERS["all"]
            lat, lon = float(wc["lat"]), float(wc["lon"])
            geocode_source = "ward_center"

        hazard = _lookup_mesh_hazard(lat, lon, store)
        return {
            "record": rec,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "geocode_source": geocode_source,
            "matched_address": matched_address or f"京都府京都市{ward}",
            "matched_shelter_id": matched_shelter_id,
            "matched_building_id": matched_building_id,
            "hazard": hazard,
            "r8_pdf_url": R8_PDF_URL,
            "r8_page_url": R8_PAGE_URL,
        }

    async def locate_unlisted_query(
        self, query: str, ward: str | None = None, store: Any | None = None
    ) -> dict[str, Any]:
        """Locate an unlisted building/facility query on the map and return priority retrofit guidance."""
        self.ensure_loaded()
        from app.constants import WARD_CENTERS
        from app.shelter_rec import _lookup_mesh_hazard, shelter_store

        q_clean = (query or "").strip()
        lat: float | None = None
        lon: float | None = None
        geocode_source = "ward_center"
        matched_address: str | None = None
        matched_shelter_id: str | None = None

        shelter_store.ensure_loaded()
        q_norm = _normalize_name(q_clean)
        for s in shelter_store.list_shelters(ward=None if not ward or ward == "all" else ward):
            s_norm = _normalize_name(s.get("name") or "")
            if q_norm and s_norm and (q_norm in s_norm or s_norm in q_norm):
                lat, lon = float(s["lat"]), float(s["lon"])
                geocode_source = "official_shelter"
                matched_address = s.get("address")
                matched_shelter_id = s.get("id")
                break

        if lat is None and q_clean:
            nom = await self._nominatim_lookup(q_clean, ward=ward)
            if nom is not None:
                lat, lon, matched_address = nom
                geocode_source = "osm_nominatim"

        if lat is None or lon is None:
            wc = WARD_CENTERS.get(ward or "all") or WARD_CENTERS["all"]
            lat, lon = float(wc["lat"]), float(wc["lon"])
            geocode_source = "ward_center"

        hazard = _lookup_mesh_hazard(lat, lon, store)
        return {
            "query": q_clean,
            "ward": ward if ward and ward != "all" else (hazard or {}).get("ward_name") or "京都市全域",
            "listed_in_r8": False,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "geocode_source": geocode_source,
            "matched_address": matched_address or q_clean,
            "matched_shelter_id": matched_shelter_id,
            "hazard": hazard,
            "priority_message": (
                f"「{q_clean}」は京都市『市有建築物耐震性能リスト（R8_list.pdf）』に未掲載のため、"
                "公的耐震管理の対象外として優先的な耐震診断・耐震改修を推奨します。"
            ),
            "r8_pdf_url": R8_PDF_URL,
            "r8_page_url": R8_PAGE_URL,
        }


r8_seismic_store = R8SeismicStore()


async def fetch_and_build_r8_json() -> dict[str, Any]:
    """Download Kyoto City R8_list.pdf and build kyoto_r8_seismic_list.json."""
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        resp = await client.get(R8_PDF_URL)
        resp.raise_for_status()
    records = parse_r8_pdf_bytes(resp.content)
    payload = {
        "source": "京都市 市有建築物耐震性能リスト（令和8年4月1日時点）",
        "pdf_url": R8_PDF_URL,
        "page_url": R8_PAGE_URL,
        "as_of": "令和8年4月1日時点",
        "count": len(records),
        "records": records,
    }
    R8_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    R8_DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload
