"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Compass,
  Map as MapIcon,
  MessageSquareHeart,
  ShieldAlert,
  Tent,
  X,
} from "lucide-react";
import { AiAssistantPanel } from "@/components/AiAssistantPanel";
import { DamageReportPanel } from "@/components/DamageReportPanel";
import { DisasterBoard } from "@/components/DisasterBoard";
import { FloatingHeader, WorkspacePanel } from "@/components/FloatingHeader";
import { MapDisplayPopover } from "@/components/MapDisplayPopover";
import { NavigationPanel } from "@/components/NavigationPanel";
import {
  MapPickMode,
  PickedMapTarget,
  QuakeMap,
  VisualPreset,
} from "@/components/QuakeMap";
import { RiskStatsDrawer } from "@/components/RiskStatsDrawer";
import { SelectedFeatureCard } from "@/components/SelectedFeatureCard";
import { SourcesModal } from "@/components/SourcesModal";
import { WARD_CENTERS } from "@/lib/colors";
import {
  getBoardSummary,
  getBuildingDetail,
  getDamageReports,
  getDamageReportsSummary,
  getEarthquakes,
  getHealth,
  getMeshDetail,
  getMeshesGeoJson,
  getMetadata,
  getNetworkStatus,
  getPriorityAreas,
  getStats,
  simulateNavigation,
  simulateRoute,
} from "@/lib/api";
import {
  AgeCategory,
  AiProtectionStatus,
  BoardSummaryResponse,
  BuildingDetail,
  DamageReport,
  DamageReportSummaryResponse,
  EarthquakeEvent,
  HazardTier,
  MapAction,
  MeshDetail,
  MeshOverlayMode,
  MetadataResponse,
  NetworkEdgeFeature,
  NetworkStatusResponse,
  PriorityArea,
  RouteSimulationResponse,
  ShelterHub,
  StatsResponse,
  UsageGroup,
} from "@/types/quakelens";

const DEFAULT_AGES: AgeCategory[] = ["pre_1981", "1982_2000", "post_2001", "unknown"];
const DEFAULT_HAZARDS: HazardTier[] = ["very_high", "elevated", "moderate", "low"];

export default function HomePage() {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [meshesGeoJson, setMeshesGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [priorityAreas, setPriorityAreas] = useState<PriorityArea[]>([]);
  const [earthquakes, setEarthquakes] = useState<EarthquakeEvent[]>([]);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [aiProtection, setAiProtection] = useState<AiProtectionStatus | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Live Disaster Data & Road Network State
  const [boardSummary, setBoardSummary] = useState<BoardSummaryResponse | null>(null);
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [reportSummary, setReportSummary] = useState<DamageReportSummaryResponse | null>(null);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatusResponse | null>(null);
  const [includeSamples, setIncludeSamples] = useState(true);
  const [disasterNonce, setDisasterNonce] = useState(0);
  const [routeResult, setRouteResult] = useState<RouteSimulationResponse | null>(null);

  // Workspace Shell & Visual Presets
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("none");
  const [displayOpen, setDisplayOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [visualPreset, setVisualPreset] = useState<VisualPreset>("crisis");

  // Map Layers & Filters
  const [selectedWard, setSelectedWard] = useState<string>("all");
  const [ageCategories, setAgeCategories] = useState<AgeCategory[]>(DEFAULT_AGES);
  const [hazardTiers, setHazardTiers] = useState<HazardTier[]>(DEFAULT_HAZARDS);
  const [usageGroup, setUsageGroup] = useState<UsageGroup>("all");
  const [selectedMeshcode, setSelectedMeshcode] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("pre_1981_high_hazard");

  const [showBuildings, setShowBuildings] = useState(true);
  const [showHazardMesh, setShowHazardMesh] = useState(true);
  const [meshOverlayMode, setMeshOverlayMode] = useState<MeshOverlayMode>("hazard");
  const [showRoadClosures, setShowRoadClosures] = useState(true);
  const [showShelterHubs, setShowShelterHubs] = useState(true);
  const [showReports, setShowReports] = useState(true);
  const [showSafetyLayer, setShowSafetyLayer] = useState(true);
  const [showEarthquakes, setShowEarthquakes] = useState(false);
  const [is3D, setIs3D] = useState(false);

  // Active Selections & Map Pickers
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingDetail | null>(null);
  const [selectedMesh, setSelectedMesh] = useState<MeshDetail | null>(null);
  const [selectedReport, setSelectedReport] = useState<DamageReport | null>(null);
  const [selectedBlockedRoad, setSelectedBlockedRoad] = useState<NetworkEdgeFeature | null>(null);
  const [selectedShelterHub, setSelectedShelterHub] = useState<ShelterHub | null>(null);

  const [mapPickMode, setMapPickMode] = useState<MapPickMode>("none");
  const [pickedReportTarget, setPickedReportTarget] = useState<PickedMapTarget | null>(null);
  const [pickedEvacuateCoords, setPickedEvacuateCoords] = useState<{
    lat: number;
    lon: number;
    label?: string;
  } | null>(null);
  const [pickedRescueCoords, setPickedRescueCoords] = useState<{
    lat: number;
    lon: number;
    label?: string;
  } | null>(null);

  const [flyToTarget, setFlyToTarget] = useState<{
    lon: number;
    lat: number;
    zoom: number;
    ts: number;
  } | null>(null);
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<{ text: string; ts: number } | null>(null);
  const [reportCreateTrigger, setReportCreateTrigger] = useState(0);

  // Initial load: health, metadata, meshes, earthquakes
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getHealth(),
      getMetadata(),
      getMeshesGeoJson("all"),
      getEarthquakes(40).catch(() => ({ earthquakes: [] })),
    ])
      .then(([h, m, mj, eq]) => {
        if (cancelled) return;
        setGeminiConfigured(h.gemini_configured);
        setAiProtection(h.ai_protection ?? null);
        setMetadata(m);
        setMeshesGeoJson(mj);
        setEarthquakes(eq.earthquakes || []);
        setApiError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setApiError(
          err instanceof Error
            ? `バックエンドAPIに接続できません（${err.message}）`
            : "バックエンドAPIに接続できません。"
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load / refresh Board Summary, Damage Reports & Road Network Status
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getBoardSummary({ ward: selectedWard, includeSamples }),
      getDamageReports({
        ward: selectedWard,
        includeSamples,
        includeResolved: true,
        limit: 120,
      }),
      getDamageReportsSummary({
        ward: selectedWard,
        includeSamples,
        includeResolved: false,
      }),
      getNetworkStatus({ includeSamples, avoidUnverified: true }),
    ])
      .then(([bSum, repList, repSum, net]) => {
        if (cancelled) return;
        setBoardSummary(bSum);
        setReports(repList.reports);
        setReportSummary(repSum);
        setNetworkStatus(net);
      })
      .catch(() => {
        // handled by top-level banner if unreachable
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWard, includeSamples, disasterNonce]);

  // Refresh building/hazard stats whenever filters change
  useEffect(() => {
    let cancelled = false;
    getStats({
      ward: selectedWard,
      ageCategories,
      hazardTiers,
      usageGroup,
      meshcode: selectedMeshcode,
    })
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        // handled cleanly
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWard, ageCategories, hazardTiers, usageGroup, selectedMeshcode]);

  // Refresh priority areas
  useEffect(() => {
    let cancelled = false;
    getPriorityAreas({
      ward: selectedWard,
      hazardTiers,
      usageGroup,
      sortBy,
      limit: 20,
    })
      .then((res) => {
        if (!cancelled) setPriorityAreas(res.areas);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWard, hazardTiers, usageGroup, sortBy]);

  const handleRefreshHealth = useCallback(async () => {
    try {
      const h = await getHealth();
      setGeminiConfigured(h.gemini_configured);
      setAiProtection(h.ai_protection ?? null);
    } catch {
      // ignore
    }
  }, []);

  const triggerDisasterRefresh = useCallback(() => {
    setDisasterNonce((n) => n + 1);
  }, []);

  const clearSelections = useCallback(() => {
    setSelectedBuilding(null);
    setSelectedMesh(null);
    setSelectedReport(null);
    setSelectedBlockedRoad(null);
    setSelectedShelterHub(null);
  }, []);

  const handleSelectWard = useCallback((ward: string) => {
    setSelectedWard(ward);
    setSelectedMeshcode(null);
    setSelectedMesh(null);
    const center = WARD_CENTERS[ward] || WARD_CENTERS.all;
    setFlyToTarget({ ...center, ts: Date.now() });
  }, []);

  const handleToggleAgeCategory = useCallback((cat: AgeCategory) => {
    setAgeCategories((prev) => {
      if (prev.length === DEFAULT_AGES.length) return [cat];
      if (prev.includes(cat)) {
        const next = prev.filter((c) => c !== cat);
        return next.length === 0 ? DEFAULT_AGES : next;
      }
      return [...prev, cat];
    });
  }, []);

  const handleToggleHazardTier = useCallback((tier: HazardTier) => {
    setHazardTiers((prev) => {
      if (prev.length === DEFAULT_HAZARDS.length) return [tier];
      if (prev.includes(tier)) {
        const next = prev.filter((t) => t !== tier);
        return next.length === 0 ? DEFAULT_HAZARDS : next;
      }
      return [...prev, tier];
    });
  }, []);

  const handleResetFilters = useCallback(() => {
    setSelectedWard("all");
    setAgeCategories(DEFAULT_AGES);
    setHazardTiers(DEFAULT_HAZARDS);
    setUsageGroup("all");
    setSelectedMeshcode(null);
    setRouteResult(null);
    clearSelections();
    setFlyToTarget({ ...WARD_CENTERS.all, ts: Date.now() });
  }, [clearSelections]);

  const handleSelectBuilding = useCallback(
    async (buildingId: string) => {
      clearSelections();
      try {
        const detail = await getBuildingDetail(buildingId);
        setSelectedBuilding(detail);
      } catch {
        // ignore
      }
    },
    [clearSelections]
  );

  const handleSelectMesh = useCallback(
    async (meshcode: string) => {
      clearSelections();
      setSelectedMeshcode(meshcode);
      try {
        const detail = await getMeshDetail(meshcode);
        setSelectedMesh(detail);
      } catch {
        // ignore
      }
    },
    [clearSelections]
  );

  const handleSelectReportFromMap = useCallback(
    (rep: DamageReport) => {
      clearSelections();
      setSelectedReport(rep);
    },
    [clearSelections]
  );

  const handleSelectBlockedRoad = useCallback(
    (edge: NetworkEdgeFeature) => {
      clearSelections();
      setSelectedBlockedRoad(edge);
    },
    [clearSelections]
  );

  const handleSelectShelterHub = useCallback(
    (hub: ShelterHub) => {
      clearSelections();
      setSelectedShelterHub(hub);
      setFlyToTarget({ lon: hub.lon, lat: hub.lat, zoom: 14.5, ts: Date.now() });
    },
    [clearSelections]
  );

  const handleSelectSafetyWardFromMap = useCallback((wardName: string) => {
    if (wardName && WARD_CENTERS[wardName]) {
      setSelectedWard(wardName);
    }
    setActivePanel("safety");
    setDisplayOpen(false);
  }, []);

  const handleFocusReport = useCallback((rep: DamageReport) => {
    setSelectedReport(rep);
    setShowReports(true);
    if (rep.lon != null && rep.lat != null) {
      setFlyToTarget({ lon: rep.lon, lat: rep.lat, zoom: 16.5, ts: Date.now() });
    } else if (rep.ward_name && WARD_CENTERS[rep.ward_name]) {
      setSelectedWard(rep.ward_name);
      setFlyToTarget({ ...WARD_CENTERS[rep.ward_name], ts: Date.now() });
    }
  }, []);

  const handleReportCreated = useCallback(
    (rep: DamageReport) => {
      setShowReports(true);
      setShowRoadClosures(true);
      setSelectedReport(rep);
      if (rep.lon != null && rep.lat != null) {
        setFlyToTarget({ lon: rep.lon, lat: rep.lat, zoom: 16.8, ts: Date.now() });
      }
    },
    []
  );

  const handleDispatchRescueToReport = useCallback(
    async (rep: DamageReport) => {
      try {
        clearSelections();
        const res = await simulateNavigation({
          mode: "rescue",
          targetReportId: rep.id,
          includeSamples,
          avoidUnverified: true,
        });
        setRouteResult(res);
        setShowRoadClosures(true);
        setShowShelterHubs(true);
        setActivePanel("nav");
      } catch {
        setActivePanel("nav");
      }
    },
    [includeSamples, clearSelections]
  );

  const handleDispatchRescueToBuilding = useCallback(
    async (building: BuildingDetail) => {
      try {
        clearSelections();
        const res = await simulateNavigation({
          mode: "rescue",
          targetLat: building.centroid_lat,
          targetLon: building.centroid_lon,
          includeSamples,
          avoidUnverified: true,
        });
        setPickedRescueCoords({
          lat: building.centroid_lat,
          lon: building.centroid_lon,
          label: `${building.ward_name} (${building.building_id})`,
        });
        setRouteResult(res);
        setShowRoadClosures(true);
        setShowShelterHubs(true);
        setActivePanel("nav");
      } catch {
        setActivePanel("nav");
      }
    },
    [includeSamples, clearSelections]
  );

  const handleReportBuilding = useCallback((building: BuildingDetail) => {
    setPickedReportTarget({
      lat: building.centroid_lat,
      lon: building.centroid_lon,
      buildingId: building.building_id,
      meshcode: building.meshcode,
      wardName: building.ward_name,
      yearBuilt: building.year_built,
      structureLabel: building.structure_label,
      usageLabel: building.usage_label,
    });
    setReportCreateTrigger((n) => n + 1);
    setActivePanel("report");
    setDisplayOpen(false);
  }, []);

  const handleOpenReportForMesh = useCallback((mesh: MeshDetail) => {
    setPickedReportTarget({
      lat: mesh.centroid_lat,
      lon: mesh.centroid_lon,
      meshcode: mesh.meshcode,
      wardName: mesh.ward_name,
    });
    setReportCreateTrigger((n) => n + 1);
    setActivePanel("report");
    setDisplayOpen(false);
  }, []);

  const handleMapPicked = useCallback(
    async (target: PickedMapTarget) => {
      if (mapPickMode === "report") {
        setPickedReportTarget(target);
        setMapPickMode("none");
        setReportCreateTrigger((n) => n + 1);
        setActivePanel("report");
        return;
      }

      if (mapPickMode === "evacuate") {
        setMapPickMode("none");
        setPickedEvacuateCoords({
          lat: target.lat,
          lon: target.lon,
          label: target.wardName
            ? `${target.wardName} (${target.lat.toFixed(4)}, ${target.lon.toFixed(4)})`
            : undefined,
        });
        try {
          const res = await simulateNavigation({
            mode: "evacuate",
            startLat: target.lat,
            startLon: target.lon,
            includeSamples,
            avoidUnverified: true,
          });
          setRouteResult(res);
          setActivePanel("nav");
        } catch {
          setActivePanel("nav");
        }
        return;
      }

      if (mapPickMode === "rescue") {
        setMapPickMode("none");
        setPickedRescueCoords({
          lat: target.lat,
          lon: target.lon,
          label: target.buildingId
            ? `${target.wardName ?? ""} (${target.buildingId})`
            : target.wardName
              ? `${target.wardName} (${target.lat.toFixed(4)}, ${target.lon.toFixed(4)})`
              : undefined,
        });
        try {
          const res = await simulateNavigation({
            mode: "rescue",
            targetLat: target.lat,
            targetLon: target.lon,
            includeSamples,
            avoidUnverified: true,
          });
          setRouteResult(res);
          setActivePanel("nav");
        } catch {
          setActivePanel("nav");
        }
      }
    },
    [mapPickMode, includeSamples]
  );

  const handleSelectPriorityArea = useCallback(
    async (area: PriorityArea) => {
      setSelectedMeshcode(area.meshcode);
      setFlyToTarget({
        lon: area.centroid_lon,
        lat: area.centroid_lat,
        zoom: 15.8,
        ts: Date.now(),
      });
      try {
        const detail = await getMeshDetail(area.meshcode);
        setSelectedMesh(detail);
      } catch {
        // ignore
      }
    },
    []
  );

  const handleRequestAiExplain = useCallback((prompt: string) => {
    setQueuedAiPrompt({ text: prompt, ts: Date.now() });
    setActivePanel("ai");
    setDisplayOpen(false);
  }, []);

  const handleFocusBoardArea = useCallback(async (wardName: string, meshcode: string | null) => {
    setShowSafetyLayer(true);
    if (wardName && wardName !== "京都市全域" && WARD_CENTERS[wardName]) {
      setSelectedWard(wardName);
    }
    if (meshcode) {
      setSelectedMeshcode(meshcode);
      try {
        const detail = await getMeshDetail(meshcode);
        setSelectedMesh(detail);
        setFlyToTarget({
          lon: detail.centroid_lon,
          lat: detail.centroid_lat,
          zoom: 15.6,
          ts: Date.now(),
        });
        return;
      } catch {
        // fallback to ward
      }
    }
    const center = WARD_CENTERS[wardName] || WARD_CENTERS.all;
    setFlyToTarget({ ...center, ts: Date.now() });
  }, []);

  const handleExecuteMapAction = useCallback(
    async (action: MapAction) => {
      if (action.type === "fly_to_ward" && action.ward) {
        setSelectedWard(action.ward);
        setSelectedMeshcode(null);
        setSelectedMesh(null);
        const center = WARD_CENTERS[action.ward] || WARD_CENTERS.all;
        setFlyToTarget({
          lon: action.lon ?? center.lon,
          lat: action.lat ?? center.lat,
          zoom: action.zoom ?? center.zoom ?? 12.6,
          ts: Date.now(),
        });
        return;
      }

      if (action.type === "fly_to_mesh" && action.meshcode) {
        setSelectedMeshcode(action.meshcode);
        if (action.lon != null && action.lat != null) {
          setFlyToTarget({
            lon: action.lon,
            lat: action.lat,
            zoom: action.zoom ?? 15.6,
            ts: Date.now(),
          });
        }
        try {
          const detail = await getMeshDetail(action.meshcode);
          setSelectedMesh(detail);
          if (action.lon == null || action.lat == null) {
            setFlyToTarget({
              lon: detail.centroid_lon,
              lat: detail.centroid_lat,
              zoom: action.zoom ?? 15.6,
              ts: Date.now(),
            });
          }
        } catch {
          // ignore
        }
        return;
      }

      if (action.type === "focus_building" && action.building_id) {
        try {
          const detail = await getBuildingDetail(action.building_id);
          setSelectedBuilding(detail);
          if (detail.meshcode) setSelectedMeshcode(detail.meshcode);
          setFlyToTarget({
            lon: action.lon ?? detail.centroid_lon,
            lat: action.lat ?? detail.centroid_lat,
            zoom: action.zoom ?? 17.2,
            ts: Date.now(),
          });
        } catch {
          // ignore
        }
        return;
      }

      if (action.type === "focus_report") {
        setShowReports(true);
        if (action.lon != null && action.lat != null) {
          setFlyToTarget({
            lon: action.lon,
            lat: action.lat,
            zoom: action.zoom ?? 15.8,
            ts: Date.now(),
          });
        } else if (action.ward && WARD_CENTERS[action.ward]) {
          setFlyToTarget({ ...WARD_CENTERS[action.ward], ts: Date.now() });
        }
        return;
      }

      if (action.type === "show_route_simulation" && action.origin_id && action.destination_id) {
        try {
          const res = await simulateRoute({
            originId: action.origin_id,
            destinationId: action.destination_id,
            includeSamples,
            avoidUnverified: true,
          });
          setRouteResult(res);
          setShowRoadClosures(true);
        } catch {
          // ignore
        }
      }
    },
    [includeSamples]
  );

  const wards = metadata?.wards ?? Object.keys(WARD_CENTERS).filter((k) => k !== "all");
  const blockedCount = networkStatus?.blocked_count ?? 0;

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-slate-950">
      {/* Full-Viewport Interactive Kyoto Map Canvas */}
      <QuakeMap
        meshesGeoJson={meshesGeoJson}
        earthquakes={earthquakes}
        reports={reports}
        boardSummary={boardSummary}
        networkStatus={networkStatus}
        routeResult={routeResult}
        visualPreset={visualPreset}
        selectedWard={selectedWard}
        ageCategories={ageCategories}
        hazardTiers={hazardTiers}
        usageGroup={usageGroup}
        showBuildings={showBuildings}
        showHazardMesh={showHazardMesh}
        meshOverlayMode={meshOverlayMode}
        showEarthquakes={showEarthquakes}
        showReports={showReports}
        showRoadClosures={showRoadClosures}
        showSafetyLayer={showSafetyLayer}
        showShelterHubs={showShelterHubs}
        is3D={is3D}
        selectedBuildingId={selectedBuilding?.building_id ?? null}
        selectedMeshcode={selectedMeshcode}
        flyToTarget={flyToTarget}
        mapPickMode={mapPickMode}
        pickedCoords={pickedReportTarget}
        onCancelPickMode={() => setMapPickMode("none")}
        onMapPicked={(target) => void handleMapPicked(target)}
        onSelectBuilding={(id) => void handleSelectBuilding(id)}
        onSelectMesh={(mc) => void handleSelectMesh(mc)}
        onSelectReport={handleSelectReportFromMap}
        onSelectBlockedRoad={handleSelectBlockedRoad}
        onSelectShelterHub={handleSelectShelterHub}
        onSelectSafetyWard={handleSelectSafetyWardFromMap}
      />

      {/* Top Floating Nav & Mobile Bottom Dock */}
      <FloatingHeader
        activePanel={activePanel}
        onTogglePanel={(p) => {
          setActivePanel(p);
          setDisplayOpen(false);
        }}
        wards={wards}
        selectedWard={selectedWard}
        onSelectWard={handleSelectWard}
        displayOpen={displayOpen}
        onToggleDisplay={() => setDisplayOpen((o) => !o)}
        onOpenSources={() => setSourcesOpen(true)}
        reportCount={reportSummary?.total_reports ?? reports.length}
        boardCount={boardSummary?.total_entries ?? 0}
        blockedRoadCount={blockedCount}
        hasActiveRoute={Boolean(routeResult)}
        geminiConfigured={geminiConfigured}
      />

      {/* API Connection Error Banner (floating under top header) */}
      {apiError && (
        <div
          role="alert"
          data-testid="api-error-banner"
          className="fixed left-1/2 top-[68px] z-40 flex w-[min(640px,calc(100vw-24px))] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-rose-500/60 bg-rose-950/95 px-4 py-2.5 text-xs text-rose-100 shadow-2xl backdrop-blur-md"
        >
          <span>{apiError}</span>
          <button
            type="button"
            onClick={() => setApiError(null)}
            className="rounded px-2 py-0.5 text-rose-200 hover:bg-rose-900"
          >
            閉じる
          </button>
        </div>
      )}

      {/* Compact Display & Filter Settings Popover */}
      <MapDisplayPopover
        open={displayOpen}
        onClose={() => setDisplayOpen(false)}
        visualPreset={visualPreset}
        onChangeVisualPreset={setVisualPreset}
        is3D={is3D}
        onChangeIs3D={setIs3D}
        showBuildings={showBuildings}
        onToggleBuildings={() => setShowBuildings((v) => !v)}
        showHazardMesh={showHazardMesh}
        onToggleHazardMesh={() => setShowHazardMesh((v) => !v)}
        meshOverlayMode={meshOverlayMode}
        onChangeMeshOverlayMode={setMeshOverlayMode}
        showRoadClosures={showRoadClosures}
        onToggleRoadClosures={() => setShowRoadClosures((v) => !v)}
        showShelterHubs={showShelterHubs}
        onToggleShelterHubs={() => setShowShelterHubs((v) => !v)}
        showReports={showReports}
        onToggleReports={() => setShowReports((v) => !v)}
        showSafetyLayer={showSafetyLayer}
        onToggleSafetyLayer={() => setShowSafetyLayer((v) => !v)}
        showEarthquakes={showEarthquakes}
        onToggleEarthquakes={() => setShowEarthquakes((v) => !v)}
        includeSamples={includeSamples}
        onToggleIncludeSamples={() => setIncludeSamples((v) => !v)}
        ageCategories={ageCategories}
        onToggleAgeCategory={handleToggleAgeCategory}
        hazardTiers={hazardTiers}
        onToggleHazardTier={handleToggleHazardTier}
        usageGroup={usageGroup}
        onChangeUsageGroup={setUsageGroup}
        selectedMeshcode={selectedMeshcode}
        onClearMeshcode={() => {
          setSelectedMeshcode(null);
          setSelectedMesh(null);
        }}
        onResetFilters={handleResetFilters}
      />

      {/* Clean Left Slide-Over Action Drawer */}
      {activePanel !== "none" && (
        <aside
          data-testid="workspace-drawer"
          className="fixed inset-x-2 bottom-[62px] top-[66px] z-20 flex flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-xl lg:inset-x-auto lg:bottom-4 lg:left-3 lg:top-[68px] lg:w-[420px]"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/70 px-4 py-2.5">
            <span className="text-xs font-bold text-slate-200">
              {activePanel === "report"
                ? "被害状況の報告・確認"
                : activePanel === "safety"
                  ? "災害用伝言板（安否確認）"
                  : activePanel === "nav"
                    ? "避難・救援ルート案内"
                    : activePanel === "ai"
                      ? "Gemini AI 状況分析"
                      : "災害統計・建物リスク分析"}
            </span>
            <button
              type="button"
              data-testid="close-drawer-btn"
              onClick={() => setActivePanel("none")}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              地図を広く見る
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {activePanel === "report" && (
              <DamageReportPanel
                key={`rep-${reportCreateTrigger}`}
                wards={wards}
                selectedWard={selectedWard}
                selectedMeshcode={selectedMeshcode}
                reports={reports}
                summary={reportSummary}
                includeSamples={includeSamples}
                onToggleIncludeSamples={setIncludeSamples}
                pickedTarget={pickedReportTarget}
                isPickingLocation={mapPickMode === "report"}
                onStartPickLocation={() => {
                  setShowReports(true);
                  setMapPickMode("report");
                }}
                onCancelPickLocation={() => setMapPickMode("none")}
                onClearPickedLocation={() => setPickedReportTarget(null)}
                onFocusReport={handleFocusReport}
                onReportCreated={handleReportCreated}
                onDispatchRescue={(rep) => void handleDispatchRescueToReport(rep)}
                onReportsChanged={triggerDisasterRefresh}
                onOpenRouteSimulator={() => setActivePanel("nav")}
                startInCreateMode={reportCreateTrigger > 0}
              />
            )}

            {activePanel === "safety" && (
              <DisasterBoard
                embedded
                wards={wards}
                defaultWard={selectedWard}
                defaultMeshcode={selectedMeshcode}
                includeSamples={includeSamples}
                onToggleIncludeSamples={setIncludeSamples}
                onFocusArea={handleFocusBoardArea}
                onSelectWardFilter={handleSelectWard}
                onDataMutated={triggerDisasterRefresh}
              />
            )}

            {activePanel === "nav" && (
              <NavigationPanel
                reports={reports}
                networkStatus={networkStatus}
                routeResult={routeResult}
                includeSamples={includeSamples}
                isPickingEvacuate={mapPickMode === "evacuate"}
                isPickingRescue={mapPickMode === "rescue"}
                pickedEvacuateCoords={pickedEvacuateCoords}
                pickedRescueCoords={pickedRescueCoords}
                onStartPickEvacuate={() => {
                  setShowShelterHubs(true);
                  setShowRoadClosures(true);
                  setMapPickMode("evacuate");
                }}
                onStartPickRescue={() => {
                  setShowShelterHubs(true);
                  setShowRoadClosures(true);
                  setMapPickMode("rescue");
                }}
                onCancelPick={() => setMapPickMode("none")}
                onChangeRouteResult={(res) => {
                  if (res) clearSelections();
                  setRouteResult(res);
                }}
                onSelectShelterHub={handleSelectShelterHub}
              />
            )}

            {activePanel === "ai" && (
              <AiAssistantPanel
                geminiConfigured={geminiConfigured}
                aiProtection={aiProtection}
                totalBuildings={metadata?.counts.total_buildings ?? stats?.total_buildings}
                onRefreshHealth={handleRefreshHealth}
                selectedWard={selectedWard}
                ageCategories={ageCategories}
                hazardTiers={hazardTiers}
                usageGroup={usageGroup}
                is3D={is3D}
                selectedBuilding={selectedBuilding}
                selectedMesh={selectedMesh}
                queuedPrompt={queuedAiPrompt}
                onConsumeQueuedPrompt={() => setQueuedAiPrompt(null)}
                onExecuteMapAction={handleExecuteMapAction}
              />
            )}

            {activePanel === "stats" && (
              <RiskStatsDrawer
                selectedWard={selectedWard}
                selectedMeshcode={selectedMeshcode}
                includeSamples={includeSamples}
                stats={stats}
                boardSummary={boardSummary}
                reportSummary={reportSummary}
                priorityAreas={priorityAreas}
                sortBy={sortBy}
                onChangeSortBy={setSortBy}
                ageCategories={ageCategories}
                hazardTiers={hazardTiers}
                onToggleAgeCategory={handleToggleAgeCategory}
                onToggleHazardTier={handleToggleHazardTier}
                onSelectPriorityArea={handleSelectPriorityArea}
                onOpenSafety={() => setActivePanel("safety")}
                onOpenReports={() => setActivePanel("report")}
              />
            )}
          </div>
        </aside>
      )}

      {/* Unobtrusive Bottom-Left Live Summary & Visual Key when Drawer Closed (Desktop) */}
      {activePanel === "none" && mapPickMode === "none" && (
        <div
          data-testid="map-summary-pill"
          className="pointer-events-auto fixed bottom-4 left-3 z-20 hidden max-w-[600px] flex-col gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/90 px-4 py-3 text-xs text-slate-200 shadow-2xl backdrop-blur-xl lg:flex"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 font-bold text-white">
              <MapIcon className="h-3.5 w-3.5 text-sky-400" />
              {selectedWard === "all" ? "京都市全域" : selectedWard}
            </span>
            <span className="font-mono text-slate-300">
              建物 {(stats?.total_buildings ?? metadata?.counts.total_buildings ?? 0).toLocaleString("ja-JP")}棟
            </span>
            <span className="flex items-center gap-1 text-rose-300">
              <Ban className="h-3.5 w-3.5" />
              通行止 {blockedCount}区間
            </span>
            <span className="flex items-center gap-1 text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              報告 {reportSummary?.total_reports ?? reports.length}件
            </span>
            <span className="flex items-center gap-1 text-sky-300">
              <MessageSquareHeart className="h-3.5 w-3.5" />
              安否 {boardSummary?.total_entries ?? 0}件
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-500 ring-1 ring-white/50" />
                倒壊/被害建物・通行止
              </span>
              <span className="flex items-center gap-1">
                <Tent className="h-3.5 w-3.5 text-emerald-400" />
                避難/支援拠点(訓練用)
              </span>
              <span className="flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                市民報告=未確認
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setReportCreateTrigger((n) => n + 1);
                  setActivePanel("report");
                }}
                className="rounded-lg bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-400"
              >
                ＋ 被害を報告
              </button>
              <button
                type="button"
                onClick={() => setActivePanel("nav")}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Compass className="h-3 w-3" />
                避難・救援ナビ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selected Building / Report / Blocked Road / Shelter Hub / Active Route HUD */}
      <SelectedFeatureCard
        selectedBuilding={selectedBuilding}
        selectedMesh={selectedMesh}
        selectedReport={selectedReport}
        selectedBlockedRoad={selectedBlockedRoad}
        selectedShelterHub={selectedShelterHub}
        routeResult={routeResult}
        onClearSelection={clearSelections}
        onClearRoute={() => setRouteResult(null)}
        onReportBuilding={handleReportBuilding}
        onDispatchToBuilding={(b) => void handleDispatchRescueToBuilding(b)}
        onDispatchToReport={(r) => void handleDispatchRescueToReport(r)}
        onEvacuateToHub={(hub) => {
          clearSelections();
          setShowShelterHubs(true);
          setShowRoadClosures(true);
          setActivePanel("nav");
          setMapPickMode("evacuate");
          setFlyToTarget({ lon: hub.lon, lat: hub.lat, zoom: 13.8, ts: Date.now() });
        }}
        onOpenNavPanel={() => setActivePanel("nav")}
        onOpenSafetyForWard={(w) => {
          if (w && WARD_CENTERS[w]) setSelectedWard(w);
          setActivePanel("safety");
        }}
        onOpenReportForMesh={handleOpenReportForMesh}
        onRequestAiExplain={handleRequestAiExplain}
      />

      {/* Sources Modal */}
      <SourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} metadata={metadata} />
    </div>
  );
}
