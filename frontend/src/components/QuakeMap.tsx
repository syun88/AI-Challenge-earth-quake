"use client";

import React, { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Loader2, ZoomIn } from "lucide-react";
import { AGE_COLORS, HAZARD_COLORS } from "@/lib/colors";
import { getBuildingsInBbox } from "@/lib/api";
import {
  AgeCategory,
  EarthquakeEvent,
  HazardTier,
  MeshOverlayMode,
  UsageGroup,
} from "@/types/quakelens";

interface QuakeMapProps {
  meshesGeoJson: GeoJSON.FeatureCollection | null;
  earthquakes: EarthquakeEvent[];
  selectedWard: string;
  ageCategories: AgeCategory[];
  hazardTiers: HazardTier[];
  usageGroup: UsageGroup;
  showBuildings: boolean;
  showHazardMesh: boolean;
  meshOverlayMode: MeshOverlayMode;
  showEarthquakes: boolean;
  selectedBuildingId: string | null;
  selectedMeshcode: string | null;
  flyToTarget: { lon: number; lat: number; zoom: number; ts: number } | null;
  onSelectBuilding: (buildingId: string) => void;
  onSelectMesh: (meshcode: string) => void;
}

export function QuakeMap({
  meshesGeoJson,
  earthquakes,
  selectedWard,
  ageCategories,
  hazardTiers,
  usageGroup,
  showBuildings,
  showHazardMesh,
  meshOverlayMode,
  showEarthquakes,
  selectedBuildingId,
  selectedMeshcode,
  flyToTarget,
  onSelectBuilding,
  onSelectMesh,
}: QuakeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(12);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [buildingStatus, setBuildingStatus] = useState<{
    returned: number;
    total: number;
    truncated: boolean;
  } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);

  // Latest filter refs so MapLibre event listeners always read fresh filters
  const filtersRef = useRef({
    selectedWard,
    ageCategories,
    hazardTiers,
    usageGroup,
    showBuildings,
  });
  useEffect(() => {
    filtersRef.current = {
      selectedWard,
      ageCategories,
      hazardTiers,
      usageGroup,
      showBuildings,
    };
  }, [selectedWard, ageCategories, hazardTiers, usageGroup, showBuildings]);

  const callbacksRef = useRef({ onSelectBuilding, onSelectMesh });
  useEffect(() => {
    callbacksRef.current = { onSelectBuilding, onSelectMesh };
  }, [onSelectBuilding, onSelectMesh]);

  const fetchBuildingsForCurrentView = async () => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const f = filtersRef.current;
    const currentZoom = map.getZoom();
    setZoom(currentZoom);

    const src = map.getSource("buildings") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (!f.showBuildings || currentZoom < 14.2) {
      src.setData({ type: "FeatureCollection", features: [] });
      setBuildingStatus(null);
      return;
    }

    const b = map.getBounds();
    setLoadingBuildings(true);
    try {
      const fc = await getBuildingsInBbox(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        {
          ward: f.selectedWard,
          ageCategories: f.ageCategories,
          hazardTiers: f.hazardTiers,
          usageGroup: f.usageGroup,
        },
        3500
      );
      src.setData(fc);
      if (fc.meta) {
        setBuildingStatus({
          returned: fc.meta.returned,
          total: fc.meta.total_matching,
          truncated: fc.meta.truncated,
        });
      }
    } catch {
      // keep previous layer data on transient network abort
    } finally {
      setLoadingBuildings(false);
    }
  };

  // Initialize MapLibre once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          gsi_pale: {
            type: "raster",
            tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '地図タイル: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a> | 建物: <a href="https://www.mlit.go.jp/plateau/" target="_blank">Project PLATEAU</a> | ハザード: <a href="https://www.j-shis.bosai.go.jp/" target="_blank">J-SHIS (防災科研)</a>',
          },
        },
        layers: [
          {
            id: "gsi-pale-base",
            type: "raster",
            source: "gsi_pale",
            paint: {
              "raster-brightness-max": 0.92,
              "raster-saturation": -0.25,
            },
          },
        ],
      },
      center: [135.7588, 34.9858],
      zoom: 12,
      minZoom: 10,
      maxZoom: 19,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    map.on("load", () => {
      map.addSource("meshes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "meshes-fill",
        type: "fill",
        source: "meshes",
        paint: {
          "fill-color": [
            "match",
            ["get", "hazard_tier"],
            "very_high",
            HAZARD_COLORS.very_high,
            "elevated",
            HAZARD_COLORS.elevated,
            "moderate",
            HAZARD_COLORS.moderate,
            "low",
            HAZARD_COLORS.low,
            HAZARD_COLORS.unknown,
          ],
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.48, 15, 0.22],
        },
      });

      map.addLayer({
        id: "meshes-line",
        type: "line",
        source: "meshes",
        paint: {
          "line-color": "#475569",
          "line-width": 0.6,
          "line-opacity": 0.55,
        },
      });

      map.addLayer({
        id: "meshes-selected",
        type: "line",
        source: "meshes",
        filter: ["==", ["get", "meshcode"], ""],
        paint: {
          "line-color": "#38bdf8",
          "line-width": 3,
        },
      });

      map.addSource("buildings", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        paint: {
          "fill-color": [
            "match",
            ["get", "age_category"],
            "pre_1981",
            AGE_COLORS.pre_1981,
            "1982_2000",
            AGE_COLORS["1982_2000"],
            "post_2001",
            AGE_COLORS.post_2001,
            AGE_COLORS.unknown,
          ],
          "fill-opacity": 0.84,
        },
      });

      map.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        paint: {
          "line-color": "#0f172a",
          "line-width": 0.6,
          "line-opacity": 0.7,
        },
      });

      map.addLayer({
        id: "buildings-selected",
        type: "line",
        source: "buildings",
        filter: ["==", ["get", "building_id"], ""],
        paint: {
          "line-color": "#22d3ee",
          "line-width": 2.8,
        },
      });

      map.addSource("earthquakes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "earthquakes-circle",
        type: "circle",
        source: "earthquakes",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "mag"], 2],
            1,
            5,
            4,
            10,
            6,
            16,
          ],
          "circle-color": "#f43f5e",
          "circle-opacity": 0.72,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      // Interactions
      map.on("click", (e) => {
        const eqHits = map.queryRenderedFeatures(e.point, { layers: ["earthquakes-circle"] });
        if (eqHits.length > 0) {
          const p = eqHits[0].properties || {};
          new maplibregl.Popup({ maxWidth: "260px" })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div class="text-xs space-y-1">
                <div class="font-bold text-rose-300">${p.anm || "地震情報"}</div>
                <div>発生: ${p.at || "—"}</div>
                <div>規模: M${p.mag ?? "—"} / 最大震度: ${p.maxi || "—"} / 深さ: ${p.depth_km ?? "—"}km</div>
                <div class="text-[10px] text-slate-400">出典: 気象庁</div>
              </div>`
            )
            .addTo(map);
          return;
        }

        const bldgHits = map.queryRenderedFeatures(e.point, { layers: ["buildings-fill"] });
        if (bldgHits.length > 0) {
          const bid = bldgHits[0].properties?.building_id;
          if (bid) {
            callbacksRef.current.onSelectBuilding(String(bid));
            return;
          }
        }

        const meshHits = map.queryRenderedFeatures(e.point, { layers: ["meshes-fill"] });
        if (meshHits.length > 0) {
          const mc = meshHits[0].properties?.meshcode;
          if (mc) {
            callbacksRef.current.onSelectMesh(String(mc));
            if (map.getZoom() < 14.5) {
              map.flyTo({ center: e.lngLat, zoom: 15.3, duration: 800 });
            }
          }
        }
      });

      map.on("mousemove", (e) => {
        const bHits = map.queryRenderedFeatures(e.point, { layers: ["buildings-fill"] });
        if (bHits.length > 0) {
          map.getCanvas().style.cursor = "pointer";
          const p = bHits[0].properties || {};
          const yr = p.year_built ? `${p.year_built}年築` : "建築年不明";
          setHoverInfo(`${p.ward_name || ""} | ${yr} | ${p.usage_label || ""} | ${p.structure_label || ""}`);
          return;
        }
        const mHits = map.queryRenderedFeatures(e.point, { layers: ["meshes-fill"] });
        if (mHits.length > 0) {
          map.getCanvas().style.cursor = "pointer";
          const p = mHits[0].properties || {};
          const prob = p.t30_i55_ps != null ? `${(Number(p.t30_i55_ps) * 100).toFixed(1)}%` : "不明";
          setHoverInfo(
            `メッシュ ${p.meshcode} (${p.ward_name}) | 建物 ${p.total_buildings}棟 (1981以前 ${p.pre_1981_count}棟) | 30年震度6弱+ ${prob} | ARV ${p.arv ?? "—"}`
          );
          return;
        }
        map.getCanvas().style.cursor = "";
        setHoverInfo(null);
      });

      map.on("moveend", () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          fetchBuildingsForCurrentView();
        }, 220);
      });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update 250m meshes GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !meshesGeoJson) return;
    const src = map.getSource("meshes") as maplibregl.GeoJSONSource | undefined;
    src?.setData(meshesGeoJson);
  }, [meshesGeoJson, mapReady]);

  // Update earthquakes GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("earthquakes") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: earthquakes.map((q) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [q.lon, q.lat] },
        properties: { ...q },
      })),
    });
  }, [earthquakes, mapReady]);

  // Update layer visibility & mesh coloring mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    map.setLayoutProperty("meshes-fill", "visibility", showHazardMesh ? "visible" : "none");
    map.setLayoutProperty("meshes-line", "visibility", showHazardMesh ? "visible" : "none");
    map.setLayoutProperty("meshes-selected", "visibility", showHazardMesh ? "visible" : "none");
    map.setLayoutProperty("buildings-fill", "visibility", showBuildings ? "visible" : "none");
    map.setLayoutProperty("buildings-outline", "visibility", showBuildings ? "visible" : "none");
    map.setLayoutProperty("earthquakes-circle", "visibility", showEarthquakes ? "visible" : "none");

    if (meshOverlayMode === "arv") {
      map.setPaintProperty("meshes-fill", "fill-color", [
        "step",
        ["coalesce", ["get", "arv"], 0],
        "#475569",
        0.1,
        "#ccfbf1",
        1.2,
        "#5eead4",
        1.6,
        "#14b8a6",
        2.0,
        "#0f766e",
      ]);
    } else {
      map.setPaintProperty("meshes-fill", "fill-color", [
        "match",
        ["get", "hazard_tier"],
        "very_high",
        HAZARD_COLORS.very_high,
        "elevated",
        HAZARD_COLORS.elevated,
        "moderate",
        HAZARD_COLORS.moderate,
        "low",
        HAZARD_COLORS.low,
        HAZARD_COLORS.unknown,
      ]);
    }

    // Apply hazard tier filter on meshes layer as well
    if (hazardTiers.length > 0 && hazardTiers.length < 4) {
      map.setFilter("meshes-fill", ["in", ["get", "hazard_tier"], ["literal", hazardTiers]]);
    } else {
      map.setFilter("meshes-fill", null);
    }
  }, [showHazardMesh, showBuildings, showEarthquakes, meshOverlayMode, hazardTiers, mapReady]);

  // Update selected highlight filters
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setFilter("buildings-selected", [
      "==",
      ["get", "building_id"],
      selectedBuildingId || "",
    ]);
    map.setFilter("meshes-selected", ["==", ["get", "meshcode"], selectedMeshcode || ""]);
  }, [selectedBuildingId, selectedMeshcode, mapReady]);

  // Re-fetch visible buildings whenever filters change
  useEffect(() => {
    if (!mapReady) return;
    fetchBuildingsForCurrentView();
  }, [selectedWard, ageCategories, hazardTiers, usageGroup, showBuildings, mapReady]);

  // FlyTo trigger (ward change or priority area click)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !flyToTarget) return;
    map.flyTo({
      center: [flyToTarget.lon, flyToTarget.lat],
      zoom: flyToTarget.zoom,
      duration: 900,
    });
  }, [flyToTarget, mapReady]);

  return (
    <div className="relative h-full w-full bg-slate-950">
      <div ref={containerRef} className="h-full w-full" />

      {/* Top-left floating status pills */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1.5">
        {zoom < 14.2 && showBuildings && (
          <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 shadow-lg backdrop-blur">
            <ZoomIn className="h-3.5 w-3.5 text-sky-400" />
            <span>
              現在ズーム z{zoom.toFixed(1)}（メッシュ表示中）— ズームインまたはメッシュクリックで建物ポリゴン表示
            </span>
          </div>
        )}

        {loadingBuildings && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-slate-900/90 px-3 py-1.5 text-xs text-sky-200 shadow-lg">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>建物データを読み込み中...</span>
          </div>
        )}

        {!loadingBuildings && buildingStatus && showBuildings && zoom >= 14.2 && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-[11px] text-slate-200 shadow-lg">
            <span>
              表示中の建物:{" "}
              <strong className="font-mono text-white">
                {buildingStatus.returned.toLocaleString("ja-JP")}
              </strong>
              棟
              {buildingStatus.truncated &&
                `（範囲内 ${buildingStatus.total.toLocaleString("ja-JP")}棟中 上限表示・ズームインで全件）`}
            </span>
          </div>
        )}
      </div>

      {/* Bottom-left hover bar & ARV legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-2 max-w-[85%]">
        {showHazardMesh && meshOverlayMode === "arv" && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[11px] text-slate-200 shadow-lg backdrop-blur">
            <div className="mb-1 font-semibold text-teal-300">表層地盤 最大速度増幅率（ARV）</div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#ccfbf1]" /> &lt;1.2</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#5eead4]" /> 1.2–1.6</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#14b8a6]" /> 1.6–2.0</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#0f766e]" /> 2.0+（揺れ増幅大）</span>
            </div>
          </div>
        )}

        {hoverInfo && (
          <div className="rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-1.5 text-xs text-slate-100 shadow-lg backdrop-blur">
            {hoverInfo}
          </div>
        )}
      </div>
    </div>
  );
}
