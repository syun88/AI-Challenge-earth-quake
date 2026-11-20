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
} from "lucide-react";
import { AGE_COLORS, HAZARD_SHORT_LABELS } from "@/lib/colors";
import { AiAssistantPanel } from "@/components/AiAssistantPanel";
import {
  AgeCategory,
  BuildingDetail,
  HazardTier,
  MapAction,
  MeshDetail,
  PriorityArea,
  StatsResponse,
  UsageGroup,
} from "@/types/quakelens";

export type RightTab = "stats" | "detail" | "ai";

interface RightPanelProps {
  activeTab: RightTab;
  onChangeTab: (tab: RightTab) => void;
  stats: StatsResponse | null;
  priorityAreas: PriorityArea[];
  sortBy: string;
  onChangeSortBy: (s: string) => void;
  onSelectPriorityArea: (area: PriorityArea) => void;
  selectedBuilding: BuildingDetail | null;
  selectedMesh: MeshDetail | null;
  selectedWard: string;
  ageCategories: AgeCategory[];
  hazardTiers: HazardTier[];
  usageGroup: UsageGroup;
  is3D: boolean;
  geminiConfigured: boolean;
  queuedAiPrompt: { text: string; ts: number } | null;
  onConsumeQueuedAiPrompt: () => void;
  onRequestAiExplain: (prompt: string) => void;
  onExecuteMapAction: (action: MapAction) => void;
  onToggleAgeCategory: (cat: AgeCategory) => void;
  onToggleHazardTier: (tier: HazardTier) => void;
}

export function RightPanel({
  activeTab,
  onChangeTab,
  stats,
  priorityAreas,
  sortBy,
  onChangeSortBy,
  onSelectPriorityArea,
  selectedBuilding,
  selectedMesh,
  selectedWard,
  ageCategories,
  hazardTiers,
  usageGroup,
  is3D,
  geminiConfigured,
  queuedAiPrompt,
  onConsumeQueuedAiPrompt,
  onRequestAiExplain,
  onExecuteMapAction,
  onToggleAgeCategory,
  onToggleHazardTier,
}: RightPanelProps) {
  const ageData = stats?.age_breakdown ?? [];
  const crossData = (stats?.cross_tab ?? [])
    .filter((r) => r.hazard_tier !== "unknown" || r.total > 0)
    .map((r) => ({
      ...r,
      shortLabel: HAZARD_SHORT_LABELS[r.hazard_tier],
    }));

  return (
    <aside className="flex h-full flex-col border-l border-slate-800 bg-slate-900/95">
      {/* Tabs */}
      <div className="grid shrink-0 grid-cols-3 border-b border-slate-800 bg-slate-950/60">
        <TabButton
          active={activeTab === "stats"}
          onClick={() => onChangeTab("stats")}
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label="統計・エリア"
        />
        <TabButton
          active={activeTab === "detail"}
          onClick={() => onChangeTab("detail")}
          icon={<Building className="h-3.5 w-3.5" />}
          label="詳細・補助"
        />
        <TabButton
          active={activeTab === "ai"}
          onClick={() => onChangeTab("ai")}
          icon={<Sparkles className="h-3.5 w-3.5 text-emerald-400" />}
          label="AI防災解説"
        />
      </div>

      {/* Tab Content */}
      <div
        className={`flex-1 min-h-0 ${
          activeTab === "ai" ? "overflow-hidden p-3" : "overflow-y-auto p-3.5"
        }`}
      >
        {activeTab === "stats" && (
          <div className="space-y-4">
            {/* Denominator & Missingness Box */}
            {stats && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
                <div className="mb-1.5 flex items-center justify-between font-semibold text-slate-200">
                  <span>対象範囲サマリー</span>
                  <span className="font-mono text-[11px] text-sky-300">
                    {stats.scope.ward === "all" ? "京都市全域" : stats.scope.ward}
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
                  />
                  <MiniStat
                    label="高ハザード(26%+)×1981以前"
                    value={`${stats.overlap_very_high_pre1981.toLocaleString("ja-JP")}棟`}
                    sub={`6%以上合計 ${stats.overlap_elevated_or_higher_pre1981.toLocaleString("ja-JP")}棟`}
                    accent="text-fuchsia-300"
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
                <span className="text-[10px] text-slate-400">棒クリックで絞込</span>
              </div>
              <div className="h-44 w-full">
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
            </div>

            {/* Chart 2: Hazard x Age stacked */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-200">
                  地震ハザード区分 × 築年区分
                </h3>
                <span className="text-[10px] text-slate-400">棒クリックで絞込</span>
              </div>
              <div className="h-44 w-full">
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
            </div>

            {/* Priority Confirmation Areas (250m mesh ranking) */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-200">
                    優先確認エリア（250mメッシュ）
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    実測値ベース（行クリックで地図移動）
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
                {priorityAreas.map((area, idx) => (
                  <button
                    key={area.meshcode}
                    type="button"
                    onClick={() => onSelectPriorityArea(area)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-2 text-left text-[11px] transition hover:border-sky-500/50 hover:bg-slate-800"
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
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "detail" && (
          <div className="space-y-4 text-xs">
            {!selectedBuilding && !selectedMesh && (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-5 text-center text-slate-400">
                <Navigation className="mx-auto mb-2 h-6 w-6 text-slate-500" />
                地図上の建物ポリゴンまたは250mメッシュをクリックすると、建築年・構造・地盤・地震ハザード・公式補助制度の詳細が表示されます。
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

                <button
                  type="button"
                  onClick={() =>
                    onRequestAiExplain(
                      `現在選択中の250mメッシュ（コード: ${selectedMesh.meshcode}、${selectedMesh.ward_name}）の統計、1981年以前建築の傾向、表層地盤（${selectedMesh.jname}・ARV ${selectedMesh.arv ?? "不明"}）、震度6弱+確率、及び京都市の補助制度について詳しく解説してください。`
                    )
                  }
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-500/25"
                >
                  <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                  このメッシュをAIで詳しく解説
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
          <AiAssistantPanel
            geminiConfigured={geminiConfigured}
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
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-semibold transition ${
        active
          ? "border-sky-400 bg-slate-900 text-white"
          : "border-transparent text-slate-400 hover:bg-slate-900/50 hover:text-slate-200"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MiniStat({
  label,
  value,
  sub,
  accent = "text-white",
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
}) {
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
