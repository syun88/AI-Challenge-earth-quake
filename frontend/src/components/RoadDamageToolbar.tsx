"use client";

import React from "react";
import {
  Brush,
  CheckCircle2,
  GitCommitHorizontal,
  Loader2,
  MousePointerClick,
  RotateCcw,
  ShieldAlert,
  X,
  ZoomIn,
} from "lucide-react";
import { ReportSeverity, RoadPaintTool } from "@/types/quakelens";

export const ROAD_CAUSE_PRESETS: Array<{ label: string; desc: string; severity: ReportSeverity }> = [
  {
    label: "路面陥没・段差",
    desc: "道路の亀裂・段差・陥没により車両の通行ができない状態です。",
    severity: "critical",
  },
  {
    label: "倒壊建物・塀による閉塞",
    desc: "沿道のブロック塀や建物の崩落物により道路が塞がれています。",
    severity: "critical",
  },
  {
    label: "電柱傾斜・倒木",
    desc: "電柱の傾斜や倒木・垂下線により通行危険（迂回必要）な状態です。",
    severity: "high",
  },
  {
    label: "橋梁・高架の損傷危険",
    desc: "橋梁や跨線橋に段差・破損が見られ、通行止めとなっています。",
    severity: "critical",
  },
  {
    label: "冠水・土砂流出",
    desc: "水道管破損による冠水または土砂流出のため通行困難です。",
    severity: "high",
  },
];

interface RoadDamageToolbarProps {
  tool: Exclude<RoadPaintTool, "none">;
  onChangeTool: (tool: Exclude<RoadPaintTool, "none">) => void;
  causeIdx: number;
  onChangeCauseIdx: (idx: number) => void;
  locationConsent: boolean;
  onChangeConsent: (val: boolean) => void;
  consentHighlight: boolean;
  corridorStart: { lat: number; lon: number; label?: string } | null;
  onClearCorridorStart: () => void;
  undoCount: number;
  onUndoLastClosure: () => void;
  busy: boolean;
  statusText: string | null;
  errorText: string | null;
  mapZoom: number;
  drawerOpen: boolean;
  onZoomIn: () => void;
  onClose: () => void;
}

export function RoadDamageToolbar({
  tool,
  onChangeTool,
  causeIdx,
  onChangeCauseIdx,
  locationConsent,
  onChangeConsent,
  consentHighlight,
  corridorStart,
  onClearCorridorStart,
  undoCount,
  onUndoLastClosure,
  busy,
  statusText,
  errorText,
  mapZoom,
  drawerOpen,
  onZoomIn,
  onClose,
}: RoadDamageToolbarProps) {
  return (
    <div
      data-testid="road-paint-toolbar"
      className={`pointer-events-auto fixed top-[66px] z-30 flex flex-col gap-2 rounded-2xl border border-cyan-500/50 bg-slate-950/95 p-2.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl ${
        drawerOpen
          ? "inset-x-2 lg:inset-x-auto lg:left-[444px] lg:right-3 lg:max-w-3xl"
          : "left-1/2 w-[min(780px,calc(100vw-20px))] -translate-x-1/2"
      }`}
    >
      {/* Row 1: 3 Tool Modes + Cause + Undo + Done */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="grid flex-1 min-w-[280px] sm:min-w-[340px] grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-900/90 p-1">
          <button
            type="button"
            data-testid="paint-mode-click"
            onClick={() => onChangeTool("click")}
            className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 sm:px-2 py-1.5 text-[10px] sm:text-[11px] font-bold transition ${
              tool === "click"
                ? "bg-cyan-400 text-slate-950 shadow-sm"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
            <span>道路クリック</span>
          </button>
          <button
            type="button"
            data-testid="paint-mode-corridor"
            onClick={() => onChangeTool("corridor")}
            className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 sm:px-2 py-1.5 text-[10px] sm:text-[11px] font-bold transition ${
              tool === "corridor"
                ? "bg-amber-400 text-slate-950 shadow-sm"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span>始点 → 終点</span>
          </button>
          <button
            type="button"
            data-testid="paint-mode-brush"
            onClick={() => onChangeTool("brush")}
            className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 sm:px-2 py-1.5 text-[10px] sm:text-[11px] font-bold transition ${
              tool === "brush"
                ? "bg-rose-500 text-white shadow-sm"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Brush className="h-3.5 w-3.5 shrink-0" />
            <span>Canvasでなぞる</span>
          </button>
        </div>

        <select
          aria-label="道路被害の原因"
          value={causeIdx}
          onChange={(e) => onChangeCauseIdx(Number(e.target.value))}
          className="h-8 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
        >
          {ROAD_CAUSE_PRESETS.map((p, idx) => (
            <option key={p.label} value={idx}>
              {p.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          data-testid="paint-undo-btn"
          disabled={undoCount === 0 || busy}
          onClick={onUndoLastClosure}
          title="直前に設定した道路閉鎖を取り消す"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>戻す{undoCount > 0 ? ` (${undoCount})` : ""}</span>
        </button>

        <button
          type="button"
          data-testid="paint-close-btn"
          onClick={onClose}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-800 px-2.5 text-[11px] font-bold text-slate-100 hover:bg-slate-700"
        >
          <X className="h-3.5 w-3.5" />
          <span>完了</span>
        </button>
      </div>

      {/* Row 2: Live contextual guidance + 1-time Consent + Zoom Helper */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {busy ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-cyan-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              道路区間を反映・経路再計算中...
            </span>
          ) : tool === "click" ? (
            <span className="text-cyan-100/95">
              水色に光る道路を<strong>クリックするだけで即・赤い通行止め</strong>になります（自作区間を再クリックで解除）
            </span>
          ) : tool === "corridor" ? (
            corridorStart ? (
              <span className="flex flex-wrap items-center gap-1.5 text-amber-200">
                <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-slate-950">
                  始点(S)決定済
                </span>
                <span>{corridorStart.label || "指定地点"} → ②「終点」の道路をクリック</span>
                <button
                  type="button"
                  onClick={onClearCorridorStart}
                  className="rounded border border-amber-500/50 px-1.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-500/20"
                >
                  始点やり直し
                </button>
              </span>
            ) : (
              <span className="text-amber-100/95">
                ① <strong>始点（S）となる道路</strong>をクリック → ② 終点クリックで間の道路を一括閉鎖
              </span>
            )
          ) : (
            <span className="text-rose-100/95">
              🖌 地図移動ロック中 — <strong>壊れた道路の上を指やマウスでなぞって離す</strong>と赤い通行止めに反映
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {mapZoom < 13.3 && (
            <button
              type="button"
              onClick={onZoomIn}
              className="inline-flex items-center gap-1 rounded-lg border border-sky-500/60 bg-sky-500/20 px-2 py-1 text-[10px] font-bold text-sky-200 hover:bg-sky-500/30"
            >
              <ZoomIn className="h-3 w-3" />
              拡大する (z14.5)
            </button>
          )}

          <label
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
              consentHighlight && !locationConsent
                ? "animate-pulse border-amber-400 bg-amber-500/30 text-amber-100 ring-2 ring-amber-400/70"
                : locationConsent
                  ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-200"
                  : "border-slate-700 bg-slate-900 text-slate-300"
            }`}
          >
            <input
              type="checkbox"
              data-testid="paint-consent-checkbox"
              checked={locationConsent}
              onChange={(e) => onChangeConsent(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-emerald-400 focus:ring-emerald-400"
            />
            <span>未確認の市民報告として公開（位置同意）</span>
          </label>
        </div>
      </div>

      {/* Row 3: Instant feedback / error pill */}
      {(errorText || statusText) && (
        <div
          data-testid="paint-feedback-banner"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${
            errorText
              ? "border-amber-500/60 bg-amber-950/60 text-amber-100"
              : "border-emerald-500/50 bg-emerald-950/50 text-emerald-100"
          }`}
        >
          {errorText ? (
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
          )}
          <span className="truncate">{errorText || statusText}</span>
        </div>
      )}
    </div>
  );
}
