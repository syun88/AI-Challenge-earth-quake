"use client";

import React, { useEffect, useState, useCallback } from "react";
import { AlertTriangle, X } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { LeftFilterPanel } from "@/components/LeftFilterPanel";
import { QuakeMap } from "@/components/QuakeMap";
import { RightPanel, RightTab } from "@/components/RightPanel";
import { SourcesModal } from "@/components/SourcesModal";
import { DisasterBoard } from "@/components/DisasterBoard";
import { WARD_CENTERS } from "@/lib/colors";
import {
  getBuildingDetail,
  getEarthquakes,
  getHealth,
  getMeshDetail,
  getMeshesGeoJson,
  getMetadata,
  getPriorityAreas,
  getStats,
} from "@/lib/api";
import {
  AgeCategory,
  AiProtectionStatus,
  BuildingDetail,
  EarthquakeEvent,
  HazardTier,
  MapAction,
  MeshDetail,
  MeshOverlayMode,
  MetadataResponse,
  PriorityArea,
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
  const [is3D, setIs3D] = useState(false);

  // Selection & UI state
  const [activeTab, setActiveTab] = useState<RightTab>("stats");
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingDetail | null>(null);
  const [selectedMesh, setSelectedMesh] = useState<MeshDetail | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<{
    lon: number;
    lat: number;
    zoom: number;
    ts: number;
  } | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<{ text: string; ts: number } | null>(null);

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

  const handleRefreshHealth = useCallback(async () => {
    try {
      const h = await getHealth();
      setGeminiConfigured(h.gemini_configured);
      setAiProtection(h.ai_protection ?? null);
    } catch {
      // ignore transient error
    }
  }, []);

  // Refresh stats whenever filters change
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
        // handled by top-level error
      }
    })();
  }, [selectedWard, ageCategories, hazardTiers, usageGroup, selectedMeshcode]);

  // Refresh priority areas whenever ward, hazardTiers, usageGroup, or sortBy changes
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
        // ignore transient errors
      }
    })();
  }, [selectedWard, hazardTiers, usageGroup, sortBy]);

  const handleSelectWard = useCallback((ward: string) => {
    setSelectedWard(ward);
    setSelectedMeshcode(null);
    setSelectedMesh(null);
    const center = WARD_CENTERS[ward] || WARD_CENTERS.all;
    setFlyToTarget({ ...center, ts: Date.now() });
  }, []);

  const handleToggleAgeCategory = useCallback((cat: AgeCategory) => {
    setAgeCategories((prev) => {
      if (prev.length === DEFAULT_AGES.length) {
        return [cat];
      }
      if (prev.includes(cat)) {
        const next = prev.filter((c) => c !== cat);
        return next.length === 0 ? DEFAULT_AGES : next;
      }
      return [...prev, cat];
    });
  }, []);

  const handleToggleHazardTier = useCallback((tier: HazardTier) => {
    setHazardTiers((prev) => {
      if (prev.length === DEFAULT_HAZARDS.length) {
        return [tier];
      }
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
    setFlyToTarget({ ...WARD_CENTERS.all, ts: Date.now() });
  }, []);

  const handleClearMeshcode = useCallback(() => {
    setSelectedMeshcode(null);
    setSelectedMesh(null);
  }, []);

  const handleSelectBuilding = useCallback(async (buildingId: string) => {
    try {
      const detail = await getBuildingDetail(buildingId);
      setSelectedBuilding(detail);
      setActiveTab("detail");
      setMobileRightOpen(true);
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
      setMobileRightOpen(true);
    } catch {
      // ignore
    }
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
      try {
        const detail = await getMeshDetail(area.meshcode);
        setSelectedMesh(detail);
      } catch {
        // ignore
      }
    },
    [selectedMeshcode]
  );

  const handleOpenAiTab = useCallback(() => {
    setActiveTab("ai");
    setMobileRightOpen(true);
  }, []);

  const handleRequestAiExplain = useCallback((prompt: string) => {
    setQueuedAiPrompt({ text: prompt, ts: Date.now() });
    setActiveTab("ai");
    setMobileRightOpen(true);
  }, []);

  const handleConsumeQueuedAiPrompt = useCallback(() => {
    setQueuedAiPrompt(null);
  }, []);

  const handleExecuteMapAction = useCallback(async (action: MapAction) => {
    setMobileRightOpen(false);
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
        if (detail.meshcode) {
          setSelectedMeshcode(detail.meshcode);
        }
        setFlyToTarget({
          lon: action.lon ?? detail.centroid_lon,
          lat: action.lat ?? detail.centroid_lat,
          zoom: action.zoom ?? 17.2,
          ts: Date.now(),
        });
      } catch {
        // ignore
      }
    }
  }, []);

  const handleFocusBoardArea = useCallback(
    async (wardName: string, meshcode: string | null) => {
      setBoardOpen(false);
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
          // fallback to ward center
        }
      }
      const center = WARD_CENTERS[wardName] || WARD_CENTERS.all;
      setFlyToTarget({ ...center, ts: Date.now() });
    },
    []
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950">
      <TopBar
        stats={stats}
        selectedWard={selectedWard}
        geminiConfigured={geminiConfigured}
        onOpenSources={() => setSourcesOpen(true)}
        onOpenAiTab={handleOpenAiTab}
        onOpenBoard={() => setBoardOpen(true)}
        onToggleMobileLeft={() => setMobileLeftOpen((v) => !v)}
        onToggleMobileRight={() => setMobileRightOpen((v) => !v)}
      />

      {apiError && (
        <div className="flex items-center justify-between border-b border-rose-500/40 bg-rose-950/80 px-4 py-2 text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{apiError}</span>
          </div>
          <span className="font-mono text-[11px] text-rose-300">
            Backend: uv run uvicorn app.main:app --port 8000
          </span>
        </div>
      )}

      {/* Main 3-column workspace */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar (desktop fixed + mobile drawer) */}
        <div className="hidden lg:block lg:w-72 shrink-0 h-full overflow-hidden">
          <LeftFilterPanel
            wards={metadata?.wards || Object.keys(WARD_CENTERS).filter((k) => k !== "all")}
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
            is3D={is3D}
            onChangeIs3D={setIs3D}
            onResetFilters={handleResetFilters}
            selectedMeshcode={selectedMeshcode}
            onClearMeshcode={handleClearMeshcode}
            knownHeightRate={metadata?.counts?.known_measured_height_rate ?? null}
          />
        </div>

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
                wards={metadata?.wards || Object.keys(WARD_CENTERS).filter((k) => k !== "all")}
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

        {/* Center Interactive Map */}
        <main className="relative flex-1 min-h-0 h-full overflow-hidden">
          <QuakeMap
            meshesGeoJson={meshesGeoJson}
            earthquakes={earthquakes}
            selectedWard={selectedWard}
            ageCategories={ageCategories}
            hazardTiers={hazardTiers}
            usageGroup={usageGroup}
            showBuildings={showBuildings}
            showHazardMesh={showHazardMesh}
            meshOverlayMode={meshOverlayMode}
            showEarthquakes={showEarthquakes}
            is3D={is3D}
            onToggle3D={() => setIs3D((v) => !v)}
            selectedBuildingId={selectedBuilding?.building_id ?? null}
            selectedMeshcode={selectedMeshcode}
            flyToTarget={flyToTarget}
            onSelectBuilding={handleSelectBuilding}
            onSelectMesh={handleSelectMesh}
          />
        </main>

        {/* Right panel (desktop fixed + mobile drawer) */}
        <div className="hidden lg:block lg:w-[410px] shrink-0 h-full overflow-hidden">
          <RightPanel
            activeTab={activeTab}
            onChangeTab={setActiveTab}
            stats={stats}
            priorityAreas={priorityAreas}
            sortBy={sortBy}
            onChangeSortBy={setSortBy}
            onSelectPriorityArea={handleSelectPriorityArea}
            selectedBuilding={selectedBuilding}
            selectedMesh={selectedMesh}
            selectedMeshcode={selectedMeshcode}
            selectedWard={selectedWard}
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
          />
        </div>

        {mobileRightOpen && (
          <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
            <div
              className="flex-1 bg-black/50"
              onClick={() => setMobileRightOpen(false)}
            />
            <div className="relative h-full w-full max-w-[390px] bg-slate-900 shadow-2xl">
              <button
                type="button"
                onClick={() => setMobileRightOpen(false)}
                className="absolute right-2 top-2 z-50 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
              <RightPanel
                activeTab={activeTab}
                onChangeTab={setActiveTab}
                stats={stats}
                priorityAreas={priorityAreas}
                sortBy={sortBy}
                onChangeSortBy={setSortBy}
                onSelectPriorityArea={handleSelectPriorityArea}
                selectedBuilding={selectedBuilding}
                selectedMesh={selectedMesh}
                selectedMeshcode={selectedMeshcode}
                selectedWard={selectedWard}
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
              />
            </div>
          </div>
        )}
      </div>

      <SourcesModal
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        metadata={metadata}
      />

      {boardOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBoardOpen(false);
          }}
        >
          <div className="h-[min(88vh,760px)] w-full max-w-md">
            <DisasterBoard
              onBack={() => setBoardOpen(false)}
              wards={metadata?.wards || Object.keys(WARD_CENTERS).filter((k) => k !== "all")}
              defaultWard={selectedWard}
              defaultMeshcode={selectedMeshcode}
              onFocusArea={handleFocusBoardArea}
            />
          </div>
        </div>
      )}
    </div>
  );
}
