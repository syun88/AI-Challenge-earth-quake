"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  Bot,
  Building2,
  Compass,
  Loader2,
  Map as MapIcon,
  MapPin,
  MessageSquareHeart,
  ShieldAlert,
  Tent,
  X,
} from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { getFirebaseDb } from "@/lib/firebase";
import { AiAssistantPanel } from "@/components/AiAssistantPanel";
import { PENDING_BOARD_MAP_ACTIONS_KEY } from "@/components/BoardChatPanel";
import { DraggableMochimamoBot } from "@/components/DraggableMochimamoBot";
import { DamageReportPanel } from "@/components/DamageReportPanel";
import { DisasterBoard } from "@/components/DisasterBoard";
import DisasterUpdatesPanel from "@/components/DisasterUpdatesPanel";
import EnterpriseAssetsPanel from "@/components/EnterpriseAssetsPanel";
import { FloatingHeader, WorkspacePanel } from "@/components/FloatingHeader";
import { LocationSearchBar } from "@/components/LocationSearchBar";
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
  autoSelectOptimalShelter,
  createDamageReport,
  deleteDamageReport,
  getBoardSummary,
  getBuildingDetail,
  getDamageReports,
  getDamageReportsSummary,
  getDisasterUpdates,
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
  refreshDisasterUpdates,
  resolveRoadCorridor,
  resolveRoadStroke,
  reverseGeocode,
  simulateNavigation,
  simulateRoute,
  snapRoadInfo,
  updateDamageReport,
} from "@/lib/api";
import {
  AgeCategory,
  AgentMapPin,
  AiProtectionStatus,
  AutoShelterSelectionResponse,
  BcpSiteCandidate,
  BoardSummaryResponse,
  BuildingDetail,
  DamageReport,
  DamageReportSummaryResponse,
  DisasterUpdatesPeriod,
  DisasterUpdatesResponse,
  EarthquakeEvent,
  EnterpriseAsset,
  EnterpriseAssetType,
  EnterpriseConfidentiality,
  HazardTier,
  HistoricResidentialMeshCandidate,
  HistoricResidentialSampleBuilding,
  KyotoEarthquakeArchiveItem,
  LocationSearchResult,
  Map3DMode,
  MapAction,
  MeshDetail,
  MeshOverlayMode,
  MetadataResponse,
  MultiBeltHotspot,
  NetworkEdgeFeature,
  NetworkStatusResponse,
  OfficialShelter,
  PriorityArea,
  R8LocateResponse,
  R8UnlistedLocateResponse,
  ReverseGeocodeResponse,
  RoadPaintTool,
  RouteSimulationResponse,
  SeismicBeltImpactItem,
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
  const router = useRouter();
  const {
    firebaseReady,
    firebaseUser,
    profile,
    authLoading,
    needsRegistration,
    logout,
  } = useAuth();
  const isAuthenticated = Boolean(firebaseUser && profile && !authLoading);

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
  const [favoriteWard, setFavoriteWard] = useState<string | null>(null);
  const [savingFavoriteWard, setSavingFavoriteWard] = useState(false);
  const manualWardChangedRef = useRef(false);
  const loadedPrefsUidRef = useRef<string | null>(null);
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
  const [map3DMode, setMap3DMode] = useState<Map3DMode>("auto");
  const [isPitch3D, setIsPitch3D] = useState(false);

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
  const [autoShelterResult, setAutoShelterResult] =
    useState<AutoShelterSelectionResponse | null>(null);
  const [autoLiveShelterMode, setAutoLiveShelterMode] = useState(false);
  const [shelterLoading, setShelterLoading] = useState(false);
  const [shelterError, setShelterError] = useState<string | null>(null);
  const [selectedRecShelterId, setSelectedRecShelterId] = useState<string | null>(null);

  // JMA & Kyoto City Disaster Updates (2025-2026 + Archive)
  const [updatesPeriod, setUpdatesPeriod] = useState<DisasterUpdatesPeriod>("all");
  const [updatesData, setUpdatesData] = useState<DisasterUpdatesResponse | null>(null);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesRefreshing, setUpdatesRefreshing] = useState(false);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  const [updatesRefreshMsg, setUpdatesRefreshMsg] = useState<string | null>(null);

  // Active Selections & Map Pickers
  const [statsTab, setStatsTab] = useState<
    "risk" | "bcp" | "shared_assets" | "heritage" | "seismic_belts"
  >("risk");
  const [seismicBeltsGeoJson, setSeismicBeltsGeoJson] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [activeSeismicBeltId, setActiveSeismicBeltId] = useState<string | null>(null);
  const [selectedBeltHotspot, setSelectedBeltHotspot] = useState<MultiBeltHotspot | null>(null);
  const [enterpriseAssets, setEnterpriseAssets] = useState<EnterpriseAsset[]>([]);
  const [pickedEnterpriseCoords, setPickedEnterpriseCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingDetail | null>(null);
  const [selectedMesh, setSelectedMesh] = useState<MeshDetail | null>(null);
  const [selectedBcpSite, setSelectedBcpSite] = useState<BcpSiteCandidate | null>(null);
  const [selectedHeritageMesh, setSelectedHeritageMesh] =
    useState<HistoricResidentialMeshCandidate | null>(null);
  const [selectedReport, setSelectedReport] = useState<DamageReport | null>(null);
  const [selectedBlockedRoad, setSelectedBlockedRoad] = useState<NetworkEdgeFeature | null>(null);
  const [selectedShelterHub, setSelectedShelterHub] = useState<ShelterHub | null>(null);
  const [selectedR8Facility, setSelectedR8Facility] = useState<R8LocateResponse | null>(null);
  const [selectedR8Unlisted, setSelectedR8Unlisted] = useState<R8UnlistedLocateResponse | null>(null);
  const [searchPin, setSearchPin] = useState<LocationSearchResult | null>(null);
  const [searchCandidates, setSearchCandidates] = useState<LocationSearchResult[]>([]);
  const [reverseAddress, setReverseAddress] = useState<ReverseGeocodeResponse | null>(null);
  const reverseReqSeqRef = useRef(0);

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
    bbox?: [number, number, number, number] | null;
    ts: number;
  } | null>(null);
  const [agentPins, setAgentPins] = useState<AgentMapPin[]>([]);
  const [selectedAgentPin, setSelectedAgentPin] = useState<AgentMapPin | null>(null);
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
  const summaryPillRef = useRef<HTMLDivElement | null>(null);
  const [summaryPillHeight, setSummaryPillHeight] = useState(0);
  const summaryPillVisible = activePanel === "none" && mapPickMode === "none";

  useEffect(() => {
    if (!summaryPillVisible) {
      queueMicrotask(() => setSummaryPillHeight(0));
      return;
    }
    const el = summaryPillRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      setSummaryPillHeight((prev) => (prev !== h ? h : prev));
    };
    queueMicrotask(measure);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [summaryPillVisible, profile?.role]);

  // Auth Guard Redirect: never reveal map before Firebase Auth + Profile registration
  useEffect(() => {
    if (authLoading) return;
    if (!firebaseReady || !firebaseUser) {
      router.replace("/login");
    } else if (needsRegistration || !profile) {
      router.replace("/register");
    }
  }, [authLoading, firebaseReady, firebaseUser, profile, needsRegistration, router]);

  // Firestore listener for confidential enterprise assets (enterprise owner OR gov emergency shared ONLY)
  useEffect(() => {
    if (!isAuthenticated || !profile || profile.role === "citizen") {
      queueMicrotask(() => setEnterpriseAssets([]));
      return;
    }
    const db = getFirebaseDb();
    if (!db) return;

    const col = collection(db, "enterprise_assets");
    const q =
      profile.role === "government"
        ? query(
            col,
            where("confidentialityLevel", "==", "gov_emergency_share"),
            orderBy("createdAt", "desc"),
            limit(50)
          )
        : query(
            col,
            where("ownerUid", "==", profile.uid),
            orderBy("createdAt", "desc"),
            limit(50)
          );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: EnterpriseAsset[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerUid: String(data.ownerUid || ""),
            organizationName: String(data.organizationName || ""),
            name: String(data.name || ""),
            assetType: (data.assetType as EnterpriseAssetType) || "server_room",
            confidentialityLevel:
              (data.confidentialityLevel as EnterpriseConfidentiality) ||
              "enterprise_only",
            wardName: String(data.wardName || "京都市"),
            lat: Number(data.lat || 0),
            lon: Number(data.lon || 0),
            floorInfo: typeof data.floorInfo === "string" ? data.floorInfo : "",
            backupHours:
              typeof data.backupHours === "number" ? data.backupHours : null,
            notes: typeof data.notes === "string" ? data.notes : "",
          };
        });
        setEnterpriseAssets(list);
      },
      (err) => {
        console.warn("Confidential assets subscription skipped:", err);
      }
    );
    return () => unsub();
  }, [isAuthenticated, profile]);

  // Firestore one-shot load of user personal favorite ward preference (max 1 read per session)
  useEffect(() => {
    if (!isAuthenticated || !profile) {
      loadedPrefsUidRef.current = null;
      manualWardChangedRef.current = false;
      queueMicrotask(() => setFavoriteWard(null));
      return;
    }
    if (loadedPrefsUidRef.current === profile.uid) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) return;

    loadedPrefsUidRef.current = profile.uid;
    let cancelled = false;
    getDoc(doc(db, "user_preferences", profile.uid))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const data = snap.data();
        const saved =
          typeof data?.favoriteWard === "string" ? data.favoriteWard : null;
        if (!saved) return;
        setFavoriteWard(saved);
        if (
          !manualWardChangedRef.current &&
          (saved === "all" || Boolean(WARD_CENTERS[saved]))
        ) {
          setSelectedWard(saved);
          if (saved !== "all") {
            const center = WARD_CENTERS[saved];
            if (center) {
              setFlyToTarget({ ...center, ts: Date.now() });
            }
          }
        }
      })
      .catch((err) => {
        console.warn("User preferences read skipped:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, profile]);

  // Initial load: health, metadata, meshes, earthquakes (strictly post-auth)
  useEffect(() => {
    if (!isAuthenticated) return;
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
  }, [isAuthenticated]);

  // Load / refresh Board Summary, Damage Reports & Road Network Status (strictly post-auth)
  useEffect(() => {
    if (!isAuthenticated) return;
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
  }, [isAuthenticated, selectedWard, includeSamples, disasterNonce]);

  // Refresh building/hazard stats whenever filters change (strictly post-auth)
  useEffect(() => {
    if (!isAuthenticated) return;
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
  }, [isAuthenticated, selectedWard, ageCategories, hazardTiers, usageGroup, selectedMeshcode]);

  // Refresh priority areas (strictly post-auth)
  useEffect(() => {
    if (!isAuthenticated) return;
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
  }, [isAuthenticated, selectedWard, hazardTiers, usageGroup, sortBy]);

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
    setSelectedBcpSite(null);
    setSelectedHeritageMesh(null);
    setSelectedBeltHotspot(null);
    setSelectedReport(null);
    setSelectedBlockedRoad(null);
    setSelectedShelterHub(null);
    setSelectedOfficialShelter(null);
    setSelectedR8Facility(null);
    setSelectedR8Unlisted(null);
    setReverseAddress(null);
  }, []);

  const handleSelectR8Record = useCallback(
    (loc: R8LocateResponse) => {
      clearSelections();
      setSelectedR8Facility(loc);
      if (loc.hazard?.meshcode) setSelectedMeshcode(loc.hazard.meshcode);
      setFlyToTarget({
        lat: loc.lat,
        lon: loc.lon,
        zoom: 17.0,
        ts: Date.now(),
      });
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setActivePanel("none");
      }
    },
    [clearSelections]
  );

  const handleSelectR8Unlisted = useCallback(
    (loc: R8UnlistedLocateResponse) => {
      clearSelections();
      setSelectedR8Unlisted(loc);
      if (loc.hazard?.meshcode) setSelectedMeshcode(loc.hazard.meshcode);
      setFlyToTarget({
        lat: loc.lat,
        lon: loc.lon,
        zoom: 16.5,
        ts: Date.now(),
      });
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setActivePanel("none");
      }
    },
    [clearSelections]
  );

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
    if (!isAuthenticated || activePanel !== "shelter") return;
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
    isAuthenticated,
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
          mode: "evacuate",
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
      setShowRoadClosures(true);
      setActivePanel("shelter");
      setShelterLoading(true);
      setShelterError(null);
      void autoSelectOptimalShelter({
        lat: target.lat,
        lon: target.lon,
        scenario: "auto",
        includeSamples,
        avoidUnverified: shelterAvoidUnverified,
        limit: 5,
      })
        .then((res) => {
          setAutoShelterResult(res);
          setShelterRecommendation(res);
          setShelterScenario(res.auto_detected_scenario);
          if (res.selected_shelter) {
            setSelectedRecShelterId(res.selected_shelter.id);
            setSelectedOfficialShelter(res.selected_shelter);
            setRouteResult(res.selected_shelter.nav_route);
            setFlyToTarget({
              lat: res.selected_shelter.lat,
              lon: res.selected_shelter.lon,
              zoom: 14.8,
              ts: Date.now(),
            });
          }
        })
        .catch((err) => {
          setShelterError(
            err instanceof Error ? err.message : "最適避難場所の自動選定に失敗しました。"
          );
        })
        .finally(() => {
          setShelterLoading(false);
        });
    },
    [clearSelections, includeSamples, shelterAvoidUnverified]
  );

  const handleAutoSelectNow = useCallback(() => {
    const activeTarget = selectedBuilding
      ? {
          lat: selectedBuilding.centroid_lat,
          lon: selectedBuilding.centroid_lon,
          label: `${selectedBuilding.ward_name} 建物 ${selectedBuilding.building_id}`,
        }
      : selectedMesh
        ? {
            lat: selectedMesh.centroid_lat,
            lon: selectedMesh.centroid_lon,
            label: `${selectedMesh.ward_name} メッシュ ${selectedMesh.meshcode}`,
          }
        : searchPin
          ? {
              lat: searchPin.lat,
              lon: searchPin.lon,
              label: searchPin.title,
            }
          : null;

    if (activeTarget) {
      handleRecommendFromTarget(activeTarget);
      return;
    }

    const fallbackOrigin =
      selectedWard !== "all" && WARD_CENTERS[selectedWard]
        ? {
            lat: WARD_CENTERS[selectedWard].lat,
            lon: WARD_CENTERS[selectedWard].lon,
            label: `${selectedWard} 中心付近`,
          }
        : shelterOrigin;

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      setShelterLoading(true);
      setShelterError(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(5));
          const lon = Number(pos.coords.longitude.toFixed(5));
          handleRecommendFromTarget({ lat, lon, label: `GPS現在地 (${lat}, ${lon})` });
        },
        () => {
          handleRecommendFromTarget(fallbackOrigin);
        },
        { enableHighAccuracy: true, timeout: 2500 }
      );
      return;
    }

    handleRecommendFromTarget(fallbackOrigin);
  }, [
    selectedBuilding,
    selectedMesh,
    searchPin,
    selectedWard,
    shelterOrigin,
    handleRecommendFromTarget,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !autoLiveShelterMode) return;
    let cancelled = false;
    autoSelectOptimalShelter({
      lat: shelterOrigin.lat,
      lon: shelterOrigin.lon,
      scenario: "auto",
      includeSamples,
      avoidUnverified: shelterAvoidUnverified,
      limit: 5,
    })
      .then((res) => {
        if (cancelled) return;
        setAutoShelterResult(res);
        setShelterRecommendation(res);
        setShelterScenario(res.auto_detected_scenario);
        if (res.selected_shelter) {
          setSelectedRecShelterId(res.selected_shelter.id);
          setSelectedOfficialShelter(res.selected_shelter);
          setRouteResult(res.selected_shelter.nav_route);
        }
      })
      .catch(() => {
        // ignore background live re-evaluation error
      });
    return () => {
      cancelled = true;
    };
  }, [
    isAuthenticated,
    autoLiveShelterMode,
    shelterOrigin.lat,
    shelterOrigin.lon,
    includeSamples,
    shelterAvoidUnverified,
    disasterNonce,
    reports.length,
    networkStatus?.blocked_count,
  ]);

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

  useEffect(() => {
    if (!isAuthenticated || activePanel !== "updates") return;
    let cancelled = false;
    getDisasterUpdates({ period: updatesPeriod, kind: "all" })
      .then((res) => {
        if (cancelled) return;
        setUpdatesData(res);
        setUpdatesError(null);
        setUpdatesLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setUpdatesError(
          err instanceof Error ? err.message : "防災アップデート情報の取得に失敗しました。"
        );
        setUpdatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, activePanel, updatesPeriod]);

  const handleRefreshUpdatesLive = useCallback(async () => {
    setUpdatesRefreshing(true);
    setUpdatesError(null);
    setUpdatesRefreshMsg(null);
    try {
      await refreshDisasterUpdates();
      const filtered = await getDisasterUpdates({ period: updatesPeriod, kind: "all" });
      setUpdatesData(filtered);
      setUpdatesRefreshMsg(
        `気象庁・Yahoo!地震履歴・京都市公式ポータルを最新同期しました（地震 ${filtered.counts.total_earthquakes}件 / 市更新 ${filtered.counts.total_municipality_updates}件）`
      );
    } catch (err) {
      setUpdatesError(
        err instanceof Error ? err.message : "ライブアップデートに失敗しました。"
      );
    } finally {
      setUpdatesRefreshing(false);
    }
  }, [updatesPeriod]);

  const handleFocusArchiveEarthquake = useCallback((eq: KyotoEarthquakeArchiveItem) => {
    if (eq.lat == null || eq.lon == null) return;
    setShowEarthquakes(true);
    setEarthquakes((prev) => {
      if (prev.some((p) => p.eid === eq.id)) return prev;
      return [
        {
          eid: eq.id,
          at: eq.occurred_at,
          anm: eq.epicenter,
          ttl: eq.source,
          mag: eq.mag,
          maxi: eq.maxi,
          lat: eq.lat as number,
          lon: eq.lon as number,
          depth_km: eq.depth_km,
        },
        ...prev,
      ];
    });
    setFlyToTarget({ lat: eq.lat, lon: eq.lon, zoom: 11.8, ts: Date.now() });
  }, []);

  const handleSelectWard = useCallback((ward: string) => {
    manualWardChangedRef.current = true;
    setSelectedWard(ward);
    setSelectedMeshcode(null);
    setSelectedMesh(null);
    const center = WARD_CENTERS[ward] || WARD_CENTERS.all;
    setFlyToTarget({ ...center, ts: Date.now() });
  }, []);

  const handleToggleSaveFavoriteWard = useCallback(async () => {
    if (!profile || !firebaseUser) return;
    const db = getFirebaseDb();
    if (!db) return;
    setSavingFavoriteWard(true);
    try {
      const prefRef = doc(db, "user_preferences", profile.uid);
      if (favoriteWard === selectedWard) {
        await deleteDoc(prefRef);
        setFavoriteWard(null);
      } else {
        await setDoc(
          prefRef,
          {
            uid: profile.uid,
            favoriteWard: selectedWard,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        setFavoriteWard(selectedWard);
      }
    } catch (err) {
      console.warn("User preferences write skipped:", err);
    } finally {
      setSavingFavoriteWard(false);
    }
  }, [profile, firebaseUser, favoriteWard, selectedWard]);

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
    setSearchPin(null);
    setSearchCandidates([]);
    clearSelections();
    setFlyToTarget({ ...WARD_CENTERS.all, ts: Date.now() });
  }, [clearSelections]);

  const loadReverseAddress = useCallback(async (lat: number, lon: number) => {
    const seq = ++reverseReqSeqRef.current;
    try {
      const rev = await reverseGeocode(lat, lon);
      if (seq === reverseReqSeqRef.current) {
        setReverseAddress(rev);
      }
    } catch {
      // ignore transient geocoder error
    }
  }, []);

  const handleSelectBuilding = useCallback(
    async (buildingId: string) => {
      clearSelections();
      try {
        const detail = await getBuildingDetail(buildingId);
        setSelectedBuilding(detail);
        void loadReverseAddress(detail.centroid_lat, detail.centroid_lon);
      } catch {
        // ignore
      }
    },
    [clearSelections, loadReverseAddress]
  );

  const handleSelectMesh = useCallback(
    async (meshcode: string) => {
      clearSelections();
      setSelectedMeshcode(meshcode);
      try {
        const detail = await getMeshDetail(meshcode);
        setSelectedMesh(detail);
        void loadReverseAddress(detail.centroid_lat, detail.centroid_lon);
      } catch {
        // ignore
      }
    },
    [clearSelections, loadReverseAddress]
  );

  const handleSelectBcpSite = useCallback(
    async (site: BcpSiteCandidate) => {
      clearSelections();
      setSelectedBcpSite(site);
      setSelectedMeshcode(site.meshcode);
      setFlyToTarget({
        lat: site.centroid_lat,
        lon: site.centroid_lon,
        zoom: 15.8,
        ts: Date.now(),
      });
      try {
        const detail = await getMeshDetail(site.meshcode);
        setSelectedMesh(detail);
        void loadReverseAddress(site.centroid_lat, site.centroid_lon);
      } catch {
        // ignore mesh detail fallback
      }
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setActivePanel("none");
      }
    },
    [clearSelections, loadReverseAddress]
  );

  const handleSelectHeritageMesh = useCallback(
    async (mesh: HistoricResidentialMeshCandidate) => {
      clearSelections();
      setSelectedHeritageMesh(mesh);
      setSelectedMeshcode(mesh.meshcode);
      setShowHazardMesh(true);
      setFlyToTarget({
        lat: mesh.centroid_lat,
        lon: mesh.centroid_lon,
        zoom: 15.8,
        ts: Date.now(),
      });
      try {
        const detail = await getMeshDetail(mesh.meshcode);
        setSelectedMesh(detail);
        void loadReverseAddress(mesh.centroid_lat, mesh.centroid_lon);
      } catch {
        // ignore mesh detail fallback
      }
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setActivePanel("none");
      }
    },
    [clearSelections, loadReverseAddress]
  );

  const handleSelectHeritageBuilding = useCallback(
    async (bldg: HistoricResidentialSampleBuilding) => {
      clearSelections();
      setShowBuildings(true);
      setSelectedMeshcode(bldg.meshcode);
      setFlyToTarget({
        lat: bldg.centroid_lat,
        lon: bldg.centroid_lon,
        zoom: 17.2,
        ts: Date.now(),
      });
      try {
        const detail = await getBuildingDetail(bldg.building_id);
        setSelectedBuilding(detail);
        void loadReverseAddress(detail.centroid_lat, detail.centroid_lon);
      } catch {
        // ignore
      }
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setActivePanel("none");
      }
    },
    [clearSelections, loadReverseAddress]
  );

  const handleSeismicBeltsLoaded = useCallback(
    (geojson: GeoJSON.FeatureCollection | null, activeBeltId: string | null) => {
      setSeismicBeltsGeoJson(geojson);
      setActiveSeismicBeltId(activeBeltId);
    },
    []
  );

  const handleSelectSeismicBelt = useCallback((belt: SeismicBeltImpactItem) => {
    setShowHazardMesh(true);
    setFlyToTarget({
      lat: belt.focus_lat,
      lon: belt.focus_lon,
      zoom: belt.id === "nankai_trough" ? 12.2 : 13.4,
      ts: Date.now(),
    });
  }, []);

  const handleSelectMultiBeltHotspot = useCallback(
    async (hotspot: MultiBeltHotspot) => {
      clearSelections();
      setSelectedBeltHotspot(hotspot);
      setSelectedMeshcode(hotspot.meshcode);
      setShowHazardMesh(true);
      setFlyToTarget({
        lat: hotspot.centroid_lat,
        lon: hotspot.centroid_lon,
        zoom: 15.6,
        ts: Date.now(),
      });
      try {
        const detail = await getMeshDetail(hotspot.meshcode);
        setSelectedMesh(detail);
        void loadReverseAddress(hotspot.centroid_lat, hotspot.centroid_lon);
      } catch {
        // ignore mesh detail fallback
      }
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setActivePanel("none");
      }
    },
    [clearSelections, loadReverseAddress]
  );

  const handleSelectSearchResult = useCallback(
    async (item: LocationSearchResult, allCandidates?: LocationSearchResult[]) => {
      clearSelections();
      setDisplayOpen(false);
      setSearchPin(item);
      if (allCandidates) {
        setSearchCandidates(allCandidates);
      }

      if (item.kind === "shelter") {
        setShowOfficialShelters(true);
      } else if (item.kind === "building" && item.building_id) {
        setShowBuildings(true);
        try {
          const detail = await getBuildingDetail(item.building_id);
          setSelectedBuilding(detail);
          void loadReverseAddress(detail.centroid_lat, detail.centroid_lon);
        } catch {
          // ignore
        }
      } else if (item.kind === "mesh" && item.meshcode) {
        setSelectedMeshcode(item.meshcode);
        setShowHazardMesh(true);
        try {
          const detail = await getMeshDetail(item.meshcode);
          setSelectedMesh(detail);
          void loadReverseAddress(detail.centroid_lat, detail.centroid_lon);
        } catch {
          // ignore
        }
      }

      setFlyToTarget({
        lon: item.lon,
        lat: item.lat,
        zoom: item.zoom || 16.0,
        bbox: item.bbox ?? null,
        ts: Date.now(),
      });
    },
    [clearSelections, loadReverseAddress]
  );

  const handleFocusSearchPin = useCallback(
    (item: LocationSearchResult) => {
      clearSelections();
      setSearchPin(item);
      setFlyToTarget({
        lon: item.lon,
        lat: item.lat,
        zoom: Math.max(currentMapZoom, item.zoom || 15.8),
        bbox: item.bbox ?? null,
        ts: Date.now(),
      });
    },
    [clearSelections, currentMapZoom]
  );

  const handleClearSearch = useCallback(() => {
    setSearchPin(null);
    setSearchCandidates([]);
  }, []);

  const handleZoomToSearchPlace = useCallback((place: LocationSearchResult) => {
    setShowBuildings(true);
    setFlyToTarget({
      lon: place.lon,
      lat: place.lat,
      zoom: 17.2,
      bbox: null,
      ts: Date.now(),
    });
  }, []);

  const handleReportFromSearchPlace = useCallback((place: LocationSearchResult) => {
    setPickedReportTarget({
      lat: place.lat,
      lon: place.lon,
      wardName: place.ward_name || place.kyoto_context?.ward_name || null,
      meshcode: place.meshcode || place.kyoto_context?.meshcode || null,
      buildingId: place.building_id ?? null,
      roadName: place.address || place.title,
    });
    setReportCreateTrigger((n) => n + 1);
    setShowReports(true);
    setActivePanel("report");
    setDisplayOpen(false);
  }, []);

  const handleNavigateFromSearchPlace = useCallback(
    async (place: LocationSearchResult, mode: "evacuate" | "rescue") => {
      const navParams: Parameters<typeof simulateNavigation>[0] =
        mode === "evacuate"
          ? {
              mode: "evacuate",
              startLat: place.lat,
              startLon: place.lon,
              includeSamples,
              avoidUnverified: true,
            }
          : {
              mode: "rescue",
              targetLat: place.lat,
              targetLon: place.lon,
              includeSamples,
              avoidUnverified: true,
            };
      if (mode === "evacuate") {
        setPickedEvacuateCoords({ lat: place.lat, lon: place.lon, label: place.title });
      } else {
        setPickedRescueCoords({ lat: place.lat, lon: place.lon, label: place.title });
      }
      try {
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
    [includeSamples]
  );

  const handleRouteToSearchedShelter = useCallback(
    async (shelterId: string) => {
      const match = officialShelters.find((s) => s.id === shelterId);
      if (match) {
        await handleRouteToOfficialShelter(match);
      }
    },
    [officialShelters, handleRouteToOfficialShelter]
  );

  const handleSelectNearbyShelterById = useCallback(
    (shelterId: string) => {
      const match = officialShelters.find((s) => s.id === shelterId);
      if (!match) return;
      clearSelections();
      setShowOfficialShelters(true);
      setSelectedOfficialShelter(match);
      setFlyToTarget({
        lon: match.lon,
        lat: match.lat,
        zoom: 16.2,
        bbox: null,
        ts: Date.now(),
      });
    },
    [officialShelters, clearSelections]
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
      const canBypass = profile?.role === "government";
      const code = canBypass
        ? undefined
        : authMap[reportId] || window.prompt("通行止めを解除するための暗証番号を入力してください");
      if (code === null) return;
      try {
        await updateDamageReport(reportId, {
          passcode: code || undefined,
          resolved: true,
        });
        clearSelections();
        await handleRoadClosuresChanged();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "通行止めの解除に失敗しました。");
      }
    },
    [profile?.role, clearSelections, handleRoadClosuresChanged]
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
        return;
      }

      if (mapPickMode === "enterprise_asset") {
        setMapPickMode("none");
        setPickedEnterpriseCoords({ lat: target.lat, lon: target.lon });
        setActivePanel("assets");
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
      if (action.type === "clear_agent_pins") {
        setAgentPins([]);
        setSelectedAgentPin(null);
        return;
      }

      if (action.type === "set_agent_pins" && action.pins) {
        const incoming = action.pins.filter(
          (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)
        );
        setAgentPins((prev) => {
          if (action.replace) return incoming;
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const p of incoming) {
            byId.set(p.id, p);
          }
          return Array.from(byId.values());
        });
        if (incoming.length > 0) {
          setSelectedAgentPin(incoming[0]);
        }
        return;
      }

      if (action.type === "configure_map_layers") {
        if (typeof action.show_hazard_mesh === "boolean") {
          setShowHazardMesh(action.show_hazard_mesh);
        }
        if (action.mesh_overlay_mode) {
          setMeshOverlayMode(action.mesh_overlay_mode);
        }
        if (typeof action.show_buildings === "boolean") {
          setShowBuildings(action.show_buildings);
        }
        if (typeof action.show_official_shelters === "boolean") {
          setShowOfficialShelters(action.show_official_shelters);
        }
        if (typeof action.show_road_closures === "boolean") {
          setShowRoadClosures(action.show_road_closures);
        }
        if (typeof action.show_reports === "boolean") {
          setShowReports(action.show_reports);
        }
        if (typeof action.map_3d === "boolean") {
          setMap3DMode(action.map_3d ? "3d" : "auto");
        }
        if (action.visual_preset) {
          setVisualPreset(action.visual_preset);
        }
        if (
          action.open_panel &&
          (action.open_panel !== "assets" || profile?.role === "enterprise")
        ) {
          setActivePanel(action.open_panel);
        }
        return;
      }

      if (action.type === "fly_to_location" && action.lat != null && action.lon != null) {
        setFlyToTarget({
          lon: action.lon,
          lat: action.lat,
          zoom: action.zoom ?? 15.6,
          ts: Date.now(),
        });
        return;
      }

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

      if (
        action.type === "navigate_evacuation" &&
        action.start_lat != null &&
        action.start_lon != null
      ) {
        try {
          const navParams = {
            mode: "evacuate" as const,
            startLat: action.start_lat,
            startLon: action.start_lon,
            targetLat: action.target_lat,
            targetLon: action.target_lon,
            includeSamples,
            avoidUnverified: true,
          };
          setLastNavParams(navParams);
          const res = await simulateNavigation(navParams);
          setRouteResult(res);
          setShowRoadClosures(true);
          setShowOfficialShelters(true);
          const dest = res.destination;
          setFlyToTarget({
            lon: dest?.lon ?? action.target_lon ?? action.start_lon,
            lat: dest?.lat ?? action.target_lat ?? action.start_lat,
            zoom: action.zoom ?? 14.6,
            ts: Date.now(),
          });
        } catch {
          if (action.target_lat != null && action.target_lon != null) {
            setFlyToTarget({
              lon: action.target_lon,
              lat: action.target_lat,
              zoom: action.zoom ?? 14.6,
              ts: Date.now(),
            });
          }
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
    [includeSamples, profile?.role]
  );

  const handleExecuteMapActionsBatch = useCallback(
    async (actions: MapAction[]) => {
      if (!actions || actions.length === 0) return;

      for (const act of actions) {
        if (
          act.type === "clear_agent_pins" ||
          act.type === "set_agent_pins" ||
          act.type === "configure_map_layers"
        ) {
          await handleExecuteMapAction(act);
        }
      }

      const navAct = actions.find(
        (a) => a.type === "navigate_evacuation" || a.type === "show_route_simulation"
      );
      if (navAct) {
        await handleExecuteMapAction(navAct);
        return;
      }

      const camAct = actions.find(
        (a) =>
          a.type === "fly_to_location" ||
          a.type === "focus_building" ||
          a.type === "fly_to_mesh" ||
          a.type === "focus_report" ||
          a.type === "fly_to_ward"
      );
      if (camAct) {
        await handleExecuteMapAction(camAct);
        return;
      }

      const pinAct = actions.find(
        (a) => a.type === "set_agent_pins" && a.pins && a.pins.length > 0
      );
      if (pinAct?.pins?.[0]) {
        setFlyToTarget({
          lon: pinAct.pins[0].lon,
          lat: pinAct.pins[0].lat,
          zoom: 14.8,
          ts: Date.now(),
        });
      }
    },
    [handleExecuteMapAction]
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const raw = window.sessionStorage.getItem(PENDING_BOARD_MAP_ACTIONS_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(PENDING_BOARD_MAP_ACTIONS_KEY);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        queueMicrotask(() => {
          void handleExecuteMapActionsBatch(parsed as MapAction[]);
        });
      }
    } catch {
      // ignore storage errors
    }
  }, [isAuthenticated, handleExecuteMapActionsBatch]);

  const wards = metadata?.wards ?? Object.keys(WARD_CENTERS).filter((k) => k !== "all");
  const blockedCount = networkStatus?.blocked_count ?? 0;

  if (authLoading || !isAuthenticated || !profile) {
    return (
      <div className="flex h-[100dvh] w-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-6 py-4 shadow-xl">
          <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
          <span className="text-sm font-medium">
            認証確認中...（未ログインの場合はログイン画面へ移動します）
          </span>
        </div>
      </div>
    );
  }

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
        enterpriseAssets={enterpriseAssets}
        onSelectEnterpriseAsset={(asset) => {
          setFlyToTarget({ lon: asset.lon, lat: asset.lat, zoom: 16.5, ts: Date.now() });
          if (profile.role === "enterprise") {
            setActivePanel("assets");
          } else if (profile.role === "government") {
            setStatsTab("shared_assets");
            setActivePanel("stats");
          }
        }}
        agentPins={agentPins}
        onSelectAgentPin={(pin) => {
          setSelectedAgentPin(pin);
          setFlyToTarget({ lon: pin.lon, lat: pin.lat, zoom: 16.0, ts: Date.now() });
        }}
        map3DMode={map3DMode}
        onChangeMap3DMode={setMap3DMode}
        onPitch3DChange={setIsPitch3D}
        selectedBuildingId={
          selectedBuilding?.building_id ??
          selectedR8Facility?.matched_building_id ??
          searchPin?.building_id ??
          null
        }
        selectedMeshcode={selectedMeshcode}
        highlightedTarget={
          selectedBuilding
            ? {
                lat: selectedBuilding.centroid_lat,
                lon: selectedBuilding.centroid_lon,
                label: `${selectedBuilding.ward_name}（${selectedBuilding.usage_label}）`,
                subLabel:
                  selectedBuilding.r8_seismic_assessment?.priority_badge ||
                  `${selectedBuilding.age_label}・${selectedBuilding.structure_label}`,
                tone:
                  selectedBuilding.r8_seismic_assessment?.priority_tier === "critical"
                    ? "rose"
                    : "amber",
              }
            : selectedR8Facility
              ? {
                  lat: selectedR8Facility.lat,
                  lon: selectedR8Facility.lon,
                  label: selectedR8Facility.record.name,
                  subLabel: `耐震性能: ${selectedR8Facility.record.seismic_grade}（${selectedR8Facility.record.ward}）`,
                  tone: selectedR8Facility.record.needs_retrofit ? "rose" : "amber",
                }
              : selectedR8Unlisted
                ? {
                    lat: selectedR8Unlisted.lat,
                    lon: selectedR8Unlisted.lon,
                    label: selectedR8Unlisted.query,
                    subLabel: "R8表未掲載（優先耐震対象）",
                    tone: "rose",
                  }
                : selectedBcpSite
                  ? {
                      lat: selectedBcpSite.centroid_lat,
                      lon: selectedBcpSite.centroid_lon,
                      label: `BCP推奨${selectedBcpSite.rank}位: ${selectedBcpSite.ward_name} (${selectedBcpSite.jname})`,
                      subLabel: `安全度 ${selectedBcpSite.safety_score}点 / ARV ${selectedBcpSite.arv.toFixed(2)}`,
                      tone: "emerald",
                    }
                  : selectedHeritageMesh
                    ? {
                        lat: selectedHeritageMesh.centroid_lat,
                        lon: selectedHeritageMesh.centroid_lon,
                        label: `重点対策${selectedHeritageMesh.rank}位(${selectedHeritageMesh.dominant_priority}): ${selectedHeritageMesh.ward_name}`,
                        subLabel: `〜1950歴史 ${selectedHeritageMesh.historic_pre1950_count}棟 / 旧耐震住宅 ${selectedHeritageMesh.pre_1981_residential_count}棟`,
                        tone: "amber",
                      }
                    : selectedBeltHotspot
                      ? {
                          lat: selectedBeltHotspot.centroid_lat,
                          lon: selectedBeltHotspot.centroid_lon,
                          label: `複数断層重複(${selectedBeltHotspot.belt_count}帯): ${selectedBeltHotspot.ward_name}`,
                          subLabel: selectedBeltHotspot.overlapping_belts
                            .map((b) => b.short_name)
                            .join("・"),
                          tone: "rose",
                        }
                      : selectedOfficialShelter
                    ? {
                        lat: selectedOfficialShelter.lat,
                        lon: selectedOfficialShelter.lon,
                        label: selectedOfficialShelter.name,
                        subLabel: selectedOfficialShelter.is_wide_area
                          ? "広域避難場所"
                          : "指定緊急避難場所",
                        tone: "emerald",
                      }
                    : null
        }
        flyToTarget={flyToTarget}
        searchPin={searchPin}
        searchCandidates={searchCandidates}
        onSelectSearchPin={handleFocusSearchPin}
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
        drawerOpen={activePanel !== "none"}
        summaryPillVisible={summaryPillVisible}
        summaryPillHeight={summaryPillHeight}
        seismicBeltsGeoJson={
          activePanel === "stats" && statsTab === "seismic_belts" ? seismicBeltsGeoJson : null
        }
        activeSeismicBeltId={activeSeismicBeltId}
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
        favoriteWard={favoriteWard}
        onToggleSaveFavoriteWard={() => void handleToggleSaveFavoriteWard()}
        savingFavoriteWard={savingFavoriteWard}
        displayOpen={displayOpen}
        onToggleDisplay={() => setDisplayOpen((o) => !o)}
        onOpenSources={() => setSourcesOpen(true)}
        reportCount={reportSummary?.total_reports ?? reports.length}
        boardCount={boardSummary?.total_entries ?? 0}
        blockedRoadCount={blockedCount}
        hasActiveRoute={Boolean(routeResult)}
        geminiConfigured={geminiConfigured}
        userRole={profile.role}
        userDisplayName={profile.display_name}
        organizationName={profile.organization_name}
        enterpriseAssetCount={enterpriseAssets.length}
        onLogout={() => void logout()}
      />

      {/* Google-Maps-Style Address & Place Search Bar */}
      <LocationSearchBar
        activeSearchPlace={searchPin}
        candidateCount={searchCandidates.length}
        drawerOpen={activePanel !== "none"}
        hidden={roadPaintTool !== "none" || mapPickMode !== "none"}
        onSelectResult={(item, all) => void handleSelectSearchResult(item, all)}
        onClearSearch={handleClearSearch}
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
        map3DMode={map3DMode}
        onChangeMap3DMode={setMap3DMode}
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
                    : activePanel === "updates"
                      ? "気象庁・自治体 防災情報アップデート"
                      : activePanel === "nav"
                        ? profile.role === "government"
                          ? "避難・救援ルート案内"
                          : "避難・迂回ルート案内"
                        : activePanel === "assets"
                          ? "企業・非公開重要施設保護（サーバー室・DC）"
                          : activePanel === "ai"
                            ? "Gemini AI 状況分析"
                            : statsTab === "bcp" && profile.role === "enterprise"
                              ? "企業BCP・重要施設 安全立地候補"
                              : statsTab === "heritage"
                                ? "歴史的建物 × 住宅系 優先順位と解決策"
                                : statsTab === "seismic_belts"
                                  ? "京都市11地震帯 影響・関係性分析"
                                  : statsTab === "shared_assets" && profile.role === "government"
                                  ? "政府連携共有・企業重要拠点"
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
                userRole={profile.role}
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
                onDispatchRescue={
                  profile.role === "government"
                    ? (rep) => void handleDispatchRescueToReport(rep)
                    : undefined
                }
                onReportsChanged={() => void handleRoadClosuresChanged()}
                onOpenRouteSimulator={() => setActivePanel("nav")}
                startInCreateMode={reportCreateTrigger > 0}
              />
            )}

            {activePanel === "safety" && (
              <DisasterBoard
                userRole={profile.role}
                embedded
                wards={wards}
                defaultWard={selectedWard}
                defaultMeshcode={selectedMeshcode}
                includeSamples={includeSamples}
                onToggleIncludeSamples={setIncludeSamples}
                onFocusArea={handleFocusBoardArea}
                onSelectWardFilter={handleSelectWard}
                onDataMutated={triggerDisasterRefresh}
                onExecuteMapActions={(acts) => void handleExecuteMapActionsBatch(acts)}
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
                  autoSelection={autoShelterResult}
                  autoLiveMode={autoLiveShelterMode}
                  onToggleAutoLiveMode={setAutoLiveShelterMode}
                  onAutoSelectNow={handleAutoSelectNow}
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
                userRole={profile.role}
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

            {activePanel === "assets" && profile.role === "enterprise" && (
              <div className="p-3.5">
                <EnterpriseAssetsPanel
                  userUid={profile.uid}
                  userRole={profile.role}
                  organizationName={profile.organization_name}
                  pickedCoords={pickedEnterpriseCoords}
                  pickActive={mapPickMode === "enterprise_asset"}
                  onRequestMapPick={() => setMapPickMode("enterprise_asset")}
                  onCancelMapPick={() => setMapPickMode("none")}
                  onFocusAsset={(asset) => {
                    setFlyToTarget({
                      lon: asset.lon,
                      lat: asset.lat,
                      zoom: 16.5,
                      ts: Date.now(),
                    });
                  }}
                />
              </div>
            )}

            <div className={activePanel === "ai" ? "h-full" : "hidden"}>
              <AiAssistantPanel
                key={`${profile.uid}:${profile.role}`}
                userUid={profile.uid}
                userRole={profile.role}
                enterpriseAssets={profile.role === "citizen" ? undefined : enterpriseAssets}
                geminiConfigured={geminiConfigured}
                aiProtection={aiProtection}
                totalBuildings={metadata?.counts.total_buildings ?? stats?.total_buildings}
                onRefreshHealth={handleRefreshHealth}
                selectedWard={selectedWard}
                ageCategories={ageCategories}
                hazardTiers={hazardTiers}
                usageGroup={usageGroup}
                is3D={map3DMode === "3d" || isPitch3D}
                selectedBuilding={selectedBuilding}
                selectedMesh={selectedMesh}
                queuedPrompt={queuedAiPrompt}
                onConsumeQueuedPrompt={() => setQueuedAiPrompt(null)}
                onExecuteMapAction={handleExecuteMapAction}
                onExecuteMapActionsBatch={(acts) => void handleExecuteMapActionsBatch(acts)}
              />
            </div>

            {activePanel === "stats" && (
              <RiskStatsDrawer
                userRole={profile.role}
                userUid={profile.uid}
                organizationName={profile.organization_name}
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
                onSelectR8Record={handleSelectR8Record}
                onSelectR8Unlisted={handleSelectR8Unlisted}
                statsTab={statsTab}
                onChangeStatsTab={setStatsTab}
                onSelectBcpSite={(site) => void handleSelectBcpSite(site)}
                onSelectHeritageMesh={(m) => void handleSelectHeritageMesh(m)}
                onSelectHeritageBuilding={(b) => void handleSelectHeritageBuilding(b)}
                onSeismicBeltsLoaded={handleSeismicBeltsLoaded}
                onSelectSeismicBelt={handleSelectSeismicBelt}
                onSelectMultiBeltHotspot={(h) => void handleSelectMultiBeltHotspot(h)}
                onSelectEnterpriseAsset={(asset) => {
                  setFlyToTarget({
                    lon: asset.lon,
                    lat: asset.lat,
                    zoom: 16.5,
                    ts: Date.now(),
                  });
                }}
                onSelectWardFilter={handleSelectWard}
                onOpenSafety={() => setActivePanel("safety")}
                onOpenReports={() => setActivePanel("report")}
              />
            )}

            {activePanel === "updates" && (
              <DisasterUpdatesPanel
                data={updatesData}
                loading={updatesLoading}
                refreshing={updatesRefreshing}
                error={updatesError}
                refreshMessage={updatesRefreshMsg}
                period={updatesPeriod}
                onChangePeriod={(nextPeriod) => {
                  setUpdatesLoading(true);
                  setUpdatesPeriod(nextPeriod);
                }}
                onRefreshLive={() => void handleRefreshUpdatesLive()}
                onFocusEarthquake={handleFocusArchiveEarthquake}
              />
            )}
          </div>
        </aside>
      )}

      {/* Unobtrusive Bottom-Left Live Summary & Visual Key when Drawer Closed (Desktop) */}
      {summaryPillVisible && (
        <div
          ref={summaryPillRef}
          data-testid="map-summary-pill"
          className="pointer-events-auto fixed bottom-4 left-3 z-20 hidden max-w-[min(560px,calc(100vw-440px))] flex-col gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/90 px-4 py-3 text-xs text-slate-200 shadow-2xl backdrop-blur-xl xl:max-w-[600px] lg:flex"
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
              {profile.role === "enterprise" && (
                <button
                  type="button"
                  data-testid="summary-enterprise-bcp-btn"
                  onClick={() => {
                    setStatsTab("bcp");
                    setActivePanel("stats");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-100 hover:bg-emerald-500/35"
                >
                  <Building2 className="h-3 w-3 text-emerald-300" />
                  企業BCP適地
                </button>
              )}
              <button
                type="button"
                data-testid="summary-auto-shelter-btn"
                onClick={handleAutoSelectNow}
                className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-rose-500 to-amber-500 px-2.5 py-1 text-[11px] font-bold text-white hover:brightness-110"
              >
                <ShieldAlert className="h-3 w-3" />
                緊急自動避難
              </button>
              <button
                type="button"
                onClick={() => setActivePanel("nav")}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Compass className="h-3 w-3" />
                {profile.role === "government" ? "避難・救援ナビ" : "避難ナビ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Agent Pinned Locations Floating Control Pill */}
      {agentPins.length > 0 && !displayOpen && (
        <div
          data-testid="agent-pins-pill"
          className="pointer-events-auto fixed right-3 top-[68px] z-20 flex max-w-[min(320px,calc(100vw-24px))] items-center gap-2 rounded-2xl border border-emerald-500/50 bg-slate-900/95 px-3 py-1.5 text-[11px] text-emerald-100 shadow-2xl backdrop-blur-xl"
        >
          <Bot className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-white">
              {selectedAgentPin ? selectedAgentPin.label : `AIピン ${agentPins.length}件表示中`}
            </div>
            {selectedAgentPin?.description && (
              <div className="truncate text-[10px] text-emerald-200/90">
                {selectedAgentPin.description}
              </div>
            )}
          </div>
          <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
            <MapPin className="h-2.5 w-2.5" />
            {agentPins.length}
          </span>
          <button
            type="button"
            data-testid="clear-agent-pins-btn"
            aria-label="AIピンをクリア"
            onClick={() => {
              setAgentPins([]);
              setSelectedAgentPin(null);
            }}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Selected Building / Report / Blocked Road / Shelter Hub / Search Place / Active Route HUD */}
      <SelectedFeatureCard
        userRole={profile.role}
        selectedBuilding={selectedBuilding}
        selectedMesh={selectedMesh}
        selectedReport={selectedReport}
        selectedBlockedRoad={selectedBlockedRoad}
        selectedShelterHub={selectedShelterHub}
        selectedOfficialShelter={selectedOfficialShelter}
        selectedR8Facility={selectedR8Facility}
        selectedR8Unlisted={selectedR8Unlisted}
        selectedSearchPlace={searchPin}
        selectedReverseAddress={reverseAddress}
        routeResult={routeResult}
        onClearSelection={clearSelections}
        onClearSearchPlace={handleClearSearch}
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
        onZoomToSearchPlace={handleZoomToSearchPlace}
        onReportFromSearchPlace={handleReportFromSearchPlace}
        onNavigateFromSearchPlace={(place, mode) =>
          void handleNavigateFromSearchPlace(place, mode)
        }
        onRouteToSearchedShelter={(sid) => void handleRouteToSearchedShelter(sid)}
        onSelectNearbyShelterById={handleSelectNearbyShelterById}
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

      {/* Always-Movable Live2D ChatBot Launcher (auto-dodges bottom-right cards, display popover & freely draggable anywhere) */}
      {activePanel !== "ai" && (
        <DraggableMochimamoBot
          displayOpen={displayOpen}
          hasBottomRightCard={Boolean(
            selectedBuilding ||
              selectedMesh ||
              selectedReport ||
              selectedBlockedRoad ||
              selectedShelterHub ||
              selectedOfficialShelter ||
              selectedR8Facility ||
              selectedR8Unlisted ||
              searchPin ||
              reverseAddress ||
              routeResult
          )}
          onOpenAiChat={() => setActivePanel("ai")}
        />
      )}

      {/* Sources Modal */}
      <SourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} metadata={metadata} />
    </div>
  );
}
