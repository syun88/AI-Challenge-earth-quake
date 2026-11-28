"use client";

import React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Compass,
  Database,
  Layers,
  LogOut,
  Map as MapIcon,
  MessageSquareHeart,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { ROLE_META } from "@/lib/firebase";
import { UserRole } from "@/types/quakelens";

export type WorkspacePanel =
  | "none"
  | "report"
  | "safety"
  | "shelter"
  | "updates"
  | "nav"
  | "ai"
  | "stats"
  | "assets";

interface FloatingHeaderProps {
  activePanel: WorkspacePanel;
  mobileDrawerMinimized?: boolean;
  onTogglePanel: (panel: WorkspacePanel) => void;
  wards: string[];
  selectedWard: string;
  onSelectWard: (ward: string) => void;
  favoriteWard?: string | null;
  onToggleSaveFavoriteWard?: () => void;
  savingFavoriteWard?: boolean;
  displayOpen: boolean;
  onToggleDisplay: () => void;
  onOpenSources: () => void;
  reportCount: number;
  boardCount: number;
  blockedRoadCount: number;
  hasActiveRoute: boolean;
  geminiConfigured: boolean;
  userRole: UserRole;
  userDisplayName: string;
  organizationName?: string;
  enterpriseAssetCount?: number;
  onLogout: () => void;
}

export function FloatingHeader({
  activePanel,
  mobileDrawerMinimized = false,
  onTogglePanel,
  wards,
  selectedWard,
  onSelectWard,
  favoriteWard = null,
  onToggleSaveFavoriteWard,
  savingFavoriteWard = false,
  displayOpen,
  onToggleDisplay,
  onOpenSources,
  reportCount,
  boardCount,
  blockedRoadCount,
  hasActiveRoute,
  geminiConfigured,
  userRole,
  userDisplayName,
  organizationName,
  enterpriseAssetCount = 0,
  onLogout,
}: FloatingHeaderProps) {
  const toggle = (panel: WorkspacePanel) => {
    // On mobile, if the active panel is currently minimized to show the map,
    // tapping the same dock tab restores the drawer instead of closing it.
    if (activePanel === panel && mobileDrawerMinimized) {
      onTogglePanel(panel);
      return;
    }
    onTogglePanel(activePanel === panel ? "none" : panel);
  };
  const roleMeta = ROLE_META[userRole];
  const navLabel =
    userRole === "government"
      ? "避難・救援ナビ"
      : userRole === "enterprise"
        ? "避難・BCP迂回"
        : "避難ナビ";
  const statsLabel =
    userRole === "government"
      ? "被害統計・管理"
      : userRole === "enterprise"
        ? "BCP・統計"
        : "ハザード統計";

  return (
    <>
      {/* Top Floating Bar */}
      <header className="pointer-events-none fixed inset-x-2 top-[calc(0.5rem+env(safe-area-inset-top,0px))] z-30 flex items-center justify-between gap-1.5 sm:inset-x-3 sm:top-3 sm:gap-2">
        {/* Left: Brand + Ward Filter */}
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1 rounded-2xl border border-slate-700/80 bg-slate-900/92 px-2 py-1 shadow-xl backdrop-blur-xl sm:flex-initial sm:shrink-0 sm:gap-2 sm:px-3 sm:py-1.5">
          <Link
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onTogglePanel("none");
            }}
            className="flex shrink-0 items-center gap-2"
            aria-label="QuakeLens ホーム（地図を表示）"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-sm">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="hidden xl:block">
              <div className="text-xs font-extrabold tracking-tight text-white">
                QuakeLens
              </div>
              <div className="text-[10px] text-slate-400">京都市防災支援</div>
            </div>
          </Link>

          <div className="h-5 w-px shrink-0 bg-slate-800" />

          <select
            aria-label="対象地域（行政区）"
            data-testid="ward-select"
            value={selectedWard}
            onChange={(e) => onSelectWard(e.target.value)}
            className="min-w-0 flex-1 truncate rounded-xl border border-slate-700/80 bg-slate-950/90 px-1.5 py-1.5 text-xs font-semibold text-white outline-none transition hover:border-slate-500 sm:flex-initial sm:max-w-[144px] sm:px-2 xl:max-w-none xl:px-2.5"
          >
            <option value="all">京都市 全域 (11区)</option>
            {wards.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>

          {onToggleSaveFavoriteWard && (
            <button
              type="button"
              data-testid="favorite-ward-button"
              disabled={savingFavoriteWard}
              onClick={onToggleSaveFavoriteWard}
              title={
                favoriteWard === selectedWard
                  ? "保存済みのお気に入り地域（クリックで解除）"
                  : "現在選択中の地域を初期表示として保存"
              }
              aria-label="お気に入り地域を保存"
              className={`flex shrink-0 items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
                favoriteWard === selectedWard
                  ? "border-amber-400/60 bg-amber-500/20 text-amber-200"
                  : "border-slate-700/80 bg-slate-950/80 text-slate-300 hover:border-slate-500 hover:text-white"
              }`}
            >
              <Star
                className={`h-3.5 w-3.5 ${
                  favoriteWard === selectedWard ? "fill-amber-400 text-amber-400" : ""
                }`}
              />
              <span className="hidden 2xl:inline">
                {favoriteWard === selectedWard ? "保存済" : "地域保存"}
              </span>
            </button>
          )}
        </div>

        {/* Center Desktop Nav Pills */}
        <nav
          aria-label="主要機能ナビゲーション"
          className="pointer-events-auto hidden min-w-0 max-w-fit items-center gap-0.5 overflow-x-auto rounded-2xl border border-slate-700/80 bg-slate-900/90 p-1 shadow-xl backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex xl:gap-1"
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
            label={navLabel}
            badge={
              hasActiveRoute
                ? "案内中"
                : blockedRoadCount > 0
                  ? `閉鎖${blockedRoadCount}`
                  : undefined
            }
            activeClass="bg-emerald-500/20 text-emerald-100 border-emerald-400/70"
          />
          {userRole === "enterprise" && (
            <NavPill
              testId="nav-tab-assets"
              active={activePanel === "assets"}
              onClick={() => toggle("assets")}
              icon={<Server className="h-3.5 w-3.5 text-emerald-300" />}
              label="非公開拠点"
              badge={enterpriseAssetCount > 0 ? String(enterpriseAssetCount) : undefined}
              activeClass="bg-emerald-500/20 text-emerald-100 border-emerald-400/70"
            />
          )}
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
            label={statsLabel}
            activeClass="bg-indigo-500/20 text-indigo-100 border-indigo-400/70"
          />
          <NavPill
            testId="nav-tab-updates"
            active={activePanel === "updates"}
            onClick={() => toggle("updates")}
            icon={<Activity className="h-3.5 w-3.5 text-cyan-300" />}
            label="防災更新・履歴"
            activeClass="bg-cyan-500/20 text-cyan-100 border-cyan-400/70"
          />
        </nav>

        {/* Right: Role Badge + Display Settings + Standalone Board + Sources + Logout */}
        <div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-2xl border border-slate-700/80 bg-slate-900/92 p-1 shadow-xl backdrop-blur-xl sm:gap-1.5">
          <div
            data-testid="active-role-badge"
            title={
              organizationName
                ? `${roleMeta.label}: ${organizationName} (${userDisplayName})`
                : `${roleMeta.label}: ${userDisplayName}`
            }
            className={`hidden items-center gap-1 rounded-xl border px-2 py-1 text-[11px] font-bold md:inline-flex ${roleMeta.badgeClass}`}
          >
            <span>{roleMeta.shortLabel}</span>
            <span className="max-w-[56px] truncate text-[10px] font-normal opacity-90 2xl:max-w-[96px]">
              {organizationName || userDisplayName}
            </span>
          </div>

          <button
            type="button"
            data-testid="toggle-display-popover"
            onClick={onToggleDisplay}
            title="表示設定"
            aria-label="表示設定"
            className={`inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold transition sm:h-auto sm:w-auto sm:px-2.5 sm:py-1.5 ${
              displayOpen
                ? "border-sky-400 bg-sky-500/20 text-white"
                : "border-transparent text-slate-200 hover:bg-slate-800"
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden xl:inline">表示設定</span>
          </button>

          <Link
            href="/board"
            className="hidden rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white 2xl:inline-flex"
          >
            伝言板ページ
          </Link>

          <Link
            href="/guide"
            data-testid="open-guide-link"
            title="利用ガイド・権限比較・AI質問例"
            aria-label="利用ガイド"
            className="inline-flex h-8 w-8 items-center justify-center gap-1 rounded-xl text-xs text-amber-200 transition hover:bg-slate-800 hover:text-amber-100 sm:h-auto sm:w-auto sm:px-2 sm:py-1.5"
          >
            <BookOpen className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden xl:inline">ガイド</span>
          </Link>

          <button
            type="button"
            data-testid="open-sources-btn"
            onClick={onOpenSources}
            title="出典・データライセンス"
            aria-label="出典・データライセンス"
            className="inline-flex h-8 w-8 items-center justify-center gap-1 rounded-xl text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white sm:h-auto sm:w-auto sm:px-2 sm:py-1.5"
          >
            <Database className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden 2xl:inline">出典</span>
          </button>

          <button
            type="button"
            data-testid="logout-btn"
            onClick={onLogout}
            title="ログアウト"
            aria-label="ログアウト"
            className="inline-flex h-8 w-8 items-center justify-center gap-1 rounded-xl border border-slate-700/80 bg-slate-950/70 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:text-rose-200 sm:h-auto sm:w-auto sm:px-2 sm:py-1.5 xl:px-2.5"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">ログアウト</span>
          </button>
        </div>
      </header>

      {/* Mobile & Tablet Touch-Friendly Scrollable Bottom Dock (< lg) */}
      <nav
        aria-label="モバイルナビゲーション"
        className="no-scrollbar fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-1 overflow-x-auto border-t border-slate-800/90 bg-slate-950/95 px-1.5 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] shadow-[0_-8px_24px_rgba(0,0,0,0.45)] backdrop-blur-xl md:justify-center lg:hidden"
      >
        <MobileDockBtn
          active={activePanel === "none" || mobileDrawerMinimized}
          onClick={() => onTogglePanel("none")}
          icon={<MapIcon className="h-4 w-4" />}
          label="地図"
        />
        <MobileDockBtn
          testId="mobile-tab-report"
          active={activePanel === "report" && !mobileDrawerMinimized}
          onClick={() => toggle("report")}
          icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
          label="被害報告"
          badge={reportCount > 0 ? String(reportCount) : undefined}
        />
        <MobileDockBtn
          testId="mobile-tab-safety"
          active={activePanel === "safety" && !mobileDrawerMinimized}
          onClick={() => toggle("safety")}
          icon={<MessageSquareHeart className="h-4 w-4 text-sky-400" />}
          label="安否確認"
          badge={boardCount > 0 ? String(boardCount) : undefined}
        />
        <MobileDockBtn
          testId="mobile-tab-shelter"
          active={activePanel === "shelter" && !mobileDrawerMinimized}
          onClick={() => toggle("shelter")}
          icon={<ShieldCheck className="h-4 w-4 text-teal-400" />}
          label="避難推薦"
        />
        <MobileDockBtn
          testId="mobile-tab-nav"
          active={activePanel === "nav" && !mobileDrawerMinimized}
          onClick={() => toggle("nav")}
          icon={<Compass className="h-4 w-4 text-emerald-400" />}
          label="ナビ"
          badge={hasActiveRoute ? "中" : blockedRoadCount > 0 ? String(blockedRoadCount) : undefined}
        />
        {userRole === "enterprise" && (
          <MobileDockBtn
            testId="mobile-tab-assets"
            active={activePanel === "assets" && !mobileDrawerMinimized}
            onClick={() => toggle("assets")}
            icon={<Server className="h-4 w-4 text-emerald-300" />}
            label="拠点"
            badge={enterpriseAssetCount > 0 ? String(enterpriseAssetCount) : undefined}
          />
        )}
        <MobileDockBtn
          testId="mobile-tab-ai"
          active={activePanel === "ai" && !mobileDrawerMinimized}
          onClick={() => toggle("ai")}
          icon={<Sparkles className="h-4 w-4 text-amber-300" />}
          label="AI分析"
          dotColor={geminiConfigured ? "bg-emerald-400" : "bg-amber-400"}
        />
        <MobileDockBtn
          testId="mobile-tab-stats"
          active={activePanel === "stats" && !mobileDrawerMinimized}
          onClick={() => toggle("stats")}
          icon={<BarChart3 className="h-4 w-4 text-indigo-300" />}
          label="統計"
        />
        <MobileDockBtn
          testId="mobile-tab-updates"
          active={activePanel === "updates" && !mobileDrawerMinimized}
          onClick={() => toggle("updates")}
          icon={<Activity className="h-4 w-4 text-cyan-300" />}
          label="防災更新"
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
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition xl:gap-1.5 xl:px-2.5 2xl:px-3 2xl:text-xs ${
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
  badge,
  dotColor,
}: {
  testId?: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  dotColor?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`relative flex min-h-[46px] min-w-[60px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 text-[10px] font-semibold transition sm:min-w-[68px] md:flex-1 ${
        active
          ? "bg-slate-800/95 text-white ring-1 ring-slate-600/80"
          : "text-slate-400 active:bg-slate-800/70 hover:text-slate-200"
      }`}
    >
      <span className="relative inline-flex items-center justify-center">
        {icon}
        {dotColor && (
          <span className={`absolute -right-1.5 -top-0.5 h-1.5 w-1.5 rounded-full ${dotColor}`} />
        )}
        {badge && (
          <span className="absolute -right-3 -top-1.5 rounded-full bg-slate-900 px-1 py-0 font-mono text-[8.5px] font-bold leading-tight text-sky-200 ring-1 ring-slate-700">
            {badge}
          </span>
        )}
      </span>
      <span className="max-w-full whitespace-nowrap leading-tight">{label}</span>
    </button>
  );
}
