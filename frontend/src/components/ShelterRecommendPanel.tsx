"use client";

import React from "react";
import {
  AlertTriangle,
  Compass,
  ExternalLink,
  FileText,
  Flame,
  Layers,
  Loader2,
  MapPin,
  Navigation,
  Route as RouteIcon,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import {
  ShelterRecommendationItem,
  ShelterRecommendationResponse,
  ShelterScenario,
} from "@/types/quakelens";

interface ShelterRecommendPanelProps {
  wards: string[];
  selectedWard: string;
  origin: { lat: number; lon: number; label: string };
  scenario: ShelterScenario;
  avoidUnverified: boolean;
  includeSamples: boolean;
  isPickingOrigin: boolean;
  loading: boolean;
  error: string | null;
  recommendation: ShelterRecommendationResponse | null;
  selectedShelterId: string | null;
  onChangeScenario: (scenario: ShelterScenario) => void;
  onChangeAvoidUnverified: (next: boolean) => void;
  onChangeIncludeSamples: (next: boolean) => void;
  onTogglePickOrigin: () => void;
  onUseGpsOrigin: () => void;
  onSelectWardOrigin: (ward: string) => void;
  onRefresh: () => void;
  onSelectRecommendation: (item: ShelterRecommendationItem) => void;
}

const SCENARIO_OPTIONS: Array<{
  id: ShelterScenario;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "earthquake",
    label: "地震",
    subtitle: "指定緊急避難場所（地震対応）",
    icon: ShieldAlert,
  },
  {
    id: "post_quake_fire",
    label: "地震後火災",
    subtitle: "大規模火事（広域避難場所）優先",
    icon: Flame,
  },
  {
    id: "multi_hazard",
    label: "複合災害",
    subtitle: "地震＋火災＋浸水・土砂対応度",
    icon: Layers,
  },
];

const HAZARD_BADGE_CLASSES: Record<string, string> = {
  extreme: "border-rose-500/60 bg-rose-500/20 text-rose-200",
  high: "border-orange-500/60 bg-orange-500/20 text-orange-200",
  moderate: "border-amber-500/60 bg-amber-500/20 text-amber-200",
  low: "border-emerald-500/60 bg-emerald-500/20 text-emerald-200",
  unknown: "border-slate-600/60 bg-slate-800 text-slate-300",
};

const STATUS_BADGE: Record<
  ShelterRecommendationItem["shelter_status"],
  { label: string; cls: string }
> = {
  open: {
    label: "開設・受入可能想定",
    cls: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  },
  restricted: {
    label: "一部制限あり",
    cls: "border-amber-500/50 bg-amber-500/15 text-amber-200",
  },
  support_needed: {
    label: "支援要請・混雑報告",
    cls: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  },
};

export default function ShelterRecommendPanel({
  wards,
  selectedWard,
  origin,
  scenario,
  avoidUnverified,
  includeSamples,
  isPickingOrigin,
  loading,
  error,
  recommendation,
  selectedShelterId,
  onChangeScenario,
  onChangeAvoidUnverified,
  onChangeIncludeSamples,
  onTogglePickOrigin,
  onUseGpsOrigin,
  onSelectWardOrigin,
  onRefresh,
  onSelectRecommendation,
}: ShelterRecommendPanelProps) {
  const originHazard = recommendation?.origin.hazard;
  const pdfLinks = recommendation?.origin.hazard_map_links;

  return (
    <div
      className="space-y-3.5 text-slate-100"
      data-testid="shelter-recommend-panel"
    >
      {/* Header banner */}
      <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-200">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>ハザードマップ連動・避難場所推薦</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
              京都市公式「指定緊急避難場所」514件・J-SHIS揺れやすさ/地盤増幅率・実道路通行止めを統合し、最適な避難先Top5を実ルート付きで提案します。
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {loading ? "探索中..." : "再計算"}
          </button>
        </div>
      </div>

      {/* Scenario Selector */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          災害シナリオ
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {SCENARIO_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = scenario === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`shelter-scenario-${opt.id}`}
                onClick={() => onChangeScenario(opt.id)}
                className={`flex flex-col items-start gap-0.5 rounded-xl border p-2 text-left transition ${
                  active
                    ? "border-emerald-400 bg-emerald-500/20 text-white shadow-sm shadow-emerald-500/20"
                    : "border-slate-700/80 bg-slate-900/70 text-slate-300 hover:border-slate-500"
                }`}
              >
                <div className="flex items-center gap-1 text-xs font-bold">
                  <Icon
                    className={`h-3.5 w-3.5 ${
                      active ? "text-emerald-300" : "text-slate-400"
                    }`}
                  />
                  <span>{opt.label}</span>
                </div>
                <span className="text-[10px] leading-tight text-slate-400">
                  {opt.subtitle}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Origin Controls */}
      <div className="space-y-2 rounded-xl border border-slate-700/80 bg-slate-900/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
            <MapPin className="h-3.5 w-3.5 text-cyan-400" />
            <span>出発地点（現在地・対象地点）</span>
          </div>
          <span className="font-mono text-[10px] text-slate-400">
            {origin.lat.toFixed(4)}, {origin.lon.toFixed(4)}
          </span>
        </div>

        <div className="truncate rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-xs text-cyan-100">
          {origin.label}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            data-testid="shelter-pick-origin-btn"
            onClick={onTogglePickOrigin}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition ${
              isPickingOrigin
                ? "border-amber-400 bg-amber-500/25 text-amber-100"
                : "border-cyan-500/45 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
            }`}
          >
            <Compass className="h-3.5 w-3.5" />
            <span>{isPickingOrigin ? "地図をクリック中..." : "地図から地点指定"}</span>
          </button>

          <button
            type="button"
            data-testid="shelter-gps-origin-btn"
            onClick={onUseGpsOrigin}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-2 text-[11px] font-semibold text-slate-200 hover:border-slate-500 hover:bg-slate-800"
          >
            <Navigation className="h-3.5 w-3.5 text-emerald-400" />
            <span>GPS現在地</span>
          </button>
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          <label
            htmlFor="shelter-ward-preset"
            className="shrink-0 text-[11px] text-slate-400"
          >
            区中心プリセット:
          </label>
          <select
            id="shelter-ward-preset"
            value={selectedWard}
            onChange={(e) => {
              if (e.target.value) {
                onSelectWardOrigin(e.target.value);
              }
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">区を選択して出発点を移動...</option>
            {wards.map((ward) => (
              <option key={ward} value={ward}>
                {ward}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-300">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={avoidUnverified}
              onChange={(e) => onChangeAvoidUnverified(e.target.checked)}
              className="rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-0"
            />
            <span>未検証の通行止めも迂回</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeSamples}
              onChange={(e) => onChangeIncludeSamples(e.target.checked)}
              className="rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-0"
            />
            <span>訓練サンプル含む</span>
          </label>
        </div>
      </div>

      {/* Origin Hazard + Kyoto City Official Earthquake Hazard Map Links */}
      {recommendation && (
        <div
          className="space-y-2 rounded-xl border border-slate-700/80 bg-slate-900/75 p-3"
          data-testid="origin-hazard-card"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-200">
              出発地点の地震ハザード診断 ({recommendation.origin.ward_name})
            </div>
            {originHazard && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  HAZARD_BADGE_CLASSES[originHazard.hazard_tier] ||
                  HAZARD_BADGE_CLASSES.unknown
                }`}
              >
                {originHazard.hazard_label}
              </span>
            )}
          </div>

          {originHazard ? (
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1.5">
                <div className="text-[10px] text-slate-400">30年震度6弱以上</div>
                <div className="mt-0.5 font-mono text-xs font-bold text-amber-200">
                  {originHazard.t30_i55_ps != null
                    ? `${(originHazard.t30_i55_ps * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1.5">
                <div className="text-[10px] text-slate-400">地盤増幅率 ARV</div>
                <div className="mt-0.5 font-mono text-xs font-bold text-cyan-200">
                  {originHazard.arv != null ? originHazard.arv.toFixed(2) : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1.5">
                <div className="text-[10px] text-slate-400">旧耐震建物率</div>
                <div className="mt-0.5 font-mono text-xs font-bold text-rose-200">
                  {originHazard.pre_1981_share_known != null
                    ? `${(originHazard.pre_1981_share_known * 100).toFixed(0)}%`
                    : "—"}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">
              出発地点のJ-SHIS 250mメッシュ統計は取得範囲外です。
            </div>
          )}

          {originHazard?.jname && (
            <div className="text-[11px] text-slate-400">
              微地形区分:{" "}
              <span className="font-semibold text-slate-200">
                {originHazard.jname}
              </span>
              {originHazard.meshcode && (
                <span className="ml-2 font-mono text-[10px] text-slate-500">
                  ({originHazard.meshcode})
                </span>
              )}
            </div>
          )}

          {pdfLinks && (
            <div className="space-y-1.5 border-t border-slate-800 pt-2">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <FileText className="h-3 w-3 text-emerald-400" />
                <span>京都市公式 地震ハザードマップ ({pdfLinks.ward_name})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pdfLinks.ward_map_pdf && (
                  <a
                    href={pdfLinks.ward_map_pdf}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                  >
                    <span>地図面PDF</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {pdfLinks.ward_info_pdf && (
                  <a
                    href={pdfLinks.ward_info_pdf}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-slate-500"
                  >
                    <span>情報・学習面PDF</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {pdfLinks.keihoku_map_pdf && (
                  <a
                    href={pdfLinks.keihoku_map_pdf}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-slate-500"
                  >
                    <span>京北地域地図PDF</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <a
                  href={pdfLinks.earthquake_page_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                >
                  <span>京都市公式ページ</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href={pdfLinks.web_hazard_map_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500"
                >
                  <span>重ねるWebマップ</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error / Loading / Recommendations */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/50 bg-rose-950/40 p-3 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 py-6 text-xs text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          <span>実道路網とハザード条件から避難場所を探索しています...</span>
        </div>
      )}

      {!loading && recommendation && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              推奨避難場所 Top {recommendation.recommendations.length}（候補{" "}
              {recommendation.total_candidates}件）
            </span>
            <span>通行止め考慮: {recommendation.active_blocked_count}件</span>
          </div>

          {recommendation.recommendations.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-center text-xs text-slate-400">
              条件に一致する推奨避難場所が見つかりませんでした。
            </div>
          ) : (
            <div className="space-y-2">
              {recommendation.recommendations.map((item) => {
                const isSelected = selectedShelterId === item.id;
                const statusInfo = STATUS_BADGE[item.shelter_status];
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`shelter-rec-card-${item.rank}`}
                    onClick={() => onSelectRecommendation(item)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? "border-emerald-400 bg-emerald-950/35 shadow-md shadow-emerald-500/15"
                        : "border-slate-700/80 bg-slate-900/75 hover:border-emerald-500/50 hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                            item.rank === 1
                              ? "bg-emerald-500 text-slate-950"
                              : "border border-emerald-500/50 bg-emerald-500/20 text-emerald-200"
                          }`}
                        >
                          {item.rank}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-white">
                              {item.name}
                            </span>
                            {item.is_wide_area && (
                              <span className="rounded-full border border-orange-500/60 bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold text-orange-200">
                                広域避難場所
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {item.ward} ／ {item.address}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="font-mono text-sm font-bold text-emerald-300">
                          {item.road_distance_km != null
                            ? `${item.road_distance_km.toFixed(2)} km`
                            : `直線 ${item.crow_fly_km.toFixed(2)} km`}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {item.walk_minutes != null
                            ? `徒歩 約${item.walk_minutes}分`
                            : "到達経路注意"}
                        </div>
                      </div>
                    </div>

                    {/* Compatibility + Status Badges */}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusInfo.cls}`}
                      >
                        {statusInfo.label}
                      </span>
                      {item.rerouted && item.detour_delta_km != null && (
                        <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                          迂回 +{item.detour_delta_km.toFixed(2)}km
                        </span>
                      )}
                      {item.shelter_hazard && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            HAZARD_BADGE_CLASSES[
                              item.shelter_hazard.hazard_tier
                            ] || HAZARD_BADGE_CLASSES.unknown
                          }`}
                        >
                          先: {item.shelter_hazard.hazard_label} (ARV{" "}
                          {item.shelter_hazard.arv != null
                            ? item.shelter_hazard.arv.toFixed(2)
                            : "—"}
                          )
                        </span>
                      )}
                      {item.disaster_labels.slice(0, 4).map((lbl) => (
                        <span
                          key={lbl}
                          className="rounded-md bg-slate-800/90 px-1.5 py-0.5 text-[10px] text-slate-300"
                        >
                          {lbl}
                        </span>
                      ))}
                    </div>

                    {/* Reasons */}
                    {item.reasons.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-[11px] text-slate-300">
                        {item.reasons.map((reason, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span className="text-emerald-400">•</span>
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-2 flex items-center justify-end gap-1 text-[11px] font-semibold text-emerald-300">
                      <RouteIcon className="h-3.5 w-3.5" />
                      <span>クリックして地図に実避難ルートを表示</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
            {recommendation.simulation_disclaimer}
          </div>
        </div>
      )}
    </div>
  );
}
