"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Ambulance,
  Ban,
  Brush,
  Building2,
  CheckCircle2,
  Compass,
  Construction,
  GitCommitHorizontal,
  Loader2,
  MapPin,
  MousePointerClick,
  Navigation,
  Route as RouteIcon,
  ShieldAlert,
  Tent,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  createDamageReport,
  deleteDamageReport,
  getRouteNodes,
  simulateNavigation,
  updateDamageReport,
} from "@/lib/api";
import { REPORT_CATEGORY_META, VERIFICATION_META } from "@/lib/colors";
import { readLocalReportAuth, saveLocalReportAuth } from "@/lib/reportAuth";
import { ROAD_CAUSE_PRESETS } from "@/components/RoadDamageToolbar";
import {
  DamageReport,
  NetworkStatusResponse,
  RoadPaintTool,
  RouteNode,
  RouteSimulationResponse,
  ShelterHub,
  SnappedRoadInfo,
  UserRole,
} from "@/types/quakelens";

export type NavMode = "evacuate" | "rescue" | "custom";

interface NavigationPanelProps {
  userRole: UserRole;
  reports: DamageReport[];
  networkStatus: NetworkStatusResponse | null;
  routeResult: RouteSimulationResponse | null;
  includeSamples: boolean;
  isPickingEvacuate: boolean;
  isPickingRescue: boolean;
  isPickingRoadBlock: boolean;
  pickedEvacuateCoords: { lat: number; lon: number; label?: string } | null;
  pickedRescueCoords: { lat: number; lon: number; label?: string } | null;
  snappedRoadTarget: SnappedRoadInfo | null;
  onStartPickEvacuate: () => void;
  onStartPickRescue: () => void;
  onStartPickRoadBlock: () => void;
  onOpenRoadPaintMode?: (tool: Exclude<RoadPaintTool, "none">) => void;
  onClearRoadBlockTarget: () => void;
  onCancelPick: () => void;
  onChangeRouteResult: (
    res: RouteSimulationResponse | null,
    params?: Parameters<typeof simulateNavigation>[0]
  ) => void;
  onSelectShelterHub: (hub: ShelterHub) => void;
  onFocusReport: (report: DamageReport) => void;
  onRoadClosuresChanged: () => Promise<void> | void;
  onFocusMap?: () => void;
}

export function NavigationPanel({
  userRole,
  reports,
  networkStatus,
  routeResult,
  includeSamples,
  isPickingEvacuate,
  isPickingRescue,
  isPickingRoadBlock,
  pickedEvacuateCoords,
  pickedRescueCoords,
  snappedRoadTarget,
  onStartPickEvacuate,
  onStartPickRescue,
  onStartPickRoadBlock,
  onOpenRoadPaintMode,
  onClearRoadBlockTarget,
  onCancelPick,
  onChangeRouteResult,
  onSelectShelterHub,
  onFocusReport,
  onRoadClosuresChanged,
  onFocusMap,
}: NavigationPanelProps) {
  const canRescue = userRole === "government";
  const canCustom = userRole === "government" || userRole === "enterprise";
  const [selectedNavMode, setSelectedNavMode] = useState<NavMode>(
    routeResult?.mode === "rescue" && canRescue
      ? "rescue"
      : routeResult?.mode === "custom" && canCustom
        ? "custom"
        : "evacuate"
  );
  const navMode: NavMode =
    selectedNavMode === "rescue" && !canRescue
      ? "evacuate"
      : selectedNavMode === "custom" && !canCustom
        ? "evacuate"
        : selectedNavMode;
  const setNavMode = setSelectedNavMode;
  const [nodes, setNodes] = useState<RouteNode[]>([]);
  const [originId, setOriginId] = useState("takeda_st");
  const [destinationId, setDestinationId] = useState("chushojima");
  const [evacOriginNodeId, setEvacOriginNodeId] = useState("chushojima");
  const [avoidUnverified, setAvoidUnverified] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick road-closure creator state
  const [causeIdx, setCauseIdx] = useState(0);
  const [roadConsent, setRoadConsent] = useState(false);
  const [customRoadNote, setCustomRoadNote] = useState("");
  const [savingRoadBlock, setSavingRoadBlock] = useState(false);
  const [roadFeedback, setRoadFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [localAuthMap, setLocalAuthMap] = useState<Record<string, string>>({});

  useEffect(() => {
    queueMicrotask(() => {
      setLocalAuthMap(readLocalReportAuth());
    });
  }, [reports.length]);

  useEffect(() => {
    let cancelled = false;
    getRouteNodes()
      .then((res) => {
        if (!cancelled) setNodes(res.nodes || []);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runNav = async (params: Parameters<typeof simulateNavigation>[0]) => {
    setLoading(true);
    setError(null);
    try {
      const fullParams = {
        ...params,
        includeSamples,
        avoidUnverified,
      };
      const res = await simulateNavigation(fullParams);
      onChangeRouteResult(res, fullParams);
      onFocusMap?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "経路計算に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRoadBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!snappedRoadTarget || savingRoadBlock) return;
    if (!roadConsent) {
      setRoadFeedback({
        type: "err",
        text: "地図上に通行止め情報を記録・表示するには、下の同意チェックを入れてください。",
      });
      return;
    }

    const preset = ROAD_CAUSE_PRESETS[causeIdx] ?? ROAD_CAUSE_PRESETS[0];
    const effPasscode = String(Math.floor(1000 + Math.random() * 9000));
    const descText = customRoadNote.trim()
      ? `${preset.desc}（補足: ${customRoadNote.trim()}）`
      : preset.desc;

    setSavingRoadBlock(true);
    setRoadFeedback(null);
    try {
      const res = await createDamageReport({
        category: "road_blocked",
        severity: preset.severity,
        title: `${snappedRoadTarget.road_name} ${preset.label}による通行止め`,
        description: descText,
        ward_name: snappedRoadTarget.ward_name,
        meshcode: snappedRoadTarget.meshcode,
        location_label: snappedRoadTarget.road_name,
        lat: snappedRoadTarget.snap_lat,
        lon: snappedRoadTarget.snap_lon,
        location_consent: true,
        passcode: effPasscode,
        force_duplicate: true,
      });
      saveLocalReportAuth(res.report.id, effPasscode);
      setLocalAuthMap(readLocalReportAuth());
      setCustomRoadNote("");
      setRoadConsent(false);
      onClearRoadBlockTarget();
      await onRoadClosuresChanged();
      setRoadFeedback({
        type: "ok",
        text: `${snappedRoadTarget.road_name} を通行止めに設定しました（管理用暗証番号: ${effPasscode}）。`,
      });
    } catch (err) {
      setRoadFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "通行止めの設定に失敗しました。",
      });
    } finally {
      setSavingRoadBlock(false);
    }
  };

  const handleResolveRoad = async (rep: DamageReport) => {
    const code = localAuthMap[rep.id] || window.prompt("解除用の暗証番号を入力してください");
    if (code === null) return;
    setBusyReportId(rep.id);
    setRoadFeedback(null);
    try {
      await updateDamageReport(rep.id, { passcode: code, resolved: true });
      await onRoadClosuresChanged();
      setRoadFeedback({
        type: "ok",
        text: `${rep.title} の通行止めを解除（復旧済み）しました。`,
      });
    } catch (err) {
      setRoadFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "解除に失敗しました。",
      });
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDeleteRoad = async (rep: DamageReport) => {
    const code = localAuthMap[rep.id] || window.prompt("削除用の暗証番号を入力してください");
    if (code === null) return;
    setBusyReportId(rep.id);
    setRoadFeedback(null);
    try {
      await deleteDamageReport(rep.id, code);
      await onRoadClosuresChanged();
      setRoadFeedback({
        type: "ok",
        text: `通行止め設定（${rep.title}）を削除しました。`,
      });
    } catch (err) {
      setRoadFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "削除に失敗しました。",
      });
    } finally {
      setBusyReportId(null);
    }
  };

  const dispatchTargets = reports
    .filter(
      (r) =>
        !r.resolved &&
        r.lat != null &&
        r.lon != null &&
        (r.category === "rescue_support" ||
          r.category === "building_damage" ||
          r.category === "other_disaster")
    )
    .sort((a, b) => {
      const rank: Record<string, number> = { critical: 0, high: 1, moderate: 2, info: 3 };
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    });

  const activeRoadBlocks = reports.filter((r) => !r.resolved && r.category === "road_blocked");
  const hubs = networkStatus?.hubs ?? [];
  const blockedCount = networkStatus?.blocked_count ?? 0;

  return (
    <div className="space-y-4 p-4 text-sm text-slate-200">
      {/* Header + Clear Route */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Compass className="h-5 w-5 text-sky-400" />
            <span>避難・救援ルート案内</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            実道路上の通行止め（現在 <strong className="text-rose-300">{blockedCount}か所</strong>）を避けて計算します
          </p>
        </div>
        {routeResult && (
          <button
            type="button"
            onClick={() => onChangeRouteResult(null)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
          >
            <XCircle className="h-3.5 w-3.5" />
            解除
          </button>
        )}
      </div>

      {/* Mandatory Simulation Disclaimer */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div>
          <span className="font-bold text-amber-300">訓練・研究用シミュレーション</span>
          <p className="mt-0.5 text-[11px] text-amber-100/90">
            OpenStreetMap実道路網と報告データに基づく試算です。実災害時の道路安全性や避難所開設を保証するものではありません。
          </p>
        </div>
      </div>

      {/* Damaged / Closed Road Setup Card */}
      <div className="space-y-2.5 rounded-xl border border-rose-500/40 bg-rose-950/20 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-rose-200">
            <Construction className="h-4 w-4 text-rose-400" />
            <span>壊れた道路（通行止め）の設定・管理</span>
          </div>
          <span className="rounded-full bg-rose-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-200">
            {activeRoadBlocks.length}件
          </span>
        </div>

        {onOpenRoadPaintMode && (
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              data-testid="nav-paint-click-btn"
              onClick={() => onOpenRoadPaintMode("click")}
              className="flex items-center justify-center gap-1 rounded-xl border border-cyan-500/50 bg-cyan-500/15 px-2 py-2 text-[11px] font-bold text-cyan-100 hover:bg-cyan-500/25"
            >
              <MousePointerClick className="h-3.5 w-3.5 text-cyan-300 shrink-0" />
              <span className="truncate">道路クリック</span>
            </button>
            <button
              type="button"
              data-testid="nav-paint-corridor-btn"
              onClick={() => onOpenRoadPaintMode("corridor")}
              className="flex items-center justify-center gap-1 rounded-xl border border-amber-500/50 bg-amber-500/15 px-2 py-2 text-[11px] font-bold text-amber-100 hover:bg-amber-500/25"
            >
              <GitCommitHorizontal className="h-3.5 w-3.5 text-amber-300 shrink-0" />
              <span className="truncate">始点→終点</span>
            </button>
            <button
              type="button"
              data-testid="nav-paint-brush-btn"
              onClick={() => onOpenRoadPaintMode("brush")}
              className="flex items-center justify-center gap-1 rounded-xl border border-rose-500/50 bg-rose-500/20 px-2 py-2 text-[11px] font-bold text-rose-100 hover:bg-rose-500/30"
            >
              <Brush className="h-3.5 w-3.5 text-rose-300 shrink-0" />
              <span className="truncate">Canvasなぞり</span>
            </button>
          </div>
        )}

        <button
          type="button"
          data-testid="nav-pick-road-block-btn"
          onClick={isPickingRoadBlock ? onCancelPick : onStartPickRoadBlock}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
            isPickingRoadBlock
              ? "border-amber-400 bg-amber-500/25 text-amber-100"
              : "border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500"
          }`}
        >
          <Ban className="h-3.5 w-3.5 text-rose-300" />
          {isPickingRoadBlock
            ? "地図上の道路をクリックしてください（押下で中止）"
            : "メモを添えて1地点を指定する"}
        </button>

        {snappedRoadTarget && (
          <form
            onSubmit={handleSubmitRoadBlock}
            data-testid="road-block-quick-form"
            className="space-y-2.5 rounded-xl border border-amber-400/60 bg-slate-950/90 p-3 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-amber-300">
                  選択した実道路セグメント
                </div>
                <div className="mt-0.5 text-sm font-bold text-white">
                  {snappedRoadTarget.road_name}
                </div>
                <div className="text-[11px] text-slate-400">
                  {snappedRoadTarget.ward_name} ／ {snappedRoadTarget.highway_label}
                </div>
              </div>
              <button
                type="button"
                onClick={onClearRoadBlockTarget}
                className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-slate-300">損壊・通行止めの状況</div>
              <div className="flex flex-wrap gap-1">
                {ROAD_CAUSE_PRESETS.map((preset, idx) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setCauseIdx(idx)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                      causeIdx === idx
                        ? "border-rose-400 bg-rose-500/25 text-white"
                        : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="text"
              maxLength={120}
              value={customRoadNote}
              onChange={(e) => setCustomRoadNote(e.target.value)}
              placeholder="補足メモ（任意：片側車線崩落・迂回方向など）"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500"
            />

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/70 p-2 text-[11px] text-slate-200">
              <input
                type="checkbox"
                data-testid="road-block-consent-checkbox"
                checked={roadConsent}
                onChange={(e) => setRoadConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-rose-500"
              />
              <span>
                この道路地点を<strong>「未確認（市民報告）」</strong>として記録・地図公開することに同意する
              </span>
            </label>

            <button
              type="submit"
              data-testid="road-block-submit-btn"
              disabled={savingRoadBlock}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-rose-500 py-2 text-xs font-bold text-white transition hover:bg-rose-400 disabled:opacity-50"
            >
              {savingRoadBlock ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              この道路を通行止めに設定（表示ルートも自動再計算）
            </button>
          </form>
        )}

        {roadFeedback && (
          <div
            className={`rounded-lg border px-2.5 py-2 text-[11px] ${
              roadFeedback.type === "ok"
                ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-100"
                : "border-rose-500/50 bg-rose-950/50 text-rose-100"
            }`}
          >
            {roadFeedback.text}
          </div>
        )}

        {activeRoadBlocks.length > 0 && (
          <div className="max-h-36 space-y-1.5 overflow-y-auto pr-0.5 pt-0.5">
            {activeRoadBlocks.map((rep) => {
              const canManage = !rep.is_sample && Boolean(localAuthMap[rep.id] || rep.has_passcode);
              return (
                <div
                  key={rep.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-slate-950/80 px-2.5 py-1.5 text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() => onFocusReport(rep)}
                    className="min-w-0 flex-1 truncate text-left font-medium text-rose-100 hover:underline"
                    title={rep.title}
                  >
                    {rep.ward_name}：{rep.title}
                  </button>
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        data-testid={`resolve-road-${rep.id}`}
                        disabled={busyReportId === rep.id}
                        onClick={() => void handleResolveRoad(rep)}
                        className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                      >
                        解除
                      </button>
                      <button
                        type="button"
                        disabled={busyReportId === rep.id}
                        onClick={() => void handleDeleteRoad(rep)}
                        aria-label="通行止めを削除"
                        className="rounded border border-rose-500/40 px-1 py-0.5 text-rose-300 hover:bg-rose-500/25"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {rep.is_sample ? "訓練例" : "報告済"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mode Selector Tabs (role-filtered) */}
      <div
        className={`grid gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-1 ${
          canRescue && canCustom
            ? "grid-cols-3"
            : canCustom
              ? "grid-cols-2"
              : "grid-cols-1"
        }`}
      >
        <button
          type="button"
          data-testid="nav-mode-evacuate"
          onClick={() => setNavMode("evacuate")}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
            navMode === "evacuate"
              ? "bg-sky-500 text-slate-950 shadow-sm"
              : "text-slate-300 hover:bg-slate-800/80"
          }`}
        >
          <Tent className="h-3.5 w-3.5" />
          <span>避難所へ</span>
        </button>
        {canRescue && (
          <button
            type="button"
            data-testid="nav-mode-rescue"
            onClick={() => setNavMode("rescue")}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
              navMode === "rescue"
                ? "bg-emerald-500 text-slate-950 shadow-sm"
                : "text-slate-300 hover:bg-slate-800/80"
            }`}
          >
            <Ambulance className="h-3.5 w-3.5" />
            <span>救援出動</span>
          </button>
        )}
        {canCustom && (
          <button
            type="button"
            data-testid="nav-mode-custom"
            onClick={() => setNavMode("custom")}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
              navMode === "custom"
                ? "bg-purple-500 text-white shadow-sm"
                : "text-slate-300 hover:bg-slate-800/80"
            }`}
          >
            <RouteIcon className="h-3.5 w-3.5" />
            <span>2拠点比較</span>
          </button>
        )}
      </div>

      {/* Global Avoidance Toggle */}
      <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
        <input
          type="checkbox"
          checked={avoidUnverified}
          onChange={(e) => setAvoidUnverified(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-sky-400"
        />
        <span>未確認の市民報告による道路通行止めも安全側で迂回する</span>
      </label>

      {/* Mode 1: Evacuate to Nearest Shelter */}
      {navMode === "evacuate" && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <div className="text-xs font-semibold text-sky-300">
            現在地から最寄りの開設可能避難拠点へ
          </div>

          <button
            type="button"
            data-testid="nav-pick-evacuate-btn"
            onClick={isPickingEvacuate ? onCancelPick : onStartPickEvacuate}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-bold transition ${
              isPickingEvacuate
                ? "border-amber-400 bg-amber-500/20 text-amber-200"
                : "border-sky-500/60 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25"
            }`}
          >
            <MapPin className="h-4 w-4 text-sky-400" />
            {isPickingEvacuate
              ? "地図上で現在地をクリックしてください（押下で解除）"
              : "地図をクリックして現在地から避難ルートを検索"}
          </button>

          {pickedEvacuateCoords && (
            <div className="rounded-lg border border-sky-500/40 bg-sky-950/30 px-3 py-2 text-xs text-sky-200">
              指定中の現在地:{" "}
              <span className="font-mono">
                {pickedEvacuateCoords.label ||
                  `${pickedEvacuateCoords.lat.toFixed(4)}, ${pickedEvacuateCoords.lon.toFixed(4)}`}
              </span>
            </div>
          )}

          {nodes.length > 0 && (
            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <div className="text-[11px] font-medium text-slate-400">
                または最寄りの主要交差点・駅から計算
              </div>
              <div className="flex gap-2">
                <select
                  value={evacOriginNodeId}
                  onChange={(e) => setEvacOriginNodeId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.ward}：{n.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    void runNav({
                      mode: "evacuate",
                      originId: evacOriginNodeId,
                    })
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
                  検索
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mode 2: Shelter-to-Incident Rescue Dispatch (Government Only) */}
      {canRescue && navMode === "rescue" && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <div className="text-xs font-semibold text-emerald-300">
            避難・支援拠点 → 要救助・倒壊現場への救援ルート
          </div>

          <button
            type="button"
            data-testid="nav-pick-rescue-btn"
            onClick={isPickingRescue ? onCancelPick : onStartPickRescue}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
              isPickingRescue
                ? "border-amber-400 bg-amber-500/20 text-amber-200"
                : "border-emerald-500/60 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
            }`}
          >
            <MapPin className="h-4 w-4 text-emerald-400" />
            {isPickingRescue
              ? "地図上の建物・現場をクリックしてください（押下で解除）"
              : "地図上の被害建物・任意の現場をクリックして救援経路"}
          </button>

          {pickedRescueCoords && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
              指定した支援先:{" "}
              <span className="font-mono">
                {pickedRescueCoords.label ||
                  `${pickedRescueCoords.lat.toFixed(4)}, ${pickedRescueCoords.lon.toFixed(4)}`}
              </span>
            </div>
          )}

          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-medium text-slate-400">
              地図上の要支援・建物損傷報告へワンクリック出動計算
            </div>
            {dispatchTargets.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center text-xs text-slate-400">
                座標付きの救助・建物被害報告はまだありません。
              </div>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto pr-0.5">
                {dispatchTargets.map((rep) => {
                  const catMeta = REPORT_CATEGORY_META[rep.category];
                  const verMeta = VERIFICATION_META[rep.verification_status];
                  return (
                    <div
                      key={rep.id}
                      className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 transition hover:border-emerald-500/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${catMeta.badgeClass}`}
                            >
                              {catMeta.short}
                            </span>
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${verMeta.badgeClass}`}
                            >
                              {verMeta.short}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-300">
                              {rep.ward_name}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs font-bold text-white">
                            {rep.title}
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid={`dispatch-report-${rep.id}`}
                          disabled={loading}
                          onClick={() =>
                            void runNav({
                              mode: "rescue",
                              targetReportId: rep.id,
                            })
                          }
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                        >
                          <Ambulance className="h-3.5 w-3.5" />
                          救援経路
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode 3: Custom Origin-Destination Comparison (Government & Enterprise) */}
      {canCustom && navMode === "custom" && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="nav-preset-fushimi"
              onClick={() => {
                setOriginId("takeda_st");
                setDestinationId("chushojima");
                void runNav({
                  mode: "custom",
                  originId: "takeda_st",
                  destinationId: "chushojima",
                });
              }}
              className="rounded-lg border border-purple-500/40 bg-purple-500/15 px-2.5 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-500/25"
            >
              伏見区デモ（竹田 → 中書島）
            </button>
            <button
              type="button"
              onClick={() => {
                setOriginId("kyoto_st");
                setDestinationId("yamashina_st");
                void runNav({
                  mode: "custom",
                  originId: "kyoto_st",
                  destinationId: "yamashina_st",
                });
              }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              京都駅 → 山科駅
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">出発地点</label>
              <select
                value={originId}
                onChange={(e) => setOriginId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.ward}：{n.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">目的地</label>
              <select
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.ward}：{n.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() =>
              void runNav({
                mode: "custom",
                originId,
                destinationId,
              })
            }
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-purple-500 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
            迂回ルートを比較計算
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Calculated Route Details */}
      {routeResult && (
        <div
          data-testid="nav-route-result"
          className="space-y-3 rounded-xl border border-emerald-500/40 bg-slate-950/90 p-3.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold text-emerald-400">
                {routeResult.mode === "evacuate"
                  ? "避難所ルート試算"
                  : routeResult.mode === "rescue"
                    ? "救援出動ルート試算"
                    : "代替経路比較試算"}
              </div>
              <div className="mt-0.5 text-xs font-bold text-white">
                {routeResult.origin.name} → {routeResult.destination.name}
              </div>
            </div>
            {routeResult.rerouted && (
              <span className="shrink-0 rounded-full border border-amber-400/50 bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-200">
                迂回ルート適用
              </span>
            )}
          </div>

          {routeResult.note && (
            <div className="rounded-lg border border-sky-500/35 bg-sky-950/30 p-2 text-[11px] text-sky-200">
              {routeResult.note}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="text-[11px] text-slate-400">通常最短距離</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-slate-300">
                {routeResult.baseline_route.reachable
                  ? `${routeResult.baseline_route.distance_km} km`
                  : "到達不可"}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/35 bg-emerald-950/20 p-2.5">
              <div className="text-[11px] text-emerald-300">通行止め回避距離</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-emerald-200">
                {routeResult.alternative_route.reachable
                  ? `${routeResult.alternative_route.distance_km} km`
                  : "到達不可"}
                {routeResult.detour_delta_km != null && routeResult.detour_delta_km > 0 && (
                  <span className="ml-1 text-[11px] font-normal text-amber-300">
                    (+{routeResult.detour_delta_km} km)
                  </span>
                )}
              </div>
            </div>
          </div>

          {routeResult.blocked_segments.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-rose-300">
                <Ban className="h-3.5 w-3.5" />
                <span>回避中の通行止め区間 ({routeResult.blocked_segments.length}区間)</span>
              </div>
              {routeResult.blocked_segments.slice(0, 6).map((seg, i) => (
                <div
                  key={`${seg.from_id}-${seg.to_id}-${i}`}
                  className="rounded-lg border border-rose-500/30 bg-rose-950/25 px-2.5 py-1.5 text-[11px] text-rose-200"
                >
                  <span className="font-semibold">{seg.label}</span>
                  {seg.triggered_by[0] && (
                    <span className="ml-1.5 text-rose-300/85">
                      ({seg.triggered_by[0].verification_label}: {seg.triggered_by[0].title})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {routeResult.alternative_route.reachable ? (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-300">推奨経由ルート（実道路）</div>
              <ol className="space-y-1 pl-1 text-xs text-slate-200">
                {routeResult.alternative_route.segments.map((seg, i) => (
                  <li key={`${seg}-${i}`} className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 font-mono text-[10px] font-bold text-emerald-300">
                      {i + 1}
                    </span>
                    <span>{seg}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/50 bg-rose-950/40 p-2.5 text-xs text-rose-200">
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
              <span>すべての経路が通行止め報告により遮断されています。</span>
            </div>
          )}
        </div>
      )}

      {/* Shelter & Relief Hubs Overview */}
      {hubs.length > 0 && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-emerald-400" />
              <span>防災・救援拠点ステータス（訓練用）</span>
            </span>
            <span className="text-[11px] text-slate-400">クリックで地図移動</span>
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-0.5">
            {hubs.map((hub) => {
              const badge =
                hub.hub_status === "support_needed"
                  ? "border-rose-500/60 bg-rose-500/20 text-rose-200"
                  : hub.hub_status === "restricted"
                    ? "border-amber-500/60 bg-amber-500/20 text-amber-200"
                    : "border-emerald-500/50 bg-emerald-500/15 text-emerald-200";
              const statusText =
                hub.hub_status === "support_needed"
                  ? "近隣要支援"
                  : hub.hub_status === "restricted"
                    ? "確認中・注意"
                    : "待機・開設可";
              return (
                <button
                  key={hub.id}
                  type="button"
                  onClick={() => onSelectShelterHub(hub)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-left text-xs transition hover:border-sky-500/50 hover:bg-slate-800/80"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-white">{hub.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400">
                      {hub.ward} ／ {hub.status_note}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge}`}>
                    {statusText}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
