"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, Hand, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { MochimamoLive2D, MochimamoMood } from "@/components/MochimamoLive2D";

export type StageMode = "compact" | "expanded" | "minimized";

interface MochimamoChatStageProps {
  mood: MochimamoMood;
  statusText: string;
  speechPulseKey: number;
  selectedWard: string;
}

const MOOD_META: Record<
  MochimamoMood,
  { label: string; badgeClass: string; glowClass: string }
> = {
  idle: {
    label: "見守り待機中",
    badgeClass: "border-cyan-500/40 bg-cyan-500/15 text-cyan-200",
    glowClass: "from-cyan-500/15 via-slate-900/60 to-indigo-950/50",
  },
  listening: {
    label: "質問を聞いています",
    badgeClass: "border-sky-400/50 bg-sky-500/20 text-sky-200",
    glowClass: "from-sky-500/20 via-slate-900/60 to-slate-950",
  },
  thinking: {
    label: "実データを照会・分析中",
    badgeClass: "border-cyan-400/60 bg-cyan-500/25 text-cyan-100",
    glowClass: "from-cyan-500/25 via-teal-950/40 to-slate-950",
  },
  speaking: {
    label: "ご説明しています",
    badgeClass: "border-emerald-400/60 bg-emerald-500/20 text-emerald-200",
    glowClass: "from-emerald-500/20 via-cyan-950/40 to-slate-950",
  },
  happy: {
    label: "案内完了！",
    badgeClass: "border-emerald-400/60 bg-emerald-500/20 text-emerald-100",
    glowClass: "from-emerald-500/25 via-sky-950/40 to-slate-950",
  },
  alert: {
    label: "ご注意・要確認",
    badgeClass: "border-amber-400/60 bg-amber-500/20 text-amber-200",
    glowClass: "from-amber-500/20 via-rose-950/30 to-slate-950",
  },
};

const MOCHIMAMO_TIPS = [
  "こんにちは！京都市防災AIマスコットの「もちまも」です。気になる区や建物を選んで話しかけてね！",
  "提灯ドローンとホログラム地図で京都市内を見守り中！PLATEAU・J-SHISの実データでお答えします。",
  "市民からの被害報告は「未確認情報」として公的データと区別して整理するので安心してくださいね。",
  "「CSVにまとめて」と頼むと、現在の地域レポートをすぐ出力できますよ！",
];

const MANUAL_MOODS: Array<{ id: MochimamoMood | "auto"; label: string }> = [
  { id: "auto", label: "自動" },
  { id: "happy", label: "笑顔" },
  { id: "thinking", label: "分析" },
  { id: "alert", label: "警戒" },
];

/**
 * Interactive Live2D stage header docked inside AiAssistantPanel.
 * Automatically mirrors ChatBot streaming/thinking/alert states while allowing
 * users to tap Mochimamo, wave, or resize/minimize the stage.
 */
export function MochimamoChatStage({
  mood,
  statusText,
  speechPulseKey,
  selectedWard,
}: MochimamoChatStageProps) {
  const [stageMode, setStageMode] = useState<StageMode>("compact");
  const [manualMood, setManualMood] = useState<MochimamoMood | "auto">("auto");
  const [waveTrigger, setWaveTrigger] = useState(0);
  const [tipIndex, setTipIndex] = useState<number | null>(null);

  const effectiveMood = manualMood === "auto" ? mood : manualMood;
  const meta = MOOD_META[effectiveMood];
  const areaLabel = selectedWard === "all" ? "京都市全域" : selectedWard;

  const displayBubble =
    manualMood !== "auto"
      ? `表情プレビュー中（${MANUAL_MOODS.find((m) => m.id === manualMood)?.label}）— 「自動」でAI連動に戻ります`
      : tipIndex !== null && effectiveMood === "idle"
        ? MOCHIMAMO_TIPS[tipIndex]
        : statusText;

  const handleTapMascot = () => {
    setWaveTrigger((n) => n + 1);
    setTipIndex((prev) => (prev === null ? 0 : (prev + 1) % MOCHIMAMO_TIPS.length));
  };

  if (stageMode === "minimized") {
    return (
      <div
        data-testid="mochimamo-chat-stage"
        className="mb-2 flex items-center justify-between rounded-xl border border-cyan-500/30 bg-slate-950/90 px-2.5 py-1.5"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          <span className="text-[11px] font-bold text-slate-100">もちまも</span>
          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${meta.badgeClass}`}>
            {meta.label}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setStageMode("compact")}
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-cyan-200 hover:border-cyan-500/50 hover:text-white"
        >
          <ChevronDown className="h-3 w-3" />
          表示
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="mochimamo-chat-stage"
      className={`relative mb-2.5 overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-br ${meta.glowClass} shadow-lg`}
    >
      {/* Subtle decorative radial cyber-bousai aura */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-8 -top-8 h-32 w-32 rounded-full bg-cyan-400/10 blur-2xl"
      />

      {stageMode === "compact" ? (
        <div className="flex items-stretch gap-2.5 p-2">
          {/* Live2D Canvas Stage (~1/5 viewport height) */}
          <div className="relative h-[152px] w-[148px] shrink-0 overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/65 sm:h-[168px] sm:w-[162px]">
            <MochimamoLive2D
              mood={effectiveMood}
              speechPulseKey={speechPulseKey}
              waveTrigger={waveTrigger}
              onTap={handleTapMascot}
              className="h-full w-full"
            />
          </div>

          {/* Right Status, Speech Bubble & Controls */}
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
            <div className="flex items-center justify-between gap-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="text-xs font-extrabold tracking-tight text-white">もちまも</span>
                <span
                  className={`truncate rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${meta.badgeClass}`}
                >
                  {meta.label}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={handleTapMascot}
                  title="手を振る"
                  className="rounded border border-slate-700/80 bg-slate-900/90 p-1 text-cyan-300 transition hover:border-cyan-400/60 hover:text-white"
                >
                  <Hand className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setStageMode("expanded")}
                  title="ステージを拡大"
                  className="rounded border border-slate-700/80 bg-slate-900/90 p-1 text-slate-300 transition hover:border-slate-500 hover:text-white"
                >
                  <Maximize2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setStageMode("minimized")}
                  title="もちまもを折りたたむ"
                  className="rounded border border-slate-700/80 bg-slate-900/90 p-1 text-slate-400 transition hover:border-slate-500 hover:text-white"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800/90 bg-slate-950/75 px-2.5 py-1.5 text-[11px] leading-snug text-slate-200">
              {displayBubble}
            </div>

            {/* Quick Live2D Mood Controls */}
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-[9px] text-slate-400">
                担当: <span className="text-sky-300">{areaLabel}</span>
              </span>
              <div className="flex items-center gap-0.5">
                {MANUAL_MOODS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setManualMood(opt.id)}
                    className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition ${
                      manualMood === opt.id
                        ? "bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-400/50"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col p-2.5">
          {/* Top Bar */}
          <div className="mb-1.5 flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
              <span className="truncate text-xs font-extrabold text-white">もちまも Live2D</span>
              <span
                className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${meta.badgeClass}`}
              >
                {meta.label}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={handleTapMascot}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-100 hover:bg-cyan-500/25"
              >
                <Hand className="h-3 w-3" />
                手を振る
              </button>
              <button
                type="button"
                onClick={() => setStageMode("compact")}
                title="コンパクト表示に戻す"
                className="shrink-0 rounded border border-slate-700 bg-slate-900 p-1 text-slate-300 hover:text-white"
              >
                <Minimize2 className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Large Interactive Stage */}
          <div className="relative h-[236px] w-full overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/70">
            <MochimamoLive2D
              mood={effectiveMood}
              speechPulseKey={speechPulseKey}
              waveTrigger={waveTrigger}
              onTap={handleTapMascot}
              className="h-full w-full"
            />
            <div className="pointer-events-none absolute bottom-1.5 left-2 rounded bg-slate-950/75 px-1.5 py-0.5 text-[9px] text-slate-400">
              マウス追従・クリックで反応
            </div>
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate rounded-md border border-slate-800 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-200">
              {displayBubble}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {MANUAL_MOODS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setManualMood(opt.id)}
                  className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition ${
                    manualMood === opt.id
                      ? "bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-400/50"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
