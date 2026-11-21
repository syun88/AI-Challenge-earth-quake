"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Navigation, Route, XCircle } from "lucide-react";
import { getRouteNodes, simulateRoute } from "@/lib/api";
import { RouteNode, RouteSimulationResponse } from "@/types/quakelens";

interface RouteSimulatorCardProps {
  routeResult: RouteSimulationResponse | null;
  onChangeRouteResult: (res: RouteSimulationResponse | null) => void;
  includeSamples: boolean;
}

export function RouteSimulatorCard({
  routeResult,
  onChangeRouteResult,
  includeSamples,
}: RouteSimulatorCardProps) {
  const [nodes, setNodes] = useState<RouteNode[]>([]);
  const [originId, setOriginId] = useState("takeda_st");
  const [destinationId, setDestinationId] = useState("chushojima");
  const [avoidUnverified, setAvoidUnverified] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getRouteNodes();
        setNodes(res.nodes);
      } catch {
        // ignore if unreachable
      }
    })();
  }, []);

  const handleRun = async (ori = originId, dst = destinationId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await simulateRoute({
        originId: ori,
        destinationId: dst,
        includeSamples,
        avoidUnverified,
      });
      onChangeRouteResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "経路計算に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-purple-500/35 bg-slate-950/80 p-3 text-xs space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-bold text-purple-200">
          <Route className="h-4 w-4 text-purple-400" />
          <span>代替経路シミュレーション（試作）</span>
        </div>
        {routeResult && (
          <button
            type="button"
            onClick={() => onChangeRouteResult(null)}
            className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-white"
          >
            <XCircle className="h-3 w-3" />
            クリア
          </button>
        )}
      </div>

      {/* Prominent Simulation-Only Disclaimer */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/45 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-100">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span>
          <strong>【訓練・研究用】</strong>
          簡略化した主要幹線モデル上の経路探索プロトタイプです。実際の道路安全性・通行可否を保証するものではなく、実災害時の救助・避難ナビには使用しないでください。
        </span>
      </div>

      {/* Quick Demo Presets */}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => {
            setOriginId("takeda_st");
            setDestinationId("chushojima");
            void handleRun("takeda_st", "chushojima");
          }}
          className="rounded border border-purple-500/40 bg-purple-500/15 px-2 py-1 text-[10px] font-semibold text-purple-200 hover:bg-purple-500/25"
        >
          伏見区デモ（竹田 → 中書島）
        </button>
        <button
          type="button"
          onClick={() => {
            setOriginId("kyoto_st");
            setDestinationId("yamashina_st");
            void handleRun("kyoto_st", "yamashina_st");
          }}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-300 hover:text-white"
        >
          京都駅 → 山科駅
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] text-slate-400">出発拠点</label>
          <select
            value={originId}
            onChange={(e) => setOriginId(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white"
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                [{n.ward}] {n.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-slate-400">目的拠点</label>
          <select
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white"
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                [{n.ward}] {n.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-[10px] text-slate-300">
        <input
          type="checkbox"
          checked={avoidUnverified}
          onChange={(e) => setAvoidUnverified(e.target.checked)}
          className="h-3.5 w-3.5 accent-purple-500"
        />
        未確認の市民投稿（道路通行止め）も回避対象に含める
      </label>

      <button
        type="button"
        disabled={loading || nodes.length === 0}
        onClick={() => void handleRun()}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-purple-500 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
        通行止め回避ルートを地図上に表示（訓練用）
      </button>

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-[10px] text-rose-200">
          {error}
        </div>
      )}

      {routeResult && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 text-[11px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-slate-700 bg-slate-950 p-2">
              <div className="text-[10px] text-slate-400">通常最短（点線）</div>
              <div className="font-mono text-sm font-bold text-slate-200">
                {routeResult.baseline_route.distance_km ?? "—"} km
              </div>
            </div>
            <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2">
              <div className="text-[10px] text-emerald-300">回避ルート（実線）</div>
              <div className="font-mono text-sm font-bold text-emerald-200">
                {routeResult.alternative_route.reachable
                  ? `${routeResult.alternative_route.distance_km} km`
                  : "到達不可"}
                {routeResult.detour_delta_km !== null && routeResult.rerouted && (
                  <span className="ml-1 text-[10px] text-amber-300">
                    (+{routeResult.detour_delta_km}km)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-300">
            通過幹線: {routeResult.alternative_route.segments.join(" → ") || "迂回なし"}
          </div>

          {routeResult.blocked_segments.length > 0 && (
            <div className="space-y-1 border-t border-slate-800 pt-1.5 text-[10px]">
              <div className="font-semibold text-rose-300">
                回避判定された区間（{routeResult.blocked_segments.length}区間）
              </div>
              {routeResult.blocked_segments.slice(0, 4).map((seg) => (
                <div key={`${seg.from_id}-${seg.to_id}`} className="text-slate-300">
                  • {seg.label}（要因: {seg.triggered_by[0]?.verification_label} - {seg.triggered_by[0]?.title}）
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
