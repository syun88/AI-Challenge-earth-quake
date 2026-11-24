"use client";

import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Compass,
  Database,
  Layers,
  Map as MapIcon,
  MessageSquareHeart,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export type WorkspacePanel =
  | "none"
  | "report"
  | "safety"
  | "shelter"
  | "nav"
  | "ai"
  | "stats";

interface FloatingHeaderProps {
  activePanel: WorkspacePanel;
  onTogglePanel: (panel: WorkspacePanel) => void;
  wards: string[];
  selectedWard: string;
  onSelectWard: (ward: string) => void;
  displayOpen: boolean;
  onToggleDisplay: () => void;
  onOpenSources: () => void;
  reportCount: number;
  boardCount: number;
  blockedRoadCount: number;
  hasActiveRoute: boolean;
  geminiConfigured: boolean;
}

export function FloatingHeader({
  activePanel,
  onTogglePanel,
  wards,
  selectedWard,
  onSelectWard,
  displayOpen,
  onToggleDisplay,
  onOpenSources,
  reportCount,
  boardCount,
  blockedRoadCount,
  hasActiveRoute,
  geminiConfigured,
}: FloatingHeaderProps) {
  const toggle = (panel: WorkspacePanel) => {
    onTogglePanel(activePanel === panel ? "none" : panel);
  };

  return (
    <>
      {/* Top Floating Bar */}
      <header className="pointer-events-none fixed inset-x-3 top-3 z-30 flex items-center justify-between gap-2">
        {/* Left: Brand + Ward Filter */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 shadow-xl backdrop-blur-xl">
          <Link
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onTogglePanel("none");
            }}
            className="flex items-center gap-2"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-sm">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="hidden sm:block">
              <div className="text-xs font-extrabold tracking-tight text-white">
                QuakeLens
              </div>
              <div className="text-[10px] text-slate-400">京都市防災支援</div>
            </div>
          </Link>

          <div className="h-5 w-px bg-slate-800" />

          <select
            aria-label="対象地域（行政区）"
            data-testid="ward-select"
            value={selectedWard}
            onChange={(e) => onSelectWard(e.target.value)}
            className="rounded-xl border border-slate-700/80 bg-slate-950/90 px-2.5 py-1.5 text-xs font-semibold text-white outline-none transition hover:border-slate-500"
          >
            <option value="all">京都市 全域 (11区)</option>
            {wards.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        {/* Center Desktop Nav Pills */}
        <nav
          aria-label="主要機能ナビゲーション"
          className="pointer-events-auto hidden items-center gap-1 rounded-2xl border border-slate-700/80 bg-slate-900/90 p-1 shadow-xl backdrop-blur-xl lg:flex"
        >
          <NavPill
            testId="nav-tab-report"
            active={activePanel === "report"}
            onClick={() => toggle("report")}
            icon={<AlertTriangle className="h-3.5 w-3.5 text-rose-400" />}
            label="被害報告"
            badge={reportCount > 0 ? String(reportCount) : undefined}
            activeClass="bg-rose-500/20 text-rose-100 border-rose-400/70"
          />
          <NavPill
            testId="nav-tab-safety"
            active={activePanel === "safety"}
            onClick={() => toggle("safety")}
            icon={<MessageSquareHeart className="h-3.5 w-3.5 text-sky-400" />}
            label="安否確認"
            badge={boardCount > 0 ? String(boardCount) : undefined}
            activeClass="bg-sky-500/20 text-sky-100 border-sky-400/70"
          />
          <NavPill
            testId="nav-tab-shelter"
            active={activePanel === "shelter"}
            onClick={() => toggle("shelter")}
            icon={<ShieldCheck className="h-3.5 w-3.5 text-teal-400" />}
            label="避難場所推薦"
            activeClass="bg-teal-500/20 text-teal-100 border-teal-400/70"
          />
          <NavPill
            testId="nav-tab-nav"
            active={activePanel === "nav"}
            onClick={() => toggle("nav")}
            icon={<Compass className="h-3.5 w-3.5 text-emerald-400" />}
            label="避難・救援ナビ"
            badge={
              hasActiveRoute
                ? "案内中"
                : blockedRoadCount > 0
                  ? `閉鎖${blockedRoadCount}`
                  : undefined
            }
            activeClass="bg-emerald-500/20 text-emerald-100 border-emerald-400/70"
          />
          <NavPill
            testId="nav-tab-ai"
            active={activePanel === "ai"}
            onClick={() => toggle("ai")}
            icon={<Sparkles className="h-3.5 w-3.5 text-amber-300" />}
            label="AI分析"
            dotColor={geminiConfigured ? "bg-emerald-400" : "bg-amber-400"}
            activeClass="bg-amber-500/20 text-amber-100 border-amber-400/70"
          />
          <NavPill
            testId="nav-tab-stats"
            active={activePanel === "stats"}
            onClick={() => toggle("stats")}
            icon={<BarChart3 className="h-3.5 w-3.5 text-indigo-300" />}
            label="統計・リスク"
            activeClass="bg-indigo-500/20 text-indigo-100 border-indigo-400/70"
          />
        </nav>

        {/* Right: Display Settings + Standalone Board + Sources */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-slate-700/80 bg-slate-900/90 p-1 shadow-xl backdrop-blur-xl">
          <button
            type="button"
            data-testid="toggle-display-popover"
            onClick={onToggleDisplay}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              displayOpen
                ? "border-sky-400 bg-sky-500/20 text-white"
                : "border-transparent text-slate-200 hover:bg-slate-800"
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            <span>表示設定</span>
          </button>

          <Link
            href="/board"
            className="hidden rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white xl:inline-flex"
          >
            伝言板ページ
          </Link>

          <button
            type="button"
            data-testid="open-sources-btn"
            onClick={onOpenSources}
            title="出典・データライセンス"
            aria-label="出典・データライセンス"
            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <Database className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden sm:inline">出典</span>
          </button>
        </div>
      </header>

      {/* Mobile Bottom Dock (< lg) */}
      <nav
        aria-label="モバイルナビゲーション"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-slate-800 bg-slate-950/95 px-1 py-1.5 backdrop-blur-xl lg:hidden"
      >
        <MobileDockBtn
          active={activePanel === "none"}
          onClick={() => onTogglePanel("none")}
          icon={<MapIcon className="h-4 w-4" />}
          label="地図"
        />
        <MobileDockBtn
          testId="mobile-tab-report"
          active={activePanel === "report"}
          onClick={() => toggle("report")}
          icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
          label="被害報告"
        />
        <MobileDockBtn
          testId="mobile-tab-safety"
          active={activePanel === "safety"}
          onClick={() => toggle("safety")}
          icon={<MessageSquareHeart className="h-4 w-4 text-sky-400" />}
          label="安否確認"
        />
        <MobileDockBtn
          testId="mobile-tab-shelter"
          active={activePanel === "shelter"}
          onClick={() => toggle("shelter")}
          icon={<ShieldCheck className="h-4 w-4 text-teal-400" />}
          label="避難推薦"
        />
        <MobileDockBtn
          testId="mobile-tab-nav"
          active={activePanel === "nav"}
          onClick={() => toggle("nav")}
          icon={<Compass className="h-4 w-4 text-emerald-400" />}
          label="ナビ"
        />
        <MobileDockBtn
          testId="mobile-tab-ai"
          active={activePanel === "ai"}
          onClick={() => toggle("ai")}
          icon={<Sparkles className="h-4 w-4 text-amber-300" />}
          label="AI分析"
        />
        <MobileDockBtn
          testId="mobile-tab-stats"
          active={activePanel === "stats"}
          onClick={() => toggle("stats")}
          icon={<BarChart3 className="h-4 w-4 text-indigo-300" />}
          label="統計"
        />
      </nav>
    </>
  );
}

function NavPill({
  testId,
  active,
  onClick,
  icon,
  label,
  badge,
  dotColor,
  activeClass,
}: {
  testId: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  dotColor?: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? activeClass
          : "border-transparent text-slate-300 hover:bg-slate-800/80 hover:text-white"
      }`}
    >
      {icon}
      <span>{label}</span>
      {dotColor && <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />}
      {badge && (
        <span className="rounded-full bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
          {badge}
        </span>
      )}
    </button>
  );
}

function MobileDockBtn({
  testId,
  active,
  onClick,
  icon,
  label,
}: {
  testId?: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10px] font-semibold transition ${
        active ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
