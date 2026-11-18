"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import { Loader2, ZoomIn, Activity, RotateCcw } from "lucide-react";
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

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const AGE_MESH_PROP_MAP: Record<AgeCategory, string> = {
  pre_1981: "pre_1981_count",
  "1982_2000": "b1982_2000_count",
  post_2001: "post_2001_count",
  unknown: "unknown_year_count",
};

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
  const reqSeqRef = useRef(0);
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
    selectedMeshcode,
  });
  useEffect(() => {
    filtersRef.current = {
      selectedWard,
      ageCategories,
      hazardTiers,
      usageGroup,
      showBuildings,
      selectedMeshcode,
    };
  }, [selectedWard, ageCategories, hazardTiers, usageGroup, showBuildings, selectedMeshcode]);

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

  const fetchBuildingsForCurrentView = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;

    const currentZoom = map.getZoom();
    setZoom(currentZoom);

    let src: maplibregl.GeoJSONSource | undefined;
    try {
      src = map.getSource("buildings") as maplibregl.GeoJSONSource | undefined;
    } catch {
      return;
    }
    if (!src) return;

    const f = filtersRef.current;
    if (!f.showBuildings) {
      src.setData(EMPTY_FC);
      setBuildingStatus(null);
      setLoadingBuildings(false);
      return;
    }

    const b = map.getBounds();
    const seq = ++reqSeqRef.current;
    setLoadingBuildings(true);
    try {
      const fc = await getBuildingsInBbox(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        {
          ward: f.selectedWard,
          ageCategories: f.ageCategories,
          hazardTiers: f.hazardTiers,
          usageGroup: f.usageGroup,
          meshcode: f.selectedMeshcode,
        },
        3500
      );
      if (seq !== reqSeqRef.current) return;
      const latestSrc = map.getSource("buildings") as maplibregl.GeoJSONSource | undefined;
      latestSrc?.setData(fc);
      if (fc.meta) {
        setBuildingStatus({
          returned: fc.meta.returned,
          total: fc.meta.total_matching,
          truncated: fc.meta.truncated,
        });
      }
    } catch {
      // keep previous layer data on transient network error
    } finally {
      if (seq === reqSeqRef.current) {
        setLoadingBuildings(false);
      }
    }
  }, []);

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
        minZoom: 4.5,
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
      if (layersInitialized || !map.style) return;
      try {
        if (map.getSource("meshes")) {
          layersInitialized = true;
          setMapReady(true);
          fetchBuildingsForCurrentView();
          return;
        }
      } catch {
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
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.56, 14, 0.32, 16, 0.18],
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

      map.addSource("buildings", {
        type: "geojson",
        data: EMPTY_FC,
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
          "fill-opacity": 0.88,
        },
      });

      map.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        paint: {
          "line-color": [
            "step",
            ["zoom"],
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
            15,
            "#0f172a",
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.0, 14, 1.3, 15.5, 0.65],
          "line-opacity": 0.88,
        },
      });

      map.addLayer({
        id: "buildings-selected",
        type: "line",
        source: "buildings",
        filter: ["==", ["get", "building_id"], ""],
        paint: {
          "line-color": "#22d3ee",
          "line-width": 3,
        },
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
            6,
            4,
            11,
            6,
            18,
          ],
          "circle-color": "#f43f5e",
          "circle-opacity": 0.82,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.8,
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

        const bldgHits = map.queryRenderedFeatures(e.point, { layers: ["buildings-fill", "buildings-outline"] });
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
        const bHits = map.queryRenderedFeatures(e.point, { layers: ["buildings-fill", "buildings-outline"] });
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

      map.on("zoom", () => {
        setZoom(map.getZoom());
      });

      map.on("moveend", () => {
        setZoom(map.getZoom());
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          fetchBuildingsForCurrentView();
        }, 150);
      });

      map.resize();
      setMapReady(true);
      fetchBuildingsForCurrentView();
    };

    map.on("error", (e) => {
      const msg = e.error?.message;
      if (msg && !msg.includes("Failed to fetch")) {
        setMapError(`地図描画エラー: ${msg}`);
      }
    });

    map.on("style.load", initMapLayers);
    map.on("load", initMapLayers);
    map.on("styledata", initMapLayers);
    initMapLayers();

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
  }, [fetchBuildingsForCurrentView]);

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

  // Update layer visibility, mesh coloring mode, and mesh filter expressions
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    map.setLayoutProperty("meshes-fill", "visibility", showHazardMesh ? "visible" : "none");
    map.setLayoutProperty("meshes-line", "visibility", showHazardMesh ? "visible" : "none");
    map.setLayoutProperty("meshes-selected", "visibility", showHazardMesh ? "visible" : "none");
    map.setLayoutProperty("buildings-fill", "visibility", showBuildings ? "visible" : "none");
    map.setLayoutProperty("buildings-outline", "visibility", showBuildings ? "visible" : "none");
    map.setLayoutProperty("buildings-selected", "visibility", showBuildings ? "visible" : "none");
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
    } else if (meshOverlayMode === "pre1981") {
      map.setPaintProperty("meshes-fill", "fill-color", [
        "step",
        ["coalesce", ["get", "pre_1981_share_known"], 0],
        "#334155",
        0.01,
        "#fef3c7",
        0.25,
        "#fdba74",
        0.45,
        "#f97316",
        0.65,
        "#c2410c",
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

    // Build combined filter expression for 250m meshes so ALL filter buttons visually reflect on the mesh layer too
    const meshConditions: maplibregl.FilterSpecification[] = [];
    if (selectedWard && selectedWard !== "all") {
      meshConditions.push(["==", ["get", "ward_name"], selectedWard]);
    }
    if (hazardTiers.length > 0 && hazardTiers.length < 4) {
      meshConditions.push(["in", ["get", "hazard_tier"], ["literal", hazardTiers]]);
    }
    if (ageCategories.length > 0 && ageCategories.length < 4) {
      const sumTerms = ageCategories.map(
        (cat) => ["coalesce", ["get", AGE_MESH_PROP_MAP[cat]], 0] as unknown as maplibregl.ExpressionSpecification
      );
      const sumExpr =
        sumTerms.length === 1 ? sumTerms[0] : (["+", ...sumTerms] as unknown as maplibregl.ExpressionSpecification);
      meshConditions.push([">", sumExpr, 0]);
    }
    if (usageGroup === "residential") {
      meshConditions.push([">", ["coalesce", ["get", "residential_count"], 0], 0]);
    } else if (usageGroup === "non_residential") {
      meshConditions.push([
        ">",
        ["-", ["coalesce", ["get", "total_buildings"], 0], ["coalesce", ["get", "residential_count"], 0]],
        0,
      ]);
    }

    const combinedMeshFilter: maplibregl.FilterSpecification | null =
      meshConditions.length === 0
        ? null
        : meshConditions.length === 1
          ? meshConditions[0]
          : (["all", ...meshConditions] as unknown as maplibregl.FilterSpecification);

    map.setFilter("meshes-fill", combinedMeshFilter);
    map.setFilter("meshes-line", combinedMeshFilter);
  }, [
    showHazardMesh,
    showBuildings,
    showEarthquakes,
    meshOverlayMode,
    selectedWard,
    hazardTiers,
    ageCategories,
    usageGroup,
    mapReady,
  ]);

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
  }, [
    selectedWard,
    ageCategories,
    hazardTiers,
    usageGroup,
    showBuildings,
    selectedMeshcode,
    mapReady,
    fetchBuildingsForCurrentView,
  ]);

  // FlyTo trigger (ward change or priority area click)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !flyToTarget) return;
    map.flyTo({
      center: [flyToTarget.lon, flyToTarget.lat],
      zoom: flyToTarget.zoom,
      duration: 800,
    });
  }, [flyToTarget, mapReady]);

  return (
    <div className="relative h-full w-full min-h-[360px] bg-slate-950">
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
        {loadingBuildings && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-slate-900/90 px-3 py-1.5 text-xs text-sky-200 shadow-lg backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>建物データを更新中...</span>
          </div>
        )}

        {!loadingBuildings && buildingStatus && showBuildings && (
          <div className="pointer-events-auto inline-flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-[11px] text-slate-200 shadow-lg backdrop-blur">
            <span>
              表示中の建物:{" "}
              <strong className="font-mono text-white">
                {buildingStatus.returned.toLocaleString("ja-JP")}
              </strong>
              棟
              {buildingStatus.truncated &&
                `（範囲内 ${buildingStatus.total.toLocaleString("ja-JP")}棟から均等表示）`}
            </span>
            {zoom < 15.0 && (
              <button
                type="button"
                onClick={() => {
                  const map = mapRef.current;
                  if (!map) return;
                  map.flyTo({
                    center: map.getCenter(),
                    zoom: 15.5,
                    duration: 700,
                  });
                }}
                className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-sky-500"
              >
                <ZoomIn className="h-3 w-3" />
                ズームインして全棟表示
              </button>
            )}
            {zoom >= 13.0 && (
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
            )}
          </div>
        )}

        {showEarthquakes && (
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/40 bg-slate-900/90 px-3 py-1.5 text-[11px] text-rose-200 shadow-lg backdrop-blur">
            <Activity className="h-3.5 w-3.5 text-rose-400" />
            <span>気象庁 直近震源: {earthquakes.length}件</span>
            {zoom > 7.5 ? (
              <button
                type="button"
                onClick={() => {
                  mapRef.current?.flyTo({
                    center: [136.0, 35.5],
                    zoom: 5.8,
                    duration: 800,
                  });
                }}
                className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-rose-500"
              >
                広域で震源を見る
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  mapRef.current?.flyTo({
                    center: [135.7645, 34.9945],
                    zoom: 14.8,
                    duration: 800,
                  });
                }}
                className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-slate-600"
              >
                <RotateCcw className="h-3 w-3" />
                京都市に戻る
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom-left hover bar & Mesh legends */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-2 max-w-[85%]">
        {showHazardMesh && meshOverlayMode === "arv" && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[11px] text-slate-200 shadow-lg backdrop-blur">
            <div className="mb-1 font-semibold text-teal-300">表層地盤 最大速度増幅率（ARV）</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#ccfbf1]" /> &lt;1.2</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#5eead4]" /> 1.2–1.6</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#14b8a6]" /> 1.6–2.0</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#0f766e]" /> 2.0+（揺れ増幅大）</span>
            </div>
          </div>
        )}

        {showHazardMesh && meshOverlayMode === "pre1981" && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[11px] text-slate-200 shadow-lg backdrop-blur">
            <div className="mb-1 font-semibold text-orange-300">250mメッシュ内 1981年以前建築の割合（判明分）</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#fef3c7]" /> &lt;25%</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#fdba74]" /> 25–45%</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#f97316]" /> 45–65%</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#c2410c]" /> 65%+（高密集）</span>
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
