"use client";

import React from "react";
import {
  AlertTriangle,
  Ambulance,
  Ban,
  Building2,
  Compass,
  ExternalLink,
  MessageSquareHeart,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Tent,
  X,
} from "lucide-react";
import { AGE_COLORS, REPORT_CATEGORY_META, REPORT_SEVERITY_META } from "@/lib/colors";
import { VerificationBadge } from "@/components/DamageReportPanel";
import {
  BuildingDetail,
  DamageReport,
  MeshDetail,
  NetworkEdgeFeature,
  RouteSimulationResponse,
  ShelterHub,
} from "@/types/quakelens";

interface SelectedFeatureCardProps {
  selectedBuilding: BuildingDetail | null;
  selectedMesh: MeshDetail | null;
  selectedReport: DamageReport | null;
  selectedBlockedRoad: NetworkEdgeFeature | null;
  selectedShelterHub: ShelterHub | null;
  routeResult: RouteSimulationResponse | null;
  onClearSelection: () => void;
  onClearRoute: () => void;
  onReportBuilding: (building: BuildingDetail) => void;
  onDispatchToBuilding: (building: BuildingDetail) => void;
  onDispatchToReport: (report: DamageReport) => void;
  onEvacuateToHub: (hub: ShelterHub) => void;
  onOpenNavPanel: () => void;
  onOpenSafetyForWard: (ward: string) => void;
  onOpenReportForMesh: (mesh: MeshDetail) => void;
  onRequestAiExplain: (prompt: string) => void;
}

export function SelectedFeatureCard({
  selectedBuilding,
  selectedMesh,
  selectedReport,
  selectedBlockedRoad,
  selectedShelterHub,
  routeResult,
  onClearSelection,
  onClearRoute,
  onReportBuilding,
  onDispatchToBuilding,
  onDispatchToReport,
  onEvacuateToHub,
  onOpenNavPanel,
  onOpenSafetyForWard,
  onOpenReportForMesh,
  onRequestAiExplain,
}: SelectedFeatureCardProps) {
  const hasSelection = Boolean(
    selectedBuilding ||
      selectedMesh ||
      selectedReport ||
      selectedBlockedRoad ||
      selectedShelterHub
  );

  if (!hasSelection && !routeResult) return null;

  return (
    <div className="pointer-events-none fixed bottom-16 right-3 z-20 flex w-[min(360px,calc(100vw-24px))] flex-col gap-2 lg:bottom-4 lg:right-14">
      {/* Compact Active Route HUD */}
      {routeResult && (
        <div
          data-testid="active-route-hud"
          className="pointer-events-auto rounded-2xl border border-emerald-500/60 bg-slate-900/95 p-3 text-xs text-slate-100 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                <Compass className="h-3.5 w-3.5" />
                <span>
                  {routeResult.mode === "rescue"
                    ? "救援ルート表示中"
                    : routeResult.mode === "evacuate"
                      ? "避難ルート表示中"
                      : "代替ルート表示中"}
                  （訓練用）
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs font-bold text-white">
                {routeResult.origin.name} → {routeResult.destination.name}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-300">
                回避距離:{" "}
                <strong className="font-mono text-emerald-200">
                  {routeResult.alternative_route.reachable
                    ? `${routeResult.alternative_route.distance_km} km`
                    : "到達不可"}
                </strong>
                {routeResult.blocked_segments.length > 0 && (
                  <span className="ml-2 text-rose-300">
                    （閉鎖 {routeResult.blocked_segments.length}区間回避）
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onOpenNavPanel}
                className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-slate-700"
              >
                詳細
              </button>
              <button
                type="button"
                onClick={onClearRoute}
                aria-label="ルートを解除"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selected Map Object Card */}
      {selectedReport && (
        <div
          data-testid="selected-feature-card"
          className="pointer-events-auto rounded-2xl border border-rose-500/50 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl space-y-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  REPORT_CATEGORY_META[selectedReport.category].badgeClass
                }`}
              >
                {selectedReport.category_label}
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  REPORT_SEVERITY_META[selectedReport.severity].badgeClass
                }`}
              >
                {selectedReport.severity_label}
              </span>
              <VerificationBadge status={selectedReport.verification_status} />
            </div>
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <h3 className="text-sm font-bold text-white">{selectedReport.title}</h3>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {selectedReport.ward_name}
              {selectedReport.location_label ? `・${selectedReport.location_label}` : ""}
              {selectedReport.building_id ? `・建物 ${selectedReport.building_id}` : ""}
            </div>
            <p className="mt-1.5 line-clamp-3 leading-relaxed text-slate-300">
              {selectedReport.description}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {!selectedReport.resolved &&
              selectedReport.lat != null &&
              selectedReport.lon != null &&
              selectedReport.category !== "road_blocked" && (
                <button
                  type="button"
                  onClick={() => onDispatchToReport(selectedReport)}
                  className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-2.5 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
                >
                  <Ambulance className="h-3.5 w-3.5" />
                  拠点から救援ルート
                </button>
              )}
            <button
              type="button"
              onClick={() =>
                onRequestAiExplain(
                  `被害報告（ID: ${selectedReport.id} / ${selectedReport.ward_name} / ${selectedReport.title}）と周辺の地震ハザード・建築年リスクを整理してください。`
                )
              }
              className="inline-flex items-center gap-1 rounded-xl border border-amber-400/50 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25"
            >
              <Sparkles className="h-3.5 w-3.5" />
              AIで分析
            </button>
          </div>
        </div>
      )}

      {!selectedReport && selectedBlockedRoad && (
        <div
          data-testid="selected-feature-card"
          className="pointer-events-auto rounded-2xl border border-rose-500/60 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl space-y-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-rose-300">
              <Ban className="h-4 w-4 text-rose-400" />
              <span>通行不可の道路区間（回避対象）</span>
            </div>
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="text-sm font-bold text-white">{selectedBlockedRoad.label}</div>
          <div className="space-y-1">
            {selectedBlockedRoad.triggered_by.map((t) => (
              <div
                key={t.report_id}
                className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-2.5 py-1.5 text-[11px] text-rose-200"
              >
                <span className="font-semibold">[{t.verification_label}]</span> {t.title}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onOpenNavPanel}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
          >
            <Compass className="h-3.5 w-3.5" />
            この区間を避けて迂回ナビを開く
          </button>
        </div>
      )}

      {!selectedReport && !selectedBlockedRoad && selectedShelterHub && (
        <div
          data-testid="selected-feature-card"
          className="pointer-events-auto rounded-2xl border border-emerald-500/50 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl space-y-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-emerald-300">
              <Tent className="h-4 w-4 text-emerald-400" />
              <span>防災・救援拠点（訓練用）</span>
            </div>
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">{selectedShelterHub.name}</h3>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {selectedShelterHub.ward}・{selectedShelterHub.role}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-300">{selectedShelterHub.status_note}</p>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onEvacuateToHub(selectedShelterHub)}
              className="flex-1 rounded-xl bg-sky-500 py-1.5 text-center text-[11px] font-bold text-slate-950 hover:bg-sky-400"
            >
              この拠点周辺の避難経路
            </button>
            <button
              type="button"
              onClick={() => onOpenSafetyForWard(selectedShelterHub.ward)}
              className="rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
            >
              区の安否確認
            </button>
          </div>
        </div>
      )}

      {!selectedReport && !selectedBlockedRoad && !selectedShelterHub && selectedBuilding && (
        <div
          data-testid="selected-feature-card"
          className="pointer-events-auto rounded-2xl border border-slate-700 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl space-y-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-400">
                <Building2 className="h-3.5 w-3.5" />
                <span>選択中の建物</span>
              </div>
              <h3 className="mt-0.5 truncate font-mono text-sm font-bold text-white">
                {selectedBuilding.building_id}
              </h3>
              <div className="text-[11px] text-slate-400">
                {selectedBuilding.ward_name} ／ 築
                {selectedBuilding.year_built ? `${selectedBuilding.year_built}年` : "不明"} ／{" "}
                {selectedBuilding.structure_label}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                style={{ backgroundColor: AGE_COLORS[selectedBuilding.age_category] }}
              >
                {selectedBuilding.age_label}
              </span>
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
              <span className="text-slate-400">用途・階数: </span>
              <span className="font-semibold text-slate-100">
                {selectedBuilding.usage_label}・{selectedBuilding.storeys_above ?? "?"}階
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
              <span className="text-slate-400">震度6弱+(30年): </span>
              <span className="font-mono font-semibold text-fuchsia-300">
                {selectedBuilding.t30_i55_ps != null
                  ? `${(selectedBuilding.t30_i55_ps * 100).toFixed(1)}%`
                  : "不明"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="selected-building-report-btn"
              onClick={() => onReportBuilding(selectedBuilding)}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-rose-500 px-2.5 py-2 text-[11px] font-bold text-white hover:bg-rose-400"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              この建物の被害を報告
            </button>
            <button
              type="button"
              onClick={() => onDispatchToBuilding(selectedBuilding)}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-500 px-2.5 py-2 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Ambulance className="h-3.5 w-3.5" />
              ここへ救援ルート
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              onRequestAiExplain(
                `建物 ${selectedBuilding.building_id}（${selectedBuilding.ward_name}）の耐震区分・地盤・京都市公式補助制度を解説してください。`
              )
            }
            className="flex w-full items-center justify-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AIでこの建物と補助制度を解説
          </button>

          {selectedBuilding.official_programs?.[0] && (
            <a
              href={selectedBuilding.official_programs[0].url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/25 px-2.5 py-1.5 text-[11px] text-emerald-200 hover:border-emerald-400"
            >
              <span className="flex items-center gap-1 truncate">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                {selectedBuilding.official_programs[0].title}
              </span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          )}
        </div>
      )}

      {!selectedReport &&
        !selectedBlockedRoad &&
        !selectedShelterHub &&
        !selectedBuilding &&
        selectedMesh && (
          <div
            data-testid="selected-feature-card"
            className="pointer-events-auto rounded-2xl border border-fuchsia-500/40 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold text-fuchsia-300">250mメッシュ</div>
                <h3 className="font-mono text-sm font-bold text-white">
                  {selectedMesh.meshcode}
                </h3>
                <div className="text-[11px] text-slate-400">
                  {selectedMesh.ward_name} ／ {selectedMesh.jname}
                </div>
              </div>
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                <span className="text-slate-400">1981以前: </span>
                <strong className="font-mono text-orange-300">
                  {selectedMesh.pre_1981_count}棟
                </strong>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                <span className="text-slate-400">震度6弱+: </span>
                <strong className="font-mono text-fuchsia-300">
                  {selectedMesh.t30_i55_ps != null
                    ? `${(selectedMesh.t30_i55_ps * 100).toFixed(1)}%`
                    : "不明"}
                </strong>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => onOpenReportForMesh(selectedMesh)}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-rose-500/20 px-2 py-1.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/30"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                報告
              </button>
              <button
                type="button"
                onClick={() => onOpenSafetyForWard(selectedMesh.ward_name)}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-sky-500/20 px-2 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/30"
              >
                <MessageSquareHeart className="h-3.5 w-3.5" />
                安否
              </button>
              <button
                type="button"
                onClick={() =>
                  onRequestAiExplain(
                    `メッシュ ${selectedMesh.meshcode}（${selectedMesh.ward_name}）のリスクと地盤特性を解説してください。`
                  )
                }
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-amber-500/20 px-2 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/30"
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI解説
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
