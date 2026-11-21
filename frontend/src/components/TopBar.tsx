"use client";

import React from "react";
import {
  ShieldAlert,
  Info,
  Building2,
  Layers,
  Sparkles,
  MessageSquareHeart,
  AlertTriangle,
  PlusCircle,
} from "lucide-react";
import {
  BoardSummaryResponse,
  DamageReportSummaryResponse,
  StatsResponse,
} from "@/types/quakelens";

interface TopBarProps {
  stats: StatsResponse | null;
  boardSummary: BoardSummaryResponse | null;
  reportSummary: DamageReportSummaryResponse | null;
  selectedWard: string;
  geminiConfigured: boolean;
  onOpenSources: () => void;
  onOpenSafetyTab: () => void;
  onOpenReportsTab: () => void;
  onOpenAiTab: () => void;
  onToggleMobileLeft?: () => void;
}

export function TopBar({
  stats,
  boardSummary,
  reportSummary,
  selectedWard,
  geminiConfigured,
  onOpenSources,
  onOpenSafetyTab,
  onOpenReportsTab,
  onOpenAiTab,
  onToggleMobileLeft,
}: TopBarProps) {
  const total = stats?.total_buildings ?? 0;
  const knownRate = stats ? (stats.known_year_rate * 100).toFixed(1) : "—";
  const overlapHigh = stats?.overlap_elevated_or_higher_pre1981 ?? 0;
  const boardTotal = boardSummary?.total_entries ?? 0;
  const reportTotal = reportSummary?.total_reports ?? 0;
  const reportUnverified = reportSummary?.unverified_count ?? 0;

  return (
    <header className="shrink-0 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Brand & Scope */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 shadow-md shadow-orange-950/50">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-white">
                QuakeLens Japan
              </h1>
              <span className="rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
                京都市{selectedWard !== "all" ? `・${selectedWard}` : "全域"}
              </span>
              {geminiConfigured && (
                <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <Sparkles className="h-3 w-3" /> Gemini AI Ready
                </span>
              )}
            </div>
            <p className="hidden sm:block text-[10px] text-slate-400">
              建物地震リスク（PLATEAU × J-SHIS）× 安否伝言板 × 被害状況把握・AI統合プラットフォーム
            </p>
          </div>
        </div>

        {/* Live KPI Strip */}
        <div className="hidden xl:flex items-center gap-2">
          <KpiPill
            icon={<Building2 className="h-3.5 w-3.5 text-sky-400" />}
            label="対象建物"
            value={total.toLocaleString("ja-JP")}
            unit="棟"
            sub={`判明率 ${knownRate}%`}
          />
          <KpiPill
            label="6弱+確率6%以上×1981以前"
            value={overlapHigh.toLocaleString("ja-JP")}
            unit="棟"
            accent="text-fuchsia-300"
          />
          <KpiPill
            icon={<MessageSquareHeart className="h-3.5 w-3.5 text-emerald-400" />}
            label="安否伝言板"
            value={String(boardTotal)}
            unit="件"
            accent="text-emerald-300"
            sub={`市民 ${boardSummary?.user_entries_count ?? 0}`}
            onClick={onOpenSafetyTab}
          />
          <KpiPill
            icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
            label="被害状況報告"
            value={String(reportTotal)}
            unit="件"
            accent="text-amber-300"
            sub={`未確認 ${reportUnverified}`}
            onClick={onOpenReportsTab}
          />
        </div>

        {/* Operational CTAs */}
        <div className="flex items-center gap-1.5">
          {onToggleMobileLeft && (
            <button
              type="button"
              onClick={onToggleMobileLeft}
              className="lg:hidden inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">フィルター</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSafetyTab}
            className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 transition hover:bg-sky-500/25"
          >
            <MessageSquareHeart className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden sm:inline">安否伝言板</span>
            <span className="sm:hidden">安否</span>
          </button>
          <button
            type="button"
            onClick={onOpenReportsTab}
            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/50 bg-rose-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-500/30"
          >
            <PlusCircle className="h-3.5 w-3.5 text-rose-300" />
            <span className="hidden sm:inline">被害報告</span>
            <span className="sm:hidden">報告</span>
          </button>
          <button
            type="button"
            onClick={onOpenAiTab}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            <span className="hidden sm:inline">AI分析</span>
            <span className="sm:hidden">AI</span>
          </button>
          <button
            type="button"
            onClick={onOpenSources}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-slate-700"
            title="データ出典・前提条件"
          >
            <Info className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden md:inline">出典</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function KpiPill({
  icon,
  label,
  value,
  unit,
  sub,
  accent = "text-white",
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  sub?: string;
  accent?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      {icon}
      <div className="text-left">
        <div className="text-[10px] leading-tight text-slate-400">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className={`font-mono text-sm font-bold ${accent}`}>{value}</span>
          <span className="text-[10px] text-slate-400">{unit}</span>
          {sub && <span className="ml-0.5 text-[9px] text-slate-400">({sub})</span>}
        </div>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1 transition hover:border-sky-500/50 hover:bg-slate-900"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1">
      {inner}
    </div>
  );
}
