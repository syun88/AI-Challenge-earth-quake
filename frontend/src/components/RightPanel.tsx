"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  BarChart3,
  Building,
  Sparkles,
  ExternalLink,
  Navigation,
  ShieldCheck,
  MessageSquareHeart,
  AlertTriangle,
  Download,
  FileSpreadsheet,
  MapPin,
  PlusCircle,
} from "lucide-react";
import {
  AGE_COLORS,
  AGE_LABELS,
  HAZARD_COLORS,
  HAZARD_SHORT_LABELS,
  REPORT_CATEGORY_META,
  REPORT_SEVERITY_META,
} from "@/lib/colors";
import { buildDisasterCsvUrl, buildDisasterXlsxUrl } from "@/lib/api";
import { AiAssistantPanel } from "@/components/AiAssistantPanel";
import { DamageReportPanel, VerificationBadge } from "@/components/DamageReportPanel";
import { DisasterBoard } from "@/components/DisasterBoard";
import { RouteSimulatorCard } from "@/components/RouteSimulatorCard";
import {
  AgeCategory,
  AiProtectionStatus,
  BoardSummaryResponse,
  BuildingDetail,
  DamageReport,
  DamageReportSummaryResponse,
  HazardTier,
  MapAction,
  MeshDetail,
  PriorityArea,
  RouteSimulationResponse,
  StatsResponse,
  UsageGroup,
} from "@/types/quakelens";

export type RightTab = "stats" | "safety" | "reports" | "detail" | "ai";

interface RightPanelProps {
  activeTab: RightTab;
  onChangeTab: (tab: RightTab) => void;
  wards: string[];
  stats: StatsResponse | null;
  priorityAreas: PriorityArea[];
  sortBy: string;
  onChangeSortBy: (s: string) => void;
  onSelectPriorityArea: (area: PriorityArea) => void;
  selectedBuilding: BuildingDetail | null;
  selectedMesh: MeshDetail | null;
  selectedReport: DamageReport | null;
  selectedMeshcode?: string | null;
  selectedWard: string;
  onSelectWard: (ward: string) => void;
  ageCategories: AgeCategory[];
  hazardTiers: HazardTier[];
  usageGroup: UsageGroup;
  is3D: boolean;
  geminiConfigured: boolean;
  aiProtection?: AiProtectionStatus | null;
  totalBuildings?: number | null;
  onRefreshHealth?: () => void;
  queuedAiPrompt: { text: string; ts: number } | null;
  onConsumeQueuedAiPrompt: () => void;
  onRequestAiExplain: (prompt: string) => void;
  onExecuteMapAction: (action: MapAction) => void;
  onToggleAgeCategory: (cat: AgeCategory) => void;
  onToggleHazardTier: (tier: HazardTier) => void;
  // Integrated Safety & Damage props
  boardSummary: BoardSummaryResponse | null;
  reports: DamageReport[];
  reportSummary: DamageReportSummaryResponse | null;
  includeSamples: boolean;
  onToggleIncludeSamples: (next: boolean) => void;
  onFocusBoardArea: (wardName: string, meshcode: string | null) => void;
  onFocusReport: (report: DamageReport) => void;
  onDisasterDataChanged: () => void;
  pickedCoords: { lat: number; lon: number } | null;
  isPickingLocation: boolean;
  onStartPickLocation: () => void;
  onCancelPickLocation: () => void;
  onClearPickedLocation: () => void;
  routeResult: RouteSimulationResponse | null;
  onChangeRouteResult: (res: RouteSimulationResponse | null) => void;
}

const ALL_AGE_CATS: AgeCategory[] = ["pre_1981", "1982_2000", "post_2001", "unknown"];
const ALL_HAZARD_TIERS: HazardTier[] = ["very_high", "elevated", "moderate", "low"];

export function RightPanel({
  activeTab,
  onChangeTab,
  wards,
  stats,
  priorityAreas,
  sortBy,
  onChangeSortBy,
  onSelectPriorityArea,
  selectedBuilding,
  selectedMesh,
  selectedReport,
  selectedMeshcode,
  selectedWard,
  onSelectWard,
  ageCategories,
  hazardTiers,
  usageGroup,
  is3D,
  geminiConfigured,
  aiProtection,
  totalBuildings,
  onRefreshHealth,
  queuedAiPrompt,
  onConsumeQueuedAiPrompt,
  onRequestAiExplain,
  onExecuteMapAction,
  onToggleAgeCategory,
  onToggleHazardTier,
  boardSummary,
  reports,
  reportSummary,
  includeSamples,
  onToggleIncludeSamples,
  onFocusBoardArea,
  onFocusReport,
  onDisasterDataChanged,
  pickedCoords,
  isPickingLocation,
  onStartPickLocation,
  onCancelPickLocation,
  onClearPickedLocation,
  routeResult,
  onChangeRouteResult,
}: RightPanelProps) {
  const ageData = stats?.age_breakdown ?? [];
  const crossData = (stats?.cross_tab ?? [])
    .filter((r) => r.hazard_tier !== "unknown" || r.total > 0)
    .map((r) => ({
      ...r,
      shortLabel: HAZARD_SHORT_LABELS[r.hazard_tier],
    }));

  const isAgeFiltered = ageCategories.length < ALL_AGE_CATS.length;
  const isHazardFiltered = hazardTiers.length < ALL_HAZARD_TIERS.length;
  const fullHeightTab = activeTab === "ai" || activeTab === "safety" || activeTab === "reports";

  return (
    <aside className="flex h-full flex-col border-l border-slate-800 bg-slate-900/95">
      {/* 5-Tab Unified Platform Navigation */}
      <div className="grid shrink-0 grid-cols-5 border-b border-slate-800 bg-slate-950/70" role="tablist">
        <TabButton
          testId="tab-stats"
          active={activeTab === "stats"}
          onClick={() => onChangeTab("stats")}
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label="概要"
        />
        <TabButton
          testId="tab-safety"
          active={activeTab === "safety"}
          onClick={() => onChangeTab("safety")}
          icon={<MessageSquareHeart className="h-3.5 w-3.5 text-sky-400" />}
          label="安否"
          badge={boardSummary ? boardSummary.total_entries : undefined}
        />
        <TabButton
          testId="tab-reports"
          active={activeTab === "reports"}
          onClick={() => onChangeTab("reports")}
          icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
          label="被害報告"
          badge={reportSummary ? reportSummary.total_reports : undefined}
        />
        <TabButton
          testId="tab-detail"
          active={activeTab === "detail"}
          onClick={() => onChangeTab("detail")}
          icon={<Building className="h-3.5 w-3.5 text-fuchsia-400" />}
          label="詳細・経路"
        />
        <TabButton
          testId="tab-ai"
          active={activeTab === "ai"}
          onClick={() => onChangeTab("ai")}
          icon={<Sparkles className="h-3.5 w-3.5 text-emerald-400" />}
          label="AI分析"
        />
      </div>

      {/* Tab Content */}
      <div
        className={`flex-1 min-h-0 ${
          fullHeightTab ? "overflow-hidden" : "overflow-y-auto p-3.5"
        }`}
      >
        {activeTab === "stats" && (
          <div className="space-y-4">
            {/* Unified Live Disaster Response Situation + Export Strip */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/85 p-3 text-xs space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-white">
                  リアルタイム防災・被害状況（{selectedWard === "all" ? "京都市全域" : selectedWard}）
                </span>
                <div className="flex items-center gap-1.5">
                  <a
                    href={buildDisasterCsvUrl({
                      scope: "overview",
                      ward: selectedWard,
                      includeSamples,
                    })}
                    download
                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-sky-300 hover:border-sky-500/60"
                  >
                    <Download className="h-2.5 w-2.5" /> CSV
                  </a>
                  <a
                    href={buildDisasterXlsxUrl({
                      ward: selectedWard,
                      includeSamples,
                    })}
                    download
                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 hover:border-emerald-500/60"
                  >
                    <FileSpreadsheet className="h-2.5 w-2.5" /> Excel
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onChangeTab("safety")}
                  className="rounded-lg border border-sky-500/35 bg-sky-500/10 p-2 text-left transition hover:bg-sky-500/20"
                >
                  <div className="flex items-center justify-between text-[10px] text-sky-300">
                    <span>災害用伝言板（安否）</span>
                    <MessageSquareHeart className="h-3 w-3" />
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-white">
                    {boardSummary?.total_entries ?? 0}件
                  </div>
                  <div className="text-[10px] text-slate-400">
                    市民 {boardSummary?.user_entries_count ?? 0} / サンプル {boardSummary?.sample_entries_count ?? 0}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTab("reports")}
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-left transition hover:bg-amber-500/20"
                >
                  <div className="flex items-center justify-between text-[10px] text-amber-300">
                    <span>被害状況報告（継続中）</span>
                    <AlertTriangle className="h-3 w-3" />
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-white">
                    {reportSummary?.total_reports ?? 0}件
                  </div>
                  <div className="text-[10px] text-amber-200/90">
                    未確認 {reportSummary?.unverified_count ?? 0} / サンプル {reportSummary?.demo_sample_count ?? 0}
                  </div>
                </button>
              </div>
            </div>
            {/* Denominator & Missingness Box */}
            {stats && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
                <div className="mb-1.5 flex items-center justify-between font-semibold text-slate-200">
                  <span>対象範囲サマリー</span>
                  <span className="font-mono text-[11px] text-sky-300">
                    {stats.scope.ward === "all" ? "京都市全域" : stats.scope.ward}
                    {stats.scope.meshcode ? ` (${stats.scope.meshcode})` : ""}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat
                    label="表示条件内の棟数"
                    value={`${stats.total_buildings.toLocaleString("ja-JP")}棟`}
                    sub={`母数 ${stats.scope.scope_denominator_buildings.toLocaleString("ja-JP")}棟`}
                  />
                  <MiniStat
                    label="建築年判明 / 不明"
                    value={`${(stats.known_year_rate * 100).toFixed(1)}%`}
                    sub={`不明 ${stats.unknown_year_count.toLocaleString("ja-JP")}棟 (${(stats.unknown_year_rate * 100).toFixed(1)}%)`}
                  />
                  <MiniStat
                    label="1981年以前建築"
                    value={`${stats.pre_1981_count.toLocaleString("ja-JP")}棟`}
                    sub={
                      stats.pre_1981_share_of_known !== null
                        ? `判明建物の ${(stats.pre_1981_share_of_known * 100).toFixed(1)}%`
                        : "判明データなし"
                    }
                    accent="text-orange-400"
                    onClick={() => onToggleAgeCategory("pre_1981")}
                  />
                  <MiniStat
                    label="高ハザード(26%+)×1981以前"
                    value={`${stats.overlap_very_high_pre1981.toLocaleString("ja-JP")}棟`}
                    sub={`6%以上合計 ${stats.overlap_elevated_or_higher_pre1981.toLocaleString("ja-JP")}棟`}
                    accent="text-fuchsia-300"
                    onClick={() => onToggleHazardTier("very_high")}
                  />
                </div>
              </div>
            )}

            {/* Chart 1: Age breakdown */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-200">
                  築年区分別の建物数
                </h3>
                <span className="text-[10px] text-slate-400">棒またはボタンで絞込</span>
              </div>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={ageData}
                    margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#cbd5e1", fontSize: 10 }}
                      axisLine={{ stroke: "#334155" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.1)" }}
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "0.5rem",
                        fontSize: "11px",
                      }}
                      formatter={(val) => [
                        `${Number(val ?? 0).toLocaleString("ja-JP")}棟`,
                        "建物数",
                      ]}
                    />
                    <Bar
                      dataKey="count"
                      isAnimationActive={false}
                      radius={[4, 4, 0, 0]}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const key = (entry as { payload?: { key?: AgeCategory } })?.payload?.key;
                        if (key) onToggleAgeCategory(key);
                      }}
                    >
                      {ageData.map((entry) => (
                        <Cell key={entry.key} fill={AGE_COLORS[entry.key]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Clickable chips below chart so filtered-out 0-height bars can always be clicked */}
              <div className="mt-2 grid grid-cols-4 gap-1">
                {ALL_AGE_CATS.map((cat) => {
                  const active = ageCategories.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => onToggleAgeCategory(cat)}
                      className={`flex items-center justify-center gap-1 rounded border px-1 py-1 text-[10px] font-medium transition ${
                        active
                          ? isAgeFiltered
                            ? "border-sky-500/70 bg-sky-950/40 text-white"
                            : "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                          : "border-slate-800/80 bg-slate-950/40 text-slate-500 opacity-50 hover:opacity-85"
                      }`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: AGE_COLORS[cat] }}
                      />
                      <span className="truncate">{AGE_LABELS[cat]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Chart 2: Hazard x Age stacked */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-200">
                  地震ハザード区分 × 築年区分
                </h3>
                <span className="text-[10px] text-slate-400">棒またはボタンで絞込</span>
              </div>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={crossData}
                    margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="shortLabel"
                      tick={{ fill: "#cbd5e1", fontSize: 10 }}
                      axisLine={{ stroke: "#334155" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.1)" }}
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "0.5rem",
                        fontSize: "11px",
                      }}
                    />
                    <Bar
                      dataKey="pre_1981"
                      name="1981年以前"
                      stackId="a"
                      isAnimationActive={false}
                      fill={AGE_COLORS.pre_1981}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const tier = (entry as { payload?: { hazard_tier?: HazardTier } })?.payload?.hazard_tier;
                        if (tier) onToggleHazardTier(tier);
                      }}
                    />
                    <Bar
                      dataKey="1982_2000"
                      name="1982〜2000年"
                      stackId="a"
                      isAnimationActive={false}
                      fill={AGE_COLORS["1982_2000"]}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const tier = (entry as { payload?: { hazard_tier?: HazardTier } })?.payload?.hazard_tier;
                        if (tier) onToggleHazardTier(tier);
                      }}
                    />
                    <Bar
                      dataKey="post_2001"
                      name="2001年以降"
                      stackId="a"
                      isAnimationActive={false}
                      fill={AGE_COLORS.post_2001}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const tier = (entry as { payload?: { hazard_tier?: HazardTier } })?.payload?.hazard_tier;
                        if (tier) onToggleHazardTier(tier);
                      }}
                    />
                    <Bar
                      dataKey="unknown"
                      name="建築年不明"
                      stackId="a"
                      isAnimationActive={false}
                      fill={AGE_COLORS.unknown}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const tier = (entry as { payload?: { hazard_tier?: HazardTier } })?.payload?.hazard_tier;
                        if (tier) onToggleHazardTier(tier);
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {ALL_HAZARD_TIERS.map((tier) => {
                  const active = hazardTiers.includes(tier);
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => onToggleHazardTier(tier)}
                      className={`flex items-center justify-center gap-1 rounded border px-1 py-1 text-[10px] font-medium transition ${
                        active
                          ? isHazardFiltered
                            ? "border-fuchsia-500/70 bg-fuchsia-950/30 text-white"
                            : "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                          : "border-slate-800/80 bg-slate-950/40 text-slate-500 opacity-50 hover:opacity-85"
                      }`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: HAZARD_COLORS[tier] }}
                      />
                      <span className="truncate">{HAZARD_SHORT_LABELS[tier]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Priority Confirmation Areas (250m mesh ranking) */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-200">
                    優先確認エリア（250mメッシュ）
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    実測値ベース（行クリックで地図移動・絞込）
                  </p>
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => onChangeSortBy(e.target.value)}
                  className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-200"
                >
                  <option value="pre_1981_high_hazard">高ハザード×1981以前順</option>
                  <option value="pre_1981_count">1981以前棟数順</option>
                  <option value="t30_i55_ps">震度6弱+確率順</option>
                  <option value="pre_1981_share_known">1981以前割合順</option>
                </select>
              </div>

              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                {priorityAreas.length === 0 && (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center text-[11px] text-slate-400">
                    現在の絞込条件に一致するメッシュがありません。
                  </div>
                )}
                {priorityAreas.map((area, idx) => {
                  const isSelected = selectedMeshcode === area.meshcode;
                  return (
                    <button
                      key={area.meshcode}
                      type="button"
                      onClick={() => onSelectPriorityArea(area)}
                      className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-[11px] transition ${
                        isSelected
                          ? "border-sky-400 bg-sky-950/50 ring-1 ring-sky-400/40"
                          : "border-slate-800 bg-slate-900/80 hover:border-sky-500/50 hover:bg-slate-800"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-slate-800 font-mono text-[10px] text-sky-300">
                            {idx + 1}
                          </span>
                          <span>{area.ward_name}</span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {area.meshcode}
                          </span>
                          {isSelected && (
                            <span className="rounded bg-sky-500/20 px-1.5 py-0.2 text-[9px] text-sky-300">
                              選択中
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          総{area.total_buildings}棟 / 判明率{(area.known_year_rate * 100).toFixed(0)}% / {area.jname} (ARV {area.arv ?? "—"})
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono font-bold text-orange-400">
                          {area.pre_1981_count}棟
                        </div>
                        <div className="font-mono text-[10px] text-fuchsia-300">
                          {area.t30_i55_ps != null ? `${(area.t30_i55_ps * 100).toFixed(1)}%` : "—"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === "safety" && (
          <DisasterBoard
            embedded
            wards={wards}
            defaultWard={selectedWard}
            defaultMeshcode={selectedMeshcode}
            includeSamples={includeSamples}
            onToggleIncludeSamples={onToggleIncludeSamples}
            onFocusArea={onFocusBoardArea}
            onSelectWardFilter={onSelectWard}
            onDataMutated={onDisasterDataChanged}
          />
        )}

        {activeTab === "reports" && (
          <DamageReportPanel
            wards={wards}
            selectedWard={selectedWard}
            selectedMeshcode={selectedMeshcode ?? null}
            reports={reports}
            summary={reportSummary}
            includeSamples={includeSamples}
            onToggleIncludeSamples={onToggleIncludeSamples}
            pickedCoords={pickedCoords}
            isPickingLocation={isPickingLocation}
            onStartPickLocation={onStartPickLocation}
            onCancelPickLocation={onCancelPickLocation}
            onClearPickedLocation={onClearPickedLocation}
            onFocusReport={onFocusReport}
            onReportsChanged={onDisasterDataChanged}
            onOpenRouteSimulator={() => onChangeTab("detail")}
          />
        )}

        {activeTab === "detail" && (
          <div className="space-y-4 text-xs">
            {/* Training-only Alternative Route Simulator */}
            <RouteSimulatorCard
              routeResult={routeResult}
              onChangeRouteResult={onChangeRouteResult}
              includeSamples={includeSamples}
            />

            {/* Selected Damage Report Inspector */}
            {selectedReport && (
              <div className="rounded-xl border border-amber-500/40 bg-slate-950/90 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800 pb-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <VerificationBadge status={selectedReport.verification_status} />
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${REPORT_CATEGORY_META[selectedReport.category].badgeClass}`}
                    >
                      {selectedReport.category_label}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${REPORT_SEVERITY_META[selectedReport.severity].badgeClass}`}
                    >
                      {selectedReport.severity_label}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">{selectedReport.id}</span>
                </div>
                <h3 className="text-sm font-bold text-white">{selectedReport.title}</h3>
                <p className="rounded-lg bg-slate-900 p-2 text-[11px] text-slate-200">
                  {selectedReport.description}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                  <span>
                    {selectedReport.ward_name}
                    {selectedReport.meshcode ? ` / メッシュ ${selectedReport.meshcode}` : ""}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onChangeTab("reports")}
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-200 hover:bg-amber-500/20"
                    >
                      被害報告一覧で操作
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onRequestAiExplain(
                          `被害報告 ${selectedReport.id}（${selectedReport.ward_name} / ${selectedReport.category_label} / ${selectedReport.verification_label}）周辺の建物地震リスクと関連注意点を分析してください。`
                        )
                      }
                      className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-200"
                    >
                      AIで周辺リスク分析
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!selectedBuilding && !selectedMesh && !selectedReport && (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-4 text-center text-slate-400">
                <Navigation className="mx-auto mb-1.5 h-5 w-5 text-slate-500" />
                地図上の建物・250mメッシュ・被害報告ピンをクリックすると、詳細属性と地域連携アクションが表示されます。
              </div>
            )}

            {selectedBuilding && (
              <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-3.5 space-y-3">
                <div className="flex items-start justify-between border-b border-slate-800 pb-2">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                      選択中の建物
                    </span>
                    <h3 className="font-mono text-sm font-bold text-white">
                      {selectedBuilding.building_id}
                    </h3>
                    <div className="text-[11px] text-slate-400">
                      京都市 {selectedBuilding.ward_name} ／ メッシュ {selectedBuilding.meshcode}
                    </div>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                    style={{ backgroundColor: AGE_COLORS[selectedBuilding.age_category] }}
                  >
                    {selectedBuilding.age_label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <DetailField
                    label="建築年"
                    value={selectedBuilding.year_built ? `${selectedBuilding.year_built}年` : "不明"}
                  />
                  <DetailField label="用途" value={`${selectedBuilding.usage_label} (${selectedBuilding.usage_group_label})`} />
                  <DetailField label="建物構造" value={selectedBuilding.structure_label} />
                  <DetailField
                    label="階数 / 高さ"
                    value={`${selectedBuilding.storeys_above ?? "不明"}階 / ${
                      selectedBuilding.measured_height ? `${selectedBuilding.measured_height}m` : "不明"
                    }`}
                  />
                  <DetailField
                    label="30年震度6弱+確率"
                    value={
                      selectedBuilding.t30_i55_ps != null
                        ? `${(selectedBuilding.t30_i55_ps * 100).toFixed(1)}%`
                        : "不明"
                    }
                  />
                  <DetailField
                    label="地盤 (微地形 / ARV)"
                    value={`${selectedBuilding.jname} / ${selectedBuilding.arv ?? "—"}`}
                  />
                </div>

                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200">
                  <div className="mb-0.5 font-semibold">建築基準・データに関する補足</div>
                  <p>{selectedBuilding.era_note}</p>
                  <p className="mt-1 text-[10px] text-amber-300/80">
                    {selectedBuilding.hazard_disclaimer}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onRequestAiExplain(
                      `現在選択中の建物（ID: ${selectedBuilding.building_id}、${selectedBuilding.ward_name}、メッシュ ${selectedBuilding.meshcode}）について、建築年・耐震基準区分・地盤とハザード・該当しうる京都市の公式補助制度を分かりやすく解説してください。`
                    )
                  }
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-500/25"
                >
                  <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                  この建物をAIで詳しく解説
                </button>
              </div>
            )}

            {selectedMesh && (
              <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-3.5 space-y-3">
                <div className="flex items-start justify-between border-b border-slate-800 pb-2">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-400">
                      250mメッシュ詳細
                    </span>
                    <h3 className="font-mono text-sm font-bold text-white">
                      {selectedMesh.meshcode}
                    </h3>
                    <div className="text-[11px] text-slate-400">
                      京都市 {selectedMesh.ward_name} ／ {selectedMesh.jname}
                    </div>
                  </div>
                  <span className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-200">
                    {selectedMesh.t30_i55_ps != null
                      ? `震度6弱+ ${(selectedMesh.t30_i55_ps * 100).toFixed(1)}%`
                      : "不明"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <DetailField
                    label="メッシュ内総棟数"
                    value={`${selectedMesh.total_buildings.toLocaleString("ja-JP")}棟`}
                  />
                  <DetailField
                    label="建築年判明率"
                    value={`${(selectedMesh.known_year_rate * 100).toFixed(1)}% (不明 ${selectedMesh.unknown_year_count}棟)`}
                  />
                  <DetailField
                    label="1981年以前建築"
                    value={`${selectedMesh.pre_1981_count}棟（木造 ${selectedMesh.wooden_pre_1981_count}棟）`}
                  />
                  <DetailField
                    label="表層地盤 ARV / AVS"
                    value={`${selectedMesh.arv ?? "—"} / ${selectedMesh.avs ? `${selectedMesh.avs} m/s` : "—"}`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onRequestAiExplain(
                        `現在選択中の250mメッシュ（コード: ${selectedMesh.meshcode}、${selectedMesh.ward_name}）の統計、1981年以前建築の傾向、表層地盤（${selectedMesh.jname}・ARV ${selectedMesh.arv ?? "不明"}）、震度6弱+確率、及び京都市の補助制度について詳しく解説してください。`
                      )
                    }
                    className="flex items-center justify-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-2 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                    AIでメッシュ解説
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeTab("safety")}
                    className="flex items-center justify-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-2 text-[11px] font-semibold text-sky-200 transition hover:bg-sky-500/25"
                  >
                    <MapPin className="h-3.5 w-3.5 text-sky-400" />
                    この区の安否確認
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onChangeTab("reports")}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  このメッシュ・区で被害状況を報告
                </button>
              </div>
            )}

            {/* Official Kyoto City Subsidy Programs */}
            {(selectedBuilding?.official_programs || selectedMesh?.official_programs) && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
                <div className="mb-2 flex items-center gap-1.5 font-semibold text-emerald-300">
                  <ShieldCheck className="h-4 w-4" />
                  京都市公式の耐震診断・補助制度案内
                </div>
                <div className="space-y-2">
                  {(selectedBuilding?.official_programs || selectedMesh?.official_programs || []).map(
                    (prog) => (
                      <a
                        key={prog.url}
                        href={prog.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 transition hover:border-emerald-500/40"
                      >
                        <div className="flex items-center justify-between gap-1 font-medium text-sky-300">
                          <span>{prog.title}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">{prog.summary}</p>
                      </a>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "ai" && (
          <div className="h-full p-3">
            <AiAssistantPanel
              geminiConfigured={geminiConfigured}
              aiProtection={aiProtection}
              totalBuildings={totalBuildings}
              onRefreshHealth={onRefreshHealth}
              selectedWard={selectedWard}
              ageCategories={ageCategories}
              hazardTiers={hazardTiers}
              usageGroup={usageGroup}
              is3D={is3D}
              selectedBuilding={selectedBuilding}
              selectedMesh={selectedMesh}
              queuedPrompt={queuedAiPrompt}
              onConsumeQueuedPrompt={onConsumeQueuedAiPrompt}
              onExecuteMapAction={onExecuteMapAction}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

function TabButton({
  testId,
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  testId?: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-0.5 border-b-2 px-1 py-2 text-[10px] font-semibold transition ${
        active
          ? "border-sky-400 bg-slate-900 text-white"
          : "border-transparent text-slate-400 hover:bg-slate-900/50 hover:text-slate-200"
      }`}
    >
      <div className="flex items-center gap-1">
        {icon}
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-slate-800 px-1 font-mono text-[9px] text-sky-300">
            {badge}
          </span>
        )}
      </div>
      <span className="truncate max-w-full">{label}</span>
    </button>
  );
}

function MiniStat({
  label,
  value,
  sub,
  accent = "text-white",
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg border border-slate-800/90 bg-slate-900/70 p-2 text-left transition hover:border-slate-600 hover:bg-slate-800/80"
      >
        <div className="text-[10px] text-slate-400">{label}</div>
        <div className={`font-mono text-sm font-bold ${accent}`}>{value}</div>
        <div className="text-[10px] text-slate-500">{sub}</div>
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-slate-800/90 bg-slate-900/70 p-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={`font-mono text-sm font-bold ${accent}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="mt-0.5 font-medium text-slate-100">{value}</div>
    </div>
  );
}
