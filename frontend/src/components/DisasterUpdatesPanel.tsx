"use client";

import React, { useMemo, useState } from "react";
import {
  Activity,
  Archive,
  Building,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
} from "lucide-react";

import {
  DisasterUpdatesPeriod,
  DisasterUpdatesResponse,
  KyotoEarthquakeArchiveItem,
} from "@/types/quakelens";

interface DisasterUpdatesPanelProps {
  data: DisasterUpdatesResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refreshMessage: string | null;
  period: DisasterUpdatesPeriod;
  onChangePeriod: (period: DisasterUpdatesPeriod) => void;
  onRefreshLive: () => void;
  onFocusEarthquake: (eq: KyotoEarthquakeArchiveItem) => void;
}

const PERIOD_TABS: Array<{ id: DisasterUpdatesPeriod; label: string }> = [
  { id: "all", label: "すべて（全期間）" },
  { id: "recent_2y", label: "直近2年（2025-2026）" },
  { id: "2026", label: "2026年" },
  { id: "2025", label: "2025年" },
  { id: "archive", label: "古い履歴（〜2024年）" },
];

type SectionView = "all" | "municipality" | "earthquakes";

function safeHttpUrl(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" || u.protocol === "http:") {
      return u.toString();
    }
  } catch {
    // ignore invalid URLs
  }
  return fallback;
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return "未取得";
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function maxiBadgeClass(maxi: string): string {
  if (maxi.startsWith("5") || maxi.startsWith("6") || maxi === "7") {
    return "border-rose-500/70 bg-rose-500/25 text-rose-100";
  }
  if (maxi === "4" || maxi === "3") {
    return "border-amber-500/70 bg-amber-500/20 text-amber-200";
  }
  if (maxi === "2") {
    return "border-cyan-500/50 bg-cyan-500/15 text-cyan-200";
  }
  return "border-slate-600 bg-slate-800 text-slate-300";
}

function yearBadge(year: number, isRecent2y: boolean) {
  if (year === 2026) {
    return (
      <span className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
        2026 最新
      </span>
    );
  }
  if (isRecent2y) {
    return (
      <span className="rounded-full border border-sky-400/50 bg-sky-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-200">
        {year}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-600/80 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
      <Archive className="h-2.5 w-2.5 text-slate-400" />
      {year} 過去
    </span>
  );
}

export default function DisasterUpdatesPanel({
  data,
  loading,
  refreshing,
  error,
  refreshMessage,
  period,
  onChangePeriod,
  onRefreshLive,
  onFocusEarthquake,
}: DisasterUpdatesPanelProps) {
  const [sectionView, setSectionView] = useState<SectionView>("all");

  const counts = data?.counts;
  const quakes = useMemo(() => data?.earthquakes ?? [], [data]);
  const notices = useMemo(() => data?.municipality_updates ?? [], [data]);

  return (
    <div
      className="space-y-3.5 p-3.5 text-slate-100"
      data-testid="disaster-updates-panel"
    >
      {/* Top Updater Header */}
      <div className="rounded-xl border border-cyan-500/35 bg-cyan-950/25 p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-200">
              <Activity className="h-4 w-4 text-cyan-400" />
              <span>気象庁・京都市 防災情報アップデート掲示板</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
              直近2年間（2025〜2026年）および過去の<strong>震源地＝京都のみ</strong>の地震履歴（京都府南部 `e=511`・北部 `e=510`＋JMA速報）と京都市公式の防災更新情報を一元掲示・ライブ更新します。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cyan-500/20 pt-2">
          <div className="text-[10px] text-slate-400">
            最終同期:{" "}
            <span className="font-mono text-slate-200">
              {formatSyncTime(data?.last_updated_at ?? null)}
            </span>
          </div>
          <button
            type="button"
            data-testid="updates-refresh-btn"
            onClick={onRefreshLive}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/60 bg-cyan-500/20 px-3 py-1.5 text-[11px] font-bold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>{refreshing ? "取得中..." : "最新情報にアップデート"}</span>
          </button>
        </div>

        {refreshMessage && (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1.5 text-[11px] text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>{refreshMessage}</span>
          </div>
        )}

        {counts && (
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="rounded-lg border border-slate-800 bg-slate-950/75 px-2.5 py-1.5">
              <div className="text-slate-400">京都市 防災更新</div>
              <div className="mt-0.5 font-mono font-bold text-slate-100">
                計{counts.total_municipality_updates}件
                <span className="ml-1.5 text-emerald-300">
                  (25-26年: {counts.recent_2y_municipality_updates})
                </span>
                <span className="ml-1 text-slate-400">
                  / 過去 {counts.archive_municipality_updates}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/75 px-2.5 py-1.5">
              <div className="text-slate-400">京都震源 地震履歴（京都のみ）</div>
              <div className="mt-0.5 font-mono font-bold text-slate-100">
                計{counts.total_earthquakes}件
                <span className="ml-1.5 text-cyan-300">
                  (25-26年: {counts.recent_2y_earthquakes})
                </span>
                <span className="ml-1 text-slate-400">
                  / 過去 {counts.archive_earthquakes}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Period Filter Pills */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          <Calendar className="h-3 w-3" />
          <span>期間フィルタ（2025・2026年 / 古いアーカイブ）</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PERIOD_TABS.map((tab) => {
            const active = period === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`updates-period-${tab.id}`}
                onClick={() => onChangePeriod(tab.id)}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                  active
                    ? "border-cyan-400 bg-cyan-500/20 text-white"
                    : "border-slate-700/80 bg-slate-900/70 text-slate-300 hover:border-slate-500"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section View Switcher */}
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1 text-[11px]">
        {(
          [
            { id: "all", label: `両方 (${notices.length + quakes.length})` },
            { id: "municipality", label: `自治体情報 (${notices.length})` },
            { id: "earthquakes", label: `地震履歴 (${quakes.length})` },
          ] as const
        ).map((v) => (
          <button
            key={v.id}
            type="button"
            data-testid={`updates-view-${v.id}`}
            onClick={() => setSectionView(v.id)}
            className={`rounded-lg py-1.5 font-semibold transition ${
              sectionView === v.id
                ? "bg-slate-800 text-cyan-200 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/50 bg-rose-950/40 p-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
          <span>防災アップデートと地震履歴を読み込んでいます...</span>
        </div>
      )}

      {/* Municipality Updates List */}
      {(sectionView === "all" || sectionView === "municipality") && notices.length > 0 && (
        <section className="space-y-2" data-testid="municipality-updates-section">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
              <Building className="h-3.5 w-3.5 text-emerald-400" />
              <span>自治体（京都市公式）防災アップデート掲示</span>
            </div>
            <span className="text-[10px] text-slate-400">{notices.length}件</span>
          </div>
          <div className="space-y-1.5">
            {notices.map((n) => (
              <a
                key={n.id}
                href={safeHttpUrl(n.url, "https://www.bousai.city.kyoto.lg.jp/")}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-slate-700/80 bg-slate-900/75 p-2.5 transition hover:border-emerald-400/60 hover:bg-slate-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {yearBadge(n.year, n.is_recent_2y)}
                    <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {n.category}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">
                    {n.date_text}
                  </span>
                </div>
                <div className="mt-1.5 flex items-start justify-between gap-2 text-xs font-semibold text-slate-100">
                  <span className="leading-snug">{n.title}</span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* JMA / Kyoto Earthquakes History List */}
      {(sectionView === "all" || sectionView === "earthquakes") && quakes.length > 0 && (
        <section className="space-y-2" data-testid="earthquake-history-section">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
              <Activity className="h-3.5 w-3.5 text-amber-400" />
              <span>気象庁・京都震源限定 地震履歴一覧（京都のみ）</span>
            </div>
            <a
              href={
                data?.sources.yahoo_kyoto_earthquakes ||
                "https://typhoon.yahoo.co.jp/weather/jp/earthquake/list/?e=511"
              }
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-cyan-300 hover:underline"
            >
              <span>元データ (?e=511)</span>
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
          <div className="space-y-1.5">
            {quakes.map((q) => (
              <div
                key={`${q.id}-${q.occurred_at}`}
                className="rounded-xl border border-slate-700/80 bg-slate-900/75 p-2.5 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {yearBadge(q.year, q.is_recent_2y)}
                      <span
                        className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${maxiBadgeClass(q.maxi)}`}
                      >
                        最大震度 {q.maxi}
                      </span>
                      <span className="font-mono text-[11px] font-bold text-slate-200">
                        {q.mag != null ? `M${q.mag.toFixed(1)}` : "M—"}
                      </span>
                      {q.depth_km != null && (
                        <span className="text-[10px] text-slate-400">
                          深さ {q.depth_km}km
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-white">
                      {q.epicenter}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {q.occurred_at} ／ {q.source}
                    </div>
                    {q.observed_kyoto.length > 0 && (
                      <div className="text-[10px] text-cyan-200">
                        府内観測: {q.observed_kyoto.slice(0, 3).join(" / ")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-0.5">
                  {q.lat != null && q.lon != null && (
                    <button
                      type="button"
                      onClick={() => onFocusEarthquake(q)}
                      className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/25"
                    >
                      <MapPin className="h-3 w-3" />
                      <span>地図で震源を表示</span>
                    </button>
                  )}
                  <a
                    href={safeHttpUrl(
                      q.url,
                      "https://typhoon.yahoo.co.jp/weather/jp/earthquake/list/?e=511"
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[10px] text-slate-200 hover:border-slate-500"
                  >
                    <span>詳細</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
