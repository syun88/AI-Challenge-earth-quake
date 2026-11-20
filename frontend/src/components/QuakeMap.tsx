"use client";

import React, { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Loader2, ZoomIn, Box } from "lucide-react";
import { AGE_COLORS, HAZARD_COLORS } from "@/lib/colors";
import { API_BASE, getBuildingsCountInBbox } from "@/lib/api";
import {
  AgeCategory,
  EarthquakeEvent,
  HazardTier,
  MeshOverlayMode,
  UsageGroup,
} from "@/types/quakelens";

function buildBuildingMapFilter(params: {
  selectedWard: string;
  ageCategories: AgeCategory[];
  hazardTiers: HazardTier[];
  usageGroup: UsageGroup;
}): maplibregl.FilterSpecification | null {
  const clauses: maplibregl.ExpressionSpecification[] = [];
  if (params.selectedWard && params.selectedWard !== "all") {
    clauses.push(["==", ["get", "ward_name"], params.selectedWard]);
  }
  if (params.ageCategories.length > 0 && params.ageCategories.length < 4) {
    clauses.push(["in", ["get", "age_category"], ["literal", params.ageCategories]]);
  }
  if (params.hazardTiers.length > 0 && params.hazardTiers.length < 4) {
    clauses.push(["in", ["get", "hazard_tier"], ["literal", params.hazardTiers]]);
  }
  if (params.usageGroup && params.usageGroup !== "all") {
    clauses.push(["==", ["get", "usage_group"], params.usageGroup]);
  }
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0];
  return ["all", ...clauses];
}

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
  is3D: boolean;
  onToggle3D: () => void;
  selectedBuildingId: string | null;
  selectedMeshcode: string | null;
  flyToTarget: { lon: number; lat: number; zoom: number; ts: number } | null;
  onSelectBuilding: (buildingId: string) => void;
  onSelectMesh: (meshcode: string) => void;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

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
  is3D,
  onToggle3D,
  selectedBuildingId,
  selectedMeshcode,
  flyToTarget,
  onSelectBuilding,
  onSelectMesh,
}: QuakeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(14.8);
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

  const meshesRef = useRef<GeoJSON.FeatureCollection | null>(meshesGeoJson);
  useEffect(() => {
    meshesRef.current = meshesGeoJson;
  }, [meshesGeoJson]);

  const earthquakesRef = useRef<EarthquakeEvent[]>(earthquakes);
  useEffect(() => {
    earthquakesRef.current = earthquakes;
  }, [earthquakes]);

  const fetchBuildingsForCurrentView = async () => {
    const map = mapRef.current;
    if (!map) return;
    const f = filtersRef.current;
    const currentZoom = map.getZoom();
    setZoom(currentZoom);

    if (!f.showBuildings || currentZoom < 13.5) {
      setBuildingStatus(null);
      return;
    }

    const b = map.getBounds();
    try {
      const res = await getBuildingsCountInBbox(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        {
          ward: f.selectedWard,
          ageCategories: f.ageCategories,
          hazardTiers: f.hazardTiers,
          usageGroup: f.usageGroup,
        }
      );
      setBuildingStatus({
        returned: res.total_matching,
        total: res.total_matching,
        truncated: false,
      });
    } catch {
      // ignore transient abort
    }
  };

  // Initialize MapLibre once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: maplibregl.Map;
    try {
      maplibregl.setWorkerUrl("/maplibre-gl-worker.cjs");
      map = new maplibregl.Map({
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
        center: [135.7645, 34.9945],
        zoom: 14.8,
        minZoom: 10,
        maxZoom: 19,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? `地図の初期化に失敗しました（WebGL設定をご確認ください）: ${err.message}`
          : "地図の初期化に失敗しました。";
      queueMicrotask(() => setMapError(msg));
      return;
    }

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let layersInitialized = false;

    const initMapLayers = () => {
      if (layersInitialized || !map.isStyleLoaded()) return;
      if (map.getSource("meshes")) {
        layersInitialized = true;
        setMapReady(true);
        return;
      }
      layersInitialized = true;

      map.addSource("meshes", {
        type: "geojson",
        data: meshesRef.current ?? EMPTY_FC,
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
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.58, 14, 0.34, 16, 0.2],
        },
      });

      map.addLayer({
        id: "meshes-line",
        type: "line",
        source: "meshes",
        paint: {
          "line-color": "#334155",
          "line-width": 0.85,
          "line-opacity": 0.68,
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

      const tileOrigin =
        typeof window !== "undefined" ? `${window.location.origin}${API_BASE}` : API_BASE;
      map.addSource("buildings", {
        type: "vector",
        tiles: [`${tileOrigin}/api/tiles/buildings/{z}/{x}/{y}.pbf`],
        minzoom: 13,
        maxzoom: 15,
        bounds: [135.45, 34.84, 135.92, 35.22],
      });

      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 13.5,
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
          "fill-opacity": 0.86,
        },
      });

      map.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 13.5,
        paint: {
          "line-color": "#0f172a",
          "line-width": 0.65,
          "line-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "buildings-selected",
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 13.5,
        filter: ["==", ["get", "building_id"], ""],
        paint: {
          "line-color": "#22d3ee",
          "line-width": 2.8,
        },
      });

      map.addLayer({
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 13.5,
        layout: {
          visibility: "none",
        },
        paint: {
          "fill-extrusion-color": [
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
          "fill-extrusion-height": [
            "coalesce",
            ["get", "measured_height"],
            ["*", ["coalesce", ["get", "storeys_above"], 2], 3.2],
            6.0,
          ],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.9,
          "fill-extrusion-vertical-gradient": true,
        },
      });

      map.setLight({
        anchor: "viewport",
        color: "#ffffff",
        intensity: 0.45,
        position: [1.5, 210, 30],
      });

      map.addSource("earthquakes", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: earthquakesRef.current.map((q) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [q.lon, q.lat] },
            properties: { ...q },
          })),
        },
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

        const bldgHits = map.queryRenderedFeatures(e.point, {
          layers: ["buildings-fill", "buildings-3d"],
        });
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
            if (map.getZoom() < 14.2) {
              map.flyTo({ center: e.lngLat, zoom: 15.2, duration: 800 });
            }
          }
        }
      });

      map.on("mousemove", (e) => {
        const bHits = map.queryRenderedFeatures(e.point, {
          layers: ["buildings-fill", "buildings-3d"],
        });
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

      map.on("sourcedataloading", (e) => {
        if (e.sourceId === "buildings" && map.getZoom() >= 13.5 && filtersRef.current.showBuildings) {
          setLoadingBuildings(true);
        }
      });

      map.on("idle", () => {
        setLoadingBuildings(false);
      });

      map.on("moveend", () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          fetchBuildingsForCurrentView();
        }, 150);
      });

      map.resize();
      setMapReady(true);
    };

    map.on("error", (e) => {
      const msg = e.error?.message;
      if (msg && !msg.includes("Failed to fetch")) {
        setMapError(`地図描画エラー: ${msg}`);
      }
    });

    map.on("style.load", initMapLayers);
    map.on("load", initMapLayers);
    if (map.isStyleLoaded()) {
      initMapLayers();
    }

    const ro = new ResizeObserver(() => {
      map.resize();
    });
    if (containerRef.current) {
      ro.observe(containerRef.current);
    }

    mapRef.current = map;
    return () => {
      ro.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      setMapReady(false);
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
    map.setLayoutProperty(
      "buildings-fill",
      "visibility",
      showBuildings && !is3D ? "visible" : "none"
    );
    map.setLayoutProperty(
      "buildings-outline",
      "visibility",
      showBuildings && !is3D ? "visible" : "none"
    );
    map.setLayoutProperty(
      "buildings-selected",
      "visibility",
      showBuildings && !is3D ? "visible" : "none"
    );
    map.setLayoutProperty(
      "buildings-3d",
      "visibility",
      showBuildings && is3D ? "visible" : "none"
    );
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
  }, [showHazardMesh, showBuildings, showEarthquakes, is3D, meshOverlayMode, hazardTiers, mapReady]);

  // Smooth camera tilt/bearing transition when toggling 2D / 3D mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.easeTo({
      pitch: is3D ? 55 : 0,
      bearing: is3D ? -20 : 0,
      duration: 750,
    });
  }, [is3D, mapReady]);

  // Update selected highlight filters
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setFilter("buildings-selected", [
      "==",
      ["get", "building_id"],
      selectedBuildingId || "",
    ]);
    map.setPaintProperty("buildings-3d", "fill-extrusion-color", [
      "case",
      ["==", ["get", "building_id"], selectedBuildingId || ""],
      "#22d3ee",
      [
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
    ]);
    map.setFilter("meshes-selected", ["==", ["get", "meshcode"], selectedMeshcode || ""]);
  }, [selectedBuildingId, selectedMeshcode, mapReady]);

  // Update client-side vector tile filters instantly & refresh viewport building count
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const filterExpr = buildBuildingMapFilter({
      selectedWard,
      ageCategories,
      hazardTiers,
      usageGroup,
    });
    if (map.getLayer("buildings-fill")) map.setFilter("buildings-fill", filterExpr);
    if (map.getLayer("buildings-outline")) map.setFilter("buildings-outline", filterExpr);
    if (map.getLayer("buildings-3d")) map.setFilter("buildings-3d", filterExpr);
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
    <div className="relative h-full w-full min-h-[420px] bg-slate-950">
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {mapError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/90 p-6 text-center text-sm text-rose-200">
          <div className="max-w-md rounded-xl border border-rose-500/40 bg-rose-950/50 p-4">
            {mapError}
          </div>
        </div>
      )}

      {/* Top-left floating status pills */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1.5">
        {zoom < 13.5 && showBuildings && (
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 shadow-lg backdrop-blur">
            <ZoomIn className="h-3.5 w-3.5 text-sky-400" />
            <span>
              現在ズーム z{zoom.toFixed(1)}（250mメッシュ表示中）
            </span>
            <button
              type="button"
              onClick={() => {
                mapRef.current?.flyTo({
                  center: mapRef.current.getCenter(),
                  zoom: 15.2,
                  duration: 700,
                });
              }}
              className="rounded-md bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-sky-500"
            >
              ズームインして建物表示
            </button>
          </div>
        )}

        {buildingStatus && showBuildings && zoom >= 13.5 && (
          <div className="pointer-events-auto inline-flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-[11px] text-slate-200 shadow-lg">
            {loadingBuildings && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />}
            <span>
              表示中の建物:{" "}
              <strong className="font-mono text-white">
                {buildingStatus.total.toLocaleString("ja-JP")}
              </strong>
              棟（全件表示・制限なし）
            </span>
            <button
              type="button"
              onClick={onToggle3D}
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold transition ${
                is3D
                  ? "border-amber-500/60 bg-amber-600/30 text-amber-200 hover:bg-amber-600/40"
                  : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              <Box className="h-3 w-3" />
              {is3D ? "2Dに戻す" : "3D表示"}
            </button>
            <button
              type="button"
              onClick={() => {
                mapRef.current?.flyTo({
                  center: [135.7588, 34.9858],
                  zoom: 12.0,
                  duration: 700,
                });
              }}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-sky-300 transition hover:bg-slate-700"
            >
              京都市全域（z12）
            </button>
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
