"use client";

import React, { useEffect, useRef, useState } from "react";
import { GripHorizontal, RotateCcw } from "lucide-react";
import { MochimamoLive2D } from "@/components/MochimamoLive2D";

const STORAGE_KEY = "quakelens.mochimamo.pos.v1";

interface DraggableMochimamoBotProps {
  hasBottomRightCard: boolean;
  displayOpen?: boolean;
  onOpenAiChat: () => void;
}

interface Pos {
  x: number;
  y: number;
}

function clampToViewport(x: number, y: number, w: number, h: number): Pos {
  if (typeof window === "undefined") return { x, y };
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(68, window.innerHeight - h - 8);
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(68, y), maxY),
  };
}

export function DraggableMochimamoBot({
  hasBottomRightCard,
  displayOpen = false,
  onOpenAiChat,
}: DraggableMochimamoBotProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [customPos, setCustomPos] = useState<Pos | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origLeft: number;
    origTop: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    origLeft: 0,
    origTop: 0,
    moved: false,
  });

  // Restore saved drag position cleanly after mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Pos>;
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        const w = boxRef.current?.offsetWidth ?? 180;
        const h = boxRef.current?.offsetHeight ?? 210;
        const clamped = clampToViewport(parsed.x, parsed.y, w, h);
        queueMicrotask(() => setCustomPos(clamped));
      }
    } catch {
      // ignore invalid stored position
    }
  }, []);

  // Re-clamp custom position on viewport resize
  useEffect(() => {
    const onResize = () => {
      setCustomPos((prev) => {
        if (!prev) return null;
        const w = boxRef.current?.offsetWidth ?? 180;
        const h = boxRef.current?.offsetHeight ?? 210;
        return clampToViewport(prev.x, prev.y, w, h);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest("[data-reset-pos='true']")) {
      return;
    }
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false,
    };
    setIsDragging(true);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st.active) return;
    const dx = e.clientX - st.startClientX;
    const dy = e.clientY - st.startClientY;
    if (!st.moved && Math.hypot(dx, dy) < 6) return;
    st.moved = true;
    const w = boxRef.current?.offsetWidth ?? 180;
    const h = boxRef.current?.offsetHeight ?? 210;
    const next = clampToViewport(st.origLeft + dx, st.origTop + dy, w, h);
    setCustomPos(next);
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const st = dragStateRef.current;
    if (!st.active) return;
    st.active = false;
    setIsDragging(false);
    try {
      boxRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (st.moved) {
      const dx = e.clientX - st.startClientX;
      const dy = e.clientY - st.startClientY;
      const w = boxRef.current?.offsetWidth ?? 180;
      const h = boxRef.current?.offsetHeight ?? 210;
      const finalPos = clampToViewport(st.origLeft + dx, st.origTop + dy, w, h);
      setCustomPos(finalPos);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(finalPos));
      } catch {
        // ignore storage restrictions
      }
      return;
    }

    if (!cancelled) {
      onOpenAiChat();
    }
  };

  const handleResetPosition = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setCustomPos(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const autoPositionClasses = customPos
    ? ""
    : displayOpen
      ? hasBottomRightCard
        ? "hidden xl:flex xl:top-[74px] xl:right-[384px]"
        : "hidden xl:flex xl:bottom-4 xl:right-[384px]"
      : hasBottomRightCard
        ? "top-[122px] right-3 lg:top-[74px] lg:right-3"
        : "bottom-[70px] right-14 lg:bottom-[44px] lg:right-16";

  return (
    <div
      ref={boxRef}
      role="button"
      tabIndex={0}
      data-testid="mochimamo-launcher"
      aria-label="もちまも（ドラッグで移動、クリックで防災AIチャットを開く）"
      title="ドラッグで自由に移動 / クリックで防災AIチャットを開く"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishPointer(e, false)}
      onPointerCancel={(e) => finishPointer(e, true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenAiChat();
        }
      }}
      style={
        customPos
          ? { left: `${customPos.x}px`, top: `${customPos.y}px` }
          : undefined
      }
      className={`group pointer-events-auto fixed z-30 flex select-none touch-none flex-col items-center gap-1 rounded-2xl border bg-slate-900/92 p-1.5 shadow-2xl backdrop-blur-xl sm:p-2 ${
        isDragging
          ? "cursor-grabbing border-cyan-300 ring-2 ring-cyan-400/40"
          : "cursor-grab border-cyan-500/45 transition-[border-color,box-shadow] hover:border-cyan-400/85 hover:bg-slate-900"
      } ${!customPos ? "transition-all duration-200" : ""} ${autoPositionClasses}`}
    >
      {/* Drag Handle Strip */}
      <div className="flex w-full items-center justify-between gap-1 px-0.5 text-[9px] text-slate-400">
        <span className="inline-flex items-center gap-1 font-medium group-hover:text-cyan-200">
          <GripHorizontal className="h-3 w-3 text-cyan-400/80" />
          <span>ドラッグ移動</span>
        </span>
        {customPos && (
          <button
            type="button"
            data-reset-pos="true"
            data-testid="mochimamo-reset-pos-btn"
            onClick={handleResetPosition}
            title="定位置に戻す"
            aria-label="定位置に戻す"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-cyan-200"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="h-[92px] w-[92px] overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/70 sm:h-[116px] sm:w-[116px]">
        <MochimamoLive2D mood="idle" interactive={false} trackPointer className="h-full w-full" />
      </div>

      <div className="flex items-center gap-1 px-0.5">
        <span className="text-[11px] font-extrabold text-white">もちまも</span>
        <span className="rounded bg-cyan-500/20 px-1 py-0.5 text-[9px] font-semibold text-cyan-200">
          AI
        </span>
      </div>
    </div>
  );
}
