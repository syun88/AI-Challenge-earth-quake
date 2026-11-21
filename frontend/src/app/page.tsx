"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  BarChart3,
  Map as MapIcon,
  MessageSquareHeart,
  Sparkles,
  X,
} from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { LeftFilterPanel } from "@/components/LeftFilterPanel";
import { QuakeMap } from "@/components/QuakeMap";
import { RightPanel, RightTab } from "@/components/RightPanel";
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
  getPriorityAreas,
  getStats,
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
  PriorityArea,
  RouteSimulationResponse,
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

  // Integrated Disaster Response State (Safety Board & Damage Reports & Routes)
  const [boardSummary, setBoardSummary] = useState<BoardSummaryResponse | null>(null);
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [reportSummary, setReportSummary] = useState<DamageReportSummaryResponse | null>(null);
  const [includeSamples, setIncludeSamples] = useState(true);
  const [disasterNonce, setDisasterNonce] = useState(0);
  const [routeResult, setRouteResult] = useState<RouteSimulationResponse | null>(null);

  // Filters & Layer state
  const [selectedWard, setSelectedWard] = useState<string>("all");
  const [ageCategories, setAgeCategories] = useState<AgeCategory[]>(DEFAULT_AGES);
  const [hazardTiers, setHazardTiers] = useState<HazardTier[]>(DEFAULT_HAZARDS);
  const [usageGroup, setUsageGroup] = useState<UsageGroup>("all");
  const [selectedMeshcode, setSelectedMeshcode] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("pre_1981_high_hazard");

  const [showBuildings, setShowBuildings] = useState(true);
  const [showHazardMesh, setShowHazardMesh] = useState(true);
  const [meshOverlayMode, setMeshOverlayMode] = useState<MeshOverlayMode>("hazard");
  const [showEarthquakes, setShowEarthquakes] = useState(false);
  const [showSafetyLayer, setShowSafetyLayer] = useState(true);
  const [showReports, setShowReports] = useState(true);
  const [is3D, setIs3D] = useState(false);

  // Selection, Picker & Responsive Layout State
  const [activeTab, setActiveTab] = useState<RightTab>("stats");
  const [mobilePane, setMobilePane] = useState<"map" | "panel">("map");
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingDetail | null>(null);
  const [selectedMesh, setSelectedMesh] = useState<MeshDetail | null>(null);
  const [selectedReport, setSelectedReport] = useState<DamageReport | null>(null);
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lon: number } | null>(null);

  const [flyToTarget, setFlyToTarget] = useState<{
    lon: number;
    lat: number;
    zoom: number;
    ts: number;
  } | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<{ text: string; ts: number } | null>(null);

  const wardsList =
    metadata?.wards || Object.keys(WARD_CENTERS).filter((k) => k !== "all");

  // Initial load: health, metadata, meshes, earthquakes
  useEffect(() => {
    (async () => {
      try {
        const [h, m, mj, eq] = await Promise.all([
          getHealth(),
          getMetadata(),
          getMeshesGeoJson("all"),
          getEarthquakes(40).catch(() => ({ earthquakes: [] })),
        ]);
        setGeminiConfigured(h.gemini_configured);
        setAiProtection(h.ai_protection ?? null);
        setMetadata(m);
        setMeshesGeoJson(mj);
        setEarthquakes(eq.earthquakes || []);
        setApiError(null);
      } catch (err) {
        setApiError(
          err instanceof Error
            ? `バックエンドAPIに接続できません（${err.message}）`
            : "バックエンドAPIに接続できません。"
        );
      }
    })();
  }, []);

  // Load / refresh Safety Board & Damage Reports whenever ward, sample toggle, or mutation changes
  useEffect(() => {
    (async () => {
      try {
        const [bSum, repList, repSum] = await Promise.all([
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
        ]);
        setBoardSummary(bSum);
        setReports(repList.reports);
        setReportSummary(repSum);
      } catch {
        // leave current state if backend unavailable
      }
    })();
  }, [selectedWard, includeSamples, disasterNonce]);

  const handleRefreshHealth = useCallback(async () => {
    try {
      const h = await getHealth();
      setGeminiConfigured(h.gemini_configured);
      setAiProtection(h.ai_protection ?? null);
    } catch {
      // ignore
    }
  }, []);

  // Refresh building/hazard stats whenever filters change
  useEffect(() => {
    (async () => {
      try {
        const s = await getStats({
          ward: selectedWard,
          ageCategories,
          hazardTiers,
          usageGroup,
          meshcode: selectedMeshcode,
        });
        setStats(s);
      } catch {
        // handled by top-level error banner
      }
    })();
  }, [selectedWard, ageCategories, hazardTiers, usageGroup, selectedMeshcode]);

  // Refresh priority areas
  useEffect(() => {
    (async () => {
      try {
        const res = await getPriorityAreas({
          ward: selectedWard,
          hazardTiers,
          usageGroup,
          sortBy,
          limit: 20,
        });
        setPriorityAreas(res.areas);
      } catch {
        // ignore
      }
    })();
  }, [selectedWard, hazardTiers, usageGroup, sortBy]);

  const triggerDisasterRefresh = useCallback(() => {
    setDisasterNonce((n) => n + 1);
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
    setSelectedMesh(null);
    setSelectedBuilding(null);
    setSelectedReport(null);
    setRouteResult(null);
    setFlyToTarget({ ...WARD_CENTERS.all, ts: Date.now() });
  }, []);

  const handleClearMeshcode = useCallback(() => {
    setSelectedMeshcode(null);
    setSelectedMesh(null);
  }, []);

  const openPanelTab = useCallback((tab: RightTab) => {
    setActiveTab(tab);
    setMobilePane("panel");
  }, []);

  const handleSelectBuilding = useCallback(async (buildingId: string) => {
    try {
      const detail = await getBuildingDetail(buildingId);
      setSelectedBuilding(detail);
      setActiveTab("detail");
      setMobilePane("panel");
    } catch {
      // ignore
    }
  }, []);

  const handleSelectMesh = useCallback(async (meshcode: string) => {
    setSelectedMeshcode(meshcode);
    try {
      const detail = await getMeshDetail(meshcode);
      setSelectedMesh(detail);
      setActiveTab("detail");
      setMobilePane("panel");
    } catch {
      // ignore
    }
  }, []);

  const handleSelectReportFromMap = useCallback((rep: DamageReport) => {
    setSelectedReport(rep);
    setActiveTab("detail");
    setMobilePane("panel");
  }, []);

  const handleSelectSafetyWardFromMap = useCallback((wardName: string) => {
    if (wardName && WARD_CENTERS[wardName]) {
      setSelectedWard(wardName);
    }
    setActiveTab("safety");
    setMobilePane("panel");
  }, []);

  const handleSelectPriorityArea = useCallback(
    async (area: PriorityArea) => {
      if (selectedMeshcode === area.meshcode) {
        setSelectedMeshcode(null);
        setSelectedMesh(null);
        return;
      }
      setSelectedMeshcode(area.meshcode);
      setFlyToTarget({
        lon: area.centroid_lon,
        lat: area.centroid_lat,
        zoom: 15.6,
        ts: Date.now(),
      });
      setMobilePane("map");
      try {
        const detail = await getMeshDetail(area.meshcode);
        setSelectedMesh(detail);
      } catch {
        // ignore
      }
    },
    [selectedMeshcode]
  );

  const handleRequestAiExplain = useCallback((prompt: string) => {
    setQueuedAiPrompt({ text: prompt, ts: Date.now() });
    setActiveTab("ai");
    setMobilePane("panel");
  }, []);

  const handleConsumeQueuedAiPrompt = useCallback(() => {
    setQueuedAiPrompt(null);
  }, []);

  const handleStartPickLocation = useCallback(() => {
    setIsPickingLocation(true);
    setShowReports(true);
    setMobilePane("map");
  }, []);

  const handlePickLocation = useCallback((coords: { lat: number; lon: number }) => {
    setPickedCoords(coords);
    setIsPickingLocation(false);
    setActiveTab("reports");
    setMobilePane("panel");
  }, []);

  const handleFocusReport = useCallback(
    (rep: DamageReport) => {
      setSelectedReport(rep);
      setShowReports(true);
      setMobilePane("map");
      if (rep.lon != null && rep.lat != null) {
        setFlyToTarget({ lon: rep.lon, lat: rep.lat, zoom: 15.8, ts: Date.now() });
      } else if (rep.ward_name && WARD_CENTERS[rep.ward_name]) {
        setSelectedWard(rep.ward_name);
        setFlyToTarget({ ...WARD_CENTERS[rep.ward_name], ts: Date.now() });
      }
    },
    []
  );

  const handleFocusBoardArea = useCallback(async (wardName: string, meshcode: string | null) => {
    setShowSafetyLayer(true);
    setMobilePane("map");
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
        setMobilePane("map");
        return;
      }

      if (action.type === "fly_to_mesh" && action.meshcode) {
        setSelectedMeshcode(action.meshcode);
        setMobilePane("map");
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
        setMobilePane("map");
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
        setMobilePane("map");
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
          setMobilePane("map");
        } catch {
          // ignore
        }
      }
    },
    [includeSamples]
  );

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-slate-950">
      <TopBar
        stats={stats}
        boardSummary={boardSummary}
        reportSummary={reportSummary}
        selectedWard={selectedWard}
        geminiConfigured={geminiConfigured}
        onOpenSources={() => setSourcesOpen(true)}
        onOpenSafetyTab={() => openPanelTab("safety")}
        onOpenReportsTab={() => openPanelTab("reports")}
        onOpenAiTab={() => openPanelTab("ai")}
        onToggleMobileLeft={() => setMobileLeftOpen((v) => !v)}
      />

      {apiError && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-500/40 bg-rose-950/80 px-4 py-1.5 text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{apiError}</span>
          </div>
          <span className="font-mono text-[10px] text-rose-300">
            Backend: uv run uvicorn app.main:app --port 8000
          </span>
        </div>
      )}

      {/* Main Responsive Workspace */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop Left Filters */}
        <div className="hidden lg:block lg:w-72 shrink-0 h-full overflow-hidden">
          <LeftFilterPanel
            wards={wardsList}
            selectedWard={selectedWard}
            onSelectWard={handleSelectWard}
            ageCategories={ageCategories}
            onToggleAgeCategory={handleToggleAgeCategory}
            onSelectAllAges={() => setAgeCategories(DEFAULT_AGES)}
            hazardTiers={hazardTiers}
            onToggleHazardTier={handleToggleHazardTier}
            onSelectAllHazards={() => setHazardTiers(DEFAULT_HAZARDS)}
            usageGroup={usageGroup}
            onChangeUsageGroup={setUsageGroup}
            showBuildings={showBuildings}
            onToggleBuildings={() => setShowBuildings((v) => !v)}
            showHazardMesh={showHazardMesh}
            onToggleHazardMesh={() => setShowHazardMesh((v) => !v)}
            meshOverlayMode={meshOverlayMode}
            onChangeMeshOverlayMode={setMeshOverlayMode}
            showEarthquakes={showEarthquakes}
            onToggleEarthquakes={() => setShowEarthquakes((v) => !v)}
            showSafetyLayer={showSafetyLayer}
            onToggleSafetyLayer={() => setShowSafetyLayer((v) => !v)}
            showReports={showReports}
            onToggleReports={() => setShowReports((v) => !v)}
            includeSamples={includeSamples}
            onToggleIncludeSamples={() => setIncludeSamples((v) => !v)}
            is3D={is3D}
            onChangeIs3D={setIs3D}
            onResetFilters={handleResetFilters}
            selectedMeshcode={selectedMeshcode}
            onClearMeshcode={handleClearMeshcode}
            knownHeightRate={metadata?.counts?.known_measured_height_rate ?? null}
          />
        </div>

        {/* Mobile Filters Slide-Over */}
        {mobileLeftOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="relative h-full w-72 bg-slate-900 shadow-2xl">
              <button
                type="button"
                onClick={() => setMobileLeftOpen(false)}
                className="absolute right-2 top-2 z-50 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
              <LeftFilterPanel
                wards={wardsList}
                selectedWard={selectedWard}
                onSelectWard={(w) => {
                  handleSelectWard(w);
                  setMobileLeftOpen(false);
                }}
                ageCategories={ageCategories}
                onToggleAgeCategory={handleToggleAgeCategory}
                onSelectAllAges={() => setAgeCategories(DEFAULT_AGES)}
                hazardTiers={hazardTiers}
                onToggleHazardTier={handleToggleHazardTier}
                onSelectAllHazards={() => setHazardTiers(DEFAULT_HAZARDS)}
                usageGroup={usageGroup}
                onChangeUsageGroup={setUsageGroup}
                showBuildings={showBuildings}
                onToggleBuildings={() => setShowBuildings((v) => !v)}
                showHazardMesh={showHazardMesh}
                onToggleHazardMesh={() => setShowHazardMesh((v) => !v)}
                meshOverlayMode={meshOverlayMode}
                onChangeMeshOverlayMode={setMeshOverlayMode}
                showEarthquakes={showEarthquakes}
                onToggleEarthquakes={() => setShowEarthquakes((v) => !v)}
                showSafetyLayer={showSafetyLayer}
                onToggleSafetyLayer={() => setShowSafetyLayer((v) => !v)}
                showReports={showReports}
                onToggleReports={() => setShowReports((v) => !v)}
                includeSamples={includeSamples}
                onToggleIncludeSamples={() => setIncludeSamples((v) => !v)}
                is3D={is3D}
                onChangeIs3D={setIs3D}
                onResetFilters={handleResetFilters}
                selectedMeshcode={selectedMeshcode}
                onClearMeshcode={handleClearMeshcode}
                knownHeightRate={metadata?.counts?.known_measured_height_rate ?? null}
              />
            </div>
            <div
              className="flex-1 bg-black/50"
              onClick={() => setMobileLeftOpen(false)}
            />
          </div>
        )}

        {/* Center Map: Always visible on desktop; visible when mobilePane === 'map' on small screens */}
        <main
          className={`relative flex-1 min-h-0 h-full overflow-hidden ${
            mobilePane === "map" ? "block" : "hidden lg:block"
          }`}
        >
          <QuakeMap
            meshesGeoJson={meshesGeoJson}
            earthquakes={earthquakes}
            reports={reports}
            boardSummary={boardSummary}
            routeResult={routeResult}
            selectedWard={selectedWard}
            ageCategories={ageCategories}
            hazardTiers={hazardTiers}
            usageGroup={usageGroup}
            showBuildings={showBuildings}
            onToggleBuildings={() => setShowBuildings((v) => !v)}
            showHazardMesh={showHazardMesh}
            onToggleHazardMesh={() => setShowHazardMesh((v) => !v)}
            meshOverlayMode={meshOverlayMode}
            showEarthquakes={showEarthquakes}
            onToggleEarthquakes={() => setShowEarthquakes((v) => !v)}
            showReports={showReports}
            onToggleReports={() => setShowReports((v) => !v)}
            showSafetyLayer={showSafetyLayer}
            onToggleSafetyLayer={() => setShowSafetyLayer((v) => !v)}
            is3D={is3D}
            onToggle3D={() => setIs3D((v) => !v)}
            selectedBuildingId={selectedBuilding?.building_id ?? null}
            selectedMeshcode={selectedMeshcode}
            flyToTarget={flyToTarget}
            isPickingLocation={isPickingLocation}
            pickedCoords={pickedCoords}
            onPickLocation={handlePickLocation}
            onCancelPickLocation={() => setIsPickingLocation(false)}
            onSelectBuilding={handleSelectBuilding}
            onSelectMesh={handleSelectMesh}
            onSelectReport={handleSelectReportFromMap}
            onSelectSafetyWard={handleSelectSafetyWardFromMap}
          />
        </main>

        {/* Right Integrated Command Panel: fixed on desktop; full-screen stage when mobilePane === 'panel' */}
        <div
          className={`h-full overflow-hidden shrink-0 ${
            mobilePane === "panel"
              ? "w-full lg:w-[440px] xl:w-[468px]"
              : "hidden lg:block lg:w-[440px] xl:w-[468px]"
          }`}
        >
          <RightPanel
            activeTab={activeTab}
            onChangeTab={setActiveTab}
            wards={wardsList}
            stats={stats}
            priorityAreas={priorityAreas}
            sortBy={sortBy}
            onChangeSortBy={setSortBy}
            onSelectPriorityArea={handleSelectPriorityArea}
            selectedBuilding={selectedBuilding}
            selectedMesh={selectedMesh}
            selectedReport={selectedReport}
            selectedMeshcode={selectedMeshcode}
            selectedWard={selectedWard}
            onSelectWard={handleSelectWard}
            ageCategories={ageCategories}
            hazardTiers={hazardTiers}
            usageGroup={usageGroup}
            is3D={is3D}
            geminiConfigured={geminiConfigured}
            aiProtection={aiProtection}
            totalBuildings={metadata?.counts?.total_buildings ?? stats?.total_buildings ?? null}
            onRefreshHealth={handleRefreshHealth}
            queuedAiPrompt={queuedAiPrompt}
            onConsumeQueuedAiPrompt={handleConsumeQueuedAiPrompt}
            onRequestAiExplain={handleRequestAiExplain}
            onExecuteMapAction={handleExecuteMapAction}
            onToggleAgeCategory={handleToggleAgeCategory}
            onToggleHazardTier={handleToggleHazardTier}
            boardSummary={boardSummary}
            reports={reports}
            reportSummary={reportSummary}
            includeSamples={includeSamples}
            onToggleIncludeSamples={setIncludeSamples}
            onFocusBoardArea={handleFocusBoardArea}
            onFocusReport={handleFocusReport}
            onDisasterDataChanged={triggerDisasterRefresh}
            pickedCoords={pickedCoords}
            isPickingLocation={isPickingLocation}
            onStartPickLocation={handleStartPickLocation}
            onCancelPickLocation={() => setIsPickingLocation(false)}
            onClearPickedLocation={() => setPickedCoords(null)}
            routeResult={routeResult}
            onChangeRouteResult={setRouteResult}
          />
        </div>
      </div>

      {/* Smartphone Bottom Navigation Bar */}
      <nav
        aria-label="モバイル主要メニュー"
        className="grid shrink-0 grid-cols-5 border-t border-slate-800 bg-slate-950/95 lg:hidden"
      >
        <MobileNavBtn
          active={mobilePane === "map"}
          onClick={() => setMobilePane("map")}
          icon={<MapIcon className="h-4 w-4" />}
          label="地図"
        />
        <MobileNavBtn
          active={mobilePane === "panel" && activeTab === "stats"}
          onClick={() => openPanelTab("stats")}
          icon={<BarChart3 className="h-4 w-4" />}
          label="概要"
        />
        <MobileNavBtn
          active={mobilePane === "panel" && activeTab === "safety"}
          onClick={() => openPanelTab("safety")}
          icon={<MessageSquareHeart className="h-4 w-4 text-sky-400" />}
          label="安否"
          badge={boardSummary?.total_entries}
        />
        <MobileNavBtn
          active={mobilePane === "panel" && activeTab === "reports"}
          onClick={() => openPanelTab("reports")}
          icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
          label="被害報告"
          badge={reportSummary?.total_reports}
        />
        <MobileNavBtn
          active={mobilePane === "panel" && activeTab === "ai"}
          onClick={() => openPanelTab("ai")}
          icon={<Sparkles className="h-4 w-4 text-emerald-400" />}
          label="AI分析"
        />
      </nav>

      <SourcesModal
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        metadata={metadata}
      />
    </div>
  );
}

function MobileNavBtn({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold transition ${
        active ? "bg-slate-900 text-sky-300" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      <div className="relative">
        {icon}
        {badge !== undefined && badge > 0 && (
          <span className="absolute -right-2.5 -top-1 rounded-full bg-sky-600 px-1 font-mono text-[8px] font-bold text-white">
            {badge}
          </span>
        )}
      </div>
      <span>{label}</span>
    </button>
  );
}
