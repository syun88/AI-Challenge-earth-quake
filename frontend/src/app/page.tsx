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
import { MochimamoLive2D } from "@/components/MochimamoLive2D";
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
import { ROAD_CAUSE_PRESETS, RoadDamageToolbar } from "@/components/RoadDamageToolbar";
import { SelectedFeatureCard } from "@/components/SelectedFeatureCard";
import ShelterRecommendPanel from "@/components/ShelterRecommendPanel";
import { SourcesModal } from "@/components/SourcesModal";
import { WARD_CENTERS } from "@/lib/colors";
import { readLocalReportAuth, saveLocalReportAuth } from "@/lib/reportAuth";
import {
  createDamageReport,
  deleteDamageReport,
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
  getOfficialShelters,
  getPriorityAreas,
  getStats,
  recommendShelters,
  resolveRoadCorridor,
  resolveRoadStroke,
  simulateNavigation,
  simulateRoute,
  snapRoadInfo,
  updateDamageReport,
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
  OfficialShelter,
  PriorityArea,
  RoadPaintTool,
  RouteSimulationResponse,
  ShelterHub,
  ShelterRecommendationItem,
  ShelterRecommendationResponse,
  ShelterScenario,
  SnappedRoadInfo,
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
  const [showOfficialShelters, setShowOfficialShelters] = useState(true);
  const [showReports, setShowReports] = useState(true);
  const [showSafetyLayer, setShowSafetyLayer] = useState(true);
  const [showEarthquakes, setShowEarthquakes] = useState(false);
  const [is3D, setIs3D] = useState(false);

  const [officialShelters, setOfficialShelters] = useState<OfficialShelter[]>([]);
  const [selectedOfficialShelter, setSelectedOfficialShelter] = useState<OfficialShelter | null>(null);
  const [shelterOrigin, setShelterOrigin] = useState<{ lat: number; lon: number; label: string }>({
    lat: 35.0116,
    lon: 135.7681,
    label: "京都市役所周辺（中京区）",
  });
  const [shelterScenario, setShelterScenario] = useState<ShelterScenario>("earthquake");
  const [shelterAvoidUnverified, setShelterAvoidUnverified] = useState(true);
  const [shelterRecommendation, setShelterRecommendation] =
    useState<ShelterRecommendationResponse | null>(null);
  const [shelterLoading, setShelterLoading] = useState(false);
  const [shelterError, setShelterError] = useState<string | null>(null);
  const [selectedRecShelterId, setSelectedRecShelterId] = useState<string | null>(null);

  // Active Selections & Map Pickers
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingDetail | null>(null);
  const [selectedMesh, setSelectedMesh] = useState<MeshDetail | null>(null);
  const [selectedReport, setSelectedReport] = useState<DamageReport | null>(null);
  const [selectedBlockedRoad, setSelectedBlockedRoad] = useState<NetworkEdgeFeature | null>(null);
  const [selectedShelterHub, setSelectedShelterHub] = useState<ShelterHub | null>(null);

  const [mapPickMode, setMapPickMode] = useState<MapPickMode>("none");
  const [pickedReportTarget, setPickedReportTarget] = useState<PickedMapTarget | null>(null);
  const [snappedRoadTarget, setSnappedRoadTarget] = useState<SnappedRoadInfo | null>(null);
  const [lastNavParams, setLastNavParams] = useState<Parameters<typeof simulateNavigation>[0] | null>(null);
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

  // Interactive Road Paint / Glow / Corridor / Canvas Brush state
  const [roadPaintTool, setRoadPaintTool] = useState<RoadPaintTool>("none");
  const [paintCauseIdx, setPaintCauseIdx] = useState(0);
  const [paintConsent, setPaintConsent] = useState(false);
  const [paintConsentHighlight, setPaintConsentHighlight] = useState(false);
  const [corridorStart, setCorridorStart] = useState<{
    lat: number;
    lon: number;
    label?: string;
  } | null>(null);
  const [paintUndoStack, setPaintUndoStack] = useState<
    Array<{ id: string; passcode: string; title: string }>
  >([]);
  const [paintBusy, setPaintBusy] = useState(false);
  const [paintStatusText, setPaintStatusText] = useState<string | null>(null);
  const [paintErrorText, setPaintErrorText] = useState<string | null>(null);
  const [currentMapZoom, setCurrentMapZoom] = useState(12.6);

  // Initial load: health, metadata, meshes, earthquakes
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getHealth(),
      getMetadata(),
      getMeshesGeoJson("all"),
      getEarthquakes(40).catch(() => ({ earthquakes: [] })),
      getOfficialShelters().catch(() => ({ shelters: [] as OfficialShelter[] })),
    ])
      .then(([h, m, mj, eq, sh]) => {
        if (cancelled) return;
        setGeminiConfigured(h.gemini_configured);
        setAiProtection(h.ai_protection ?? null);
        setMetadata(m);
        setMeshesGeoJson(mj);
        setEarthquakes(eq.earthquakes || []);
        setOfficialShelters(sh.shelters || []);
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
    setSelectedOfficialShelter(null);
  }, []);

  const runShelterRecommendation = useCallback(
    async (opts?: {
      lat?: number;
      lon?: number;
      scenario?: ShelterScenario;
      avoidUnverified?: boolean;
      samples?: boolean;
      autoSelectTop?: boolean;
    }) => {
      const lat = opts?.lat ?? shelterOrigin.lat;
      const lon = opts?.lon ?? shelterOrigin.lon;
      const scenario = opts?.scenario ?? shelterScenario;
      const avoid = opts?.avoidUnverified ?? shelterAvoidUnverified;
      const samples = opts?.samples ?? includeSamples;
      setShelterLoading(true);
      setShelterError(null);
      try {
        const res = await recommendShelters({
          lat,
          lon,
          scenario,
          includeSamples: samples,
          avoidUnverified: avoid,
          limit: 5,
        });
        setShelterRecommendation(res);
        if (opts?.autoSelectTop && res.recommendations.length > 0) {
          const top = res.recommendations[0];
          setSelectedRecShelterId(top.id);
          setRouteResult(top.nav_route);
        }
      } catch (err) {
        setShelterError(
          err instanceof Error ? err.message : "避難場所推薦の取得に失敗しました。"
        );
      } finally {
        setShelterLoading(false);
      }
    },
    [
      shelterOrigin.lat,
      shelterOrigin.lon,
      shelterScenario,
      shelterAvoidUnverified,
      includeSamples,
    ]
  );

  useEffect(() => {
    if (activePanel !== "shelter") return;
    let cancelled = false;
    recommendShelters({
      lat: shelterOrigin.lat,
      lon: shelterOrigin.lon,
      scenario: shelterScenario,
      includeSamples,
      avoidUnverified: shelterAvoidUnverified,
      limit: 5,
    })
      .then((res) => {
        if (cancelled) return;
        setShelterRecommendation(res);
        setShelterError(null);
        setShelterLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setShelterError(
          err instanceof Error ? err.message : "避難場所推薦の取得に失敗しました。"
        );
        setShelterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activePanel,
    shelterOrigin.lat,
    shelterOrigin.lon,
    shelterScenario,
    shelterAvoidUnverified,
    includeSamples,
    disasterNonce,
  ]);

  const handleSelectOfficialShelterFromMap = useCallback(
    (shelter: OfficialShelter) => {
      clearSelections();
      setSelectedOfficialShelter(shelter);
    },
    [clearSelections]
  );

  const handleSelectRecommendedShelter = useCallback(
    (item: ShelterRecommendationItem) => {
      clearSelections();
      setSelectedRecShelterId(item.id);
      setSelectedOfficialShelter(item);
      setRouteResult(item.nav_route);
      setShowRoadClosures(true);
      setShowOfficialShelters(true);
    },
    [clearSelections]
  );

  const handleRouteToOfficialShelter = useCallback(
    async (shelter: OfficialShelter) => {
      try {
        const res = await simulateNavigation({
          mode: "custom",
          startLat: shelterOrigin.lat,
          startLon: shelterOrigin.lon,
          targetLat: shelter.lat,
          targetLon: shelter.lon,
          includeSamples,
          avoidUnverified: shelterAvoidUnverified,
        });
        setRouteResult(res);
        setShowRoadClosures(true);
      } catch {
        // ignore transient error
      }
    },
    [shelterOrigin.lat, shelterOrigin.lon, includeSamples, shelterAvoidUnverified]
  );

  const handleRecommendFromTarget = useCallback(
    (target: { lat: number; lon: number; label: string }) => {
      clearSelections();
      setShelterOrigin(target);
      setShowOfficialShelters(true);
      setActivePanel("shelter");
      void runShelterRecommendation({
        lat: target.lat,
        lon: target.lon,
        autoSelectTop: true,
      });
    },
    [clearSelections, runShelterRecommendation]
  );

  const handleUseGpsForShelter = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setShelterError("このブラウザではGPS現在地取得が利用できません。");
      return;
    }
    setShelterLoading(true);
    setShelterError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lon = Number(pos.coords.longitude.toFixed(5));
        setShelterOrigin({ lat, lon, label: `GPS現在地 (${lat}, ${lon})` });
        setFlyToTarget({ lat, lon, zoom: 14.8, ts: Date.now() });
        void runShelterRecommendation({ lat, lon, autoSelectTop: true });
      },
      () => {
        setShelterLoading(false);
        setShelterError("現在地の位置情報権限が許可されていないため取得できませんでした。");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [runShelterRecommendation]);

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
      const navParams: Parameters<typeof simulateNavigation>[0] = {
        mode: "rescue",
        targetReportId: rep.id,
        includeSamples,
        avoidUnverified: true,
      };
      try {
        clearSelections();
        const res = await simulateNavigation(navParams);
        setLastNavParams(navParams);
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
      const navParams: Parameters<typeof simulateNavigation>[0] = {
        mode: "rescue",
        targetLat: building.centroid_lat,
        targetLon: building.centroid_lon,
        includeSamples,
        avoidUnverified: true,
      };
      try {
        clearSelections();
        const res = await simulateNavigation(navParams);
        setPickedRescueCoords({
          lat: building.centroid_lat,
          lon: building.centroid_lon,
          label: `${building.ward_name} (${building.building_id})`,
        });
        setLastNavParams(navParams);
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

  const handleRoadClosuresChanged = useCallback(async () => {
    triggerDisasterRefresh();
    if (routeResult && lastNavParams) {
      try {
        const refreshed = await simulateNavigation({ ...lastNavParams, includeSamples });
        setRouteResult(refreshed);
      } catch {
        // ignore recalculation failure
      }
    }
  }, [triggerDisasterRefresh, routeResult, lastNavParams, includeSamples]);

  const handleResolveBlockedRoadFromMap = useCallback(
    async (reportId: string) => {
      const authMap = readLocalReportAuth();
      const code = authMap[reportId] || window.prompt("通行止めを解除するための暗証番号を入力してください");
      if (code === null) return;
      try {
        await updateDamageReport(reportId, { passcode: code, resolved: true });
        clearSelections();
        await handleRoadClosuresChanged();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "通行止めの解除に失敗しました。");
      }
    },
    [clearSelections, handleRoadClosuresChanged]
  );

  const openRoadPaintMode = useCallback(
    (tool: Exclude<RoadPaintTool, "none">) => {
      clearSelections();
      setMapPickMode("none");
      setSnappedRoadTarget(null);
      setShowRoadClosures(true);
      setCorridorStart(null);
      setPaintErrorText(null);
      setPaintStatusText(null);
      setRoadPaintTool(tool);
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setActivePanel("none");
      }
    },
    [clearSelections]
  );

  const requirePaintConsent = useCallback(() => {
    if (paintConsent) return true;
    setPaintConsentHighlight(true);
    setPaintErrorText("先に右側の「未確認の市民報告として公開（位置同意）」にチェックを入れてください。");
    return false;
  }, [paintConsent]);

  const saveRoadClosureSelection = useCallback(
    async (params: {
      edgeIds: number[];
      roadName: string;
      wardName: string;
      meshcode: string | null;
      lat: number;
      lon: number;
      sourceTag: string;
    }) => {
      const preset = ROAD_CAUSE_PRESETS[paintCauseIdx] ?? ROAD_CAUSE_PRESETS[0];
      const pass = String(Math.floor(1000 + Math.random() * 9000));
      const res = await createDamageReport({
        category: "road_blocked",
        severity: preset.severity,
        title: `${params.roadName}（${preset.label}）`,
        description: `${preset.desc} [${params.sourceTag}]`,
        ward_name: params.wardName,
        meshcode: params.meshcode,
        location_label: params.roadName,
        lat: params.lat,
        lon: params.lon,
        location_consent: true,
        blocked_edge_ids: params.edgeIds,
        passcode: pass,
        force_duplicate: true,
      });
      saveLocalReportAuth(res.report.id, pass);
      setPaintUndoStack((prev) => [
        ...prev,
        { id: res.report.id, passcode: pass, title: res.report.title },
      ]);
      await handleRoadClosuresChanged();
      setPaintErrorText(null);
      setPaintStatusText(
        `✓ ${params.roadName} を通行止めに反映しました（${params.edgeIds.length}区間・管理番号:${pass}）`
      );
    },
    [paintCauseIdx, handleRoadClosuresChanged]
  );

  const handleClickRoadFeatureInPaint = useCallback(
    async (hit: {
      edgeId: number | null;
      roadName: string;
      lat: number;
      lon: number;
      isBlocked: boolean;
    }) => {
      if (paintBusy) return;
      if (roadPaintTool === "click" && hit.isBlocked && hit.edgeId != null) {
        const authMap = readLocalReportAuth();
        const owned = reports.find(
          (r) =>
            !r.resolved &&
            !r.is_sample &&
            r.category === "road_blocked" &&
            Boolean(authMap[r.id]) &&
            Array.isArray(r.blocked_edge_ids) &&
            r.blocked_edge_ids.includes(hit.edgeId!)
        );
        if (owned) {
          setPaintBusy(true);
          try {
            await deleteDamageReport(owned.id, authMap[owned.id]);
            setPaintUndoStack((prev) => prev.filter((item) => item.id !== owned.id));
            await handleRoadClosuresChanged();
            setPaintErrorText(null);
            setPaintStatusText(`🔓 通行止めを解除しました: ${hit.roadName}`);
          } catch (err) {
            setPaintErrorText(
              err instanceof Error ? err.message : "通行止めの解除に失敗しました。"
            );
          } finally {
            setPaintBusy(false);
          }
          return;
        }
        setPaintErrorText(
          `${hit.roadName} は既存または訓練用サンプルの通行止めです（「戻す」または地図の赤マーカーから確認/解除できます）。`
        );
        return;
      }

      if (!requirePaintConsent()) return;

      if (roadPaintTool === "corridor") {
        if (!corridorStart) {
          setCorridorStart({ lat: hit.lat, lon: hit.lon, label: hit.roadName });
          setPaintErrorText(null);
          setPaintStatusText(`始点(S)を設定: ${hit.roadName} → 終点の道路をクリックしてください`);
          return;
        }
        setPaintBusy(true);
        setPaintErrorText(null);
        try {
          const corr = await resolveRoadCorridor({
            startLat: corridorStart.lat,
            startLon: corridorStart.lon,
            endLat: hit.lat,
            endLon: hit.lon,
          });
          setCorridorStart(null);
          if (!corr.matched || corr.edge_ids.length === 0) {
            setPaintErrorText("始点〜終点間の道路区間を取得できませんでした。近づけてやり直してください。");
            return;
          }
          await saveRoadClosureSelection({
            edgeIds: corr.edge_ids,
            roadName: corr.road_name,
            wardName: corr.ward_name,
            meshcode: corr.meshcode,
            lat: corr.snap_lat,
            lon: corr.snap_lon,
            sourceTag: "始点→終点区間選択",
          });
        } catch (err) {
          setCorridorStart(null);
          setPaintErrorText(
            err instanceof Error ? err.message : "区間通行止めの設定に失敗しました。"
          );
        } finally {
          setPaintBusy(false);
        }
        return;
      }

      // Single-click instant road block ("click")
      setPaintBusy(true);
      setPaintErrorText(null);
      try {
        const snapped = await snapRoadInfo(hit.lat, hit.lon);
        const exactIds =
          hit.edgeId != null
            ? [hit.edgeId]
            : snapped.edge_id != null
              ? [snapped.edge_id]
              : snapped.edge_ids ?? [];
        if (exactIds.length === 0) {
          setPaintErrorText("水色に光る道路の上をクリックしてください。");
          return;
        }
        await saveRoadClosureSelection({
          edgeIds: exactIds,
          roadName: snapped.matched ? snapped.road_name : hit.roadName,
          wardName: snapped.ward_name,
          meshcode: snapped.meshcode,
          lat: snapped.snap_lat,
          lon: snapped.snap_lon,
          sourceTag: "道路クリック選択",
        });
      } catch (err) {
        setPaintErrorText(err instanceof Error ? err.message : "道路通行止めの設定に失敗しました。");
      } finally {
        setPaintBusy(false);
      }
    },
    [
      paintBusy,
      roadPaintTool,
      reports,
      corridorStart,
      requirePaintConsent,
      saveRoadClosureSelection,
      handleRoadClosuresChanged,
    ]
  );

  const handlePaintRoadStroke = useCallback(
    async (points: Array<{ lat: number; lon: number }>) => {
      if (paintBusy || points.length === 0) return;
      if (!requirePaintConsent()) return;
      setPaintBusy(true);
      setPaintErrorText(null);
      try {
        const strokeRes = await resolveRoadStroke(points);
        if (!strokeRes.matched || strokeRes.edge_ids.length === 0) {
          setPaintErrorText("なぞった線の近くに道路が見つかりませんでした。もう少し大きく拡大してなぞってください。");
          return;
        }
        await saveRoadClosureSelection({
          edgeIds: strokeRes.edge_ids,
          roadName: strokeRes.road_name,
          wardName: strokeRes.ward_name,
          meshcode: strokeRes.meshcode,
          lat: strokeRes.snap_lat,
          lon: strokeRes.snap_lon,
          sourceTag: "Canvasなぞり選択",
        });
      } catch (err) {
        setPaintErrorText(
          err instanceof Error ? err.message : "なぞり描画による通行止め設定に失敗しました。"
        );
      } finally {
        setPaintBusy(false);
      }
    },
    [paintBusy, requirePaintConsent, saveRoadClosureSelection]
  );

  const handleUndoLastPaintedClosure = useCallback(async () => {
    if (paintBusy || paintUndoStack.length === 0) return;
    const last = paintUndoStack[paintUndoStack.length - 1];
    setPaintBusy(true);
    try {
      await deleteDamageReport(last.id, last.passcode);
      setPaintUndoStack((prev) => prev.slice(0, -1));
      await handleRoadClosuresChanged();
      setPaintErrorText(null);
      setPaintStatusText(`↩ 直前の通行止めを取り消しました: ${last.title}`);
    } catch (err) {
      setPaintErrorText(err instanceof Error ? err.message : "取り消しに失敗しました。");
    } finally {
      setPaintBusy(false);
    }
  }, [paintBusy, paintUndoStack, handleRoadClosuresChanged]);

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
      if (mapPickMode === "road_block") {
        setMapPickMode("none");
        try {
          const snapped = await snapRoadInfo(target.lat, target.lon);
          setSnappedRoadTarget(snapped);
        } catch {
          setSnappedRoadTarget({
            matched: false,
            road_name: "地図上の指定道路",
            highway: "unknown",
            highway_label: "道路",
            ward_name: target.wardName || "伏見区",
            meshcode: target.meshcode ?? null,
            snap_lat: target.lat,
            snap_lon: target.lon,
            distance_m: null,
            coordinates: [],
            preview_segments: [],
          });
        }
        setShowRoadClosures(true);
        setActivePanel("nav");
        return;
      }

      if (mapPickMode === "report") {
        setMapPickMode("none");
        let enriched = target;
        if (!target.buildingId) {
          try {
            const snapped = await snapRoadInfo(target.lat, target.lon);
            enriched = {
              ...target,
              wardName: target.wardName || snapped.ward_name,
              meshcode: target.meshcode ?? snapped.meshcode,
              roadName: snapped.matched ? snapped.road_name : null,
            };
          } catch {
            // ignore
          }
        }
        setPickedReportTarget(enriched);
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
        const navParams: Parameters<typeof simulateNavigation>[0] = {
          mode: "evacuate",
          startLat: target.lat,
          startLon: target.lon,
          includeSamples,
          avoidUnverified: true,
        };
        try {
          const res = await simulateNavigation(navParams);
          clearSelections();
          setLastNavParams(navParams);
          setRouteResult(res);
          setActivePanel("nav");
        } catch {
          setActivePanel("nav");
        }
        return;
      }

      if (mapPickMode === "shelter_origin") {
        setMapPickMode("none");
        const label = target.buildingId
          ? `${target.wardName ?? "選択地点"} 建物 (${target.buildingId})`
          : target.wardName
            ? `${target.wardName} (${target.lat.toFixed(4)}, ${target.lon.toFixed(4)})`
            : `指定地点 (${target.lat.toFixed(4)}, ${target.lon.toFixed(4)})`;
        setShelterOrigin({ lat: target.lat, lon: target.lon, label });
        clearSelections();
        setShowOfficialShelters(true);
        setActivePanel("shelter");
        await runShelterRecommendation({
          lat: target.lat,
          lon: target.lon,
          autoSelectTop: true,
        });
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
        const navParams: Parameters<typeof simulateNavigation>[0] = {
          mode: "rescue",
          targetLat: target.lat,
          targetLon: target.lon,
          includeSamples,
          avoidUnverified: true,
        };
        try {
          const res = await simulateNavigation(navParams);
          clearSelections();
          setLastNavParams(navParams);
          setRouteResult(res);
          setActivePanel("nav");
        } catch {
          setActivePanel("nav");
        }
      }
    },
    [mapPickMode, includeSamples, clearSelections, runShelterRecommendation]
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
        showOfficialShelters={showOfficialShelters}
        officialShelters={officialShelters}
        recommendedShelters={
          activePanel === "shelter" ? shelterRecommendation?.recommendations ?? [] : []
        }
        is3D={is3D}
        selectedBuildingId={selectedBuilding?.building_id ?? null}
        selectedMeshcode={selectedMeshcode}
        flyToTarget={flyToTarget}
        mapPickMode={mapPickMode}
        pickedCoords={pickedReportTarget}
        previewRoadSegments={snappedRoadTarget?.preview_segments ?? null}
        roadPaintTool={roadPaintTool}
        corridorStart={corridorStart}
        avoidUnverifiedRoads={true}
        includeSampleReports={includeSamples}
        onCancelPickMode={() => setMapPickMode("none")}
        onMapPicked={(target) => void handleMapPicked(target)}
        onClickRoadFeature={(hit) => void handleClickRoadFeatureInPaint(hit)}
        onPaintRoadStroke={(pts) => void handlePaintRoadStroke(pts)}
        onZoomChange={(z) => setCurrentMapZoom(z)}
        onSelectBuilding={(id) => void handleSelectBuilding(id)}
        onSelectMesh={(mc) => void handleSelectMesh(mc)}
        onSelectReport={handleSelectReportFromMap}
        onSelectBlockedRoad={handleSelectBlockedRoad}
        onSelectShelterHub={handleSelectShelterHub}
        onSelectOfficialShelter={handleSelectOfficialShelterFromMap}
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
        showOfficialShelters={showOfficialShelters}
        onToggleOfficialShelters={() => setShowOfficialShelters((v) => !v)}
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
                  : activePanel === "shelter"
                    ? "ハザードマップ連動・避難場所推薦"
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
                onReportsChanged={() => void handleRoadClosuresChanged()}
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

            {activePanel === "shelter" && (
              <div className="p-3.5">
                <ShelterRecommendPanel
                  wards={wards}
                  selectedWard={selectedWard}
                  origin={shelterOrigin}
                  scenario={shelterScenario}
                  avoidUnverified={shelterAvoidUnverified}
                  includeSamples={includeSamples}
                  isPickingOrigin={mapPickMode === "shelter_origin"}
                  loading={shelterLoading}
                  error={shelterError}
                  recommendation={shelterRecommendation}
                  selectedShelterId={selectedRecShelterId}
                  onChangeScenario={(next) => {
                    setShelterLoading(true);
                    setShelterScenario(next);
                  }}
                  onChangeAvoidUnverified={(next) => {
                    setShelterLoading(true);
                    setShelterAvoidUnverified(next);
                  }}
                  onChangeIncludeSamples={(next) => {
                    setShelterLoading(true);
                    setIncludeSamples(next);
                  }}
                  onTogglePickOrigin={() => {
                    setShowOfficialShelters(true);
                    setMapPickMode((m) => (m === "shelter_origin" ? "none" : "shelter_origin"));
                  }}
                  onUseGpsOrigin={handleUseGpsForShelter}
                  onSelectWardOrigin={(ward) => {
                    const center = WARD_CENTERS[ward];
                    if (!center) return;
                    setSelectedWard(ward);
                    setShelterOrigin({
                      lat: center.lat,
                      lon: center.lon,
                      label: `${ward} 中心付近`,
                    });
                    setFlyToTarget({ ...center, zoom: 14.3, ts: Date.now() });
                    void runShelterRecommendation({
                      lat: center.lat,
                      lon: center.lon,
                      autoSelectTop: true,
                    });
                  }}
                  onRefresh={() => void runShelterRecommendation()}
                  onSelectRecommendation={handleSelectRecommendedShelter}
                />
              </div>
            )}

            {activePanel === "nav" && (
              <NavigationPanel
                reports={reports}
                networkStatus={networkStatus}
                routeResult={routeResult}
                includeSamples={includeSamples}
                isPickingEvacuate={mapPickMode === "evacuate"}
                isPickingRescue={mapPickMode === "rescue"}
                isPickingRoadBlock={mapPickMode === "road_block"}
                pickedEvacuateCoords={pickedEvacuateCoords}
                pickedRescueCoords={pickedRescueCoords}
                snappedRoadTarget={snappedRoadTarget}
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
                onStartPickRoadBlock={() => {
                  setShowRoadClosures(true);
                  setSnappedRoadTarget(null);
                  setRoadPaintTool("none");
                  setMapPickMode("road_block");
                }}
                onOpenRoadPaintMode={openRoadPaintMode}
                onClearRoadBlockTarget={() => setSnappedRoadTarget(null)}
                onCancelPick={() => setMapPickMode("none")}
                onChangeRouteResult={(res, params) => {
                  if (res) {
                    clearSelections();
                    if (params) setLastNavParams(params);
                  } else {
                    setLastNavParams(null);
                  }
                  setRouteResult(res);
                }}
                onSelectShelterHub={handleSelectShelterHub}
                onFocusReport={handleFocusReport}
                onRoadClosuresChanged={handleRoadClosuresChanged}
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
                <span className="h-2.5 w-2.5 rounded-full bg-[#14b8a6] ring-1 ring-white/80" />
                緑: 指定緊急避難場所(444)
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f97316] ring-2 ring-[#fb923c]/80" />
                橙: 広域避難場所・大規模火災対応(70)
              </span>
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
                data-testid="summary-road-block-btn"
                onClick={() => openRoadPaintMode("click")}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/50 bg-cyan-500/20 px-2.5 py-1 text-[11px] font-bold text-cyan-100 hover:bg-cyan-500/35"
              >
                <Ban className="h-3 w-3 text-rose-300" />
                道路を描く・選択
              </button>
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
        selectedOfficialShelter={selectedOfficialShelter}
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
        onRouteToOfficialShelter={(s) => void handleRouteToOfficialShelter(s)}
        onRecommendFromTarget={handleRecommendFromTarget}
        onStartPickRoadBlock={() => {
          clearSelections();
          setShowRoadClosures(true);
          setSnappedRoadTarget(null);
          setMapPickMode("road_block");
        }}
        onResolveBlockedRoad={(reportId) => void handleResolveBlockedRoadFromMap(reportId)}
        onOpenNavPanel={() => setActivePanel("nav")}
        onOpenSafetyForWard={(w) => {
          if (w && WARD_CENTERS[w]) setSelectedWard(w);
          setActivePanel("safety");
        }}
        onOpenReportForMesh={handleOpenReportForMesh}
        onRequestAiExplain={handleRequestAiExplain}
      />

      {/* Floating Interactive Road Damage Paint Toolbar */}
      {roadPaintTool !== "none" && (
        <RoadDamageToolbar
          tool={roadPaintTool}
          onChangeTool={(nextTool) => {
            setCorridorStart(null);
            setPaintErrorText(null);
            setRoadPaintTool(nextTool);
          }}
          causeIdx={paintCauseIdx}
          onChangeCauseIdx={setPaintCauseIdx}
          locationConsent={paintConsent}
          onChangeConsent={(val) => {
            setPaintConsent(val);
            if (val) {
              setPaintConsentHighlight(false);
              setPaintErrorText(null);
            }
          }}
          consentHighlight={paintConsentHighlight}
          corridorStart={corridorStart}
          onClearCorridorStart={() => {
            setCorridorStart(null);
            setPaintStatusText(null);
          }}
          undoCount={paintUndoStack.length}
          onUndoLastClosure={() => void handleUndoLastPaintedClosure()}
          busy={paintBusy}
          statusText={paintStatusText}
          errorText={paintErrorText}
          mapZoom={currentMapZoom}
          drawerOpen={activePanel !== "none"}
          onZoomIn={() => {
            const center =
              corridorStart ||
              (selectedWard !== "all" && WARD_CENTERS[selectedWard]) || {
                lat: 34.974,
                lon: 135.762,
              };
            setFlyToTarget({ lon: center.lon, lat: center.lat, zoom: 14.5, ts: Date.now() });
          }}
          onClose={() => {
            setRoadPaintTool("none");
            setCorridorStart(null);
            setPaintErrorText(null);
          }}
        />
      )}

      {/* Floating Live2D ChatBot Launcher when AI drawer & bottom-right feature card are closed */}
      {activePanel !== "ai" &&
        mapPickMode === "none" &&
        roadPaintTool === "none" &&
        !selectedBuilding &&
        !selectedMesh &&
        !selectedReport &&
        !selectedBlockedRoad &&
        !selectedShelterHub &&
        !selectedOfficialShelter &&
        !routeResult && (
          <button
            type="button"
            data-testid="mochimamo-launcher"
            onClick={() => setActivePanel("ai")}
            title="もちまも（防災AIチャット）を開く"
            className="group pointer-events-auto fixed bottom-16 right-3 z-20 hidden flex-col items-center gap-1 rounded-2xl border border-cyan-500/40 bg-slate-900/90 p-2 shadow-2xl backdrop-blur-xl transition hover:border-cyan-400/80 hover:bg-slate-900 sm:flex lg:bottom-4 lg:right-14"
          >
            <div className="h-[19vh] min-h-[136px] max-h-[192px] w-[19vh] min-w-[136px] max-w-[192px] overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/70">
              <MochimamoLive2D mood="idle" interactive={false} trackPointer className="h-full w-full" />
            </div>
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-[11px] font-extrabold text-white">もちまも</span>
              <span className="rounded bg-cyan-500/20 px-1 py-0.5 text-[9px] font-semibold text-cyan-200">
                Live2D
              </span>
              <span className="text-[10px] text-slate-300 group-hover:text-cyan-200">
                防災AIに質問
              </span>
            </div>
          </button>
        )}

      {/* Sources Modal */}
      <SourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} metadata={metadata} />
    </div>
  );
}
