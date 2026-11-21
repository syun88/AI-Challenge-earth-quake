"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import {
  Loader2,
  ZoomIn,
  Box,
  Activity,
  RotateCcw,
  MapPin,
  Layers,
  AlertTriangle,
  MessageSquareHeart,
  X,
} from "lucide-react";
import {
  AGE_COLORS,
  HAZARD_COLORS,
  REPORT_CATEGORY_META,
  VERIFICATION_META,
} from "@/lib/colors";
import { API_BASE, getBuildingsCountInBbox } from "@/lib/api";
import {
  AgeCategory,
  BoardSummaryResponse,
  DamageReport,
  EarthquakeEvent,
  HazardTier,
  MeshOverlayMode,
  RouteSimulationResponse,
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

const AGE_MESH_PROP_MAP: Record<AgeCategory, string> = {
  pre_1981: "pre_1981_count",
  "1982_2000": "b1982_2000_count",
  post_2001: "post_2001_count",
  unknown: "unknown_year_count",
};

interface QuakeMapProps {
  meshesGeoJson: GeoJSON.FeatureCollection | null;
  earthquakes: EarthquakeEvent[];
  reports: DamageReport[];
  boardSummary: BoardSummaryResponse | null;
  routeResult: RouteSimulationResponse | null;
  selectedWard: string;
  ageCategories: AgeCategory[];
  hazardTiers: HazardTier[];
  usageGroup: UsageGroup;
  showBuildings: boolean;
  onToggleBuildings: () => void;
  showHazardMesh: boolean;
  onToggleHazardMesh: () => void;
  meshOverlayMode: MeshOverlayMode;
  showEarthquakes: boolean;
  onToggleEarthquakes: () => void;
  showReports: boolean;
  onToggleReports: () => void;
  showSafetyLayer: boolean;
  onToggleSafetyLayer: () => void;
  is3D: boolean;
  onToggle3D: () => void;
  selectedBuildingId: string | null;
  selectedMeshcode: string | null;
  flyToTarget: { lon: number; lat: number; zoom: number; ts: number } | null;
  isPickingLocation: boolean;
  pickedCoords: { lat: number; lon: number } | null;
  onPickLocation: (coords: { lat: number; lon: number }) => void;
  onCancelPickLocation: () => void;
  onSelectBuilding: (buildingId: string) => void;
  onSelectMesh: (meshcode: string) => void;
  onSelectReport: (report: DamageReport) => void;
  onSelectSafetyWard: (wardName: string) => void;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function QuakeMap({
  meshesGeoJson,
  earthquakes,
  reports,
  boardSummary,
  routeResult,
  selectedWard,
  ageCategories,
  hazardTiers,
  usageGroup,
  showBuildings,
  onToggleBuildings,
  showHazardMesh,
  onToggleHazardMesh,
  meshOverlayMode,
  showEarthquakes,
  onToggleEarthquakes,
  showReports,
  onToggleReports,
  showSafetyLayer,
  onToggleSafetyLayer,
  is3D,
  onToggle3D,
  selectedBuildingId,
  selectedMeshcode,
  flyToTarget,
  isPickingLocation,
  pickedCoords,
  onPickLocation,
  onCancelPickLocation,
  onSelectBuilding,
  onSelectMesh,
  onSelectReport,
  onSelectSafetyWard,
}: QuakeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const countReqSeqRef = useRef(0);
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

  const callbacksRef = useRef({
    onSelectBuilding,
    onSelectMesh,
    onPickLocation,
    onSelectReport,
    onSelectSafetyWard,
  });
  useEffect(() => {
    callbacksRef.current = {
      onSelectBuilding,
      onSelectMesh,
      onPickLocation,
      onSelectReport,
      onSelectSafetyWard,
    };
  }, [onSelectBuilding, onSelectMesh, onPickLocation, onSelectReport, onSelectSafetyWard]);

  const pickingRef = useRef(isPickingLocation);
  useEffect(() => {
    pickingRef.current = isPickingLocation;
    const map = mapRef.current;
    if (map) {
      map.getCanvas().style.cursor = isPickingLocation ? "crosshair" : "";
    }
  }, [isPickingLocation]);

  const reportMarkersRef = useRef<maplibregl.Marker[]>([]);
  const safetyMarkersRef = useRef<maplibregl.Marker[]>([]);
  const routeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const pickMarkerRef = useRef<maplibregl.Marker | null>(null);

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
    const f = filtersRef.current;
    const currentZoom = map.getZoom();
    setZoom(currentZoom);

    if (!f.showBuildings || currentZoom < 13.5) {
      setBuildingStatus(null);
      return;
    }

    const b = map.getBounds();
    const seq = ++countReqSeqRef.current;
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
      if (seq !== countReqSeqRef.current) return;
      setBuildingStatus({
        returned: res.total_matching,
        total: res.total_matching,
        truncated: false,
      });
    } catch {
      // ignore transient abort
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
      if ((map.style as unknown as { _loaded?: boolean })._loaded === false) return;
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

      // Route simulation sources & layers (training-only corridor model)
      map.addSource("route-baseline", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-baseline-line",
        type: "line",
        source: "route-baseline",
        paint: {
          "line-color": "#94a3b8",
          "line-width": 3.5,
          "line-dasharray": [2, 2],
          "line-opacity": 0.75,
        },
      });

      map.addSource("route-blocked", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-blocked-line",
        type: "line",
        source: "route-blocked",
        paint: {
          "line-color": "#f43f5e",
          "line-width": 5,
          "line-dasharray": [1.5, 1.5],
          "line-opacity": 0.9,
        },
      });

      map.addSource("route-alternative", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-alternative-line",
        type: "line",
        source: "route-alternative",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#10b981",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });

      // Interactions
      map.on("click", (e) => {
        if (pickingRef.current) {
          callbacksRef.current.onPickLocation({
            lat: Number(e.lngLat.lat.toFixed(5)),
            lon: Number(e.lngLat.lng.toFixed(5)),
          });
          return;
        }
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
          layers: ["buildings-fill", "buildings-outline", "buildings-3d"],
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
          layers: ["buildings-fill", "buildings-outline", "buildings-3d"],
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
    if (!map || !mapReady || !map.getLayer("meshes-fill")) return;

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
    is3D,
    meshOverlayMode,
    selectedWard,
    hazardTiers,
    ageCategories,
    usageGroup,
    mapReady,
  ]);

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
    if (!map || !mapReady || !map.getLayer("buildings-selected")) return;
    map.setFilter("buildings-selected", [
      "==",
      ["get", "building_id"],
      selectedBuildingId || "",
    ]);
    if (map.getLayer("buildings-3d")) {
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
    }
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
  }, [selectedWard, ageCategories, hazardTiers, usageGroup, showBuildings, mapReady, fetchBuildingsForCurrentView]);

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

  // Render Damage Report DOM Markers (unverified vs official vs sample clearly distinguished by border & symbol)
  useEffect(() => {
    const map = mapRef.current;
    reportMarkersRef.current.forEach((m) => m.remove());
    reportMarkersRef.current = [];
    if (!map || !mapReady || !showReports) return;

    const meshLookup = new Map<string, [number, number]>();
    if (meshesGeoJson?.features) {
      for (const f of meshesGeoJson.features) {
        const p = f.properties as { meshcode?: string; centroid_lon?: number; centroid_lat?: number } | null;
        if (p?.meshcode && p.centroid_lon != null && p.centroid_lat != null) {
          meshLookup.set(p.meshcode, [p.centroid_lon, p.centroid_lat]);
        }
      }
    }

    for (const rep of reports) {
      if (rep.resolved) continue;
      if (selectedWard !== "all" && rep.ward_name !== selectedWard && rep.ward_name !== "京都市全域") {
        continue;
      }
      let coords: [number, number] | null =
        rep.lon != null && rep.lat != null ? [rep.lon, rep.lat] : null;
      if (!coords && rep.meshcode) {
        coords = meshLookup.get(rep.meshcode) ?? null;
      }
      if (!coords) continue;

      const catMeta = REPORT_CATEGORY_META[rep.category];
      const verMeta = VERIFICATION_META[rep.verification_status];

      const el = document.createElement("button");
      el.type = "button";
      el.title = `[${verMeta.label}] ${rep.ward_name} - ${rep.title}`;
      const borderStyle =
        rep.verification_status === "unverified"
          ? "border-dashed border-amber-300"
          : rep.verification_status === "demo_sample"
            ? "border-dotted border-slate-300 opacity-85"
            : "border-solid border-cyan-300";

      el.className = `group flex items-center gap-1 rounded-full border-2 ${borderStyle} bg-slate-950/95 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg transition hover:scale-105 cursor-pointer`;
      el.innerHTML = `<span style="background:${catMeta.color}" class="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold text-slate-950">${catMeta.symbol}</span><span class="max-w-[90px] truncate">${verMeta.short}</span>`;

      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        callbacksRef.current.onSelectReport(rep);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(coords)
        .addTo(map);
      reportMarkersRef.current.push(marker);
    }

    return () => {
      reportMarkersRef.current.forEach((m) => m.remove());
      reportMarkersRef.current = [];
    };
  }, [reports, showReports, selectedWard, meshesGeoJson, mapReady]);

  // Render Regional Safety Aggregation Pills by Ward
  useEffect(() => {
    const map = mapRef.current;
    safetyMarkersRef.current.forEach((m) => m.remove());
    safetyMarkersRef.current = [];
    if (!map || !mapReady || !showSafetyLayer || !boardSummary?.by_ward) return;

    for (const w of boardSummary.by_ward) {
      if (w.ward_name === "京都市全域" || w.ward_name === "京都市外") continue;
      if (selectedWard !== "all" && w.ward_name !== selectedWard) continue;

      const el = document.createElement("button");
      el.type = "button";
      el.title = `${w.ward_name} 災害用伝言板: 計${w.total_count}件（支援要/待ち ${w.support_needed_count}件）`;
      const alertClass =
        w.support_needed_count > 0
          ? "border-amber-400 bg-amber-950/95 text-amber-100"
          : "border-sky-400 bg-slate-900/95 text-sky-100";
      el.className = `flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold shadow-lg transition hover:scale-105 cursor-pointer ${alertClass}`;
      el.innerHTML = `<span>安否:${w.ward_name}</span><span class="rounded bg-white/15 px-1 font-mono font-bold">${w.total_count}</span>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        callbacksRef.current.onSelectSafetyWard(w.ward_name);
      });

      const marker = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
        offset: [0, -28],
      })
        .setLngLat([w.lon, w.lat])
        .addTo(map);
      safetyMarkersRef.current.push(marker);
    }

    return () => {
      safetyMarkersRef.current.forEach((m) => m.remove());
      safetyMarkersRef.current = [];
    };
  }, [boardSummary, showSafetyLayer, selectedWard, mapReady]);

  // Render Picked Coordinates Pin
  useEffect(() => {
    const map = mapRef.current;
    if (pickMarkerRef.current) {
      pickMarkerRef.current.remove();
      pickMarkerRef.current = null;
    }
    if (!map || !mapReady || !pickedCoords) return;
    const el = document.createElement("div");
    el.className =
      "flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-rose-600 text-[10px] font-bold text-white shadow-xl animate-pulse";
    el.textContent = "📍";
    pickMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([pickedCoords.lon, pickedCoords.lat])
      .addTo(map);
    return () => {
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
    };
  }, [pickedCoords, mapReady]);

  // Render Route Simulation GeoJSON lines + origin/dest markers
  useEffect(() => {
    const map = mapRef.current;
    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];
    if (!map || !mapReady) return;

    const baseSrc = map.getSource("route-baseline") as maplibregl.GeoJSONSource | undefined;
    const blkSrc = map.getSource("route-blocked") as maplibregl.GeoJSONSource | undefined;
    const altSrc = map.getSource("route-alternative") as maplibregl.GeoJSONSource | undefined;
    if (!baseSrc || !blkSrc || !altSrc) return;

    if (!routeResult) {
      baseSrc.setData(EMPTY_FC);
      blkSrc.setData(EMPTY_FC);
      altSrc.setData(EMPTY_FC);
      return;
    }

    baseSrc.setData({
      type: "FeatureCollection",
      features:
        routeResult.baseline_route.coordinates.length >= 2
          ? [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: routeResult.baseline_route.coordinates },
                properties: {},
              },
            ]
          : [],
    });

    blkSrc.setData({
      type: "FeatureCollection",
      features: routeResult.blocked_segments.map((seg) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: seg.coordinates },
        properties: { label: seg.label },
      })),
    });

    altSrc.setData({
      type: "FeatureCollection",
      features:
        routeResult.alternative_route.coordinates.length >= 2
          ? [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: routeResult.alternative_route.coordinates },
                properties: {},
              },
            ]
          : [],
    });

    const makeHubEl = (tag: string, bg: string) => {
      const el = document.createElement("div");
      el.className = `rounded-full border border-white ${bg} px-2 py-0.5 text-[10px] font-bold text-white shadow-lg`;
      el.textContent = tag;
      return el;
    };
    const m1 = new maplibregl.Marker({ element: makeHubEl(`発: ${routeResult.origin.ward}`, "bg-sky-600") })
      .setLngLat([routeResult.origin.lon, routeResult.origin.lat])
      .addTo(map);
    const m2 = new maplibregl.Marker({ element: makeHubEl(`着: ${routeResult.destination.ward}`, "bg-emerald-600") })
      .setLngLat([routeResult.destination.lon, routeResult.destination.lat])
      .addTo(map);
    routeMarkersRef.current = [m1, m2];

    const coords = [
      ...routeResult.baseline_route.coordinates,
      ...routeResult.alternative_route.coordinates,
    ];
    if (coords.length >= 2) {
      const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
      for (const c of coords) bounds.extend(c);
      map.fitBounds(bounds, {
        padding: { top: 112, bottom: 78, left: 56, right: 56 },
        duration: 800,
        maxZoom: 15.2,
      });
    }
  }, [routeResult, mapReady]);

  return (
    <div className="relative h-full w-full min-h-[380px] bg-slate-950">
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

      {/* Top-left floating quick controls + operational status pills */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[82%] flex-col gap-1.5">
        {isPickingLocation && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border-2 border-rose-400 bg-rose-950/95 px-3 py-2 text-xs font-bold text-rose-100 shadow-2xl">
            <MapPin className="h-4 w-4 animate-bounce text-rose-300" />
            <span>地図上の被害・通行止め地点をクリックしてください</span>
            <button
              type="button"
              onClick={onCancelPickLocation}
              className="ml-1 inline-flex items-center gap-0.5 rounded bg-rose-800 px-2 py-0.5 text-[10px] text-white hover:bg-rose-700"
            >
              <X className="h-3 w-3" /> 中止
            </button>
          </div>
        )}

        {/* Quick Layer Bar directly on Map */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-slate-700/80 bg-slate-950/85 p-1 text-[10px] shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={onToggleBuildings}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition ${
              showBuildings ? "bg-sky-500/25 text-sky-200" : "text-slate-400 hover:text-white"
            }`}
          >
            <Layers className="h-3 w-3" /> 建物
          </button>
          <button
            type="button"
            onClick={onToggle3D}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition ${
              is3D ? "bg-amber-500/30 text-amber-200" : "text-slate-400 hover:text-white"
            }`}
          >
            <Box className="h-3 w-3" /> 3D
          </button>
          <button
            type="button"
            onClick={onToggleHazardMesh}
            className={`rounded-lg px-2 py-1 font-semibold transition ${
              showHazardMesh ? "bg-fuchsia-500/25 text-fuchsia-200" : "text-slate-400 hover:text-white"
            }`}
          >
            250mメッシュ
          </button>
          <button
            type="button"
            onClick={onToggleSafetyLayer}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition ${
              showSafetyLayer ? "bg-emerald-500/25 text-emerald-200" : "text-slate-400 hover:text-white"
            }`}
          >
            <MessageSquareHeart className="h-3 w-3" /> 安否集計
          </button>
          <button
            type="button"
            onClick={onToggleReports}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition ${
              showReports ? "bg-rose-500/25 text-rose-200" : "text-slate-400 hover:text-white"
            }`}
          >
            <AlertTriangle className="h-3 w-3" /> 被害報告
          </button>
          <button
            type="button"
            onClick={onToggleEarthquakes}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition ${
              showEarthquakes ? "bg-rose-600/30 text-rose-200" : "text-slate-400 hover:text-white"
            }`}
          >
            <Activity className="h-3 w-3" /> 地震履歴
          </button>
        </div>

        {zoom < 13.5 && showBuildings && (
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 shadow-lg backdrop-blur">
            <ZoomIn className="h-3.5 w-3.5 text-sky-400" />
            <span>
              現在ズーム z{zoom.toFixed(1)}（250mメッシュ・報告表示中）
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
              棟（全件表示）
            </span>
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

      {/* Bottom-left hover bar & legends */}
      <div className="pointer-events-none absolute bottom-8 left-3 z-10 flex max-w-[88%] flex-col gap-1.5">
        {showReports && (
          <div className="rounded-lg border border-slate-700/80 bg-slate-950/90 px-2.5 py-1.5 text-[10px] text-slate-200 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-4 rounded-full border-2 border-dashed border-amber-300" />
                未確認(市民)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-4 rounded-full border-2 border-solid border-cyan-300" />
                確認済/公式
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-4 rounded-full border-2 border-dotted border-slate-300" />
                訓練サンプル
              </span>
              {routeResult && (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <span className="h-0.5 w-4 bg-emerald-400" />
                  回避ルート(訓練)
                </span>
              )}
            </div>
          </div>
        )}
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
