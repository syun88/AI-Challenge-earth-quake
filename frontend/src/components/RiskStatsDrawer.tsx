"use client";

import React, { useEffect, useState } from "react";
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
  AlertTriangle,
  BarChart3,
  Building2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Home,
  Landmark,
  Loader2,
  MapPin,
  MessageSquareHeart,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import {
  buildDisasterCsvUrl,
  buildDisasterXlsxUrl,
  downloadAuthenticatedFile,
  getEnterpriseSafeSites,
  getHistoricResidentialPriorities,
  getR8SeismicList,
  locateR8Record,
  locateR8Unlisted,
} from "@/lib/api";
import EnterpriseAssetsPanel from "@/components/EnterpriseAssetsPanel";
import {
  AGE_COLORS,
  AGE_LABELS,
  HAZARD_COLORS,
  HAZARD_SHORT_LABELS,
} from "@/lib/colors";
import {
  AgeCategory,
  BcpPurpose,
  BcpSiteCandidate,
  BcpSiteResponse,
  BoardSummaryResponse,
  DamageReportSummaryResponse,
  EnterpriseAsset,
  HazardTier,
  HistoricResidentialFocus,
  HistoricResidentialMeshCandidate,
  HistoricResidentialResponse,
  HistoricResidentialSampleBuilding,
  PriorityArea,
  R8LocateResponse,
  R8SeismicListResponse,
  R8UnlistedLocateResponse,
  StatsResponse,
  UserRole,
} from "@/types/quakelens";

const ALL_AGE_CATS: AgeCategory[] = ["pre_1981", "1982_2000", "post_2001", "unknown"];
const ALL_HAZARD_TIERS: HazardTier[] = ["very_high", "elevated", "moderate", "low"];

interface RiskStatsDrawerProps {
  userRole: UserRole;
  userUid: string;
  organizationName?: string;
  selectedWard: string;
  selectedMeshcode: string | null;
  includeSamples: boolean;
  stats: StatsResponse | null;
  boardSummary: BoardSummaryResponse | null;
  reportSummary: DamageReportSummaryResponse | null;
  priorityAreas: PriorityArea[];
  sortBy: string;
  onChangeSortBy: (s: string) => void;
  ageCategories: AgeCategory[];
  hazardTiers: HazardTier[];
  onToggleAgeCategory: (cat: AgeCategory) => void;
  onToggleHazardTier: (tier: HazardTier) => void;
  onSelectPriorityArea: (area: PriorityArea) => void;
  onSelectR8Record?: (loc: R8LocateResponse) => void;
  onSelectR8Unlisted?: (loc: R8UnlistedLocateResponse) => void;
  statsTab?: "risk" | "bcp" | "shared_assets" | "heritage";
  onChangeStatsTab?: (tab: "risk" | "bcp" | "shared_assets" | "heritage") => void;
  onSelectBcpSite?: (site: BcpSiteCandidate) => void;
  onSelectHeritageMesh?: (mesh: HistoricResidentialMeshCandidate) => void;
  onSelectHeritageBuilding?: (bldg: HistoricResidentialSampleBuilding) => void;
  onSelectEnterpriseAsset?: (asset: EnterpriseAsset) => void;
  onSelectWardFilter?: (ward: string) => void;
  onOpenSafety: () => void;
  onOpenReports: () => void;
}

export function RiskStatsDrawer({
  userRole,
  userUid,
  organizationName = "",
  selectedWard,
  selectedMeshcode,
  includeSamples,
  stats,
  boardSummary,
  reportSummary,
  priorityAreas,
  sortBy,
  onChangeSortBy,
  ageCategories,
  hazardTiers,
  onToggleAgeCategory,
  onToggleHazardTier,
  onSelectPriorityArea,
  onSelectR8Record,
  onSelectR8Unlisted,
  statsTab: controlledStatsTab,
  onChangeStatsTab,
  onSelectBcpSite,
  onSelectHeritageMesh,
  onSelectHeritageBuilding,
  onSelectEnterpriseAsset,
  onSelectWardFilter,
  onOpenSafety,
  onOpenReports,
}: RiskStatsDrawerProps) {
  const [internalTab, setInternalTab] = useState<"risk" | "bcp" | "shared_assets" | "heritage">("risk");
  const rawTab = controlledStatsTab ?? internalTab;
  const activeTab: "risk" | "bcp" | "shared_assets" | "heritage" =
    rawTab === "bcp" && userRole !== "enterprise"
      ? "risk"
      : rawTab === "shared_assets" && userRole !== "government"
        ? "risk"
        : rawTab;
  const setActiveTab = (next: "risk" | "bcp" | "shared_assets" | "heritage") => {
    setInternalTab(next);
    onChangeStatsTab?.(next);
  };
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [r8Query, setR8Query] = useState("");
  const [r8Data, setR8Data] = useState<R8SeismicListResponse | null>(null);
  const [r8LocatingId, setR8LocatingId] = useState<string | null>(null);

  const [bcpPurpose, setBcpPurpose] = useState<BcpPurpose>("datacenter_server");
  const [bcpAvoidMountain, setBcpAvoidMountain] = useState(true);
  const [bcpData, setBcpData] = useState<BcpSiteResponse | null>(null);
  const [bcpLoading, setBcpLoading] = useState(false);

  const [heritageFocus, setHeritageFocus] = useState<HistoricResidentialFocus>("all");
  const [heritageData, setHeritageData] = useState<HistoricResidentialResponse | null>(null);
  const [heritageLoading, setHeritageLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== "heritage") return;
    let cancelled = false;
    getHistoricResidentialPriorities({
      ward: selectedWard,
      focus: heritageFocus,
      limit: 6,
    })
      .then((res) => {
        if (!cancelled) {
          setHeritageData(res);
          setHeritageLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setHeritageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedWard, heritageFocus]);

  useEffect(() => {
    if (activeTab !== "bcp" || userRole !== "enterprise") return;
    let cancelled = false;
    getEnterpriseSafeSites({
      ward: selectedWard,
      purpose: bcpPurpose,
      avoidMountain: bcpAvoidMountain,
      limit: 6,
    })
      .then((res) => {
        if (!cancelled) {
          setBcpData(res);
          setBcpLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setBcpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, userRole, selectedWard, bcpPurpose, bcpAvoidMountain]);

  useEffect(() => {
    let cancelled = false;
    getR8SeismicList({ ward: selectedWard, q: r8Query, limit: 8 })
      .then((res) => {
        if (!cancelled) setR8Data(res);
      })
      .catch(() => {
        // ignore transient error
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWard, r8Query]);

  const isAgeFiltered = ageCategories.length < ALL_AGE_CATS.length;
  const isHazardFiltered = hazardTiers.length < ALL_HAZARD_TIERS.length;

  const ageData = (stats?.age_breakdown ?? []).map((item) => ({
    ...item,
    shortLabel:
      item.key === "pre_1981"
        ? "1981以前"
        : item.key === "1982_2000"
          ? "1982〜00"
          : item.key === "post_2001"
            ? "2001以降"
            : "不明",
  }));

  const crossData = (stats?.cross_tab ?? []).map((row) => ({
    ...row,
    shortLabel: HAZARD_SHORT_LABELS[row.hazard_tier] ?? row.hazard_label,
  }));

  return (
    <div className="space-y-4 p-4 text-sm text-slate-200">
      {/* Header + Authenticated Role-Scoped Export */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold text-white">
          <BarChart3 className="h-5 w-5 text-sky-400" />
          <span>災害統計・建物リスク分析</span>
        </div>
        <div className="flex items-center gap-1.5">
          {userRole === "government" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setExportErr(null);
                  void downloadAuthenticatedFile(
                    buildDisasterCsvUrl({
                      scope: "overview",
                      ward: selectedWard,
                      includeSamples,
                    }),
                    "quakelens_kyoto_overview.csv"
                  ).catch((err) =>
                    setExportErr(err instanceof Error ? err.message : "CSV出力失敗")
                  );
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-sky-300 hover:border-sky-500/60"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportErr(null);
                  void downloadAuthenticatedFile(
                    buildDisasterXlsxUrl({
                      ward: selectedWard,
                      includeSamples,
                    }),
                    "quakelens_kyoto_summary.xlsx"
                  ).catch((err) =>
                    setExportErr(err instanceof Error ? err.message : "Excel出力失敗")
                  );
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:border-emerald-500/60"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </button>
            </>
          )}
          {userRole === "enterprise" && (
            <button
              type="button"
              onClick={() => {
                setExportErr(null);
                void downloadAuthenticatedFile(
                  buildDisasterCsvUrl({
                    scope: "wards",
                    ward: selectedWard,
                    includeSamples,
                  }),
                  "quakelens_kyoto_wards.csv"
                ).catch((err) =>
                  setExportErr(err instanceof Error ? err.message : "CSV出力失敗")
                );
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-sky-300 hover:border-sky-500/60"
            >
              <Download className="h-3.5 w-3.5" /> 区別集計CSV
            </button>
          )}
        </div>
      </div>

      {exportErr && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-2.5 py-1.5 text-[11px] text-rose-200">
          {exportErr}
        </div>
      )}

      {/* Role-scoped Sub-Tab Switcher (all roles include Historic & Residential Priorities) */}
      <div
        className={`grid gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1 text-[11px] ${
          userRole === "enterprise" || userRole === "government" ? "grid-cols-3" : "grid-cols-2"
        }`}
      >
        <button
          type="button"
          data-testid="stats-tab-risk"
          onClick={() => setActiveTab("risk")}
          className={`inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 font-semibold transition ${
            activeTab === "risk"
              ? "bg-slate-800 text-sky-200 shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">建物リスク・R8</span>
        </button>
        <button
          type="button"
          data-testid="stats-tab-heritage"
          onClick={() => {
            setHeritageLoading(true);
            setActiveTab("heritage");
          }}
          className={`inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 font-semibold transition ${
            activeTab === "heritage"
              ? "border border-amber-500/40 bg-amber-500/20 text-amber-100 shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Landmark className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">歴史・住宅対策</span>
        </button>
        {userRole === "enterprise" && (
          <button
            type="button"
            data-testid="stats-tab-bcp"
            onClick={() => {
              setBcpLoading(true);
              setActiveTab("bcp");
            }}
            className={`inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 font-semibold transition ${
              activeTab === "bcp"
                ? "border border-emerald-500/40 bg-emerald-500/20 text-emerald-200 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Server className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">企業BCP立地</span>
          </button>
        )}
        {userRole === "government" && (
          <button
            type="button"
            data-testid="stats-tab-shared-assets"
            onClick={() => setActiveTab("shared_assets")}
            className={`inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 font-semibold transition ${
              activeTab === "shared_assets"
                ? "border border-amber-500/40 bg-amber-500/20 text-amber-200 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">共有・企業拠点</span>
          </button>
        )}
      </div>

      {activeTab === "heritage" && (
        <div className="space-y-3" data-testid="heritage-residential-panel">
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 font-bold text-amber-200">
                  <Landmark className="h-4 w-4 text-amber-400" />
                  <span>歴史的建造物 × 住宅系 優先順位と解決策提案</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                  京町家・伝統木造（1950年以前）や旧耐震・81-00基準住宅を対象に、J-SHIS揺れ確率・表層地盤・PLATEAU築年から
                  <strong>P1〜P4の対策優先順位</strong>と京都市公式助成を活用した具体策を提示します。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {(
                [
                  { id: "all", label: "総合優先", sub: "歴史＋住宅系" },
                  { id: "historic", label: "歴史的建物", sub: "〜1950・伝統木造" },
                  { id: "residential", label: "住宅系", sub: "旧耐震・81-00木造" },
                ] as const
              ).map((f) => {
                const active = heritageFocus === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    data-testid={`heritage-focus-${f.id}`}
                    onClick={() => {
                      setHeritageLoading(true);
                      setHeritageFocus(f.id);
                    }}
                    className={`rounded-xl border p-2 text-left transition ${
                      active
                        ? "border-amber-400 bg-amber-500/20 text-white"
                        : "border-slate-700/80 bg-slate-900/70 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <div className="text-[11px] font-bold">{f.label}</div>
                    <div className="text-[9px] text-slate-400">{f.sub}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {heritageLoading && !heritageData && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              <span>歴史的建物・住宅系の優先順位を解析しています...</span>
            </div>
          )}

          {heritageData && (
            <>
              {/* P1-P4 Summary Counts */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-rose-500/40 bg-rose-950/25 p-2.5">
                  <div className="text-[10px] text-rose-200">P1 最優先（〜1950歴史×高危険）</div>
                  <div className="font-mono text-base font-extrabold text-rose-300">
                    {heritageData.counts.p1.toLocaleString("ja-JP")}棟
                  </div>
                  <div className="text-[10px] text-slate-400">
                    1950以前計 {heritageData.counts.historic_pre1950.toLocaleString("ja-JP")}棟
                  </div>
                </div>
                <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-2.5">
                  <div className="text-[10px] text-amber-200">P2 高優先（旧耐震住宅等）</div>
                  <div className="font-mono text-base font-extrabold text-amber-300">
                    {heritageData.counts.p2.toLocaleString("ja-JP")}棟
                  </div>
                  <div className="text-[10px] text-slate-400">
                    住宅系計 {heritageData.counts.residential_total.toLocaleString("ja-JP")}棟
                  </div>
                </div>
                <div className="rounded-xl border border-sky-500/40 bg-sky-950/20 p-2.5">
                  <div className="text-[10px] text-sky-200">P3 中優先（81-00木造等）</div>
                  <div className="font-mono text-base font-extrabold text-sky-300">
                    {heritageData.counts.p3.toLocaleString("ja-JP")}棟
                  </div>
                  <div className="text-[10px] text-slate-400">接合金物補強・家具固定</div>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/75 p-2.5">
                  <div className="text-[10px] text-slate-300">P4 把握優先（築年不明）</div>
                  <div className="font-mono text-base font-extrabold text-slate-100">
                    {heritageData.counts.p4.toLocaleString("ja-JP")}棟
                  </div>
                  <div className="text-[10px] text-slate-400">登記・無料診断で築年確定</div>
                </div>
              </div>

              {/* Priority Tiers + Concrete Solutions */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
                  <Wrench className="h-3.5 w-3.5 text-amber-400" />
                  <span>優先順位別 解決方法提案（P1 → P4）</span>
                </div>
                {heritageData.priority_tiers.map((tier) => (
                  <div
                    key={tier.tier}
                    data-testid={`heritage-tier-${tier.tier}`}
                    className={`space-y-2 rounded-xl border p-3 text-xs ${
                      tier.tier === "P1"
                        ? "border-rose-500/45 bg-rose-950/20"
                        : tier.tier === "P2"
                          ? "border-amber-500/45 bg-amber-950/20"
                          : tier.tier === "P3"
                            ? "border-sky-500/35 bg-sky-950/15"
                            : "border-slate-700 bg-slate-900/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-white">
                            {tier.tier}・{tier.urgency_label}
                          </span>
                          <span className="font-mono text-[11px] font-bold text-slate-200">
                            {tier.building_count.toLocaleString("ja-JP")}棟
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] font-bold text-white">{tier.title}</div>
                      </div>
                    </div>
                    <p className="text-[10px] leading-relaxed text-slate-400">
                      対象: {tier.target_criteria}
                    </p>
                    <div className="space-y-1.5">
                      {tier.solutions.map((sol, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg border border-slate-800/90 bg-slate-950/70 px-2.5 py-1.5"
                        >
                          <div className="text-[10px] font-bold text-amber-200">
                            [{sol.kind}] {sol.action}
                          </div>
                          <div className="mt-0.5 text-[10px] leading-relaxed text-slate-300">
                            {sol.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Official Subsidy Programs */}
              <div className="space-y-1.5 rounded-xl border border-emerald-500/35 bg-emerald-950/15 p-3 text-xs">
                <div className="font-bold text-emerald-200">京都市 公式耐震診断・補助制度</div>
                {heritageData.official_programs.map((prog) => (
                  <a
                    key={prog.url}
                    href={prog.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/75 px-2.5 py-2 text-[11px] transition hover:border-emerald-400/60"
                  >
                    <div>
                      <div className="font-semibold text-emerald-100">{prog.title}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{prog.summary}</div>
                    </div>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  </a>
                ))}
              </div>

              {/* Ward Comparative Ranking */}
              <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-200">
                    行政区別 歴史・住宅優先対策ランキング
                  </span>
                  {selectedWard !== "all" && (
                    <button
                      type="button"
                      onClick={() => onSelectWardFilter?.("all")}
                      className="text-[10px] text-cyan-300 hover:underline"
                    >
                      全区表示に戻す
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {heritageData.ward_ranking.slice(0, 6).map((w, idx) => (
                    <button
                      key={w.ward_name}
                      type="button"
                      onClick={() => onSelectWardFilter?.(w.ward_name)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition ${
                        selectedWard === w.ward_name
                          ? "border-amber-400 bg-amber-950/35"
                          : "border-slate-800/80 bg-slate-900/60 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-amber-300">
                          {idx + 1}.
                        </span>
                        <span className="font-bold text-white">{w.ward_name}</span>
                        <span className="text-[10px] text-slate-400">
                          〜1950: {w.historic_pre1950_count.toLocaleString("ja-JP")}棟
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-rose-300">
                        P1 {w.p1_count.toLocaleString("ja-JP")} / P2 {w.p2_count.toLocaleString("ja-JP")}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Priority 250m Meshes */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-300">
                  重点対策エリア Top {heritageData.priority_meshes.length}（クリックで地図へ移動）
                </div>
                {heritageData.priority_meshes.map((m) => (
                  <button
                    key={m.meshcode}
                    type="button"
                    data-testid={`heritage-mesh-card-${m.rank}`}
                    onClick={() => onSelectHeritageMesh?.(m)}
                    className="w-full space-y-1.5 rounded-xl border border-slate-700/80 bg-slate-900/75 p-2.5 text-left text-xs transition hover:border-amber-400/70 hover:bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-bold text-white">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-slate-950">
                          {m.rank}
                        </span>
                        <span>
                          {m.ward_name} ／ {m.jname}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                          {m.meshcode}
                        </span>
                      </div>
                      <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-200">
                        {m.dominant_priority}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-300">
                      P1(〜1950高危険): <strong>{m.p1_count}</strong>棟 / 旧耐震住宅:{" "}
                      <strong>{m.pre_1981_residential_count}</strong>棟 / 6弱+{" "}
                      {m.t30_i55_ps != null ? `${(m.t30_i55_ps * 100).toFixed(1)}%` : "—"}
                    </div>
                    <div className="text-[10px] text-amber-200/90">{m.recommended_action}</div>
                  </button>
                ))}
              </div>

              {/* Sample Concrete Historic / Residential Buildings */}
              {heritageData.sample_buildings.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                    <Home className="h-3.5 w-3.5 text-sky-400" />
                    <span>代表的な対象建物（クリックで建物を強調表示）</span>
                  </div>
                  {heritageData.sample_buildings.map((b) => (
                    <button
                      key={b.building_id}
                      type="button"
                      data-testid={`heritage-building-card-${b.rank}`}
                      onClick={() => onSelectHeritageBuilding?.(b)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/75 px-3 py-2 text-left text-xs transition hover:border-sky-400/70 hover:bg-slate-800"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-bold text-white">
                          <span className="rounded bg-rose-500/25 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
                            {b.priority_tier}
                          </span>
                          <span className="truncate">
                            {b.ward_name} ／ {b.year_built ? `${b.year_built}年築` : "築年不明"} ／{" "}
                            {b.usage_label}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-slate-400">
                          {b.structure_label} ・ {b.category_tag}
                        </div>
                      </div>
                      <MapPin className="h-4 w-4 shrink-0 text-sky-400" />
                    </button>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
                {heritageData.disclaimer}
              </div>
            </>
          )}
        </div>
      )}

      {userRole === "government" && activeTab === "shared_assets" && (
        <EnterpriseAssetsPanel
          userUid={userUid}
          userRole="government"
          organizationName={organizationName}
          pickedCoords={null}
          pickActive={false}
          onRequestMapPick={() => {}}
          onCancelMapPick={() => {}}
          onFocusAsset={(asset) => onSelectEnterpriseAsset?.(asset)}
        />
      )}

      {userRole === "enterprise" && activeTab === "bcp" && (
        <div className="space-y-3" data-testid="enterprise-bcp-panel">
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/25 p-3 text-xs space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 font-bold text-emerald-200">
                  <Building2 className="h-4 w-4 text-emerald-400" />
                  <span>企業向け 重要施設・BCP代替拠点 立地診断</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                  サーバー室・金庫・BCP代替拠点を京都に新設/移転する際、J-SHIS揺れ確率・地盤(ARV/AVS)・周辺旧耐震密度と『R8_list.pdf（市有耐震リスト）』の行政区インフラ耐震率から比較的安全な候補地を抽出します。
                </p>
              </div>
              {bcpData && (
                <a
                  href={bcpData.r8_pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                >
                  <span>R8_list.pdf</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {(
                [
                  { id: "datacenter_server", label: "サーバー・金庫", sub: "揺れ・地盤最重視" },
                  { id: "bcp_hq", label: "BCP代替拠点", sub: "公的R8拠点連携" },
                  { id: "logistics_storage", label: "書類・備蓄倉庫", sub: "周辺延焼回避" },
                ] as const
              ).map((p) => {
                const active = bcpPurpose === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`bcp-purpose-${p.id}`}
                    onClick={() => {
                      setBcpLoading(true);
                      setBcpPurpose(p.id);
                    }}
                    className={`rounded-xl border p-2 text-left transition ${
                      active
                        ? "border-emerald-400 bg-emerald-500/20 text-white"
                        : "border-slate-700/80 bg-slate-900/70 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <div className="text-[11px] font-bold">{p.label}</div>
                    <div className="text-[9px] text-slate-400">{p.sub}</div>
                  </button>
                );
              })}
            </div>

            <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={bcpAvoidMountain}
                onChange={(e) => {
                  setBcpLoading(true);
                  setBcpAvoidMountain(e.target.checked);
                }}
                className="rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-0"
              />
              <span>山地・急傾斜を除外し平坦な台地・扇状地を優先（建設向け）</span>
            </label>
          </div>

          {bcpLoading && !bcpData && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
              <span>安全な立地候補を解析しています...</span>
            </div>
          )}

          {bcpData && (
            <>
              {/* Ward Comparative Safety Ranking */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-200">
                    区別の比較安全度 × R8市有防災拠点適合率
                  </span>
                  {selectedWard !== "all" && (
                    <button
                      type="button"
                      onClick={() => onSelectWardFilter?.("all")}
                      className="text-[10px] text-cyan-300 hover:underline"
                    >
                      全区比較に戻す
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {bcpData.ward_ranking.slice(0, 6).map((w, idx) => (
                    <button
                      key={w.ward_name}
                      type="button"
                      onClick={() => onSelectWardFilter?.(w.ward_name)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition ${
                        selectedWard === w.ward_name
                          ? "border-emerald-400 bg-emerald-950/35"
                          : "border-slate-800/80 bg-slate-900/60 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-emerald-300">
                          {idx + 1}.
                        </span>
                        <span className="font-bold text-white">{w.ward_name}</span>
                        <span className="text-[10px] text-slate-400">
                          R8適合 {(w.r8_safe_rate * 100).toFixed(0)}% ({w.r8_safe_count}/{w.r8_total})
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-slate-300">
                        6弱+ {(w.avg_t30_i55_ps * 100).toFixed(1)}% / ARV {w.avg_arv}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Top 6 Safe 250m Mesh Recommendations */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    推奨安全エリア Top {bcpData.recommendations.length}（クリックで地図へ移動）
                  </span>
                  <span>
                    {selectedWard === "all" ? "京都市全域" : selectedWard}
                  </span>
                </div>

                {bcpData.recommendations.map((site) => (
                  <button
                    key={site.meshcode}
                    type="button"
                    data-testid={`bcp-site-card-${site.rank}`}
                    onClick={() => onSelectBcpSite?.(site)}
                    className="w-full space-y-2 rounded-xl border border-slate-700/80 bg-slate-900/75 p-3 text-left transition hover:border-emerald-400/70 hover:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-slate-950">
                            {site.rank}
                          </span>
                          <span className="text-xs font-bold text-white">
                            {site.ward_name} ／ {site.jname}
                          </span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                            {site.meshcode}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-xs font-extrabold text-emerald-300">
                          安全度 {site.safety_score}点
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {site.hazard_label.split("（")[0]}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-1 text-center font-mono text-[10px]">
                      <div className="rounded border border-slate-800 bg-slate-950/70 px-1.5 py-1">
                        <div className="text-[9px] text-slate-400">震度6弱+</div>
                        <div className="font-bold text-emerald-200">
                          {(site.t30_i55_ps * 100).toFixed(2)}%
                        </div>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950/70 px-1.5 py-1">
                        <div className="text-[9px] text-slate-400">地盤 ARV</div>
                        <div className="font-bold text-cyan-200">{site.arv.toFixed(2)}</div>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950/70 px-1.5 py-1">
                        <div className="text-[9px] text-slate-400">S波 AVS</div>
                        <div className="font-bold text-slate-100">
                          {site.avs != null ? `${site.avs.toFixed(0)}` : "—"}
                        </div>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950/70 px-1.5 py-1">
                        <div className="text-[9px] text-slate-400">周辺旧耐震</div>
                        <div className="font-bold text-amber-200">
                          {site.pre_1981_count}/{site.total_buildings}
                        </div>
                      </div>
                    </div>

                    {site.reasons.length > 0 && (
                      <ul className="space-y-0.5 text-[10px] text-slate-300">
                        {site.reasons.slice(0, 3).map((r, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {site.r8_ward_stats.sample_safe_facilities.length > 0 && (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 text-[10px] text-slate-300">
                        周辺R8適合拠点: {site.r8_ward_stats.sample_safe_facilities.slice(0, 2).join("・")}
                      </div>
                    )}

                    {site.cautions.length > 0 && (
                      <div className="rounded-lg border border-amber-500/35 bg-amber-950/25 px-2 py-1 text-[10px] text-amber-200">
                        留意点: {site.cautions[0]}
                      </div>
                    )}

                    <div className="text-[10px] leading-snug text-cyan-200/90">
                      {site.bcp_guidance}
                    </div>
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
                {bcpData.disclaimer}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "risk" && (
        <>
      {/* Live Safety + Damage KPI Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onOpenSafety}
          className="rounded-xl border border-sky-500/35 bg-sky-500/10 p-3 text-left transition hover:bg-sky-500/20"
        >
          <div className="flex items-center justify-between text-xs text-sky-300">
            <span>災害用伝言板</span>
            <MessageSquareHeart className="h-4 w-4" />
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-white">
            {boardSummary?.total_entries ?? 0}件
          </div>
          <div className="text-[11px] text-slate-400">
            市民 {boardSummary?.user_entries_count ?? 0} / 訓練 {boardSummary?.sample_entries_count ?? 0}
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenReports}
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-left transition hover:bg-amber-500/20"
        >
          <div className="flex items-center justify-between text-xs text-amber-300">
            <span>被害報告（継続中）</span>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-white">
            {reportSummary?.total_reports ?? 0}件
          </div>
          <div className="text-[11px] text-amber-200/90">
            未確認 {reportSummary?.unverified_count ?? 0} / 訓練 {reportSummary?.demo_sample_count ?? 0}
          </div>
        </button>
      </div>

      {/* Building Risk Summary */}
      {stats && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs">
          <div className="mb-2 flex items-center justify-between font-semibold text-slate-200">
            <span>対象範囲の建物データ</span>
            <span className="font-mono text-sky-300">
              {stats.scope.ward === "all" ? "京都市全域" : stats.scope.ward}
              {stats.scope.meshcode ? ` (${stats.scope.meshcode})` : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <KpiBox
              label="表示条件内の棟数"
              value={`${stats.total_buildings.toLocaleString("ja-JP")}棟`}
              sub={`母数 ${stats.scope.scope_denominator_buildings.toLocaleString("ja-JP")}棟`}
            />
            <KpiBox
              label="建築年判明率"
              value={`${(stats.known_year_rate * 100).toFixed(1)}%`}
              sub={`不明 ${stats.unknown_year_count.toLocaleString("ja-JP")}棟`}
            />
            <KpiBox
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
            <KpiBox
              label="高ハザード×1981以前"
              value={`${stats.overlap_very_high_pre1981.toLocaleString("ja-JP")}棟`}
              sub={`6%以上合計 ${stats.overlap_elevated_or_higher_pre1981.toLocaleString("ja-JP")}棟`}
              accent="text-fuchsia-300"
              onClick={() => onToggleHazardTier("very_high")}
            />
          </div>
        </div>
      )}

      {/* R8 Municipal Seismic List Cross-Check: Prioritize Unlisted Buildings */}
      {r8Data && (
        <div
          data-testid="r8-unlisted-priority-card"
          className="space-y-2.5 rounded-xl border border-amber-500/45 bg-amber-950/20 p-3.5 text-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 font-bold text-amber-200">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                <span>R8市有耐震リスト未掲載建物の優先耐震示唆</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                {r8Data.unlisted_policy}
              </p>
            </div>
            <a
              href={r8Data.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/25"
            >
              <span>R8_list.pdf</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-slate-800 bg-slate-950/75 px-2.5 py-2">
              <div className="text-slate-400">表掲載（市有建築物）</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">
                {r8Data.total_listed.toLocaleString("ja-JP")}棟
              </div>
              <div className="text-[10px] text-slate-400">
                新耐震 {r8Data.grade_counts["新耐震"] ?? 0} / Ⅲ {r8Data.grade_counts["Ⅲ"] ?? 0} / 要対策{" "}
                {(r8Data.grade_counts["Ⅰ"] ?? 0) +
                  (r8Data.grade_counts["Ⅱ"] ?? 0) +
                  (r8Data.grade_counts["未診断"] ?? 0)}
              </div>
            </div>
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/35 px-2.5 py-2">
              <div className="text-rose-200">表未掲載・優先耐震対象</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-rose-300">
                {stats
                  ? (stats.pre_1981_count + stats.unknown_year_count).toLocaleString("ja-JP")
                  : "—"}
                棟
              </div>
              <div className="text-[10px] text-rose-200/80">
                旧耐震＋年不明（一般・民有等）
              </div>
            </div>
          </div>

          {/* Search R8 List to verify if a building is unlisted */}
          <div className="space-y-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                data-testid="r8-facility-search"
                value={r8Query}
                onChange={(e) => setR8Query(e.target.value)}
                placeholder="施設名でR8_list.pdf掲載有無を検索（未掲載＝優先耐震対象）"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-2.5 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
              />
            </div>

            {r8Query.trim() && (
              r8Data.filtered_count === 0 ? (
                <div
                  data-testid="r8-search-unlisted-alert"
                  className="space-y-2 rounded-lg border border-rose-500/60 bg-rose-950/45 px-2.5 py-2 text-[11px] text-rose-100"
                >
                  <div>
                    <strong>「{r8Query.trim()}」は R8_list.pdf に未掲載です。</strong>
                    公的耐震リスト対象外の建物として、<strong>優先的に耐震診断・耐震改修</strong>を実施することを推奨します。
                  </div>
                  <button
                    type="button"
                    data-testid="r8-unlisted-locate-btn"
                    disabled={r8LocatingId === "__unlisted__"}
                    onClick={async () => {
                      setR8LocatingId("__unlisted__");
                      try {
                        const loc = await locateR8Unlisted({
                          q: r8Query.trim(),
                          ward: selectedWard,
                        });
                        onSelectR8Unlisted?.(loc);
                      } finally {
                        setR8LocatingId(null);
                      }
                    }}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-400/60 bg-rose-500/25 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-rose-500/40 disabled:opacity-50"
                  >
                    {r8LocatingId === "__unlisted__" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MapPin className="h-3.5 w-3.5" />
                    )}
                    <span>この場所の地図へ飛んで詳細・ハザードを見る</span>
                  </button>
                </div>
              ) : (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/75 p-1.5 text-[10px]">
                  {r8Data.records.map((rec) => {
                    const isBusy = r8LocatingId === rec.id;
                    return (
                      <button
                        key={rec.id}
                        type="button"
                        data-testid={`r8-search-item-${rec.id}`}
                        disabled={Boolean(r8LocatingId)}
                        onClick={async () => {
                          setR8LocatingId(rec.id);
                          try {
                            const loc = await locateR8Record(rec.id);
                            onSelectR8Record?.(loc);
                          } finally {
                            setR8LocatingId(null);
                          }
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-amber-400/50 hover:bg-slate-900 disabled:opacity-60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-slate-100">
                            {rec.name}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {rec.ward} ／ {rec.structure} {rec.storeys ?? "?"}階 ／ {rec.era}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono font-bold ${
                              rec.needs_retrofit
                                ? "bg-rose-500/25 text-rose-200"
                                : "bg-emerald-500/20 text-emerald-200"
                            }`}
                          >
                            {rec.seismic_grade}
                          </span>
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
                          ) : (
                            <MapPin className="h-3.5 w-3.5 text-sky-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Chart 1: Age breakdown */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-200">築年区分別の建物数</h3>
          <span className="text-[11px] text-slate-400">クリックで地図絞込</span>
        </div>
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ageData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <XAxis
                dataKey="shortLabel"
                tick={{ fill: "#cbd5e1", fontSize: 11 }}
                axisLine={{ stroke: "#334155" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
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
                  fontSize: "12px",
                }}
                formatter={(val) => [`${Number(val ?? 0).toLocaleString("ja-JP")}棟`, "建物数"]}
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

      {/* Chart 2: Hazard x Age */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-200">地震ハザード区分 × 築年区分</h3>
          <span className="text-[11px] text-slate-400">クリックで地図絞込</span>
        </div>
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={crossData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <XAxis
                dataKey="shortLabel"
                tick={{ fill: "#cbd5e1", fontSize: 11 }}
                axisLine={{ stroke: "#334155" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
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
                  fontSize: "12px",
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

      {/* Priority Confirmation Areas */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-slate-200">優先確認エリア（250mメッシュ）</h3>
            <p className="text-[11px] text-slate-400">行クリックで該当エリアへ移動</p>
          </div>
          <select
            value={sortBy}
            onChange={(e) => onChangeSortBy(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          >
            <option value="pre_1981_high_hazard">高ハザード×1981以前</option>
            <option value="pre_1981_count">1981以前棟数順</option>
            <option value="t30_i55_ps">震度6弱+確率順</option>
            <option value="pre_1981_share_known">1981以前割合順</option>
          </select>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
          {priorityAreas.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center text-xs text-slate-400">
              現在の絞込条件に一致するメッシュがありません。
            </div>
          ) : (
            priorityAreas.map((area, idx) => {
              const isSelected = selectedMeshcode === area.meshcode;
              return (
                <button
                  key={area.meshcode}
                  type="button"
                  onClick={() => onSelectPriorityArea(area)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                    isSelected
                      ? "border-sky-400 bg-sky-950/50 ring-1 ring-sky-400/40"
                      : "border-slate-800 bg-slate-900/80 hover:border-sky-500/50 hover:bg-slate-800"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-800 font-mono text-[11px] text-sky-300">
                        {idx + 1}
                      </span>
                      <span>{area.ward_name}</span>
                      <span className="font-mono text-[11px] text-slate-400">{area.meshcode}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      総{area.total_buildings}棟 / 判明率{(area.known_year_rate * 100).toFixed(0)}% / {area.jname} (ARV {area.arv ?? "—"})
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono font-bold text-orange-400">{area.pre_1981_count}棟</div>
                    <div className="font-mono text-[11px] text-fuchsia-300">
                      {area.t30_i55_ps != null ? `${(area.t30_i55_ps * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function KpiBox({
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
        className="rounded-xl border border-slate-800/90 bg-slate-900/70 p-2.5 text-left transition hover:border-slate-600 hover:bg-slate-800/80"
      >
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className={`mt-0.5 font-mono text-base font-bold ${accent}`}>{value}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-slate-800/90 bg-slate-900/70 p-2.5">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-bold ${accent}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}
