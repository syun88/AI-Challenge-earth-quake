"use client";

import React from "react";
import {
  Filter,
  Layers,
  MapPin,
  RotateCcw,
  AlertTriangle,
  Activity,
  Box,
} from "lucide-react";
import {
  AGE_COLORS,
  AGE_LABELS,
  HAZARD_COLORS,
  HAZARD_SHORT_LABELS,
} from "@/lib/colors";
import {
  AgeCategory,
  HazardTier,
  MeshOverlayMode,
  UsageGroup,
} from "@/types/quakelens";

interface LeftFilterPanelProps {
  wards: string[];
  selectedWard: string;
  onSelectWard: (ward: string) => void;
  ageCategories: AgeCategory[];
  onToggleAgeCategory: (cat: AgeCategory) => void;
  hazardTiers: HazardTier[];
  onToggleHazardTier: (tier: HazardTier) => void;
  usageGroup: UsageGroup;
  onChangeUsageGroup: (ug: UsageGroup) => void;
  showBuildings: boolean;
  onToggleBuildings: () => void;
  showHazardMesh: boolean;
  onToggleHazardMesh: () => void;
  meshOverlayMode: MeshOverlayMode;
  onChangeMeshOverlayMode: (mode: MeshOverlayMode) => void;
  showEarthquakes: boolean;
  onToggleEarthquakes: () => void;
  is3D: boolean;
  onChangeIs3D: (v: boolean) => void;
  onResetFilters: () => void;
  selectedMeshcode: string | null;
  onClearMeshcode: () => void;
}

const ALL_AGE_CATS: AgeCategory[] = ["pre_1981", "1982_2000", "post_2001", "unknown"];
const ALL_HAZARD_TIERS: HazardTier[] = ["very_high", "elevated", "moderate", "low"];

export function LeftFilterPanel({
  wards,
  selectedWard,
  onSelectWard,
  ageCategories,
  onToggleAgeCategory,
  hazardTiers,
  onToggleHazardTier,
  usageGroup,
  onChangeUsageGroup,
  showBuildings,
  onToggleBuildings,
  showHazardMesh,
  onToggleHazardMesh,
  meshOverlayMode,
  onChangeMeshOverlayMode,
  showEarthquakes,
  onToggleEarthquakes,
  is3D,
  onChangeIs3D,
  onResetFilters,
  selectedMeshcode,
  onClearMeshcode,
}: LeftFilterPanelProps) {
  return (
    <aside className="flex h-full flex-col overflow-y-auto border-r border-slate-800 bg-slate-900/90 p-3.5 text-xs">
      {/* Area Jump */}
      <section className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 font-semibold text-slate-200">
            <MapPin className="h-3.5 w-3.5 text-sky-400" />
            対象区・エリア選択
          </h2>
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300"
          >
            <RotateCcw className="h-3 w-3" /> リセット
          </button>
        </div>
        <select
          value={selectedWard}
          onChange={(e) => onSelectWard(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
        >
          <option value="all">京都市全域（11区）</option>
          {wards.map((w) => (
            <option key={w} value={w}>
              京都市 {w}
            </option>
          ))}
        </select>

        {selectedMeshcode && (
          <div className="mt-2 flex items-center justify-between rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-200">
            <span>メッシュ絞込: {selectedMeshcode}</span>
            <button
              type="button"
              onClick={onClearMeshcode}
              className="font-semibold text-sky-300 hover:text-white"
            >
              解除
            </button>
          </div>
        )}
      </section>

      {/* Layer Controls */}
      <section className="mb-4 border-t border-slate-800 pt-3.5">
        <h2 className="mb-2 flex items-center gap-1.5 font-semibold text-slate-200">
          <Layers className="h-3.5 w-3.5 text-amber-400" />
          地図レイヤー表示
        </h2>
        <div className="space-y-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-slate-200">建物ポリゴン（ズーム13.5+）</span>
              <input
                type="checkbox"
                checked={showBuildings}
                onChange={onToggleBuildings}
                className="h-4 w-4 accent-sky-500"
              />
            </label>
            {showBuildings && (
              <div className="mt-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onChangeIs3D(false)}
                    className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                      !is3D
                        ? "border border-sky-500/50 bg-sky-600/30 text-sky-200"
                        : "border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    2D 平面
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeIs3D(true)}
                    className={`inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                      is3D
                        ? "border border-amber-500/50 bg-amber-600/30 text-amber-200"
                        : "border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Box className="h-3 w-3" /> 3D 立体
                  </button>
                </div>
                {is3D && (
                  <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
                    PLATEAU実測高さ（判明率98.2%）で立体表示中。右ドラッグ/Ctrl+ドラッグで回転・傾き調整。
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-slate-200">250mメッシュオーバーレイ</span>
              <input
                type="checkbox"
                checked={showHazardMesh}
                onChange={onToggleHazardMesh}
                className="h-4 w-4 accent-fuchsia-500"
              />
            </label>
            {showHazardMesh && (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeMeshOverlayMode("hazard")}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    meshOverlayMode === "hazard"
                      ? "bg-fuchsia-600/30 text-fuchsia-200 border border-fuchsia-500/50"
                      : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"
                  }`}
                >
                  震度6弱+確率
                </button>
                <button
                  type="button"
                  onClick={() => onChangeMeshOverlayMode("arv")}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    meshOverlayMode === "arv"
                      ? "bg-teal-600/30 text-teal-200 border border-teal-500/50"
                      : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"
                  }`}
                >
                  表層地盤 ARV
                </button>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 hover:border-slate-700">
            <span className="flex items-center gap-1.5 text-slate-200">
              <Activity className="h-3.5 w-3.5 text-rose-400" />
              気象庁 直近震源履歴
            </span>
            <input
              type="checkbox"
              checked={showEarthquakes}
              onChange={onToggleEarthquakes}
              className="h-4 w-4 accent-rose-500"
            />
          </label>
        </div>
      </section>

      {/* Age Category Filter + Legend */}
      <section className="mb-4 border-t border-slate-800 pt-3.5">
        <h2 className="mb-2 flex items-center gap-1.5 font-semibold text-slate-200">
          <Filter className="h-3.5 w-3.5 text-orange-400" />
          築年区分フィルター・凡例
        </h2>
        <div className="space-y-1.5">
          {ALL_AGE_CATS.map((cat) => {
            const active = ageCategories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onToggleAgeCategory(cat)}
                className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left transition ${
                  active
                    ? "border-slate-700 bg-slate-800/80 text-slate-100"
                    : "border-slate-800/70 bg-slate-950/40 text-slate-500 opacity-60"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-sm border border-white/20"
                    style={{ backgroundColor: AGE_COLORS[cat] }}
                  />
                  <span>{AGE_LABELS[cat]}</span>
                </span>
                <span className="text-[10px]">{active ? "表示中" : "除外"}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Hazard Tier Filter + Legend */}
      <section className="mb-4 border-t border-slate-800 pt-3.5">
        <h2 className="mb-1.5 font-semibold text-slate-200">
          30年震度6弱以上確率（J-SHIS）
        </h2>
        <p className="mb-2 text-[10px] text-slate-400">
          2024年版・平均ケース（全地震）
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {ALL_HAZARD_TIERS.map((tier) => {
            const active = hazardTiers.includes(tier);
            return (
              <button
                key={tier}
                type="button"
                onClick={() => onToggleHazardTier(tier)}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition ${
                  active
                    ? "border-slate-700 bg-slate-800/80 text-slate-100"
                    : "border-slate-800/70 bg-slate-950/40 text-slate-500 opacity-60"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: HAZARD_COLORS[tier] }}
                />
                <span className="truncate">{HAZARD_SHORT_LABELS[tier]}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Usage Filter */}
      <section className="mb-4 border-t border-slate-800 pt-3.5">
        <h2 className="mb-2 font-semibold text-slate-200">建物用途区分</h2>
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              ["all", "すべて"],
              ["residential", "住宅系"],
              ["non_residential", "非住宅"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => onChangeUsageGroup(val)}
              className={`rounded-md border px-2 py-1.5 text-[11px] font-medium transition ${
                usageGroup === val
                  ? "border-sky-500/60 bg-sky-500/20 text-sky-200"
                  : "border-slate-800 bg-slate-950/50 text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Disclaimers */}
      <section className="mt-auto rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200/90">
        <div className="mb-1 flex items-center gap-1 font-semibold text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          データの見方に関する注意
        </div>
        <ul className="list-disc space-y-1 pl-4 text-[10px]">
          <li>ハザード確率は揺れに見舞われる確率であり、建物の倒壊確率やリアルタイム地震予知ではありません。</li>
          <li>建築年は年単位のため、1981年・2000年基準の施行日（6月1日）の前後厳密判定には利用できません。</li>
          <li>建築年・用途が公開データにない場合は「不明」として保持しています。</li>
        </ul>
      </section>
    </aside>
  );
}
