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
  OfficialShelter,
  R8LocateResponse,
  R8UnlistedLocateResponse,
  RouteSimulationResponse,
  ShelterHub,
} from "@/types/quakelens";

interface SelectedFeatureCardProps {
  selectedBuilding: BuildingDetail | null;
  selectedMesh: MeshDetail | null;
  selectedReport: DamageReport | null;
  selectedBlockedRoad: NetworkEdgeFeature | null;
  selectedShelterHub: ShelterHub | null;
  selectedOfficialShelter: OfficialShelter | null;
  selectedR8Facility?: R8LocateResponse | null;
  selectedR8Unlisted?: R8UnlistedLocateResponse | null;
  routeResult: RouteSimulationResponse | null;
  onClearSelection: () => void;
  onClearRoute: () => void;
  onReportBuilding: (building: BuildingDetail) => void;
  onDispatchToBuilding: (building: BuildingDetail) => void;
  onDispatchToReport: (report: DamageReport) => void;
  onEvacuateToHub: (hub: ShelterHub) => void;
  onRouteToOfficialShelter: (shelter: OfficialShelter) => void;
  onRecommendFromTarget: (target: { lat: number; lon: number; label: string }) => void;
  onStartPickRoadBlock: () => void;
  onResolveBlockedRoad: (reportId: string) => void;
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
  selectedOfficialShelter,
  selectedR8Facility = null,
  selectedR8Unlisted = null,
  routeResult,
  onClearSelection,
  onClearRoute,
  onReportBuilding,
  onDispatchToBuilding,
  onDispatchToReport,
  onEvacuateToHub,
  onRouteToOfficialShelter,
  onRecommendFromTarget,
  onStartPickRoadBlock,
  onResolveBlockedRoad,
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
      selectedShelterHub ||
      selectedOfficialShelter ||
      selectedR8Facility ||
      selectedR8Unlisted
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
                className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 px-2.5 py-1.5 text-[11px] text-rose-200"
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold">[{t.verification_label}]</span> {t.title}
                </span>
                {!t.is_sample && (
                  <button
                    type="button"
                    onClick={() => onResolveBlockedRoad(t.report_id)}
                    className="shrink-0 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/35"
                  >
                    通行止め解除
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onOpenNavPanel}
              className="flex items-center justify-center gap-1 rounded-xl bg-emerald-500 py-2 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Compass className="h-3.5 w-3.5" />
              迂回ナビを開く
            </button>
            <button
              type="button"
              onClick={onStartPickRoadBlock}
              className="flex items-center justify-center gap-1 rounded-xl border border-rose-500/50 bg-rose-500/15 py-2 text-[11px] font-bold text-rose-100 hover:bg-rose-500/25"
            >
              <Ban className="h-3.5 w-3.5" />
              別の道路を通行止め
            </button>
          </div>
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

      {!selectedReport &&
        !selectedBlockedRoad &&
        !selectedShelterHub &&
        selectedR8Facility && (
          <div
            data-testid="selected-feature-card"
            className="pointer-events-auto rounded-2xl border border-amber-500/60 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <Building2 className="h-4 w-4 text-amber-400" />
                <span>R8市有建築物耐震リスト 検索施設</span>
              </div>
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div data-testid="selected-r8-card">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <h3 className="text-sm font-bold text-white">
                  {selectedR8Facility.record.name}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                    selectedR8Facility.record.needs_retrofit
                      ? "border border-rose-500/60 bg-rose-500/25 text-rose-100"
                      : "border border-emerald-500/50 bg-emerald-500/20 text-emerald-100"
                  }`}
                >
                  耐震性能: {selectedR8Facility.record.seismic_grade}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {selectedR8Facility.record.ward} ／ {selectedR8Facility.matched_address}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                <span className="text-slate-400">構造・規模: </span>
                <strong className="text-slate-100">
                  {selectedR8Facility.record.structure} {selectedR8Facility.record.storeys ?? "?"}階
                </strong>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                <span className="text-slate-400">建築・面積: </span>
                <strong className="text-slate-100">
                  {selectedR8Facility.record.era} /{" "}
                  {selectedR8Facility.record.area_m2 != null
                    ? `${selectedR8Facility.record.area_m2.toLocaleString("ja-JP")}㎡`
                    : "—"}
                </strong>
              </div>
            </div>

            {selectedR8Facility.hazard && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-[11px] text-slate-300">
                J-SHIS地盤 ({selectedR8Facility.hazard.meshcode}):{" "}
                {selectedR8Facility.hazard.hazard_label} ／ ARV{" "}
                {selectedR8Facility.hazard.arv != null
                  ? selectedR8Facility.hazard.arv.toFixed(2)
                  : "—"}{" "}
                ／ {selectedR8Facility.hazard.jname}
              </div>
            )}

            {selectedR8Facility.record.needs_retrofit && (
              <div className="rounded-lg border border-rose-500/50 bg-rose-950/40 px-2.5 py-1.5 text-[10px] text-rose-100">
                耐震区分「{selectedR8Facility.record.seismic_grade}」のため、優先的な耐震改修・診断確認が必要です。
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onRecommendFromTarget({
                    lat: selectedR8Facility.lat,
                    lon: selectedR8Facility.lon,
                    label: selectedR8Facility.record.name,
                  })
                }
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-500 py-2 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                周辺避難場所Top5
              </button>
              <a
                href={selectedR8Facility.r8_pdf_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-700 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
              >
                <span>R8_list.pdf</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

      {!selectedReport &&
        !selectedBlockedRoad &&
        !selectedShelterHub &&
        !selectedR8Facility &&
        selectedR8Unlisted && (
          <div
            data-testid="selected-feature-card"
            className="pointer-events-auto rounded-2xl border border-rose-500/60 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-rose-300">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
                <span>R8耐震リスト未掲載地点（優先耐震対象）</span>
              </div>
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div data-testid="selected-r8-unlisted-card">
              <h3 className="text-sm font-bold text-white">{selectedR8Unlisted.query}</h3>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {selectedR8Unlisted.ward} ／ {selectedR8Unlisted.matched_address}
              </div>
              <p className="mt-1.5 rounded-lg border border-rose-500/45 bg-rose-950/35 px-2.5 py-1.5 text-[11px] text-rose-100">
                {selectedR8Unlisted.priority_message}
              </p>
              {selectedR8Unlisted.hazard && (
                <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-[11px] text-slate-300">
                  周辺J-SHIS ({selectedR8Unlisted.hazard.meshcode}):{" "}
                  {selectedR8Unlisted.hazard.hazard_label} ／ 旧耐震{" "}
                  {selectedR8Unlisted.hazard.pre_1981_count}棟
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onRecommendFromTarget({
                    lat: selectedR8Unlisted.lat,
                    lon: selectedR8Unlisted.lon,
                    label: selectedR8Unlisted.query,
                  })
                }
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-500 py-2 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                周辺避難場所Top5
              </button>
              <a
                href={selectedR8Unlisted.r8_pdf_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-700 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
              >
                <span>R8_list.pdf</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

      {!selectedReport &&
        !selectedBlockedRoad &&
        !selectedShelterHub &&
        !selectedR8Facility &&
        !selectedR8Unlisted &&
        selectedOfficialShelter && (
          <div
            data-testid="selected-feature-card"
            className="pointer-events-auto rounded-2xl border border-emerald-500/60 bg-slate-900/95 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>指定緊急避難場所（国土地理院・京都市公式）</span>
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
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-sm font-bold text-white">
                  {selectedOfficialShelter.name}
                </h3>
                {selectedOfficialShelter.is_wide_area && (
                  <span className="rounded-full border border-orange-500/60 bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-200">
                    広域避難場所
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {selectedOfficialShelter.ward} ／ {selectedOfficialShelter.address}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-300">
                {selectedOfficialShelter.is_wide_area ? (
                  <>
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-[#f97316] ring-1 ring-[#fb923c]" />
                    <span className="text-orange-200">
                      分類理由：大規模火災（延焼火災）対応のためオレンジピン表示
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-[#14b8a6]" />
                    <span className="text-teal-200">
                      分類理由：地震・水害等向けの指定緊急避難場所（火災は対象外）のため緑ピン表示
                    </span>
                  </>
                )}
              </div>
              {selectedOfficialShelter.disaster_labels.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedOfficialShelter.disaster_labels.map((lbl) => (
                    <span
                      key={lbl}
                      className="rounded-md border border-emerald-500/35 bg-emerald-950/50 px-1.5 py-0.5 text-[10px] text-emerald-200"
                    >
                      {lbl}
                    </span>
                  ))}
                </div>
              )}
              {selectedOfficialShelter.hazard && (
                <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-[11px] text-slate-300">
                  J-SHIS地盤: {selectedOfficialShelter.hazard.hazard_label} ／ ARV{" "}
                  {selectedOfficialShelter.hazard.arv != null
                    ? selectedOfficialShelter.hazard.arv.toFixed(2)
                    : "—"}
                </div>
              )}
              {selectedOfficialShelter.r8_seismic && (
                <div
                  data-testid="shelter-r8-status"
                  className={`mt-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
                    selectedOfficialShelter.r8_seismic.listed_in_r8
                      ? "border-emerald-500/40 bg-emerald-950/35 text-emerald-200"
                      : "border-amber-500/45 bg-amber-950/35 text-amber-200"
                  }`}
                >
                  {selectedOfficialShelter.r8_seismic.priority_note}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-testid="selected-official-shelter-route-btn"
                onClick={() => onRouteToOfficialShelter(selectedOfficialShelter)}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-500 py-2 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Compass className="h-3.5 w-3.5" />
                現在地からの避難経路
              </button>
              <button
                type="button"
                onClick={() =>
                  onRecommendFromTarget({
                    lat: selectedOfficialShelter.lat,
                    lon: selectedOfficialShelter.lon,
                    label: `${selectedOfficialShelter.name}周辺`,
                  })
                }
                className="rounded-xl border border-slate-700 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
              >
                ここから他候補を探す
              </button>
            </div>
          </div>
        )}

      {!selectedReport &&
        !selectedBlockedRoad &&
        !selectedShelterHub &&
        !selectedR8Facility &&
        !selectedR8Unlisted &&
        !selectedOfficialShelter &&
        selectedBuilding && (
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

          {selectedBuilding.r8_seismic_assessment && (
            <div
              data-testid="building-r8-priority-box"
              className={`space-y-1 rounded-xl border p-2.5 text-[11px] ${
                selectedBuilding.r8_seismic_assessment.priority_tier === "critical" ||
                selectedBuilding.r8_seismic_assessment.priority_tier === "listed_needs_work"
                  ? "border-rose-500/60 bg-rose-950/40 text-rose-100"
                  : selectedBuilding.r8_seismic_assessment.priority_tier === "high"
                    ? "border-amber-500/60 bg-amber-950/35 text-amber-100"
                    : selectedBuilding.r8_seismic_assessment.listed_in_r8
                      ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-100"
                      : "border-cyan-500/45 bg-cyan-950/30 text-cyan-100"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5 font-bold">
                <span>{selectedBuilding.r8_seismic_assessment.priority_badge}</span>
                <a
                  href={selectedBuilding.r8_seismic_assessment.r8_pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-0.5 underline opacity-90 hover:opacity-100"
                >
                  <span>R8_list.pdf</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="text-[10px] leading-relaxed opacity-95">
                {selectedBuilding.r8_seismic_assessment.recommendation}
              </p>
            </div>
          )}

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
            data-testid="selected-building-recommend-btn"
            onClick={() =>
              onRecommendFromTarget({
                lat: selectedBuilding.centroid_lat,
                lon: selectedBuilding.centroid_lon,
                label: `${selectedBuilding.ward_name} 建物 ${selectedBuilding.building_id}`,
              })
            }
            className="flex w-full items-center justify-center gap-1 rounded-xl border border-emerald-500/45 bg-emerald-500/15 py-1.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/25"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            この地点から推奨避難場所Top5を検索
          </button>

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
        !selectedR8Facility &&
        !selectedR8Unlisted &&
        !selectedOfficialShelter &&
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
            {selectedMesh.r8_unlisted_priority_count != null && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-950/25 px-2.5 py-1.5 text-[10px] text-amber-200">
                R8耐震リスト未掲載の優先耐震候補（1981以前＋不明）:{" "}
                <strong className="font-mono">
                  {selectedMesh.r8_unlisted_priority_count.toLocaleString("ja-JP")}棟
                </strong>
              </div>
            )}
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
            <button
              type="button"
              onClick={() =>
                onRecommendFromTarget({
                  lat: selectedMesh.centroid_lat,
                  lon: selectedMesh.centroid_lon,
                  label: `${selectedMesh.ward_name} (${selectedMesh.meshcode})`,
                })
              }
              className="flex w-full items-center justify-center gap-1 rounded-xl border border-emerald-500/45 bg-emerald-500/15 py-1.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/25"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              この地域の推奨避難場所Top5を検索
            </button>
          </div>
        )}
    </div>
  );
}
