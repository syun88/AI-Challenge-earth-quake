"use client";

import React from "react";
import { X, ExternalLink, Database, ShieldCheck } from "lucide-react";
import { MetadataResponse } from "@/types/quakelens";

interface SourcesModalProps {
  open: boolean;
  onClose: () => void;
  metadata: MetadataResponse | null;
}

export function SourcesModal({ open, onClose, metadata }: SourcesModalProps) {
  if (!open) return null;

  const counts = metadata?.counts;
  const hs = metadata?.hazard_summary;
  const minPct = hs?.min_t30_i55_ps != null ? (hs.min_t30_i55_ps * 100).toFixed(1) : null;
  const maxPct = hs?.max_t30_i55_ps != null ? (hs.max_t30_i55_ps * 100).toFixed(1) : null;
  const terracePct =
    hs?.sand_gravel_terrace_mean != null ? (hs.sand_gravel_terrace_mean * 100).toFixed(1) : null;
  const backmarshPct = hs?.backmarsh_mean != null ? (hs.backmarsh_mean * 100).toFixed(1) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2.5 backdrop-blur-sm sm:p-4">
      <div className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4 text-slate-100 shadow-2xl sm:p-5">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-sky-400" />
            <h2 className="text-base font-bold">データ出典・ライセンス・品質情報</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Target municipality & coverage */}
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs">
          <div className="mb-2 font-semibold text-sky-300">
            対象自治体選定理由：京都市（plateau-26100-kyoto-shi-2025）
          </div>
          <p className="mb-2 leading-relaxed text-slate-300">
            本プロジェクト開発時の事前調査にて、G空間情報センター（CKAN）公開の東京23区PLATEAU CityGML（2020/2022年度）を検証したところ標準の建築年（bldg:yearOfConstruction）属性が未整備（0%）であったため、建築年・用途・構造・階数・実測高さが網羅的かつ最新（2025年度版）の京都市を選定しました。
            {minPct && maxPct && (
              <>
                {" "}
                J-SHIS 2024年版（全{(hs?.mesh_count ?? counts?.mesh_count ?? 0).toLocaleString("ja-JP")}メッシュ集計）でも、30年震度6弱以上確率は{" "}
                <span className="font-mono text-sky-200">
                  {minPct}%〜{maxPct}%
                </span>
                {terracePct && backmarshPct && (
                  <>
                    （砂礫質台地平均 {terracePct}% vs 後背湿地平均 {backmarshPct}%）
                  </>
                )}
                と地域差が顕著に表れています。
              </>
            )}
          </p>
          {counts && (
            <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
              <StatChip label="総建物数" value={`${counts.total_buildings.toLocaleString("ja-JP")}棟`} />
              <StatChip label="建築年判明率" value={`${(counts.known_year_rate * 100).toFixed(1)}%`} />
              <StatChip label="建物用途判明率" value={`${(counts.known_usage_rate * 100).toFixed(1)}%`} />
              <StatChip label="構造判明率" value={`${(counts.known_structure_rate * 100).toFixed(1)}%`} />
              <StatChip label="地上階数判明率" value={`${(counts.known_storeys_rate * 100).toFixed(1)}%`} />
              {counts.known_measured_height_rate != null && (
                <StatChip
                  label="実測高さ判明率"
                  value={`${(counts.known_measured_height_rate * 100).toFixed(1)}%`}
                />
              )}
            </div>
          )}
        </div>

        {/* Sources */}
        <div className="mb-4 space-y-2.5">
          {metadata?.data_sources.map((src) => (
            <div
              key={src.id}
              className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-white">{src.name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    提供: {src.provider} ／ 基準年: {src.reference_year}
                  </div>
                </div>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] text-sky-300 hover:bg-slate-800"
                >
                  公式 <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="mt-1.5 text-[11px] text-emerald-300/90">
                ライセンス: {src.license}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{src.notes}</div>
            </div>
          ))}
        </div>

        {/* Official programs */}
        {metadata?.official_programs && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-xs">
            <div className="mb-2 flex items-center gap-1.5 font-semibold text-emerald-300">
              <ShieldCheck className="h-4 w-4" />
              京都市公式の耐震診断・補助制度
            </div>
            <ul className="space-y-2">
              {metadata.official_programs.map((prog) => (
                <li key={prog.url} className="border-b border-slate-800/80 pb-2 last:border-0 last:pb-0">
                  <a
                    href={prog.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-sky-300 hover:underline"
                  >
                    {prog.title} <ExternalLink className="h-3 w-3" />
                  </a>
                  <p className="mt-0.5 text-[11px] text-slate-400">{prog.summary}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="font-mono text-xs font-bold text-white">{value}</div>
    </div>
  );
}
