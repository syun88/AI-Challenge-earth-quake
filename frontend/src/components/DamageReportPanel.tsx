"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Ambulance,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Flag,
  HelpCircle,
  Home,
  Info,
  LifeBuoy,
  Loader2,
  MapPin,
  PlusCircle,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import {
  buildDisasterCsvUrl,
  buildDisasterXlsxUrl,
  checkSimilarDamageReports,
  confirmDamageReport,
  createDamageReport,
  deleteDamageReport,
  updateDamageReport,
} from "@/lib/api";
import {
  REPORT_CATEGORY_META,
  REPORT_SEVERITY_META,
  VERIFICATION_META,
} from "@/lib/colors";
import { readLocalReportAuth, saveLocalReportAuth } from "@/lib/reportAuth";
import type { PickedMapTarget } from "@/components/QuakeMap";
import {
  DamageReport,
  DamageReportSummaryResponse,
  ReportCategory,
  ReportSeverity,
  VerificationStatus,
} from "@/types/quakelens";

const PREFILL_TEMPLATES: Record<
  ReportCategory,
  Array<{ title: string; desc: string; severity: ReportSeverity }>
> = {
  building_damage: [
    {
      title: "建物倒壊・大きな傾きの恐れ",
      desc: "建物全体が大きく傾き、周辺道路へ瓦礫が落下しています。周囲の立ち入り注意。",
      severity: "critical",
    },
    {
      title: "外壁・屋根瓦の落下被害",
      desc: "外壁材と屋根瓦が歩道側に崩落しています。",
      severity: "high",
    },
  ],
  road_blocked: [
    {
      title: "ブロック塀倒壊・電柱傾斜で通行止め",
      desc: "幅員が狭く車両通行不可。歩行者も迂回が必要な状態です。",
      severity: "critical",
    },
    {
      title: "路面亀裂・陥没のため片側通行制限",
      desc: "路面に段差・陥没があり緊急車両以外の進入危険あり。",
      severity: "high",
    },
  ],
  shelter_status: [
    {
      title: "避難所の満員・受け入れ状況共有",
      desc: "指定避難所の混雑度が高まっており、水・毛布の追加支援が望まれます。",
      severity: "moderate",
    },
  ],
  rescue_support: [
    {
      title: "要配慮者・自力避難困難者の救援要請",
      desc: "高齢者・要支援者の移動支援が必要です。",
      severity: "critical",
    },
    {
      title: "飲料水・簡易トイレ等の生活支援要請",
      desc: "複数世帯で断水が発生しており給水・衛生支援が必要です。",
      severity: "high",
    },
  ],
  other_disaster: [
    {
      title: "停電・水道管漏水などのインフラ被害",
      desc: "周辺で道路冠水または停電が確認されています。",
      severity: "moderate",
    },
  ],
};

function CategoryIcon({
  category,
  className = "h-4 w-4",
}: {
  category: ReportCategory;
  className?: string;
}) {
  switch (category) {
    case "building_damage":
      return <Home className={className} />;
    case "road_blocked":
      return <Route className={className} />;
    case "shelter_status":
      return <Building2 className={className} />;
    case "rescue_support":
      return <LifeBuoy className={className} />;
    default:
      return <Info className={className} />;
  }
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const meta = VERIFICATION_META[status];
  const Icon =
    status === "official"
      ? ShieldCheck
      : status === "verified"
        ? CheckCircle2
        : status === "demo_sample"
          ? Flag
          : AlertTriangle;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
      title={meta.label}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{meta.short}</span>
    </span>
  );
}

interface DamageReportPanelProps {
  wards: string[];
  selectedWard: string;
  selectedMeshcode: string | null;
  reports: DamageReport[];
  summary: DamageReportSummaryResponse | null;
  includeSamples: boolean;
  onToggleIncludeSamples: (next: boolean) => void;
  pickedTarget: PickedMapTarget | null;
  isPickingLocation: boolean;
  onStartPickLocation: () => void;
  onCancelPickLocation: () => void;
  onClearPickedLocation: () => void;
  onFocusReport: (report: DamageReport) => void;
  onReportCreated?: (report: DamageReport) => void;
  onDispatchRescue?: (report: DamageReport) => void;
  onReportsChanged: () => void;
  onOpenRouteSimulator?: () => void;
  startInCreateMode?: boolean;
}

export function DamageReportPanel({
  wards,
  selectedWard,
  selectedMeshcode,
  reports,
  summary,
  includeSamples,
  onToggleIncludeSamples,
  pickedTarget,
  isPickingLocation,
  onStartPickLocation,
  onCancelPickLocation,
  onClearPickedLocation,
  onFocusReport,
  onReportCreated,
  onDispatchRescue,
  onReportsChanged,
  onOpenRouteSimulator,
  startInCreateMode = false,
}: DamageReportPanelProps) {
  const [mode, setMode] = useState<"list" | "create">(startInCreateMode ? "create" : "list");
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [catFilter, setCatFilter] = useState<ReportCategory | "all">("all");
  const [verFilter, setVerFilter] = useState<VerificationStatus | "all">("all");
  const [searchKw, setSearchKw] = useState("");

  // Create form state
  const [category, setCategory] = useState<ReportCategory>("building_damage");
  const [severity, setSeverity] = useState<ReportSeverity>("high");
  const [wardOverride, setWardOverride] = useState<string | null>(null);
  const wardName =
    wardOverride ??
    (pickedTarget?.wardName || (selectedWard !== "all" ? selectedWard : "伏見区"));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [reporterAlias, setReporterAlias] = useState("");
  const [passcode, setPasscode] = useState("");
  const [attachBuildingOverride, setAttachBuildingOverride] = useState<boolean | null>(null);
  const attachBuilding = attachBuildingOverride ?? Boolean(pickedTarget?.buildingId);
  const [locationConsent, setLocationConsent] = useState<boolean>(false);
  const [similarMatches, setSimilarMatches] = useState<DamageReport[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastCreatedReport, setLastCreatedReport] = useState<DamageReport | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [localAuthMap, setLocalAuthMap] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setLocalAuthMap(readLocalReportAuth());
    });
  }, []);

  const effectiveMeshcode = pickedTarget?.meshcode ?? selectedMeshcode;
  const hasSimilarQuery =
    mode === "create" && Boolean(title.trim() || effectiveMeshcode || pickedTarget);

  useEffect(() => {
    if (!hasSimilarQuery) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await checkSimilarDamageReports({
          ward_name: wardName,
          category,
          title,
          description,
          meshcode: locationConsent ? effectiveMeshcode : null,
          lat: locationConsent && pickedTarget ? pickedTarget.lat : null,
          lon: locationConsent && pickedTarget ? pickedTarget.lon : null,
        });
        if (!cancelled) {
          setSimilarMatches(res.similar_reports || []);
        }
      } catch {
        // ignore check failure
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    hasSimilarQuery,
    wardName,
    category,
    title,
    description,
    effectiveMeshcode,
    locationConsent,
    pickedTarget,
  ]);

  const activeSimilarMatches = hasSimilarQuery ? similarMatches : [];

  const filteredReports = reports.filter((r) => {
    if (selectedWard !== "all" && r.ward_name !== selectedWard && r.ward_name !== "京都市全域") {
      return false;
    }
    if (catFilter !== "all" && r.category !== catFilter) return false;
    if (verFilter !== "all" && r.verification_status !== verFilter) return false;
    if (searchKw.trim()) {
      const kw = searchKw.trim().toLowerCase();
      const hay = `${r.title} ${r.description} ${r.ward_name} ${r.location_label || ""} ${r.building_id || ""}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!title.trim() || !description.trim()) {
      setFeedback({ type: "error", text: "見出しと現場状況を入力してください。" });
      return;
    }
    if (pickedTarget && !locationConsent) {
      setFeedback({
        type: "error",
        text: "地図上の座標や建物の損傷表示を登録するには、「位置情報の記録・地図表示に同意する」にチェックを入れてください。",
      });
      return;
    }
    setSubmitting(true);
    setFeedback(null);

    const effPasscode = passcode.trim() || String(Math.floor(1000 + Math.random() * 9000));
    try {
      const res = await createDamageReport({
        category,
        severity,
        title: title.trim(),
        description: description.trim(),
        ward_name: wardName,
        meshcode: locationConsent ? effectiveMeshcode : null,
        building_id:
          locationConsent && attachBuilding && pickedTarget?.buildingId
            ? pickedTarget.buildingId
            : null,
        location_label: locationLabel.trim() || null,
        lat: locationConsent && pickedTarget ? pickedTarget.lat : null,
        lon: locationConsent && pickedTarget ? pickedTarget.lon : null,
        location_consent: locationConsent,
        reporter_alias: reporterAlias.trim() || undefined,
        passcode: effPasscode,
      });
      saveLocalReportAuth(res.report.id, effPasscode);
      setLocalAuthMap(readLocalReportAuth());
      setLastCreatedReport(res.report);
      setFeedback({
        type: "success",
        text: `「未確認（市民報告）」として地図に登録しました（ID: ${res.report.id} / 暗証番号: ${effPasscode}）。`,
      });
      setTitle("");
      setDescription("");
      setLocationLabel("");
      setWardOverride(null);
      setAttachBuildingOverride(null);
      setWizardStep(1);
      onClearPickedLocation();
      onReportsChanged();
      onReportCreated?.(res.report);
      setMode("list");
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "報告の送信に失敗しました。",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (reportId: string) => {
    setBusyId(reportId);
    try {
      await confirmDamageReport(reportId);
      onReportsChanged();
      setFeedback({
        type: "success",
        text: `報告 ${reportId} の現場確認数を +1 しました。`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "確認の追加に失敗しました。",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleResolve = async (report: DamageReport) => {
    const code = localAuthMap[report.id] || window.prompt("更新用の暗証番号を入力してください");
    if (code === null) return;
    setBusyId(report.id);
    try {
      await updateDamageReport(report.id, {
        passcode: code,
        resolved: !report.resolved,
      });
      onReportsChanged();
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "更新に失敗しました。",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (report: DamageReport) => {
    const code = localAuthMap[report.id] || window.prompt("削除用の暗証番号を入力してください");
    if (code === null) return;
    setBusyId(report.id);
    try {
      await deleteDamageReport(report.id, code);
      if (lastCreatedReport?.id === report.id) {
        setLastCreatedReport(null);
      }
      onReportsChanged();
      setFeedback({ type: "success", text: `報告 ${report.id} を削除しました。` });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "削除に失敗しました。",
      });
    } finally {
      setBusyId(null);
    }
  };

  const csvUrl = buildDisasterCsvUrl({
    scope: "reports",
    ward: selectedWard,
    category: catFilter,
    verificationStatus: verFilter,
    includeSamples,
  });
  const xlsxUrl = buildDisasterXlsxUrl({
    ward: selectedWard,
    category: catFilter,
    verificationStatus: verFilter,
    includeSamples,
  });

  const templates = PREFILL_TEMPLATES[category] || [];

  return (
    <div className="space-y-4 p-4 text-sm text-slate-200">
      {/* Mode Switch */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950/90 p-1">
        <button
          type="button"
          data-testid="report-tab-list"
          onClick={() => setMode("list")}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
            mode === "list"
              ? "bg-slate-800 text-white shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Search className="h-3.5 w-3.5" />
          <span>被害一覧 ({filteredReports.length})</span>
        </button>
        <button
          type="button"
          data-testid="report-tab-create"
          onClick={() => setMode("create")}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
            mode === "create"
              ? "bg-rose-500 text-white shadow-sm"
              : "text-rose-200 hover:bg-rose-500/15"
          }`}
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span>新規被害を報告</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`space-y-2 rounded-xl border p-3 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-100"
              : "border-rose-500/50 bg-rose-950/50 text-rose-100"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
          {feedback.type === "success" && lastCreatedReport && lastCreatedReport.lat != null && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => onFocusReport(lastCreatedReport)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900/90 px-2.5 py-1 text-[11px] font-semibold text-sky-200 hover:bg-slate-800"
              >
                <MapPin className="h-3 w-3" />
                地図で場所を確認
              </button>
              {onDispatchRescue &&
                lastCreatedReport.category !== "road_blocked" && (
                  <button
                    type="button"
                    onClick={() => onDispatchRescue(lastCreatedReport)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
                  >
                    <Ambulance className="h-3 w-3" />
                    最寄り拠点から救援ルート表示
                  </button>
                )}
            </div>
          )}
        </div>
      )}

      {mode === "list" ? (
        <div className="space-y-3">
          {/* Compact Verification & Export Bar */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-dashed border-amber-400/70 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                  未確認 {summary?.unverified_count ?? 0}
                </span>
                <span className="rounded-md border border-cyan-400/70 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">
                  確認・公式 {(summary?.verified_count ?? 0) + (summary?.official_count ?? 0)}
                </span>
                <span className="rounded-md border border-dotted border-slate-500 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                  訓練 {summary?.demo_sample_count ?? 0}
                </span>
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={includeSamples}
                  onChange={(e) => onToggleIncludeSamples(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-sky-400"
                />
                訓練例を含む
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-2">
              <div className="flex items-center gap-1.5">
                <a
                  href={csvUrl}
                  download
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:border-sky-500/60"
                >
                  <Download className="h-3 w-3" />
                  CSV
                </a>
                <a
                  href={xlsxUrl}
                  download
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:border-emerald-500/60"
                >
                  <FileSpreadsheet className="h-3 w-3" />
                  Excel
                </a>
              </div>
              {onOpenRouteSimulator && (
                <button
                  type="button"
                  onClick={onOpenRouteSimulator}
                  className="inline-flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-500/15 px-2.5 py-1 text-[11px] font-semibold text-purple-200 hover:bg-purple-500/25"
                >
                  <Route className="h-3 w-3" />
                  避難・救援ルート案内へ
                </button>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCatFilter("all")}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  catFilter === "all"
                    ? "border-sky-400 bg-sky-500/20 text-sky-100"
                    : "border-slate-700 bg-slate-900 text-slate-400"
                }`}
              >
                全種別
              </button>
              {(Object.keys(REPORT_CATEGORY_META) as ReportCategory[]).map((catKey) => {
                const meta = REPORT_CATEGORY_META[catKey];
                const active = catFilter === catKey;
                return (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setCatFilter(active ? "all" : catKey)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                      active
                        ? meta.badgeClass
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <CategoryIcon category={catKey} className="h-3 w-3" />
                    <span>{meta.short}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
                placeholder="場所・建物ID・キーワード"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500"
              />
              <select
                value={verFilter}
                onChange={(e) => setVerFilter(e.target.value as VerificationStatus | "all")}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              >
                <option value="all">すべての信頼区分</option>
                <option value="unverified">未確認（市民報告）</option>
                <option value="verified">確認済</option>
                <option value="official">公式発表</option>
                <option value="demo_sample">訓練サンプル</option>
              </select>
            </div>
          </div>

          {/* Report Cards */}
          {filteredReports.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
              条件に一致する報告はありません。
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredReports.map((rep) => {
                const catMeta = REPORT_CATEGORY_META[rep.category];
                const sevMeta = REPORT_SEVERITY_META[rep.severity];
                const canManage = !rep.is_sample && Boolean(localAuthMap[rep.id] || rep.has_passcode);
                const canDispatch =
                  onDispatchRescue &&
                  !rep.resolved &&
                  rep.lat != null &&
                  rep.lon != null &&
                  rep.category !== "road_blocked";
                return (
                  <div
                    key={rep.id}
                    data-testid={`report-card-${rep.id}`}
                    className={`rounded-xl border p-3.5 space-y-2 transition ${
                      rep.resolved
                        ? "border-slate-800 bg-slate-950/40 opacity-70"
                        : rep.verification_status === "demo_sample"
                          ? "border-dotted border-slate-600 bg-slate-900/60"
                          : "border-slate-800 bg-slate-900/90"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${catMeta.badgeClass}`}
                        >
                          <CategoryIcon category={rep.category} className="h-3 w-3" />
                          {catMeta.short}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${sevMeta.badgeClass}`}
                        >
                          {sevMeta.label}
                        </span>
                        <VerificationBadge status={rep.verification_status} />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-300">
                        {rep.ward_name}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-white leading-snug">
                      {rep.title}
                      {rep.resolved && (
                        <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          対応済
                        </span>
                      )}
                    </h4>
                    <p className="text-xs leading-relaxed text-slate-300">{rep.description}</p>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      {rep.building_id && (
                        <span className="rounded bg-orange-500/15 px-1.5 py-0.5 font-mono text-orange-300">
                          建物: {rep.building_id}
                        </span>
                      )}
                      {rep.location_label && <span>場所: {rep.location_label}</span>}
                      <span>確認 +{rep.corroborations}件</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          data-testid={`report-focus-${rep.id}`}
                          onClick={() => onFocusReport(rep)}
                          className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/25"
                        >
                          <MapPin className="h-3 w-3" />
                          地図で見る
                        </button>
                        {canDispatch && (
                          <button
                            type="button"
                            onClick={() => onDispatchRescue(rep)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
                          >
                            <Ambulance className="h-3 w-3" />
                            救援ルート
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === rep.id}
                          onClick={() => void handleConfirm(rep.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:border-amber-400/60"
                        >
                          <ThumbsUp className="h-3 w-3 text-amber-400" />
                          +1 確認
                        </button>
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busyId === rep.id}
                            onClick={() => void handleToggleResolve(rep)}
                            className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                          >
                            {rep.resolved ? "再開" : "対応済"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === rep.id}
                            onClick={() => void handleDelete(rep)}
                            aria-label="報告を削除"
                            className="rounded border border-rose-500/40 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* 3-Step Guided Wizard */
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Wizard Step Indicator */}
          <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] font-bold">
            {(
              [
                { step: 1, label: "1. 何が起きたか" },
                { step: 2, label: "2. 場所・建物" },
                { step: 3, label: "3. 状況と送信" },
              ] as const
            ).map((s) => (
              <button
                key={s.step}
                type="button"
                onClick={() => setWizardStep(s.step)}
                className={`rounded-lg border py-1.5 transition ${
                  wizardStep === s.step
                    ? "border-rose-400 bg-rose-500/20 text-white"
                    : wizardStep > s.step
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-800 bg-slate-950 text-slate-400"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-100">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              登録された報告は<strong>「未確認（市民報告）」</strong>として地図に表示されます。
            </span>
          </div>

          {wizardStep === 1 && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-white">
                  1. 被害・状況のカテゴリを選択
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  {(Object.keys(REPORT_CATEGORY_META) as ReportCategory[]).map((catKey) => {
                    const meta = REPORT_CATEGORY_META[catKey];
                    const active = category === catKey;
                    return (
                      <button
                        key={catKey}
                        type="button"
                        data-testid={`report-cat-${catKey}`}
                        onClick={() => setCategory(catKey)}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition ${
                          active
                            ? `${meta.badgeClass} ring-1 ring-white/40`
                            : "border-slate-800 bg-slate-950/70 text-slate-300 hover:bg-slate-900"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <CategoryIcon category={catKey} className="h-4 w-4 shrink-0" />
                          <span>{meta.label}</span>
                        </span>
                        {active && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-white">緊急度</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(REPORT_SEVERITY_META) as ReportSeverity[]).map((sv) => {
                    const active = severity === sv;
                    return (
                      <button
                        key={sv}
                        type="button"
                        onClick={() => setSeverity(sv)}
                        className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
                          active
                            ? `${REPORT_SEVERITY_META[sv].badgeClass} ring-1 ring-white/30`
                            : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {REPORT_SEVERITY_META[sv].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                data-testid="wizard-next-2"
                onClick={() => setWizardStep(2)}
                className="flex w-full items-center justify-center gap-1 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-sky-400"
              >
                <span>次へ：場所・建物を指定</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              <label className="block text-xs font-bold text-white">
                2. 発生場所・対象建物（地図クリックが簡単です）
              </label>

              {!isPickingLocation ? (
                <button
                  type="button"
                  data-testid="report-pick-map-btn"
                  onClick={onStartPickLocation}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/60 bg-sky-500/15 px-3 py-3 text-xs font-bold text-sky-100 transition hover:bg-sky-500/25"
                >
                  <MapPin className="h-4 w-4 text-sky-400" />
                  地図をクリックして建物・道路位置を指定
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCancelPickLocation}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500 bg-rose-500/20 px-3 py-3 text-xs font-bold text-rose-100"
                >
                  地図選択中…クリックを解除する
                </button>
              )}

              {pickedTarget && (
                <div className="space-y-2 rounded-xl border border-sky-500/40 bg-sky-950/30 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sky-200">選択した地点</span>
                    <button
                      type="button"
                      onClick={onClearPickedLocation}
                      className="text-[11px] text-slate-400 hover:text-white"
                    >
                      クリア
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-sky-100">
                    {pickedTarget.lat.toFixed(5)}, {pickedTarget.lon.toFixed(5)}
                    {pickedTarget.wardName && ` (${pickedTarget.wardName})`}
                  </div>
                  {pickedTarget.roadName && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-950/30 px-2.5 py-1.5 text-[11px] text-rose-100">
                      <span>
                        最寄り道路: <strong>{pickedTarget.roadName}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setLocationLabel(pickedTarget.roadName || "");
                          if (!title.trim()) {
                            setTitle(`${pickedTarget.roadName} 通行止め・道路損壊`);
                          }
                        }}
                        className="shrink-0 rounded bg-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-100 hover:bg-rose-500/50"
                      >
                        見出しに反映
                      </button>
                    </div>
                  )}
                  {pickedTarget.buildingId && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-orange-500/40 bg-orange-500/15 p-2 text-[11px] text-orange-100">
                      <input
                        type="checkbox"
                        checked={attachBuilding}
                        onChange={(e) => setAttachBuildingOverride(e.target.checked)}
                        className="mt-0.5 accent-orange-400"
                      />
                      <span>
                        <strong>建物ポリゴンと紐付ける</strong> ({pickedTarget.buildingId}
                        {pickedTarget.yearBuilt ? ` / ${pickedTarget.yearBuilt}年築` : ""}
                        {pickedTarget.structureLabel ? `・${pickedTarget.structureLabel}` : ""})
                      </span>
                    </label>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">
                  行政区
                </label>
                <select
                  value={wardName}
                  onChange={(e) => setWardOverride(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  {wards.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                  <option value="京都市全域">京都市全域</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">
                  目印・通り名（任意）
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                  placeholder="例: 大手筋通交差点の北側・〇〇小学校西"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-200">
                <input
                  type="checkbox"
                  data-testid="report-consent-checkbox"
                  checked={locationConsent}
                  onChange={(e) => setLocationConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-400"
                />
                <span>
                  <strong className="text-sky-200">位置情報・建物位置の公開に同意する</strong>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    個人宅の正確な位置情報は本人の明示的同意がない限り記録・地図表示されません。
                  </span>
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-700 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  <ChevronLeft className="h-4 w-4" />
                  戻る
                </button>
                <button
                  type="button"
                  data-testid="wizard-next-3"
                  onClick={() => setWizardStep(3)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400"
                >
                  次へ：内容を入力
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3">
              {/* Quick Template Pills */}
              {templates.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-400">
                    よく使われる報告テンプレート（クリックで自動入力）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((tpl) => (
                      <button
                        key={tpl.title}
                        type="button"
                        onClick={() => {
                          setTitle(tpl.title);
                          setDescription(tpl.desc);
                          setSeverity(tpl.severity);
                        }}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-sky-200 hover:border-sky-500/60 hover:bg-slate-800"
                      >
                        {tpl.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-200">
                  見出し（80文字以内）<span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  data-testid="report-title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: ブロック塀倒壊による通行止め"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-200">
                  詳細な現場状況（600文字以内）<span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  maxLength={600}
                  data-testid="report-desc-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="通行可否、被害の程度、必要な支援など"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500"
                />
              </div>

              {activeSimilarMatches.length > 0 && (
                <div className="rounded-xl border border-amber-500/45 bg-amber-950/35 p-2.5 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-200">
                    <HelpCircle className="h-4 w-4 text-amber-400" />
                    <span>近くの類似報告（重複せず +1 確認も可能）</span>
                  </div>
                  {activeSimilarMatches.slice(0, 2).map((sim) => (
                    <div
                      key={sim.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-slate-950/70 px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="truncate font-semibold text-white">{sim.title}</span>
                      <button
                        type="button"
                        onClick={() => void handleConfirm(sim.id)}
                        className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-200 hover:bg-amber-500/35"
                      >
                        +1 確認
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  maxLength={32}
                  value={reporterAlias}
                  onChange={(e) => setReporterAlias(e.target.value)}
                  placeholder="投稿者名（匿名可）"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500"
                />
                <input
                  type="text"
                  maxLength={20}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="暗証番号（空欄時自動）"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-700 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  <ChevronLeft className="h-4 w-4" />
                  戻る
                </button>
                <button
                  type="submit"
                  data-testid="report-submit-btn"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-500 py-2.5 text-xs font-bold text-white shadow-lg transition hover:bg-rose-400 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  未確認情報として送信
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
