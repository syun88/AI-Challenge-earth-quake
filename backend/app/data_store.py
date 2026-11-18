"""In-memory spatial data store for QuakeLens Japan."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd

from app.constants import (
    AGE_CATEGORY_LABELS,
    AGE_CATEGORY_ORDER,
    HAZARD_TIER_LABELS,
    HAZARD_TIER_ORDER,
    OFFICIAL_RETROFIT_PROGRAMS,
    TARGET_MUNICIPALITY,
    USAGE_GROUP_LABELS,
)

DEFAULT_PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"


class QuakeLensDataStore:
    """Loads processed Kyoto City PLATEAU + J-SHIS data and serves fast spatial/analytical queries."""

    def __init__(self, processed_dir: Path | None = None) -> None:
        self.processed_dir = processed_dir or DEFAULT_PROCESSED_DIR
        self.buildings_path = self.processed_dir / "buildings.parquet"
        self.meshes_path = self.processed_dir / "meshes.geojson"
        self.summary_path = self.processed_dir / "summary.json"

        self.buildings: gpd.GeoDataFrame = gpd.GeoDataFrame()
        self.meshes: gpd.GeoDataFrame = gpd.GeoDataFrame()
        self.summary: dict[str, Any] = {}
        self.loaded = False

    def load(self) -> None:
        """Load processed files into memory and warm spatial indices."""
        if not self.buildings_path.exists() or not self.meshes_path.exists():
            raise FileNotFoundError(
                f"Processed data not found in {self.processed_dir}. "
                "Run `uv run python scripts/fetch_and_build.py` first."
            )
        self.buildings = gpd.read_parquet(self.buildings_path)
        _ = self.buildings.sindex  # warm R-tree spatial index

        self.meshes = gpd.read_file(self.meshes_path)
        if self.summary_path.exists():
            self.summary = json.loads(self.summary_path.read_text(encoding="utf-8"))
        self.loaded = True

    def _filter_buildings_df(
        self,
        ward: str | None = None,
        age_categories: list[str] | None = None,
        hazard_tiers: list[str] | None = None,
        usage_group: str | None = None,
        structure_label: str | None = None,
        meshcode: str | None = None,
    ) -> gpd.GeoDataFrame:
        df = self.buildings
        if ward and ward != "all":
            df = df[df["ward_name"] == ward]
        if age_categories:
            df = df[df["age_category"].isin(age_categories)]
        if hazard_tiers:
            df = df[df["hazard_tier"].isin(hazard_tiers)]
        if usage_group and usage_group != "all":
            df = df[df["usage_group"] == usage_group]
        if structure_label and structure_label != "all":
            df = df[df["structure_label"] == structure_label]
        if meshcode:
            df = df[df["meshcode"] == meshcode]
        return df

    def get_metadata(self) -> dict[str, Any]:
        """Return dataset provenance, licenses, reference years, and overall completeness."""
        return {
            "municipality": self.summary.get("municipality", TARGET_MUNICIPALITY),
            "generated_at_utc": self.summary.get("generated_at_utc"),
            "is_partial_sample": self.summary.get("is_partial_sample", False),
            "plateau_metadata": self.summary.get("plateau_metadata", {}),
            "data_sources": self.summary.get("data_sources", []),
            "counts": self.summary.get("counts", {}),
            "wards": sorted(
                [w for w in self.buildings["ward_name"].unique().tolist() if w and w != "不明"]
            )
            if not self.buildings.empty
            else [],
            "age_labels": AGE_CATEGORY_LABELS,
            "hazard_labels": HAZARD_TIER_LABELS,
            "usage_group_labels": USAGE_GROUP_LABELS,
            "official_programs": OFFICIAL_RETROFIT_PROGRAMS,
        }

    def get_stats(
        self,
        ward: str | None = None,
        age_categories: list[str] | None = None,
        hazard_tiers: list[str] | None = None,
        usage_group: str | None = None,
        meshcode: str | None = None,
    ) -> dict[str, Any]:
        """Compute dashboard statistics with explicit denominators and missing-value counts."""
        # Scope without age/hazard filters for accurate denominators when needed
        scope_df = self._filter_buildings_df(ward=ward, usage_group=usage_group, meshcode=meshcode)
        filtered = self._filter_buildings_df(
            ward=ward,
            age_categories=age_categories,
            hazard_tiers=hazard_tiers,
            usage_group=usage_group,
            meshcode=meshcode,
        )

        total = int(len(filtered))
        scope_total = int(len(scope_df))
        known_year = int(filtered["year_built"].notna().sum())
        unknown_year = total - known_year

        age_counts = filtered["age_category"].value_counts().to_dict()
        hazard_counts = filtered["hazard_tier"].value_counts().to_dict()
        usage_counts = filtered["usage_group"].value_counts().to_dict()
        struct_counts = filtered["structure_label"].value_counts().head(8).to_dict()

        # Cross-tab: age_category x hazard_tier
        cross_tab = []
        if total > 0:
            ct = pd.crosstab(filtered["hazard_tier"], filtered["age_category"])
            for tier in HAZARD_TIER_ORDER:
                row: dict[str, Any] = {
                    "hazard_tier": tier,
                    "hazard_label": HAZARD_TIER_LABELS[tier],
                }
                for age in AGE_CATEGORY_ORDER:
                    row[age] = int(ct.loc[tier, age]) if (tier in ct.index and age in ct.columns) else 0
                row["total"] = sum(row[age] for age in AGE_CATEGORY_ORDER)
                cross_tab.append(row)

        pre_1981_count = int(age_counts.get("pre_1981", 0))
        overlap_very_high = int(
            ((filtered["age_category"] == "pre_1981") & (filtered["hazard_tier"] == "very_high")).sum()
        )
        overlap_elevated_or_higher = int(
            (
                (filtered["age_category"] == "pre_1981")
                & (filtered["hazard_tier"].isin(["very_high", "elevated"]))
            ).sum()
        )

        # Ward breakdown (within current age/hazard/usage filter)
        ward_rows = []
        if total > 0:
            for w_name, grp in filtered.groupby("ward_name"):
                w_total = len(grp)
                w_known = int(grp["year_built"].notna().sum())
                w_pre81 = int((grp["age_category"] == "pre_1981").sum())
                w_overlap = int(
                    (
                        (grp["age_category"] == "pre_1981")
                        & (grp["hazard_tier"].isin(["very_high", "elevated"]))
                    ).sum()
                )
                avg_prob = grp["t30_i55_ps"].dropna().mean()
                ward_rows.append({
                    "ward_name": w_name,
                    "total_buildings": int(w_total),
                    "known_year_count": w_known,
                    "unknown_year_count": int(w_total - w_known),
                    "known_year_rate": round(w_known / w_total, 4) if w_total else 0.0,
                    "pre_1981_count": w_pre81,
                    "overlap_high_pre1981": w_overlap,
                    "avg_t30_i55_ps": round(float(avg_prob), 4) if pd.notna(avg_prob) else None,
                })
            ward_rows.sort(key=lambda r: r["pre_1981_count"], reverse=True)

        return {
            "scope": {
                "ward": ward or "all",
                "usage_group": usage_group or "all",
                "age_categories": age_categories or AGE_CATEGORY_ORDER,
                "hazard_tiers": hazard_tiers or HAZARD_TIER_ORDER,
                "meshcode": meshcode,
                "scope_denominator_buildings": scope_total,
            },
            "total_buildings": total,
            "known_year_count": known_year,
            "unknown_year_count": unknown_year,
            "known_year_rate": round(known_year / total, 4) if total else 0.0,
            "unknown_year_rate": round(unknown_year / total, 4) if total else 0.0,
            "pre_1981_count": pre_1981_count,
            "pre_1981_share_of_total": round(pre_1981_count / total, 4) if total else 0.0,
            "pre_1981_share_of_known": round(pre_1981_count / known_year, 4) if known_year else None,
            "overlap_very_high_pre1981": overlap_very_high,
            "overlap_elevated_or_higher_pre1981": overlap_elevated_or_higher,
            "age_breakdown": [
                {
                    "key": k,
                    "label": AGE_CATEGORY_LABELS[k],
                    "count": int(age_counts.get(k, 0)),
                    "share": round(int(age_counts.get(k, 0)) / total, 4) if total else 0.0,
                }
                for k in AGE_CATEGORY_ORDER
            ],
            "hazard_breakdown": [
                {
                    "key": k,
                    "label": HAZARD_TIER_LABELS[k],
                    "count": int(hazard_counts.get(k, 0)),
                    "share": round(int(hazard_counts.get(k, 0)) / total, 4) if total else 0.0,
                }
                for k in HAZARD_TIER_ORDER
            ],
            "usage_breakdown": [
                {
                    "key": k,
                    "label": USAGE_GROUP_LABELS.get(k, k),
                    "count": int(usage_counts.get(k, 0)),
                }
                for k in ["residential", "non_residential", "unknown"]
            ],
            "structure_breakdown": [
                {"label": str(k), "count": int(v)} for k, v in struct_counts.items()
            ],
            "cross_tab": cross_tab,
            "ward_summary": ward_rows,
        }

    def get_priority_areas(
        self,
        ward: str | None = None,
        hazard_tiers: list[str] | None = None,
        usage_group: str | None = None,
        min_t30_i55: float = 0.0,
        min_buildings: int = 20,
        sort_by: str = "pre_1981_high_hazard",
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Rank 250m meshes using transparent raw metrics (no arbitrary weighted score)."""
        df = self.meshes.copy()
        if ward and ward != "all":
            df = df[df["ward_name"] == ward]
        if hazard_tiers:
            df = df[df["hazard_tier"].isin(hazard_tiers)]
        if usage_group == "residential":
            df = df[df["residential_count"] > 0]
        elif usage_group == "non_residential":
            df = df[(df["total_buildings"] - df["residential_count"]) > 0]
        if min_t30_i55 > 0:
            df = df[df["t30_i55_ps"].fillna(0.0) >= min_t30_i55]
        if min_buildings > 0:
            df = df[df["total_buildings"] >= min_buildings]

        if df.empty:
            return []

        if sort_by == "pre_1981_count":
            df = df.sort_values(["pre_1981_count", "t30_i55_ps"], ascending=[False, False])
        elif sort_by == "t30_i55_ps":
            df = df.sort_values(["t30_i55_ps", "pre_1981_count"], ascending=[False, False])
        elif sort_by == "pre_1981_share_known":
            df = df.sort_values(["pre_1981_share_known", "pre_1981_count"], ascending=[False, False])
        else:
            # Default: focus on high/elevated hazard (>=6%) first, then pre-1981 count
            df["is_elevated_plus"] = (df["t30_i55_ps"].fillna(0.0) >= 0.06).astype(int)
            df["is_very_high"] = (df["t30_i55_ps"].fillna(0.0) >= 0.26).astype(int)
            df = df.sort_values(
                ["is_very_high", "is_elevated_plus", "pre_1981_count", "t30_i55_ps"],
                ascending=[False, False, False, False],
            )

        records = []
        for _, r in df.head(limit).iterrows():
            records.append({
                "meshcode": r["meshcode"],
                "ward_name": r["ward_name"],
                "total_buildings": int(r["total_buildings"]),
                "known_year_count": int(r["known_year_count"]),
                "unknown_year_count": int(r["unknown_year_count"]),
                "known_year_rate": float(r["known_year_rate"]),
                "pre_1981_count": int(r["pre_1981_count"]),
                "pre_1981_residential_count": int(r["pre_1981_residential_count"]),
                "wooden_pre_1981_count": int(r["wooden_pre_1981_count"]),
                "pre_1981_share_total": float(r["pre_1981_share_total"]),
                "pre_1981_share_known": float(r["pre_1981_share_known"]) if pd.notna(r["pre_1981_share_known"]) else None,
                "t30_i55_ps": float(r["t30_i55_ps"]) if pd.notna(r["t30_i55_ps"]) else None,
                "t30_i60_ps": float(r["t30_i60_ps"]) if pd.notna(r["t30_i60_ps"]) else None,
                "hazard_tier": r["hazard_tier"],
                "hazard_label": HAZARD_TIER_LABELS.get(r["hazard_tier"], "不明"),
                "arv": float(r["arv"]) if pd.notna(r["arv"]) else None,
                "avs": float(r["avs"]) if pd.notna(r["avs"]) else None,
                "jname": r["jname"],
                "centroid_lon": float(r["centroid_lon"]),
                "centroid_lat": float(r["centroid_lat"]),
            })
        return records

    def get_meshes_geojson(self, ward: str | None = None) -> dict[str, Any]:
        """Return 250m mesh polygons with J-SHIS hazard & building stats as GeoJSON."""
        df = self.meshes
        if ward and ward != "all":
            df = df[df["ward_name"] == ward]
        return json.loads(df.to_json())

    def get_buildings_geojson(
        self,
        bbox: tuple[float, float, float, float] | None = None,
        ward: str | None = None,
        age_categories: list[str] | None = None,
        hazard_tiers: list[str] | None = None,
        usage_group: str | None = None,
        meshcode: str | None = None,
        limit: int = 3500,
    ) -> dict[str, Any]:
        """Return filtered buildings within bbox (EPSG:4326) as GeoJSON FeatureCollection."""
        df = self.buildings
        if bbox is not None:
            minx, miny, maxx, maxy = bbox
            df = df.cx[minx:maxx, miny:maxy]

        if ward and ward != "all":
            df = df[df["ward_name"] == ward]
        if age_categories:
            df = df[df["age_category"].isin(age_categories)]
        if hazard_tiers:
            df = df[df["hazard_tier"].isin(hazard_tiers)]
        if usage_group and usage_group != "all":
            df = df[df["usage_group"] == usage_group]
        if meshcode:
            df = df[df["meshcode"] == meshcode]

        total_in_bbox = int(len(df))
        truncated = total_in_bbox > limit
        if truncated:
            # Take a uniform spatial stride across the sorted GeoDataFrame so buildings
            # are evenly distributed across the entire visible map viewport
            step = max(1, total_in_bbox // limit)
            df = df.iloc[::step].iloc[:limit]

        fc = json.loads(df.to_json())
        fc["meta"] = {
            "returned": int(len(df)),
            "total_matching": total_in_bbox,
            "truncated": truncated,
            "limit": limit,
        }
        return fc

    def get_building_detail(self, building_id: str) -> dict[str, Any] | None:
        """Return full attributes and hazard context for a single building."""
        matches = self.buildings[self.buildings["building_id"] == building_id]
        if matches.empty:
            return None
        row = matches.iloc[0]
        centroid = row.geometry.centroid

        year_built = int(row["year_built"]) if pd.notna(row["year_built"]) else None
        age_cat = row["age_category"]

        # Cautious code-era note (never strictly assert pre/post June 1981 or June 2000 from year alone)
        if year_built is None:
            era_note = "建築年が公開データに含まれていないため「不明」として扱います。"
        elif year_built < 1981:
            era_note = "1981年（昭和56年）以前建築のため、1981年6月1日施行の新耐震基準導入より前の建物です（実際の耐震性は現地調査・耐震診断が必要です）。"
        elif year_built == 1981:
            era_note = "1981年建築です。PLATEAUデータは年単位のため、1981年6月1日の新耐震基準施行の前後いずれに該当するかは確認申請日等の確認が必要です。"
        elif year_built <= 1999:
            era_note = "1982〜1999年建築です。1981年新耐震基準以降ですが、2000年6月の木造住宅接合部等の規定強化より前の時期に該当します。"
        elif year_built == 2000:
            era_note = "2000年建築です。年単位データのため、2000年6月1日施行の建築基準法改正（木造接合部等の規定強化）の前後いずれかは確認が必要です。"
        else:
            era_note = "2001年以降建築です。"

        return {
            "building_id": row["building_id"],
            "ward_name": row["ward_name"],
            "year_built": year_built,
            "age_category": age_cat,
            "age_label": AGE_CATEGORY_LABELS.get(age_cat, "不明"),
            "era_note": era_note,
            "usage_code": row["usage_code"],
            "usage_label": row["usage_label"],
            "usage_group": row["usage_group"],
            "usage_group_label": USAGE_GROUP_LABELS.get(row["usage_group"], "不明"),
            "structure_code": row["structure_code"],
            "structure_label": row["structure_label"],
            "measured_height": float(row["measured_height"]) if pd.notna(row["measured_height"]) else None,
            "storeys_above": int(row["storeys_above"]) if pd.notna(row["storeys_above"]) else None,
            "footprint_area_m2": float(row["footprint_area_m2"]) if pd.notna(row["footprint_area_m2"]) else None,
            "meshcode": row["meshcode"],
            "t30_i55_ps": float(row["t30_i55_ps"]) if pd.notna(row["t30_i55_ps"]) else None,
            "t30_i60_ps": float(row["t30_i60_ps"]) if pd.notna(row["t30_i60_ps"]) else None,
            "t30_i50_ps": float(row["t30_i50_ps"]) if pd.notna(row["t30_i50_ps"]) else None,
            "hazard_tier": row["hazard_tier"],
            "hazard_label": HAZARD_TIER_LABELS.get(row["hazard_tier"], "不明"),
            "arv": float(row["arv"]) if pd.notna(row["arv"]) else None,
            "avs": float(row["avs"]) if pd.notna(row["avs"]) else None,
            "jname": row["jname"],
            "centroid_lon": round(float(centroid.x), 6),
            "centroid_lat": round(float(centroid.y), 6),
            "hazard_disclaimer": "※J-SHISハザード値は250mメッシュにおける今後30年間に一定の揺れに見舞われる確率であり、この建物個別の倒壊確率や耐震性能を示すものではありません。",
            "official_programs": OFFICIAL_RETROFIT_PROGRAMS,
        }

    def get_mesh_detail(self, meshcode: str) -> dict[str, Any] | None:
        """Return detailed stats + hazard/soil info for a 250m mesh."""
        matches = self.meshes[self.meshes["meshcode"] == meshcode]
        if matches.empty:
            return None
        r = matches.iloc[0]
        return {
            "meshcode": r["meshcode"],
            "ward_name": r["ward_name"],
            "total_buildings": int(r["total_buildings"]),
            "known_year_count": int(r["known_year_count"]),
            "unknown_year_count": int(r["unknown_year_count"]),
            "known_year_rate": float(r["known_year_rate"]),
            "pre_1981_count": int(r["pre_1981_count"]),
            "b1982_2000_count": int(r["b1982_2000_count"]),
            "post_2001_count": int(r["post_2001_count"]),
            "residential_count": int(r["residential_count"]),
            "pre_1981_residential_count": int(r["pre_1981_residential_count"]),
            "wooden_pre_1981_count": int(r["wooden_pre_1981_count"]),
            "pre_1981_share_total": float(r["pre_1981_share_total"]),
            "pre_1981_share_known": float(r["pre_1981_share_known"]) if pd.notna(r["pre_1981_share_known"]) else None,
            "t30_i45_ps": float(r["t30_i45_ps"]) if pd.notna(r["t30_i45_ps"]) else None,
            "t30_i50_ps": float(r["t30_i50_ps"]) if pd.notna(r["t30_i50_ps"]) else None,
            "t30_i55_ps": float(r["t30_i55_ps"]) if pd.notna(r["t30_i55_ps"]) else None,
            "t30_i60_ps": float(r["t30_i60_ps"]) if pd.notna(r["t30_i60_ps"]) else None,
            "hazard_tier": r["hazard_tier"],
            "hazard_label": HAZARD_TIER_LABELS.get(r["hazard_tier"], "不明"),
            "arv": float(r["arv"]) if pd.notna(r["arv"]) else None,
            "avs": float(r["avs"]) if pd.notna(r["avs"]) else None,
            "jname": r["jname"],
            "centroid_lon": float(r["centroid_lon"]),
            "centroid_lat": float(r["centroid_lat"]),
            "official_programs": OFFICIAL_RETROFIT_PROGRAMS,
        }
