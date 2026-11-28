"use client";

import React from "react";
import {
  Activity,
  Ban,
  Box,
  Building2,
  Eye,
  Flag,
  Layers,
  MapPin,
  MessageSquareHeart,
  RotateCcw,
  ShieldCheck,
  Tent,
  X,
} from "lucide-react";
import {
  AGE_COLORS,
  AGE_LABELS,
  HAZARD_COLORS,
  HAZARD_SHORT_LABELS,
} from "@/lib/colors";
import { VisualPreset } from "@/components/QuakeMap";
import {
  AgeCategory,
  HazardTier,
  Map3DMode,
  MeshOverlayMode,
  UsageGroup,
} from "@/types/quakelens";

const ALL_AGE_CATS: AgeCategory[] = ["pre_1981", "1982_2000", "post_2001", "unknown"];
const ALL_HAZARD_TIERS: HazardTier[] = ["very_high", "elevated", "moderate", "low"];

interface MapDisplayPopoverProps {
  open: boolean;
  onClose: () => void;
  visualPreset: VisualPreset;
  onChangeVisualPreset: (preset: VisualPreset) => void;
  map3DMode: Map3DMode;
  onChangeMap3DMode: (next: Map3DMode) => void;
  showBuildings: boolean;
  onToggleBuildings: () => void;
  showHazardMesh: boolean;
  onToggleHazardMesh: () => void;
  meshOverlayMode: MeshOverlayMode;
  onChangeMeshOverlayMode: (mode: MeshOverlayMode) => void;
  showRoadClosures: boolean;
  onToggleRoadClosures: () => void;
  showShelterHubs: boolean;
  onToggleShelterHubs: () => void;
  showOfficialShelters: boolean;
  onToggleOfficialShelters: () => void;
  showReports: boolean;
  onToggleReports: () => void;
  showSafetyLayer: boolean;
  onToggleSafetyLayer: () => void;
  showEarthquakes: boolean;
  onToggleEarthquakes: () => void;
  includeSamples: boolean;
  onToggleIncludeSamples: () => void;
  ageCategories: AgeCategory[];
  onToggleAgeCategory: (cat: AgeCategory) => void;
  hazardTiers: HazardTier[];
  onToggleHazardTier: (tier: HazardTier) => void;
  usageGroup: UsageGroup;
  onChangeUsageGroup: (ug: UsageGroup) => void;
  selectedMeshcode: string | null;
  onClearMeshcode: () => void;
  onResetFilters: () => void;
}

export function MapDisplayPopover({
  open,
  onClose,
  visualPreset,
  onChangeVisualPreset,
  map3DMode,
  onChangeMap3DMode,
  showBuildings,
  onToggleBuildings,
  showHazardMesh,
  onToggleHazardMesh,
  meshOverlayMode,
  onChangeMeshOverlayMode,
  showRoadClosures,
  onToggleRoadClosures,
  showShelterHubs,
  onToggleShelterHubs,
  showOfficialShelters,
  onToggleOfficialShelters,
  showReports,
  onToggleReports,
  showSafetyLayer,
  onToggleSafetyLayer,
  showEarthquakes,
  onToggleEarthquakes,
  includeSamples,
  onToggleIncludeSamples,
  ageCategories,
  onToggleAgeCategory,
  hazardTiers,
  onToggleHazardTier,
  usageGroup,
  onChangeUsageGroup,
  selectedMeshcode,
  onClearMeshcode,
  onResetFilters,
}: MapDisplayPopoverProps) {
  if (!open) return null;

  return (
    <div
      data-testid="map-display-popover"
      className="fixed inset-x-2 top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-40 max-h-[calc(100dvh-136px-env(safe-area-inset-bottom,0px))] overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900/95 p-3.5 text-xs text-slate-200 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:right-3 sm:top-[68px] sm:w-[min(360px,calc(100vw-24px))] sm:p-4 lg:max-h-[calc(100dvh-84px)]"
    >
      <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Layers className="h-4 w-4 text-sky-400" />
          <span>地図表示・リスク絞込設定</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            初期化
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="設定を閉じる"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Visual Mode + 2D/3D */}
        <section className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-400">表示テーマ・視点</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="preset-crisis-btn"
              onClick={() => onChangeVisualPreset("crisis")}
              className={`rounded-xl border px-2.5 py-2 text-left transition ${
                visualPreset === "crisis"
                  ? "border-rose-400/70 bg-rose-500/15 text-white"
                  : "border-slate-800 bg-slate-950/70 text-slate-400 hover:text-slate-200"
              }`}
            >
              <div className="font-bold">災害対応モード</div>
              <div className="mt-0.5 text-[10px] opacity-80">通行止・被害建物・避難所優先</div>
            </button>
            <button
              type="button"
              data-testid="preset-risk-btn"
              onClick={() => onChangeVisualPreset("risk")}
              className={`rounded-xl border px-2.5 py-2 text-left transition ${
                visualPreset === "risk"
                  ? "border-fuchsia-400/70 bg-fuchsia-500/15 text-white"
                  : "border-slate-800 bg-slate-950/70 text-slate-400 hover:text-slate-200"
              }`}
            >
              <div className="font-bold">建物リスク強調</div>
              <div className="mt-0.5 text-[10px] opacity-80">築年・地震ハザード重視</div>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-0.5">
            <button
              type="button"
              data-testid="view-mode-auto-btn"
              onClick={() => onChangeMap3DMode("auto")}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border py-1.5 font-semibold transition ${
                map3DMode === "auto"
                  ? "border-sky-500 bg-sky-500/20 text-sky-200"
                  : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
              }`}
            >
              <Box className="h-3.5 w-3.5" />
              自動 3D
            </button>
            <button
              type="button"
              data-testid="view-mode-2d-btn"
              onClick={() => onChangeMap3DMode("2d")}
              className={`rounded-lg border py-1.5 text-center font-semibold transition ${
                map3DMode === "2d"
                  ? "border-sky-500 bg-sky-500/20 text-sky-200"
                  : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
              }`}
            >
              2D 平面
            </button>
            <button
              type="button"
              data-testid="view-mode-3d-btn"
              onClick={() => onChangeMap3DMode("3d")}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border py-1.5 font-semibold transition ${
                map3DMode === "3d"
                  ? "border-sky-500 bg-sky-500/20 text-sky-200"
                  : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
              }`}
            >
              <Box className="h-3.5 w-3.5" />
              3D 固定
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-400">
            自動3Dではホイール拡大で自然に立体表示へ傾きます。右ドラッグ・Ctrl+ドラッグ・中ボタンドラッグでいつでも角度や向きを調整できます。
          </p>
        </section>

        {/* Disaster & Infrastructure Layers */}
        <section className="space-y-2 border-t border-slate-800/80 pt-3">
          <div className="text-[11px] font-semibold text-slate-400">地図レイヤー</div>
          <div className="grid grid-cols-2 gap-1.5">
            <LayerChip
              active={showRoadClosures}
              onClick={onToggleRoadClosures}
              icon={<Ban className="h-3.5 w-3.5 text-rose-400" />}
              label="通行不可道路"
            />
            <LayerChip
              active={showShelterHubs}
              onClick={onToggleShelterHubs}
              icon={<Tent className="h-3.5 w-3.5 text-emerald-400" />}
              label="防災・避難拠点"
            />
            <LayerChip
              active={showOfficialShelters}
              onClick={onToggleOfficialShelters}
              icon={<ShieldCheck className="h-3.5 w-3.5 text-teal-400" />}
              label="指定緊急避難場所(514)"
            />
            <LayerChip
              active={showReports}
              onClick={onToggleReports}
              icon={<MapPin className="h-3.5 w-3.5 text-orange-400" />}
              label="被害報告/倒壊建物"
            />
            <LayerChip
              active={showSafetyLayer}
              onClick={onToggleSafetyLayer}
              icon={<MessageSquareHeart className="h-3.5 w-3.5 text-sky-400" />}
              label="区別の安否集計"
            />
            <LayerChip
              active={showBuildings}
              onClick={onToggleBuildings}
              icon={<Building2 className="h-3.5 w-3.5 text-amber-400" />}
              label="PLATEAU建物"
            />
            <LayerChip
              active={showHazardMesh}
              onClick={onToggleHazardMesh}
              icon={<Eye className="h-3.5 w-3.5 text-fuchsia-400" />}
              label="250mメッシュ"
            />
            <LayerChip
              active={showEarthquakes}
              onClick={onToggleEarthquakes}
              icon={<Activity className="h-3.5 w-3.5 text-cyan-400" />}
              label="気象庁震源"
            />
            <LayerChip
              active={includeSamples}
              onClick={onToggleIncludeSamples}
              icon={<Flag className="h-3.5 w-3.5 text-slate-300" />}
              label="訓練用サンプル"
            />
          </div>

          {showOfficialShelters && (
            <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/75 px-2.5 py-2 text-[10px] text-slate-300">
              <div className="font-semibold text-slate-200">
                指定緊急避難場所のピン色分け理由
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-[#14b8a6]" />
                <span>緑：指定緊急避難場所（地震・水害等／444件）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-[#f97316] ring-1 ring-[#fb923c]" />
                <span>橙：広域避難場所（大規模火災対応／70件）</span>
              </div>
            </div>
          )}

          {showHazardMesh && (
            <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {(
                [
                  { id: "hazard", label: "震度6弱+確率" },
                  { id: "arv", label: "地盤増幅 ARV" },
                  { id: "pre1981", label: "1981以前割合" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChangeMeshOverlayMode(m.id)}
                  className={`flex-1 rounded-lg py-1 text-[11px] font-medium transition ${
                    meshOverlayMode === m.id
                      ? "bg-fuchsia-600/30 text-fuchsia-200 border border-fuchsia-500/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Active Mesh Badge */}
        {selectedMeshcode && (
          <div className="flex items-center justify-between rounded-xl border border-sky-500/40 bg-sky-950/30 px-3 py-2 text-xs">
            <span className="text-sky-200">
              メッシュ絞込中: <span className="font-mono font-bold">{selectedMeshcode}</span>
            </span>
            <button
              type="button"
              onClick={onClearMeshcode}
              className="rounded px-2 py-0.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-900/60"
            >
              解除
            </button>
          </div>
        )}

        {/* Building Filters */}
        <section className="space-y-2.5 border-t border-slate-800/80 pt-3">
          <div className="text-[11px] font-semibold text-slate-400">建物リスク絞込</div>

          <div>
            <div className="mb-1 text-[11px] text-slate-400">建築年区分（旧耐震・新耐震）</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_AGE_CATS.map((cat) => {
                const active = ageCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => onToggleAgeCategory(cat)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition ${
                      active
                        ? "border-slate-600 bg-slate-800/90 text-white"
                        : "border-slate-800/70 bg-slate-950/50 text-slate-500 opacity-60"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: AGE_COLORS[cat] }}
                    />
                    <span className="truncate">{AGE_LABELS[cat]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] text-slate-400">30年震度6弱以上確率 (J-SHIS)</div>
            <div className="grid grid-cols-4 gap-1">
              {ALL_HAZARD_TIERS.map((tier) => {
                const active = hazardTiers.includes(tier);
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => onToggleHazardTier(tier)}
                    className={`flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1.5 text-[10px] font-medium transition ${
                      active
                        ? "border-slate-600 bg-slate-800/90 text-white"
                        : "border-slate-800/70 bg-slate-950/50 text-slate-500 opacity-60"
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

          <div>
            <div className="mb-1 text-[11px] text-slate-400">建物用途</div>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: "all", label: "すべて" },
                  { id: "residential", label: "住宅系" },
                  { id: "non_residential", label: "非住宅系" },
                ] as const
              ).map((ug) => (
                <button
                  key={ug.id}
                  type="button"
                  onClick={() => onChangeUsageGroup(ug.id)}
                  className={`rounded-lg border py-1.5 text-[11px] font-medium transition ${
                    usageGroup === ug.id
                      ? "border-sky-500/70 bg-sky-500/20 text-sky-100"
                      : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {ug.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function LayerChip({
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
      className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] font-medium transition ${
        active
          ? "border-sky-500/50 bg-slate-800 text-white shadow-sm"
          : "border-slate-800 bg-slate-950/60 text-slate-500 hover:text-slate-300"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
