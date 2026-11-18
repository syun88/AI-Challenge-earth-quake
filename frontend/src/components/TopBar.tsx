"use client";

import React from "react";
import { ShieldAlert, Info, Building2, HelpCircle, Layers, Sparkles } from "lucide-react";
import { StatsResponse } from "@/types/quakelens";

interface TopBarProps {
  stats: StatsResponse | null;
  selectedWard: string;
  geminiConfigured: boolean;
  onOpenSources: () => void;
  onToggleMobileLeft?: () => void;
  onToggleMobileRight?: () => void;
}

export function TopBar({
  stats,
  selectedWard,
  geminiConfigured,
  onOpenSources,
  onToggleMobileLeft,
  onToggleMobileRight,
}: TopBarProps) {
  const total = stats?.total_buildings ?? 0;
  const knownRate = stats ? (stats.known_year_rate * 100).toFixed(1) : "—";
  const pre81 = stats?.pre_1981_count ?? 0;
  const overlapHigh = stats?.overlap_elevated_or_higher_pre1981 ?? 0;

  return (
    <header className="shrink-0 border-b border-slate-800 bg-slate-900/95 px-3 py-2.5 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Target Municipality */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 shadow-md shadow-orange-950/50">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">
                QuakeLens Japan
              </h1>
              <span className="rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                京都市{selectedWard !== "all" ? `・${selectedWard}` : "全域"}
              </span>
              {geminiConfigured && (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <Sparkles className="h-3 w-3" /> Gemini AI Ready
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              PLATEAU 2025年度 × J-SHIS 2024年版（地震ハザード・表層地盤V4）
            </p>
          </div>
        </div>

        {/* Key KPI Pills */}
        <div className="hidden lg:flex items-center gap-2">
          <KpiPill
            icon={<Building2 className="h-3.5 w-3.5 text-sky-400" />}
            label="表示対象棟数"
            value={total.toLocaleString("ja-JP")}
            unit="棟"
          />
          <KpiPill
            icon={<HelpCircle className="h-3.5 w-3.5 text-slate-400" />}
            label="建築年判明率"
            value={knownRate}
            unit="%"
            sub={`不明 ${(stats?.unknown_year_count ?? 0).toLocaleString("ja-JP")}棟`}
          />
          <KpiPill
            label="1981年以前建築"
            value={pre81.toLocaleString("ja-JP")}
            unit="棟"
            accent="text-orange-400"
          />
          <KpiPill
            label="震度6弱+確率6%以上 × 1981以前"
            value={overlapHigh.toLocaleString("ja-JP")}
            unit="棟"
            accent="text-fuchsia-300"
          />
        </div>

        {/* Actions + Mobile Panel Toggles */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMobileLeft}
            className="lg:hidden inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            <Layers className="h-3.5 w-3.5" /> フィルター
          </button>
          <button
            type="button"
            onClick={onToggleMobileRight}
            className="lg:hidden inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            統計・AI
          </button>
          <button
            type="button"
            onClick={onOpenSources}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-700"
          >
            <Info className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden sm:inline">出典・前提条件</span>
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
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5">
      {icon}
      <div>
        <div className="text-[10px] text-slate-400 leading-tight">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className={`font-mono text-sm font-bold ${accent}`}>{value}</span>
          <span className="text-[10px] text-slate-400">{unit}</span>
          {sub && <span className="ml-1 text-[10px] text-slate-500">({sub})</span>}
        </div>
      </div>
    </div>
  );
}
