"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as maplibregl from "maplibre-gl";
import { Box, Loader2, MapPin, X } from "lucide-react";
import {
  AGE_COLORS,
  HAZARD_COLORS,
  REPORT_CATEGORY_META,
  VERIFICATION_META,
} from "@/lib/colors";
import { API_BASE, getBuildingsCountInBbox, getRoadsInBbox, getSyncAuthToken } from "@/lib/api";
import {
  AgeCategory,
  AgentMapPin,
  BoardSummaryResponse,
  DamageReport,
  EarthquakeEvent,
  EnterpriseAsset,
  HazardTier,
  LocationSearchResult,
  Map3DMode,
  MeshOverlayMode,
  NetworkEdgeFeature,
  NetworkStatusResponse,
  OfficialShelter,
  RoadPaintTool,
  RouteSimulationResponse,
  ShelterHub,
  ShelterRecommendationItem,
  UsageGroup,
} from "@/types/quakelens";

export type MapPickMode =
  | "none"
  | "report"
  | "evacuate"
  | "rescue"
  | "road_block"
  | "shelter_origin"
  | "enterprise_asset";
export type VisualPreset = "crisis" | "risk";

export interface PickedMapTarget {
  lat: number;
  lon: number;
  buildingId?: string | null;
  meshcode?: string | null;
  wardName?: string | null;
  roadName?: string | null;
  yearBuilt?: number | null;
  usageLabel?: string | null;
  structureLabel?: string | null;
}

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
  networkStatus: NetworkStatusResponse | null;
  routeResult: RouteSimulationResponse | null;
  visualPreset: VisualPreset;
  selectedWard: string;
  ageCategories: AgeCategory[];
  hazardTiers: HazardTier[];
  usageGroup: UsageGroup;
  showBuildings: boolean;
  showHazardMesh: boolean;
  meshOverlayMode: MeshOverlayMode;
  showEarthquakes: boolean;
  showReports: boolean;
  showRoadClosures: boolean;
  showSafetyLayer: boolean;
  showShelterHubs: boolean;
  showOfficialShelters: boolean;
  officialShelters: OfficialShelter[];
  recommendedShelters: ShelterRecommendationItem[];
  enterpriseAssets?: EnterpriseAsset[];
  onSelectEnterpriseAsset?: (asset: EnterpriseAsset) => void;
  agentPins?: AgentMapPin[];
  onSelectAgentPin?: (pin: AgentMapPin) => void;
  map3DMode: Map3DMode;
  onChangeMap3DMode?: (mode: Map3DMode) => void;
  onPitch3DChange?: (active: boolean) => void;
  selectedBuildingId: string | null;
  selectedMeshcode: string | null;
  highlightedTarget?: {
    lat: number;
    lon: number;
    label: string;
    subLabel?: string;
    tone?: "cyan" | "amber" | "rose" | "emerald";
  } | null;
  flyToTarget: {
    lon: number;
    lat: number;
    zoom: number;
    bbox?: [number, number, number, number] | null;
    ts: number;
  } | null;
  searchPin?: LocationSearchResult | null;
  searchCandidates?: LocationSearchResult[];
  onSelectSearchPin?: (item: LocationSearchResult) => void;
  mapPickMode: MapPickMode;
  pickedCoords: { lat: number; lon: number } | null;
  previewRoadSegments?: [number, number][][] | null;
  roadPaintTool?: RoadPaintTool;
  corridorStart?: { lat: number; lon: number; label?: string } | null;
  avoidUnverifiedRoads?: boolean;
  includeSampleReports?: boolean;
  onCancelPickMode: () => void;
  onMapPicked: (target: PickedMapTarget) => void;
  onClickRoadFeature?: (hit: {
    edgeId: number | null;
    roadName: string;
    lat: number;
    lon: number;
    isBlocked: boolean;
  }) => void;
  onPaintRoadStroke?: (points: Array<{ lat: number; lon: number }>) => void;
  onSelectBuilding: (buildingId: string) => void;
  onSelectMesh: (meshcode: string) => void;
  onSelectReport: (report: DamageReport) => void;
  onSelectBlockedRoad: (edge: NetworkEdgeFeature) => void;
  onSelectShelterHub: (hub: ShelterHub) => void;
  onSelectOfficialShelter: (shelter: OfficialShelter) => void;
  onSelectSafetyWard: (wardName: string) => void;
  onZoomChange?: (zoom: number, totalInView: number | null) => void;
  drawerOpen?: boolean;
  summaryPillVisible?: boolean;
  summaryPillHeight?: number;
  seismicBeltsGeoJson?: GeoJSON.FeatureCollection | null;
  activeSeismicBeltId?: string | null;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const AUTO_3D_START_ZOOM = 14.2;
const AUTO_3D_FULL_ZOOM = 16.4;
const AUTO_3D_MAX_PITCH = 52;
const PITCH_3D_THRESHOLD = 3.5;

function computeAutoPitch(zoom: number): number {
  if (zoom <= AUTO_3D_START_ZOOM) return 0;
  if (zoom >= AUTO_3D_FULL_ZOOM) return AUTO_3D_MAX_PITCH;
  const t = (zoom - AUTO_3D_START_ZOOM) / (AUTO_3D_FULL_ZOOM - AUTO_3D_START_ZOOM);
  const smooth = t * t * (3 - 2 * t);
  return Number((smooth * AUTO_3D_MAX_PITCH).toFixed(2));
}

export function QuakeMap({
  meshesGeoJson,
  earthquakes,
  reports,
  boardSummary,
  networkStatus,
  routeResult,
  visualPreset,
  selectedWard,
  ageCategories,
  hazardTiers,
  usageGroup,
  showBuildings,
  showHazardMesh,
  meshOverlayMode,
  showEarthquakes,
  showReports,
  showRoadClosures,
  showSafetyLayer,
  showShelterHubs,
  showOfficialShelters,
  officialShelters,
  recommendedShelters,
  enterpriseAssets = [],
  onSelectEnterpriseAsset,
  agentPins = [],
  onSelectAgentPin,
  map3DMode,
  onChangeMap3DMode,
  onPitch3DChange,
  selectedBuildingId,
  selectedMeshcode,
  highlightedTarget = null,
  flyToTarget,
  searchPin = null,
  searchCandidates = [],
  onSelectSearchPin,
  mapPickMode,
  pickedCoords,
  previewRoadSegments,
  roadPaintTool = "none",
  corridorStart = null,
  avoidUnverifiedRoads = true,
  includeSampleReports = true,
  onCancelPickMode,
  onMapPicked,
  onClickRoadFeature,
  onPaintRoadStroke,
  onSelectBuilding,
  onSelectMesh,
  onSelectReport,
  onSelectBlockedRoad,
  onSelectShelterHub,
  onSelectOfficialShelter,
  onSelectSafetyWard,
  onZoomChange,
  drawerOpen = false,
  summaryPillVisible = false,
  summaryPillHeight = 0,
  seismicBeltsGeoJson = null,
  activeSeismicBeltId = null,
}: QuakeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const countReqSeqRef = useRef(0);
  const roadsReqSeqRef = useRef(0);
  const hoverEdgeIdRef = useRef<number>(-1);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushDrawingRef = useRef(false);
  const brushPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(12.6);
  const [pitch, setPitch] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);

  const map3DModeRef = useRef<Map3DMode>(map3DMode);
  const prevMap3DModeRef = useRef<Map3DMode>(map3DMode);
  const lastZoomRef = useRef(12.6);
  const manualFlatAtHighZoomRef = useRef(false);
  const applyingAutoPitchRef = useRef(false);
  const flyToActiveRef = useRef(false);
  const autoEaseActiveRef = useRef(false);
  const lastNotified3DRef = useRef<boolean | null>(null);
  const middleDragRef = useRef<{
    x: number;
    y: number;
    pitch: number;
    bearing: number;
  } | null>(null);

  useEffect(() => {
    map3DModeRef.current = map3DMode;
  }, [map3DMode]);

  const damagedBuildingIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of reports) {
      if (!r.resolved && r.category === "building_damage" && r.building_id) {
        ids.push(r.building_id);
      }
    }
    return ids;
  }, [reports]);

  const damagedFilterExpr = useMemo<maplibregl.FilterSpecification>(() => {
    if (damagedBuildingIds.length === 0) {
      return ["==", ["get", "building_id"], "__none__"];
    }
    return ["in", ["get", "building_id"], ["literal", damagedBuildingIds]];
  }, [damagedBuildingIds]);

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
    onMapPicked,
    onClickRoadFeature,
    onPaintRoadStroke,
    onSelectReport,
    onSelectBlockedRoad,
    onSelectShelterHub,
    onSelectOfficialShelter,
    onSelectSafetyWard,
    onSelectSearchPin,
    onPitch3DChange,
    onZoomChange,
  });
  useEffect(() => {
    callbacksRef.current = {
      onSelectBuilding,
      onSelectMesh,
      onMapPicked,
      onClickRoadFeature,
      onPaintRoadStroke,
      onSelectReport,
      onSelectBlockedRoad,
      onSelectShelterHub,
      onSelectOfficialShelter,
      onSelectSafetyWard,
      onSelectSearchPin,
      onPitch3DChange,
      onZoomChange,
    };
  }, [
    onSelectBuilding,
    onSelectMesh,
    onMapPicked,
    onClickRoadFeature,
    onPaintRoadStroke,
    onSelectReport,
    onSelectBlockedRoad,
    onSelectShelterHub,
    onSelectOfficialShelter,
    onSelectSafetyWard,
    onSelectSearchPin,
    onPitch3DChange,
    onZoomChange,
  ]);

  const officialSheltersRef = useRef<OfficialShelter[]>(officialShelters);
  useEffect(() => {
    officialSheltersRef.current = officialShelters;
  }, [officialShelters]);

  const roadPaintToolRef = useRef<RoadPaintTool>(roadPaintTool);
  useEffect(() => {
    const wasNone = roadPaintToolRef.current === "none";
    roadPaintToolRef.current = roadPaintTool;
    const map = mapRef.current;
    if (map && wasNone && roadPaintTool !== "none" && map.getZoom() < 13.5) {
      map.easeTo({ zoom: 14.4, duration: 480 });
    }
  }, [roadPaintTool]);

  const pickModeRef = useRef<MapPickMode>(mapPickMode);
  useEffect(() => {
    pickModeRef.current = mapPickMode;
    const map = mapRef.current;
    if (map) {
      map.getCanvas().style.cursor =
        mapPickMode !== "none" || roadPaintToolRef.current !== "none" ? "crosshair" : "";
    }
  }, [mapPickMode]);

  const paintQueryOptsRef = useRef({
    avoidUnverified: avoidUnverifiedRoads,
    includeSamples: includeSampleReports,
  });
  useEffect(() => {
    paintQueryOptsRef.current = {
      avoidUnverified: avoidUnverifiedRoads,
      includeSamples: includeSampleReports,
    };
  }, [avoidUnverifiedRoads, includeSampleReports]);

  const meshesRef = useRef<GeoJSON.FeatureCollection | null>(meshesGeoJson);
  useEffect(() => {
    meshesRef.current = meshesGeoJson;
  }, [meshesGeoJson]);

  const earthquakesRef = useRef<EarthquakeEvent[]>(earthquakes);
  useEffect(() => {
    earthquakesRef.current = earthquakes;
  }, [earthquakes]);

  const reportMarkersRef = useRef<maplibregl.Marker[]>([]);
  const blockedMarkersRef = useRef<maplibregl.Marker[]>([]);
  const hubMarkersRef = useRef<maplibregl.Marker[]>([]);
  const safetyMarkersRef = useRef<maplibregl.Marker[]>([]);
  const recMarkersRef = useRef<maplibregl.Marker[]>([]);
  const routeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const searchPinMarkerRef = useRef<maplibregl.Marker | null>(null);
  const searchCandMarkersRef = useRef<maplibregl.Marker[]>([]);
  const pickMarkerRef = useRef<maplibregl.Marker | null>(null);
  const highlightMarkerRef = useRef<maplibregl.Marker | null>(null);
  const corridorStartMarkerRef = useRef<maplibregl.Marker | null>(null);
  const enterpriseAssetMarkersRef = useRef<maplibregl.Marker[]>([]);
  const agentPinMarkersRef = useRef<maplibregl.Marker[]>([]);

  const syncBuilding3DLayers = useCallback((map: maplibregl.Map) => {
    if (!map.getLayer("buildings-fill") || !map.getLayer("buildings-3d")) return;
    const pitchNow = map.getPitch();
    const showB = filtersRef.current.showBuildings;
    const active3D = showB && (map3DModeRef.current === "3d" || pitchNow >= PITCH_3D_THRESHOLD);
    const fVis = showB && !active3D ? "visible" : "none";
    const dVis = active3D ? "visible" : "none";
    map.setLayoutProperty("buildings-fill", "visibility", fVis);
    map.setLayoutProperty("buildings-outline", "visibility", fVis);
    map.setLayoutProperty("buildings-selected", "visibility", fVis);
    if (map.getLayer("buildings-selected-fill")) {
      map.setLayoutProperty("buildings-selected-fill", "visibility", fVis);
    }
    if (map.getLayer("buildings-selected-halo")) {
      map.setLayoutProperty("buildings-selected-halo", "visibility", fVis);
    }
    map.setLayoutProperty("buildings-3d", "visibility", dVis);
    if (lastNotified3DRef.current !== active3D) {
      lastNotified3DRef.current = active3D;
      callbacksRef.current.onPitch3DChange?.(active3D);
    }
  }, []);

  const fetchBuildingsForCurrentView = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const f = filtersRef.current;
    const currentZoom = map.getZoom();
    setZoom(currentZoom);

    if (!f.showBuildings || currentZoom < 13.5) {
      callbacksRef.current.onZoomChange?.(currentZoom, null);
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
      callbacksRef.current.onZoomChange?.(currentZoom, res.total_matching);
    } catch {
      // ignore transient abort
    }
  }, []);

  const fetchInteractiveRoadsForCurrentView = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !map.getSource("interactive-roads")) return;
    if (roadPaintToolRef.current === "none" || map.getZoom() < 12.2) {
      const src = map.getSource("interactive-roads") as maplibregl.GeoJSONSource | undefined;
      src?.setData(EMPTY_FC);
      return;
    }
    const b = map.getBounds();
    const seq = ++roadsReqSeqRef.current;
    try {
      const fc = await getRoadsInBbox({
        bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        includeSamples: paintQueryOptsRef.current.includeSamples,
        avoidUnverified: paintQueryOptsRef.current.avoidUnverified,
      });
      if (seq !== roadsReqSeqRef.current) return;
      const src = map.getSource("interactive-roads") as maplibregl.GeoJSONSource | undefined;
      src?.setData(fc as unknown as GeoJSON.FeatureCollection);
    } catch {
      // ignore transient abort
    }
  }, []);

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
                '地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a> | 建物: PLATEAU | ハザード: J-SHIS | 道路: © OSM contributors',
            },
          },
          layers: [
            {
              id: "gsi-pale-base",
              type: "raster",
              source: "gsi_pale",
              paint: {
                "raster-brightness-max": 0.94,
                "raster-saturation": -0.2,
              },
            },
          ],
        },
        center: [135.762, 34.974],
        zoom: 12.6,
        minZoom: 4.5,
        maxZoom: 19,
        maxPitch: 65,
        transformRequest: (url) => {
          if (url.includes("/api/")) {
            const token = getSyncAuthToken();
            if (token) {
              return {
                url,
                headers: { Authorization: `Bearer ${token}` },
              };
            }
          }
          return { url };
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? `地図の初期化に失敗しました（WebGL2をご確認下さい）: ${err.message}`
          : "地図の初期化に失敗しました。";
      queueMicrotask(() => setMapError(msg));
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");

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
          "fill-opacity": 0.16,
        },
      });

      map.addLayer({
        id: "meshes-line",
        type: "line",
        source: "meshes",
        paint: {
          "line-color": "#475569",
          "line-width": 0.65,
          "line-opacity": 0.45,
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

      // Buildings vector tiles
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
          "fill-opacity": 0.72,
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
          "line-width": 0.55,
          "line-opacity": 0.65,
        },
      });

      // Directly highlight damaged / collapsed buildings reported by building_id
      map.addLayer({
        id: "buildings-damaged-fill",
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 12.0,
        filter: ["==", ["get", "building_id"], "__none__"],
        paint: {
          "fill-color": "#ef4444",
          "fill-opacity": 0.96,
        },
      });

      map.addLayer({
        id: "buildings-damaged-outline",
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 12.0,
        filter: ["==", ["get", "building_id"], "__none__"],
        paint: {
          "line-color": "#ffffff",
          "line-width": 3.5,
        },
      });

      map.addLayer({
        id: "buildings-selected-fill",
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 12.0,
        filter: ["==", ["get", "building_id"], ""],
        paint: {
          "fill-color": "#facc15",
          "fill-opacity": 0.65,
        },
      });

      map.addLayer({
        id: "buildings-selected-halo",
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 12.0,
        filter: ["==", ["get", "building_id"], ""],
        paint: {
          "line-color": "#fef08a",
          "line-width": 10,
          "line-opacity": 0.72,
        },
      });

      map.addLayer({
        id: "buildings-selected",
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 12.0,
        filter: ["==", ["get", "building_id"], ""],
        paint: {
          "line-color": "#06b6d4",
          "line-width": 4.0,
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
            "interpolate",
            ["linear"],
            ["zoom"],
            13.5,
            [
              "*",
              0.35,
              [
                "coalesce",
                ["get", "measured_height"],
                ["*", ["coalesce", ["get", "storeys_above"], 2], 3.2],
                6.0,
              ],
            ],
            14.2,
            [
              "coalesce",
              ["get", "measured_height"],
              ["*", ["coalesce", ["get", "storeys_above"], 2], 3.2],
              6.0,
            ],
          ],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.78,
          "fill-extrusion-vertical-gradient": true,
        },
      });

      map.setLight({
        anchor: "viewport",
        color: "#ffffff",
        intensity: 0.45,
        position: [1.5, 210, 30],
      });

      // Red visual zone halos for active damage / rescue reports
      map.addSource("damage-zones", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "damage-zones-halo",
        type: "circle",
        source: "damage-zones",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            10,
            15,
            24,
            17,
            34,
          ],
          "circle-color": ["coalesce", ["get", "color"], "#ef4444"],
          "circle-opacity": 0.24,
          "circle-stroke-color": ["coalesce", ["get", "stroke"], "#fbbf24"],
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.9,
        },
      });

      // Interactive selectable street highlight layers (glowing cyan when road-paint mode active)
      map.addSource("interactive-roads", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "interactive-roads-hit",
        type: "line",
        source: "interactive-roads",
        layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
        paint: {
          "line-color": "#22d3ee",
          "line-width": 18,
          "line-opacity": 0.01,
        },
      });
      map.addLayer({
        id: "interactive-roads-base",
        type: "line",
        source: "interactive-roads",
        layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "status"], "blocked"],
            "#fb7185",
            "#22d3ee",
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 16, 4.5],
          "line-opacity": 0.65,
        },
      });

      // Real Kyoto street-segment road closure highlight layers
      map.addSource("network-blocked", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "network-blocked-glow",
        type: "line",
        source: "network-blocked",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#dc2626",
          "line-width": 8.5,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "network-blocked-dash",
        type: "line",
        source: "network-blocked",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 2.4,
          "line-dasharray": [1.5, 1.5],
          "line-opacity": 0.95,
        },
      });

      // Vivid gold hover glow when cursor moves over selectable streets
      map.addLayer({
        id: "interactive-roads-hover-glow",
        type: "line",
        source: "interactive-roads",
        filter: ["==", ["get", "edge_id"], -1],
        layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
        paint: {
          "line-color": "#facc15",
          "line-width": 13,
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "interactive-roads-hover-core",
        type: "line",
        source: "interactive-roads",
        filter: ["==", ["get", "edge_id"], -1],
        layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
        paint: {
          "line-color": "#fef08a",
          "line-width": 5,
          "line-opacity": 1,
        },
      });

      // Road preview highlight when selecting a road segment to mark damaged/blocked
      map.addSource("preview-road", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "preview-road-glow",
        type: "line",
        source: "preview-road",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#f59e0b",
          "line-width": 10,
          "line-opacity": 0.75,
        },
      });
      map.addLayer({
        id: "preview-road-line",
        type: "line",
        source: "preview-road",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#fef08a",
          "line-width": 4,
          "line-dasharray": [2, 1],
          "line-opacity": 1,
        },
      });

      // Earthquakes
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

      // Active navigation route layers (topmost lines)
      map.addSource("route-baseline", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-baseline-line",
        type: "line",
        source: "route-baseline",
        paint: {
          "line-color": "#94a3b8",
          "line-width": 3.5,
          "line-dasharray": [2, 2],
          "line-opacity": 0.78,
        },
      });

      map.addSource("route-alternative", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-alternative-glow",
        type: "line",
        source: "route-alternative",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#064e3b",
          "line-width": 9,
          "line-opacity": 0.6,
        },
      });
      map.addLayer({
        id: "route-alternative-line",
        type: "line",
        source: "route-alternative",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#10b981",
          "line-width": 5,
          "line-opacity": 1.0,
        },
      });

      // Kyoto Official Designated Emergency Evacuation Sites (514 GSI shelters)
      map.addSource("official-shelters", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "official-shelters-wide-ring",
        type: "circle",
        source: "official-shelters",
        filter: ["==", ["get", "is_wide_area"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4.5, 13, 7, 16, 10],
          "circle-color": "transparent",
          "circle-stroke-color": "#fb923c",
          "circle-stroke-width": 1.8,
          "circle-stroke-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "official-shelters-circle",
        type: "circle",
        source: "official-shelters",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 13, 4.5, 16, 6.5],
          "circle-color": [
            "case",
            ["==", ["get", "is_wide_area"], true],
            "#f97316",
            "#14b8a6",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2,
          "circle-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "official-shelters-recommended",
        type: "circle",
        source: "official-shelters",
        filter: [">", ["get", "rank"], 0],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 9, 13, 12, 16, 14],
          "circle-color": "#10b981",
          "circle-stroke-color": "#fef08a",
          "circle-stroke-width": 2.5,
          "circle-opacity": 0.95,
        },
      });

      // Google-Maps-style Searched Street & Point Spotlight Layers
      map.addSource("search-street", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "search-street-glow",
        type: "line",
        source: "search-street",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#0284c7",
          "line-width": 11,
          "line-opacity": 0.45,
        },
      });
      map.addLayer({
        id: "search-street-line",
        type: "line",
        source: "search-street",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#38bdf8",
          "line-width": 4.5,
          "line-opacity": 0.95,
        },
      });

      map.addSource("search-halo", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "search-halo-circle",
        type: "circle",
        source: "search-halo",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 16, 15, 26, 18, 34],
          "circle-color": "#ef4444",
          "circle-opacity": 0.14,
          "circle-stroke-color": "#ef4444",
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.78,
        },
      });

      // Kyoto Active Fault / Seismic Belt Overlay Layers
      map.addSource("seismic-belts", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "seismic-belts-glow",
        type: "line",
        source: "seismic-belts",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#f43f5e"],
          "line-width": ["case", ["==", ["get", "active"], true], 12, 6],
          "line-opacity": ["case", ["==", ["get", "active"], true], 0.4, 0.18],
        },
      });
      map.addLayer({
        id: "seismic-belts-line",
        type: "line",
        source: "seismic-belts",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#f43f5e"],
          "line-width": ["case", ["==", ["get", "active"], true], 4.5, 2.5],
          "line-dasharray": [2, 1.5],
          "line-opacity": ["case", ["==", ["get", "active"], true], 0.98, 0.72],
        },
      });

      // Unified Click Handler
      map.on("click", (e) => {
        if (roadPaintToolRef.current === "click" || roadPaintToolRef.current === "corridor") {
          const rHits = map.queryRenderedFeatures(e.point, {
            layers: ["interactive-roads-hit", "interactive-roads-base"],
          });
          const rp = rHits[0]?.properties || null;
          callbacksRef.current.onClickRoadFeature?.({
            edgeId: rp?.edge_id != null ? Number(rp.edge_id) : null,
            roadName: rp?.name ? String(rp.name) : "周辺道路",
            lat: Number(e.lngLat.lat.toFixed(5)),
            lon: Number(e.lngLat.lng.toFixed(5)),
            isBlocked: rp?.status === "blocked",
          });
          return;
        }

        if (pickModeRef.current !== "none") {
          const bHits = map.queryRenderedFeatures(e.point, {
            layers: ["buildings-fill", "buildings-outline", "buildings-3d"],
          });
          const bp = bHits[0]?.properties || null;
          callbacksRef.current.onMapPicked({
            lat: Number(e.lngLat.lat.toFixed(5)),
            lon: Number(e.lngLat.lng.toFixed(5)),
            buildingId: bp?.building_id ? String(bp.building_id) : null,
            meshcode: bp?.meshcode ? String(bp.meshcode) : null,
            wardName: bp?.ward_name ? String(bp.ward_name) : null,
            yearBuilt: bp?.year_built ? Number(bp.year_built) : null,
            usageLabel: bp?.usage_label ? String(bp.usage_label) : null,
            structureLabel: bp?.structure_label ? String(bp.structure_label) : null,
          });
          return;
        }

        const shelterHits = map.queryRenderedFeatures(e.point, {
          layers: ["official-shelters-recommended", "official-shelters-circle"],
        });
        if (shelterHits.length > 0) {
          const sid = shelterHits[0].properties?.id;
          if (sid) {
            const matched = officialSheltersRef.current.find((s) => s.id === String(sid));
            if (matched) {
              callbacksRef.current.onSelectOfficialShelter(matched);
              return;
            }
          }
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
          layers: ["buildings-fill", "buildings-outline", "buildings-3d", "buildings-damaged-fill"],
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
          }
        }
      });

      map.on("mousemove", (e) => {
        if (roadPaintToolRef.current === "click" || roadPaintToolRef.current === "corridor") {
          const rHits = map.queryRenderedFeatures(e.point, {
            layers: ["interactive-roads-hit", "interactive-roads-base"],
          });
          const rp = rHits[0]?.properties || null;
          const eid = rp?.edge_id != null ? Number(rp.edge_id) : -1;
          if (hoverEdgeIdRef.current !== eid) {
            hoverEdgeIdRef.current = eid;
            if (map.getLayer("interactive-roads-hover-glow")) {
              map.setFilter("interactive-roads-hover-glow", ["==", ["get", "edge_id"], eid]);
            }
            if (map.getLayer("interactive-roads-hover-core")) {
              map.setFilter("interactive-roads-hover-core", ["==", ["get", "edge_id"], eid]);
            }
          }
          map.getCanvas().style.cursor = eid >= 0 ? "pointer" : "crosshair";
          if (rp && eid >= 0) {
            const actionHint =
              roadPaintToolRef.current === "corridor"
                ? "クリックして始点/終点に指定"
                : rp.status === "blocked"
                  ? "通行止め中（クリックで状況確認/解除）"
                  : "クリックで即・通行止めに設定";
            setHoverInfo(`✨ ${rp.name || "京都市街路"} (${rp.length_m ?? "—"}m) — ${actionHint}`);
          } else {
            setHoverInfo("水色に光る道路の上にカーソルを合わせてクリックしてください");
          }
          return;
        }
        if (pickModeRef.current !== "none") {
          map.getCanvas().style.cursor = "crosshair";
          return;
        }
        const shelterHoverHits = map.queryRenderedFeatures(e.point, {
          layers: ["official-shelters-recommended", "official-shelters-circle"],
        });
        if (shelterHoverHits.length > 0) {
          map.getCanvas().style.cursor = "pointer";
          const sp = shelterHoverHits[0].properties || {};
          const rankPrefix = Number(sp.rank || 0) > 0 ? `★推奨${sp.rank}位 ` : "";
          setHoverInfo(
            `${rankPrefix}指定緊急避難場所: ${sp.name || ""} (${sp.ward || ""}) | ${sp.disasters_summary || ""}`
          );
          return;
        }
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
            `メッシュ ${p.meshcode} (${p.ward_name}) | ${p.total_buildings}棟 (1981以前 ${p.pre_1981_count}棟) | 震度6弱+確率 ${prob}`
          );
          return;
        }
        map.getCanvas().style.cursor = "";
        setHoverInfo(null);
      });

      map.on("pitch", (e) => {
        const currentPitch = map.getPitch();
        const rounded = Math.round(currentPitch);
        setPitch((prev) => (prev === rounded ? prev : rounded));
        syncBuilding3DLayers(map);

        const isAutoEvt = Boolean((e as { fromAuto3D?: boolean }).fromAuto3D);
        if (!isAutoEvt && !flyToActiveRef.current && !autoEaseActiveRef.current) {
          if (map.getZoom() > AUTO_3D_START_ZOOM + 0.3 && currentPitch < PITCH_3D_THRESHOLD) {
            manualFlatAtHighZoomRef.current = true;
          } else if (currentPitch >= 8) {
            manualFlatAtHighZoomRef.current = false;
          }
        }
      });

      map.on("zoom", () => {
        const z = map.getZoom();
        const prevZ = lastZoomRef.current;
        lastZoomRef.current = z;
        setZoom(z);

        if (z <= AUTO_3D_START_ZOOM) {
          manualFlatAtHighZoomRef.current = false;
        }

        const isUserScrollOrPinch =
          map.scrollZoom.isZooming() || map.touchZoomRotate.isActive();
        if (
          map3DModeRef.current === "auto" &&
          isUserScrollOrPinch &&
          roadPaintToolRef.current === "none" &&
          pickModeRef.current === "none" &&
          !flyToActiveRef.current &&
          !autoEaseActiveRef.current &&
          !middleDragRef.current &&
          !map.dragRotate.isActive() &&
          !applyingAutoPitchRef.current
        ) {
          const targetP = computeAutoPitch(z);
          const curP = map.getPitch();
          const shouldRaise =
            z > prevZ && !manualFlatAtHighZoomRef.current && curP < targetP - 0.15;
          const shouldLower = z < prevZ && curP > targetP + 0.15;
          if (shouldRaise || shouldLower) {
            applyingAutoPitchRef.current = true;
            try {
              map.setPitch(targetP, { fromAuto3D: true });
            } finally {
              applyingAutoPitchRef.current = false;
            }
          }
        }
      });

      map.on("zoomend", (e) => {
        const isAutoEvt = Boolean((e as { fromAuto3D?: boolean }).fromAuto3D);
        if (
          map3DModeRef.current === "auto" &&
          !isAutoEvt &&
          !map.scrollZoom.isZooming() &&
          !map.touchZoomRotate.isActive() &&
          !flyToActiveRef.current &&
          !autoEaseActiveRef.current &&
          roadPaintToolRef.current === "none" &&
          pickModeRef.current === "none" &&
          !middleDragRef.current &&
          !map.dragRotate.isActive()
        ) {
          const z = map.getZoom();
          const targetP = computeAutoPitch(z);
          const curP = map.getPitch();
          if (!manualFlatAtHighZoomRef.current && targetP > curP + 2) {
            autoEaseActiveRef.current = true;
            map.easeTo({ pitch: targetP, duration: 380 }, { fromAuto3D: true });
          } else if (z <= AUTO_3D_START_ZOOM + 0.1 && curP > 3) {
            autoEaseActiveRef.current = true;
            map.easeTo({ pitch: 0, duration: 380 }, { fromAuto3D: true });
          }
        }
      });

      map.on("moveend", (e) => {
        if ((e as { fromAuto3D?: boolean }).fromAuto3D) {
          autoEaseActiveRef.current = false;
          return;
        }
        flyToActiveRef.current = false;
        autoEaseActiveRef.current = false;
        setZoom(map.getZoom());
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          fetchBuildingsForCurrentView();
          if (roadPaintToolRef.current !== "none") {
            fetchInteractiveRoadsForCurrentView();
          }
        }, 150);
      });

      map.resize();
      setMapReady(true);
      syncBuilding3DLayers(map);
      fetchBuildingsForCurrentView();
      if (roadPaintToolRef.current !== "none") {
        fetchInteractiveRoadsForCurrentView();
      }
    };

    // Allow middle-mouse button (scroll-wheel press + drag) for effortless 3D tilt & orbit
    const canvasEl = map.getCanvas();
    const handleCanvasMouseDown = (ev: MouseEvent) => {
      if (ev.button !== 1 || roadPaintToolRef.current === "brush") return;
      ev.preventDefault();
      middleDragRef.current = {
        x: ev.clientX,
        y: ev.clientY,
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      };
      canvasEl.style.cursor = "grabbing";
    };
    const handleWindowMouseMove = (ev: MouseEvent) => {
      const drag = middleDragRef.current;
      if (!drag) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      const nextPitch = Math.max(0, Math.min(65, drag.pitch - dy * 0.32));
      const nextBearing = drag.bearing + dx * 0.35;
      map.jumpTo({ pitch: nextPitch, bearing: nextBearing });
    };
    const handleWindowMouseUp = (ev: MouseEvent) => {
      if (!middleDragRef.current || ev.button !== 1) return;
      middleDragRef.current = null;
      canvasEl.style.cursor =
        pickModeRef.current !== "none" || roadPaintToolRef.current !== "none"
          ? "crosshair"
          : "";
    };
    canvasEl.addEventListener("mousedown", handleCanvasMouseDown);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

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
      canvasEl.removeEventListener("mousedown", handleCanvasMouseDown);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      ro.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [fetchBuildingsForCurrentView, fetchInteractiveRoadsForCurrentView, syncBuilding3DLayers]);

  // Update 250m meshes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !meshesGeoJson) return;
    const src = map.getSource("meshes") as maplibregl.GeoJSONSource | undefined;
    src?.setData(meshesGeoJson);
  }, [meshesGeoJson, mapReady]);

  // Update earthquakes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("earthquakes") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: earthquakes.map((q) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [q.lon, q.lat] },
        properties: { ...q },
      })),
    });
  }, [earthquakes, mapReady]);

  // Update Damaged Buildings Filter & Damage Halo GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer("buildings-damaged-fill")) return;
    const vis = showReports ? "visible" : "none";
    map.setLayoutProperty("buildings-damaged-fill", "visibility", vis);
    map.setLayoutProperty("buildings-damaged-outline", "visibility", vis);
    map.setFilter("buildings-damaged-fill", damagedFilterExpr);
    map.setFilter("buildings-damaged-outline", damagedFilterExpr);

    const meshLookup = new Map<string, [number, number]>();
    if (meshesGeoJson?.features) {
      for (const f of meshesGeoJson.features) {
        const p = f.properties as { meshcode?: string; centroid_lon?: number; centroid_lat?: number } | null;
        if (p?.meshcode && p.centroid_lon != null && p.centroid_lat != null) {
          meshLookup.set(p.meshcode, [p.centroid_lon, p.centroid_lat]);
        }
      }
    }

    const haloFeatures: GeoJSON.Feature[] = [];
    if (showReports) {
      for (const rep of reports) {
        if (rep.resolved) continue;
        if (selectedWard !== "all" && rep.ward_name !== selectedWard && rep.ward_name !== "京都市全域") {
          continue;
        }
        let coords: [number, number] | null =
          rep.lon != null && rep.lat != null ? [rep.lon, rep.lat] : null;
        if (!coords && rep.meshcode) coords = meshLookup.get(rep.meshcode) ?? null;
        if (!coords) continue;

        haloFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: coords },
          properties: {
            color: REPORT_CATEGORY_META[rep.category].color,
            stroke: VERIFICATION_META[rep.verification_status].mapStroke,
          },
        });
      }
    }
    const zoneSrc = map.getSource("damage-zones") as maplibregl.GeoJSONSource | undefined;
    zoneSrc?.setData({ type: "FeatureCollection", features: haloFeatures });
  }, [reports, showReports, damagedFilterExpr, selectedWard, meshesGeoJson, mapReady]);

  // Update Always-Visible Live Real-Street Road Closure Overlay & Deduplicated Markers
  useEffect(() => {
    const map = mapRef.current;
    blockedMarkersRef.current.forEach((m) => m.remove());
    blockedMarkersRef.current = [];
    if (!map || !mapReady) return;

    const blkSrc = map.getSource("network-blocked") as maplibregl.GeoJSONSource | undefined;
    if (!blkSrc) return;

    if (!showRoadClosures || !networkStatus) {
      blkSrc.setData(EMPTY_FC);
      return;
    }

    const blockedEdges = networkStatus.edges.filter((e) => e.status === "blocked");
    blkSrc.setData({
      type: "FeatureCollection",
      features: blockedEdges.map((e) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: e.coordinates },
        properties: { label: e.label },
      })),
    });

    const markerItems =
      networkStatus.closure_markers && networkStatus.closure_markers.length > 0
        ? networkStatus.closure_markers.map((cm) => {
            const matchedEdge =
              blockedEdges.find((e) =>
                e.triggered_by.some((t) => cm.triggered_by.some((ct) => ct.report_id === t.report_id))
              ) ??
              blockedEdges[0] ?? {
                from_id: cm.id,
                to_id: cm.id,
                label: cm.label,
                status: "blocked" as const,
                coordinates: [[cm.mid_lon, cm.mid_lat]],
                mid_lon: cm.mid_lon,
                mid_lat: cm.mid_lat,
                triggered_by: cm.triggered_by.map((t) => ({ ...t, distance_m: 0 })),
              };
            return {
              lon: cm.mid_lon,
              lat: cm.mid_lat,
              label: cm.label,
              edge: matchedEdge,
            };
          })
        : blockedEdges.map((e) => ({
            lon: e.mid_lon,
            lat: e.mid_lat,
            label: e.label,
            edge: e,
          }));

    for (const item of markerItems) {
      const el = document.createElement("button");
      el.type = "button";
      el.title = `通行不可区間（シミュレーション）: ${item.label}`;
      el.className =
        "flex items-center gap-1 rounded-md border border-white/90 bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-lg transition hover:scale-110 cursor-pointer";
      el.innerHTML = `<span>✕ 通行不可</span>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        callbacksRef.current.onSelectBlockedRoad(item.edge);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([item.lon, item.lat])
        .addTo(map);
      blockedMarkersRef.current.push(marker);
    }

    return () => {
      blockedMarkersRef.current.forEach((m) => m.remove());
      blockedMarkersRef.current = [];
    };
  }, [networkStatus, showRoadClosures, mapReady]);

  // Update Shelter & Relief Hubs Markers
  useEffect(() => {
    const map = mapRef.current;
    hubMarkersRef.current.forEach((m) => m.remove());
    hubMarkersRef.current = [];
    if (!map || !mapReady || !showShelterHubs || !networkStatus?.hubs) return;

    for (const hub of networkStatus.hubs) {
      if (selectedWard !== "all" && hub.ward !== selectedWard) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.title = `${hub.name} (${hub.status_note})`;
      const tone =
        hub.hub_status === "restricted"
          ? "border-amber-300 bg-amber-900/95 text-amber-100"
          : hub.hub_status === "support_needed"
            ? "border-rose-300 bg-rose-900/95 text-rose-100"
            : "border-teal-300 bg-teal-900/95 text-teal-50";
      el.className = `flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold shadow-md transition hover:scale-105 cursor-pointer ${tone}`;
      el.innerHTML = `<span>🏕</span><span>${hub.ward}拠点</span>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        callbacksRef.current.onSelectShelterHub(hub);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([hub.lon, hub.lat])
        .addTo(map);
      hubMarkersRef.current.push(marker);
    }

    return () => {
      hubMarkersRef.current.forEach((m) => m.remove());
      hubMarkersRef.current = [];
    };
  }, [networkStatus, showShelterHubs, selectedWard, mapReady]);

  // Update 514 official Kyoto shelters GeoJSON + Top-5 recommendation rank badges
  useEffect(() => {
    const map = mapRef.current;
    recMarkersRef.current.forEach((m) => m.remove());
    recMarkersRef.current = [];
    if (!map || !mapReady) return;

    const src = map.getSource("official-shelters") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const recMap = new Map<string, ShelterRecommendationItem>();
    for (const r of recommendedShelters) {
      recMap.set(r.id, r);
    }

    const filtered =
      selectedWard && selectedWard !== "all"
        ? officialShelters.filter((s) => s.ward === selectedWard || recMap.has(s.id))
        : officialShelters;

    src.setData({
      type: "FeatureCollection",
      features: filtered.map((s) => {
        const rec = recMap.get(s.id);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          properties: {
            id: s.id,
            name: s.name,
            ward: s.ward,
            is_wide_area: s.is_wide_area,
            rank: rec ? rec.rank : 0,
            disasters_summary: s.disaster_labels.join("・"),
          },
        };
      }),
    });

    if (recommendedShelters.length > 0) {
      const markers: maplibregl.Marker[] = [];
      for (const rec of recommendedShelters) {
        const el = document.createElement("button");
        el.type = "button";
        el.className =
          "group flex items-center gap-1 rounded-full border-2 border-yellow-200 bg-emerald-600 px-2 py-0.5 text-[11px] font-extrabold text-white shadow-xl hover:bg-emerald-500 transition";
        el.title = `${rec.name} (${rec.walk_minutes ?? "—"}分)`;
        el.innerHTML = `<span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-yellow-300 text-[10px] font-black text-emerald-950">${rec.rank}</span><span class="max-w-[110px] truncate">${rec.name}</span>`;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          callbacksRef.current.onSelectOfficialShelter(rec);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([rec.lon, rec.lat])
          .addTo(map);
        markers.push(marker);
      }
      recMarkersRef.current = markers;
    }

    return () => {
      recMarkersRef.current.forEach((m) => m.remove());
      recMarkersRef.current = [];
    };
  }, [officialShelters, recommendedShelters, selectedWard, mapReady]);

  // Update layer visibility, preset mesh opacity, and mesh/building colors & filters
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer("meshes-fill")) return;

    map.setLayoutProperty("meshes-fill", "visibility", showHazardMesh ? "visible" : "none");
    map.setLayoutProperty("meshes-line", "visibility", showHazardMesh ? "visible" : "none");
    map.setLayoutProperty("meshes-selected", "visibility", showHazardMesh ? "visible" : "none");

    // In 'crisis' preset, soften mesh fill & normal building opacity so streets, closed roads, and damaged buildings pop cleanly
    const opacityExpr: maplibregl.ExpressionSpecification =
      visualPreset === "crisis"
        ? ["interpolate", ["linear"], ["zoom"], 10, 0.22, 14, 0.12, 16, 0.08]
        : ["interpolate", ["linear"], ["zoom"], 10, 0.58, 14, 0.36, 16, 0.22];
    map.setPaintProperty("meshes-fill", "fill-opacity", opacityExpr);
    map.setPaintProperty(
      "buildings-fill",
      "fill-opacity",
      visualPreset === "crisis" ? 0.48 : 0.85
    );
    if (map.getLayer("buildings-3d")) {
      map.setPaintProperty(
        "buildings-3d",
        "fill-extrusion-opacity",
        visualPreset === "crisis" ? 0.78 : 0.92
      );
    }

    syncBuilding3DLayers(map);
    map.setLayoutProperty("earthquakes-circle", "visibility", showEarthquakes ? "visible" : "none");
    if (map.getLayer("official-shelters-circle")) {
      const shVis = showOfficialShelters ? "visible" : "none";
      map.setLayoutProperty("official-shelters-circle", "visibility", shVis);
      map.setLayoutProperty("official-shelters-wide-ring", "visibility", shVis);
    }
    if (map.getLayer("official-shelters-recommended")) {
      const recVis =
        showOfficialShelters || recommendedShelters.length > 0 ? "visible" : "none";
      map.setLayoutProperty("official-shelters-recommended", "visibility", recVis);
    }

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
    visualPreset,
    showHazardMesh,
    showBuildings,
    showEarthquakes,
    showOfficialShelters,
    recommendedShelters.length,
    map3DMode,
    meshOverlayMode,
    selectedWard,
    hazardTiers,
    ageCategories,
    usageGroup,
    mapReady,
    syncBuilding3DLayers,
  ]);

  // Explicit 2D / 3D / Auto mode transitions (never snaps user's manual mouse tilt unless mode explicitly changes)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (prevMap3DModeRef.current === map3DMode) return;
    prevMap3DModeRef.current = map3DMode;

    if (map3DMode === "3d") {
      manualFlatAtHighZoomRef.current = false;
      map.easeTo(
        {
          pitch: Math.max(map.getPitch(), 55),
          bearing: map.getBearing() === 0 ? -20 : map.getBearing(),
          duration: 700,
        },
        { fromAuto3D: true }
      );
    } else if (map3DMode === "2d") {
      map.easeTo({ pitch: 0, bearing: 0, duration: 700 }, { fromAuto3D: true });
    } else {
      manualFlatAtHighZoomRef.current = false;
      const p = computeAutoPitch(map.getZoom());
      map.easeTo(
        {
          pitch: p,
          bearing: p < PITCH_3D_THRESHOLD ? 0 : map.getBearing(),
          duration: 600,
        },
        { fromAuto3D: true }
      );
    }
    syncBuilding3DLayers(map);
  }, [map3DMode, mapReady, syncBuilding3DLayers]);

  // Selected + Damaged Building highlight in 2D & 3D as well
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer("buildings-selected")) return;
    const selFilter: maplibregl.FilterSpecification = [
      "==",
      ["get", "building_id"],
      selectedBuildingId || "",
    ];
    map.setFilter("buildings-selected", selFilter);
    if (map.getLayer("buildings-selected-fill")) {
      map.setFilter("buildings-selected-fill", selFilter);
    }
    if (map.getLayer("buildings-selected-halo")) {
      map.setFilter("buildings-selected-halo", selFilter);
    }
    if (map.getLayer("buildings-3d")) {
      map.setPaintProperty("buildings-3d", "fill-extrusion-color", [
        "case",
        ["==", ["get", "building_id"], selectedBuildingId || ""],
        "#facc15",
        ["in", ["get", "building_id"], ["literal", damagedBuildingIds]],
        "#ef4444",
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
  }, [selectedBuildingId, selectedMeshcode, damagedBuildingIds, mapReady]);

  // Client-side building vector filters
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

  // FlyTo / FitBounds trigger
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !flyToTarget) return;
    flyToActiveRef.current = true;
    if (flyToTarget.bbox && flyToTarget.bbox.length === 4) {
      map.fitBounds(
        [
          [flyToTarget.bbox[0], flyToTarget.bbox[1]],
          [flyToTarget.bbox[2], flyToTarget.bbox[3]],
        ],
        {
          padding: {
            top: 120,
            bottom: 90,
            left: typeof window !== "undefined" && window.innerWidth >= 1024 ? 450 : 40,
            right: 80,
          },
          maxZoom: flyToTarget.zoom,
          pitch: map3DModeRef.current === "3d" ? Math.max(map.getPitch(), 55) : 0,
          duration: 850,
        }
      );
      return;
    }
    let targetPitch = map.getPitch();
    if (map3DModeRef.current === "2d") {
      targetPitch = 0;
    } else if (map3DModeRef.current === "3d") {
      targetPitch = Math.max(map.getPitch(), 55);
    } else {
      manualFlatAtHighZoomRef.current = false;
      targetPitch = computeAutoPitch(flyToTarget.zoom);
    }
    map.flyTo({
      center: [flyToTarget.lon, flyToTarget.lat],
      zoom: flyToTarget.zoom,
      pitch: targetPitch,
      duration: 850,
    });
    const timer = setTimeout(() => {
      flyToActiveRef.current = false;
    }, 950);
    return () => clearTimeout(timer);
  }, [flyToTarget, mapReady]);

  // Sync Kyoto Active Fault / Seismic Belt Overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("seismic-belts") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!seismicBeltsGeoJson) {
      src.setData(EMPTY_FC);
      return;
    }
    const enriched: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: (seismicBeltsGeoJson.features || []).map((f) => ({
        ...f,
        properties: {
          ...(f.properties || {}),
          active: Boolean(activeSeismicBeltId && f.properties?.id === activeSeismicBeltId),
        },
      })),
    };
    src.setData(enriched);
  }, [seismicBeltsGeoJson, activeSeismicBeltId, mapReady]);

  // Google-Maps-style Searched Pin, Candidate Markers, Street Highlight & Halo
  useEffect(() => {
    const map = mapRef.current;
    searchPinMarkerRef.current?.remove();
    searchPinMarkerRef.current = null;
    searchCandMarkersRef.current.forEach((m) => m.remove());
    searchCandMarkersRef.current = [];
    if (!map || !mapReady) return;

    const streetSrc = map.getSource("search-street") as maplibregl.GeoJSONSource | undefined;
    const haloSrc = map.getSource("search-halo") as maplibregl.GeoJSONSource | undefined;

    if (!searchPin) {
      streetSrc?.setData(EMPTY_FC);
      haloSrc?.setData(EMPTY_FC);
      return;
    }

    if (streetSrc) {
      if (searchPin.street_segments && searchPin.street_segments.length > 0) {
        streetSrc.setData({
          type: "FeatureCollection",
          features: searchPin.street_segments.map((coords) => ({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: {},
          })),
        });
      } else {
        streetSrc.setData(EMPTY_FC);
      }
    }

    if (haloSrc) {
      if (searchPin.kind !== "ward") {
        haloSrc.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [searchPin.lon, searchPin.lat] },
              properties: {},
            },
          ],
        });
      } else {
        haloSrc.setData(EMPTY_FC);
      }
    }

    // Secondary candidate pins (when multiple matches exist)
    if (searchCandidates && searchCandidates.length > 1) {
      searchCandidates.forEach((cand, idx) => {
        if (cand.id === searchPin.id) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = `${cand.title} (${cand.address})`;
        btn.className =
          "flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-rose-500/85 text-[10px] font-extrabold text-white shadow-md transition hover:scale-125 hover:bg-rose-500 cursor-pointer";
        btn.textContent = String(idx + 1);
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          callbacksRef.current.onSelectSearchPin?.(cand);
        });
        const m = new maplibregl.Marker({ element: btn, anchor: "center" })
          .setLngLat([cand.lon, cand.lat])
          .addTo(map);
        searchCandMarkersRef.current.push(m);
      });
    }

    // Primary Google-Maps-style red teardrop pin + floating label
    const wrapper = document.createElement("button");
    wrapper.type = "button";
    wrapper.setAttribute("data-testid", "map-search-pin");
    wrapper.title = `${searchPin.title} (${searchPin.address})`;
    wrapper.className =
      "group flex flex-col items-center cursor-pointer focus:outline-none";

    const badge = document.createElement("div");
    badge.className =
      "mb-1 max-w-[190px] truncate rounded-full border border-rose-400/80 bg-slate-950/95 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-xl transition group-hover:scale-105";
    badge.textContent = searchPin.title;

    const svgWrap = document.createElement("div");
    svgWrap.className = "drop-shadow-[0_4px_10px_rgba(0,0,0,0.65)] transition group-hover:scale-110";
    svgWrap.innerHTML = `<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 1C7.716 1 1 7.716 1 16C1 26.5 16 39 16 39C16 39 31 26.5 31 16C31 7.716 24.284 1 16 1Z" fill="#EF4444" stroke="#FFFFFF" stroke-width="2.2"/>
      <circle cx="16" cy="15.5" r="5.5" fill="#7F1D1D" stroke="#FFFFFF" stroke-width="1.8"/>
    </svg>`;

    wrapper.appendChild(badge);
    wrapper.appendChild(svgWrap);
    wrapper.addEventListener("click", (ev) => {
      ev.stopPropagation();
      callbacksRef.current.onSelectSearchPin?.(searchPin);
    });

    searchPinMarkerRef.current = new maplibregl.Marker({ element: wrapper, anchor: "bottom" })
      .setLngLat([searchPin.lon, searchPin.lat])
      .addTo(map);

    return () => {
      searchPinMarkerRef.current?.remove();
      searchPinMarkerRef.current = null;
      searchCandMarkersRef.current.forEach((m) => m.remove());
      searchCandMarkersRef.current = [];
    };
  }, [searchPin, searchCandidates, mapReady]);

  // Damage Report Pins
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
            ? "border-dotted border-slate-300 opacity-90"
            : "border-solid border-cyan-300";

      el.className = `flex items-center gap-1 rounded-full border-2 ${borderStyle} bg-slate-950/95 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg transition hover:scale-110 cursor-pointer`;
      el.innerHTML = `<span style="background:${catMeta.color}" class="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold text-slate-950">${catMeta.symbol}</span><span>${catMeta.short}</span><span class="text-[9px] text-amber-200">${verMeta.short}</span>`;

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

  // Safety Board Ward Badges
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
      el.title = `${w.ward_name} 災害用伝言板: 計${w.total_count}件`;
      const alertClass =
        w.support_needed_count > 0
          ? "border-amber-400 bg-amber-950/95 text-amber-100"
          : "border-sky-400 bg-slate-900/95 text-sky-100";
      el.className = `flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold shadow-lg transition hover:scale-105 cursor-pointer ${alertClass}`;
      el.innerHTML = `<span>安否:${w.ward_name}</span><span class="rounded bg-white/15 px-1 font-mono font-bold">${w.total_count}</span>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        callbacksRef.current.onSelectSafetyWard(w.ward_name);
      });

      const marker = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
        offset: [0, -34],
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

  // Confidential Enterprise Assets Markers (rendered ONLY for owning Enterprise or Gov shared)
  useEffect(() => {
    const map = mapRef.current;
    enterpriseAssetMarkersRef.current.forEach((m) => m.remove());
    enterpriseAssetMarkersRef.current = [];
    if (!map || !mapReady || !enterpriseAssets || enterpriseAssets.length === 0) return;

    for (const asset of enterpriseAssets) {
      if (!Number.isFinite(asset.lat) || !Number.isFinite(asset.lon)) continue;
      if (selectedWard !== "all" && asset.wardName && asset.wardName !== selectedWard) continue;

      const isGovShared = asset.confidentialityLevel === "gov_emergency_share";
      const el = document.createElement("button");
      el.type = "button";
      el.title = `[${isGovShared ? "政府連携共有" : "自社完全秘匿"}] ${asset.name}`;
      el.className = `flex items-center gap-1 rounded-lg border-2 px-2 py-0.5 text-[10px] font-bold shadow-xl transition hover:scale-105 cursor-pointer ${
        isGovShared
          ? "border-amber-300 bg-amber-950/95 text-amber-100"
          : "border-emerald-300 bg-emerald-950/95 text-emerald-100"
      }`;
      el.innerHTML = `<span class="inline-block h-2 w-2 rounded-full ${
        isGovShared ? "bg-amber-400" : "bg-emerald-400"
      }"></span><span>${asset.name}</span>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectEnterpriseAsset?.(asset);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([asset.lon, asset.lat])
        .addTo(map);
      enterpriseAssetMarkersRef.current.push(marker);
    }

    return () => {
      enterpriseAssetMarkersRef.current.forEach((m) => m.remove());
      enterpriseAssetMarkersRef.current = [];
    };
  }, [enterpriseAssets, selectedWard, mapReady, onSelectEnterpriseAsset]);

  // Autonomous AI Agent Custom Pins (XSS-safe textContent + interactive click jump)
  useEffect(() => {
    const map = mapRef.current;
    agentPinMarkersRef.current.forEach((m) => m.remove());
    agentPinMarkersRef.current = [];
    if (!map || !mapReady || !agentPins || agentPins.length === 0) return;

    const paletteByTone: Record<
      "emerald" | "amber" | "rose" | "sky",
      { card: string; dot: string }
    > = {
      emerald: {
        card: "border-emerald-300 bg-emerald-950/95 text-emerald-50",
        dot: "bg-emerald-400",
      },
      amber: {
        card: "border-amber-300 bg-amber-950/95 text-amber-50",
        dot: "bg-amber-400",
      },
      rose: {
        card: "border-rose-400 bg-rose-950/95 text-rose-50",
        dot: "bg-rose-400",
      },
      sky: {
        card: "border-sky-300 bg-slate-900/95 text-sky-50",
        dot: "bg-sky-400",
      },
    };

    for (const pin of agentPins) {
      if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lon)) continue;
      const tone = paletteByTone[pin.tone ?? "sky"];

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-testid", `agent-pin-${pin.id}`);
      btn.title = pin.description ? `${pin.label} — ${pin.description}` : pin.label;
      btn.className = "group flex flex-col items-center focus:outline-none cursor-pointer";

      const pill = document.createElement("div");
      pill.className = `flex max-w-[200px] items-center gap-1.5 rounded-xl border-2 px-2.5 py-1 text-[10.5px] font-bold shadow-2xl backdrop-blur-md transition group-hover:scale-105 ${tone.card}`;

      const dot = document.createElement("span");
      dot.className = `h-2 w-2 shrink-0 rounded-full ${tone.dot}`;
      pill.appendChild(dot);

      const labelSpan = document.createElement("span");
      labelSpan.className = "truncate";
      labelSpan.textContent = pin.label;
      pill.appendChild(labelSpan);

      const stem = document.createElement("div");
      stem.className = `mt-0.5 h-2.5 w-0.5 rounded-full ${tone.dot}`;

      const tip = document.createElement("div");
      tip.className = `h-2.5 w-2.5 rounded-full border-2 border-white shadow ${tone.dot}`;

      btn.appendChild(pill);
      btn.appendChild(stem);
      btn.appendChild(tip);

      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectAgentPin?.(pin);
      });

      const marker = new maplibregl.Marker({ element: btn, anchor: "bottom" })
        .setLngLat([pin.lon, pin.lat])
        .addTo(map);
      agentPinMarkersRef.current.push(marker);
    }

    return () => {
      agentPinMarkersRef.current.forEach((m) => m.remove());
      agentPinMarkersRef.current = [];
    };
  }, [agentPins, mapReady, onSelectAgentPin]);

  // Highlighted Selected Building / Facility Beacon (pulsing radar ring + floating callout)
  useEffect(() => {
    const map = mapRef.current;
    if (highlightMarkerRef.current) {
      highlightMarkerRef.current.remove();
      highlightMarkerRef.current = null;
    }
    if (!map || !mapReady || !highlightedTarget) return;

    const tonePalette = {
      amber: {
        ring: "bg-amber-400/50",
        pinBg: "bg-amber-400 text-slate-950 border-white",
        card: "border-amber-400 bg-slate-950/95 text-amber-100",
        sub: "text-amber-300",
      },
      rose: {
        ring: "bg-rose-500/55",
        pinBg: "bg-rose-500 text-white border-white",
        card: "border-rose-400 bg-slate-950/95 text-rose-100",
        sub: "text-rose-300",
      },
      emerald: {
        ring: "bg-emerald-400/50",
        pinBg: "bg-emerald-500 text-slate-950 border-white",
        card: "border-emerald-400 bg-slate-950/95 text-emerald-100",
        sub: "text-emerald-300",
      },
      cyan: {
        ring: "bg-cyan-400/50",
        pinBg: "bg-cyan-400 text-slate-950 border-white",
        card: "border-cyan-400 bg-slate-950/95 text-cyan-100",
        sub: "text-cyan-300",
      },
    }[highlightedTarget.tone ?? "amber"];

    const root = document.createElement("div");
    root.className = "pointer-events-none flex flex-col items-center";
    root.setAttribute("data-testid", "selected-building-beacon");

    const callout = document.createElement("div");
    callout.className = `mb-2 max-w-[240px] rounded-xl border-2 px-2.5 py-1.5 text-center shadow-2xl backdrop-blur-md ${tonePalette.card}`;

    const titleEl = document.createElement("div");
    titleEl.className = "truncate text-[11px] font-extrabold leading-tight";
    titleEl.textContent = highlightedTarget.label;
    callout.appendChild(titleEl);

    if (highlightedTarget.subLabel) {
      const subEl = document.createElement("div");
      subEl.className = `mt-0.5 truncate text-[9px] font-semibold ${tonePalette.sub}`;
      subEl.textContent = highlightedTarget.subLabel;
      callout.appendChild(subEl);
    }

    const beaconWrap = document.createElement("div");
    beaconWrap.className = "relative flex h-11 w-11 items-center justify-center";

    const ping = document.createElement("span");
    ping.className = `absolute inset-0 rounded-full animate-ping ${tonePalette.ring}`;

    const outerRing = document.createElement("span");
    outerRing.className = `relative flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-xl ${tonePalette.pinBg}`;

    const innerDot = document.createElement("span");
    innerDot.className = "h-2 w-2 rounded-full bg-current";
    outerRing.appendChild(innerDot);

    beaconWrap.appendChild(ping);
    beaconWrap.appendChild(outerRing);

    root.appendChild(callout);
    root.appendChild(beaconWrap);

    highlightMarkerRef.current = new maplibregl.Marker({
      element: root,
      anchor: "bottom",
      offset: [0, 22],
    })
      .setLngLat([highlightedTarget.lon, highlightedTarget.lat])
      .addTo(map);

    return () => {
      highlightMarkerRef.current?.remove();
      highlightMarkerRef.current = null;
    };
  }, [highlightedTarget, mapReady]);

  // Picked Pin Marker
  useEffect(() => {
    const map = mapRef.current;
    if (pickMarkerRef.current) {
      pickMarkerRef.current.remove();
      pickMarkerRef.current = null;
    }
    if (!map || !mapReady || !pickedCoords) return;
    const el = document.createElement("div");
    el.className =
      "flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-rose-600 text-xs font-bold text-white shadow-xl animate-bounce";
    el.textContent = "📍";
    pickMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([pickedCoords.lon, pickedCoords.lat])
      .addTo(map);
    return () => {
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
    };
  }, [pickedCoords, mapReady]);

  // Road closure snap preview line highlight
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("preview-road") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!previewRoadSegments || previewRoadSegments.length === 0) {
      src.setData(EMPTY_FC);
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: previewRoadSegments.map((coords) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: {},
      })),
    });
  }, [previewRoadSegments, mapReady]);

  // Interactive road paint visibility, hover reset, dragPan lock for Canvas brush & reload on road update
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const isInteractive = roadPaintTool !== "none";
    const vis = isInteractive ? "visible" : "none";
    for (const lid of [
      "interactive-roads-hit",
      "interactive-roads-base",
      "interactive-roads-hover-glow",
      "interactive-roads-hover-core",
    ]) {
      if (map.getLayer(lid)) {
        map.setLayoutProperty(lid, "visibility", vis);
      }
    }

    if (roadPaintTool === "brush") {
      map.dragPan.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragPan.enable();
      map.doubleClickZoom.enable();
    }

    if (!isInteractive || roadPaintTool === "brush") {
      hoverEdgeIdRef.current = -1;
      if (map.getLayer("interactive-roads-hover-glow")) {
        map.setFilter("interactive-roads-hover-glow", ["==", ["get", "edge_id"], -1]);
      }
      if (map.getLayer("interactive-roads-hover-core")) {
        map.setFilter("interactive-roads-hover-core", ["==", ["get", "edge_id"], -1]);
      }
      if (!isInteractive) {
        const src = map.getSource("interactive-roads") as maplibregl.GeoJSONSource | undefined;
        src?.setData(EMPTY_FC);
        map.getCanvas().style.cursor = pickModeRef.current !== "none" ? "crosshair" : "";
        queueMicrotask(() => setHoverInfo(null));
        return;
      }
    }

    map.getCanvas().style.cursor = "crosshair";
    fetchInteractiveRoadsForCurrentView();
  }, [
    roadPaintTool,
    networkStatus,
    avoidUnverifiedRoads,
    includeSampleReports,
    mapReady,
    fetchInteractiveRoadsForCurrentView,
  ]);

  // Corridor Start point marker when using 2-step Start->End selection
  useEffect(() => {
    corridorStartMarkerRef.current?.remove();
    corridorStartMarkerRef.current = null;
    const map = mapRef.current;
    if (!map || !mapReady || !corridorStart) return;
    const el = document.createElement("div");
    el.className =
      "flex items-center gap-1 rounded-full border-2 border-white bg-amber-500 px-2 py-0.5 text-[11px] font-extrabold text-slate-950 shadow-xl animate-pulse";
    el.textContent = "S 始点";
    corridorStartMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([corridorStart.lon, corridorStart.lat])
      .addTo(map);
    return () => {
      corridorStartMarkerRef.current?.remove();
      corridorStartMarkerRef.current = null;
    };
  }, [corridorStart, mapReady]);

  // Clear Canvas stroke if exiting brush mode
  useEffect(() => {
    if (roadPaintTool !== "brush" && brushCanvasRef.current) {
      const ctx = brushCanvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, brushCanvasRef.current.width, brushCanvasRef.current.height);
      }
      brushDrawingRef.current = false;
      brushPointsRef.current = [];
    }
  }, [roadPaintTool]);

  // Navigation Route Lines + Start/End Pins
  useEffect(() => {
    const map = mapRef.current;
    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];
    if (!map || !mapReady) return;

    const baseSrc = map.getSource("route-baseline") as maplibregl.GeoJSONSource | undefined;
    const altSrc = map.getSource("route-alternative") as maplibregl.GeoJSONSource | undefined;
    if (!baseSrc || !altSrc) return;

    if (!routeResult) {
      baseSrc.setData(EMPTY_FC);
      altSrc.setData(EMPTY_FC);
      return;
    }

    baseSrc.setData({
      type: "FeatureCollection",
      features:
        routeResult.rerouted && routeResult.baseline_route.coordinates.length >= 2
          ? [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: routeResult.baseline_route.coordinates },
                properties: {},
              },
            ]
          : [],
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
      el.className = `rounded-full border-2 border-white ${bg} px-2.5 py-0.5 text-[11px] font-bold text-white shadow-xl`;
      el.textContent = tag;
      return el;
    };
    const m1 = new maplibregl.Marker({
      element: makeHubEl(
        routeResult.mode === "rescue" ? `🚑 出動: ${routeResult.origin.ward}` : `発: ${routeResult.origin.ward}`,
        routeResult.mode === "rescue" ? "bg-amber-600" : "bg-sky-600"
      ),
    })
      .setLngLat([routeResult.origin.lon, routeResult.origin.lat])
      .addTo(map);
    const m2 = new maplibregl.Marker({
      element: makeHubEl(
        routeResult.mode === "evacuate" ? `🏕 避難先: ${routeResult.destination.ward}` : `着: ${routeResult.destination.ward}`,
        "bg-emerald-600"
      ),
    })
      .setLngLat([routeResult.destination.lon, routeResult.destination.lat])
      .addTo(map);
    routeMarkersRef.current = [m1, m2];

    const coords = [
      ...routeResult.baseline_route.coordinates,
      ...routeResult.alternative_route.coordinates,
    ];
    if (coords.length >= 2 && roadPaintToolRef.current === "none") {
      const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
      for (const c of coords) bounds.extend(c);
      map.fitBounds(bounds, {
        padding: {
          top: 110,
          bottom: 95,
          left: typeof window !== "undefined" && window.innerWidth >= 1024 ? 465 : 50,
          right: 80,
        },
        duration: 800,
        maxZoom: 15.0,
      });
    }
  }, [routeResult, mapReady]);

  const drawBrushCanvasSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const canvas = brushCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(239, 68, 68, 0.45)";
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(250, 204, 21, 0.95)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    },
    []
  );

  const handleBrushPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = brushCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
    }
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    brushDrawingRef.current = true;
    brushPointsRef.current = [pt];
    drawBrushCanvasSegment(pt, { x: pt.x + 0.5, y: pt.y + 0.5 });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events without active pointerId
    }
  }, [drawBrushCanvasSegment]);

  const handleBrushPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!brushDrawingRef.current || !brushCanvasRef.current) return;
    const rect = brushCanvasRef.current.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pts = brushPointsRef.current;
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 5) return;
    pts.push(pt);
    if (prev) drawBrushCanvasSegment(prev, pt);
  }, [drawBrushCanvasSegment]);

  const finishBrushStroke = useCallback(() => {
    if (!brushDrawingRef.current) return;
    brushDrawingRef.current = false;
    const map = mapRef.current;
    const rawPts = brushPointsRef.current;
    brushPointsRef.current = [];
    if (!map || rawPts.length === 0) return;

    // Subsample evenly if stroke is very long
    const step = rawPts.length > 220 ? Math.ceil(rawPts.length / 220) : 1;
    const sampled: Array<{ lat: number; lon: number }> = [];
    for (let i = 0; i < rawPts.length; i += step) {
      const ll = map.unproject([rawPts[i].x, rawPts[i].y]);
      sampled.push({ lat: Number(ll.lat.toFixed(6)), lon: Number(ll.lng.toFixed(6)) });
    }
    const last = rawPts[rawPts.length - 1];
    const lastLl = map.unproject([last.x, last.y]);
    if (
      sampled.length === 0 ||
      sampled[sampled.length - 1].lat !== Number(lastLl.lat.toFixed(6)) ||
      sampled[sampled.length - 1].lon !== Number(lastLl.lng.toFixed(6))
    ) {
      sampled.push({ lat: Number(lastLl.lat.toFixed(6)), lon: Number(lastLl.lng.toFixed(6)) });
    }
    callbacksRef.current.onPaintRoadStroke?.(sampled);

    const canvas = brushCanvasRef.current;
    setTimeout(() => {
      if (!brushDrawingRef.current && canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }, 350);
  }, []);

  const pickPrompt =
    mapPickMode === "road_block"
      ? "通行止め・損壊を設定する道路を地図上でクリックしてください"
      : mapPickMode === "report"
        ? "地図上の建物または道路をクリックして被害場所を指定してください"
        : mapPickMode === "shelter_origin"
          ? "地図上の現在地（出発地点）をクリックするとハザードマップ連動の推奨避難場所Top5を検索します"
          : mapPickMode === "evacuate"
            ? "地図上の現在地（出発地点）をクリックすると最寄り避難所へのルートを表示します"
            : mapPickMode === "rescue"
              ? "地図上の救助・支援先をクリックすると最寄り拠点からの救援ルートを表示します"
              : mapPickMode === "enterprise_asset"
                ? "地図上の企業重要拠点（サーバー室・DC等）の位置をクリックして座標を取得してください"
                : null;

  return (
    <div className="relative h-full w-full bg-slate-950">
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {roadPaintTool === "brush" && (
        <canvas
          ref={brushCanvasRef}
          data-testid="road-brush-canvas"
          onPointerDown={handleBrushPointerDown}
          onPointerMove={handleBrushPointerMove}
          onPointerUp={finishBrushStroke}
          onPointerCancel={finishBrushStroke}
          className="absolute inset-0 z-20 h-full w-full cursor-crosshair touch-none"
        />
      )}

      {mapError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/90 p-6 text-center text-sm text-rose-200">
          <div className="max-w-md rounded-xl border border-rose-500/40 bg-rose-950/50 p-4">
            {mapError}
          </div>
        </div>
      )}

      {/* Centered Clean Prompt Banner ONLY when user actively picks on map */}
      {pickPrompt && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border-2 border-amber-400 bg-slate-950/95 px-4 py-2 text-xs sm:text-sm font-bold text-amber-100 shadow-2xl">
            <MapPin className="h-4 w-4 animate-bounce text-amber-400 shrink-0" />
            <span>{pickPrompt}</span>
            <button
              type="button"
              onClick={onCancelPickMode}
              className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              <X className="h-3.5 w-3.5" /> 中止
            </button>
          </div>
        </div>
      )}

      {/* Compact 3D / Auto-3D / 2D Switcher Pill above NavigationControl */}
      {onChangeMap3DMode && (
        <button
          type="button"
          data-testid="map-3d-toggle-pill"
          onClick={() => {
            const next: Map3DMode =
              map3DMode === "auto" ? "3d" : map3DMode === "3d" ? "2d" : "auto";
            onChangeMap3DMode(next);
          }}
          title="視点モード切替（自動3D: ホイール拡大や右/中ボタンドラッグで自動立体表示 ⇄ 3D固定 ⇄ 2D固定）"
          aria-label="3D表示モード切替"
          className={`pointer-events-auto fixed bottom-[204px] right-2.5 z-20 flex flex-col items-center justify-center rounded-xl border px-1.5 py-1.5 text-[10px] font-extrabold shadow-xl backdrop-blur-md transition lg:bottom-[144px] ${
            map3DMode === "3d" || pitch >= PITCH_3D_THRESHOLD
              ? "border-sky-400/80 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35"
              : map3DMode === "auto"
                ? "border-slate-600/90 bg-slate-900/90 text-slate-200 hover:border-sky-400/70 hover:text-white"
                : "border-slate-700 bg-slate-950/90 text-slate-400 hover:text-slate-200"
          }`}
        >
          <Box className="h-3.5 w-3.5" />
          <span className="mt-0.5 leading-none">
            {map3DMode === "auto" ? "自動3D" : map3DMode === "3d" ? "3D" : "2D"}
          </span>
          {pitch >= PITCH_3D_THRESHOLD && (
            <span className="mt-0.5 font-mono text-[9px] text-sky-300 leading-none">
              {pitch}°
            </span>
          )}
        </button>
      )}

      {/* Subtle Hover Tooltip OR Zoom Prompt at bottom (avoids drawer, measured summary pill & mobile dock) */}
      <div
        data-testid="map-hover-hud"
        style={
          {
            "--hover-bottom-desktop": `${
              !drawerOpen && summaryPillVisible
                ? Math.max(200, (summaryPillHeight > 0 ? summaryPillHeight : 184) + 28)
                : 16
            }px`,
          } as React.CSSProperties
        }
        className={`pointer-events-none absolute bottom-[72px] left-3 right-20 z-30 flex flex-wrap items-center gap-2 lg:bottom-[var(--hover-bottom-desktop)] ${
          drawerOpen ? "lg:left-[444px]" : "lg:left-3"
        }`}
      >
        {hoverInfo && (
          <div className="rounded-xl border border-sky-500/45 bg-slate-950/95 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-2xl backdrop-blur-md">
            {hoverInfo}
          </div>
        )}
        {zoom < 13.5 && showBuildings && !hoverInfo && (
          <button
            type="button"
            onClick={() => {
              const targetZ = 15.6;
              mapRef.current?.flyTo({
                center: mapRef.current.getCenter(),
                zoom: targetZ,
                pitch:
                  map3DModeRef.current === "2d"
                    ? 0
                    : map3DModeRef.current === "3d"
                      ? 55
                      : computeAutoPitch(targetZ),
                duration: 750,
              });
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-sky-200 shadow-lg backdrop-blur hover:bg-slate-800"
          >
            <Loader2 className="hidden" />
            <span>z{zoom.toFixed(1)} • ズームインして建物・3D表示</span>
          </button>
        )}
      </div>
    </div>
  );
}
