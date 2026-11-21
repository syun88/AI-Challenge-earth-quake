"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
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
import {
  DamageReport,
  DamageReportSummaryResponse,
  ReportCategory,
  ReportSeverity,
  VerificationStatus,
} from "@/types/quakelens";

const REPORT_HISTORY_KEY = "quakelens_damage_report_history_v1";

interface LocalReportAuth {
  id: string;
  passcode: string;
}

function readLocalReportAuth(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REPORT_HISTORY_KEY);
    if (!raw) return {};
    const arr = JSON.parse(raw) as LocalReportAuth[];
    if (!Array.isArray(arr)) return {};
    const out: Record<string, string> = {};
    for (const item of arr) {
      if (item?.id && item?.passcode) out[item.id] = item.passcode;
    }
    return out;
  } catch {
    return {};
  }
}

function saveLocalReportAuth(id: string, passcode: string) {
  if (typeof window === "undefined" || !passcode) return;
  try {
    const prev = readLocalReportAuth();
    prev[id] = passcode;
    const list: LocalReportAuth[] = Object.entries(prev)
      .slice(-30)
      .map(([k, v]) => ({ id: k, passcode: v }));
    window.localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

function CategoryIcon({ category, className = "h-3.5 w-3.5" }: { category: ReportCategory; className?: string }) {
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
  pickedCoords: { lat: number; lon: number } | null;
  isPickingLocation: boolean;
  onStartPickLocation: () => void;
  onCancelPickLocation: () => void;
  onClearPickedLocation: () => void;
  onFocusReport: (report: DamageReport) => void;
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
  pickedCoords,
  isPickingLocation,
  onStartPickLocation,
  onCancelPickLocation,
  onClearPickedLocation,
  onFocusReport,
  onReportsChanged,
  onOpenRouteSimulator,
  startInCreateMode = false,
}: DamageReportPanelProps) {
  const [mode, setMode] = useState<"list" | "create">(startInCreateMode ? "create" : "list");
  const [catFilter, setCatFilter] = useState<ReportCategory | "all">("all");
  const [verFilter, setVerFilter] = useState<VerificationStatus | "all">("all");
  const [searchKw, setSearchKw] = useState("");

  // Create form state
  const [category, setCategory] = useState<ReportCategory>("road_blocked");
  const [severity, setSeverity] = useState<ReportSeverity>("high");
  const [wardOverride, setWardOverride] = useState<string | null>(null);
  const wardName = wardOverride ?? (selectedWard !== "all" ? selectedWard : "伏見区");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [reporterAlias, setReporterAlias] = useState("");
  const [passcode, setPasscode] = useState("");
  const [attachMesh, setAttachMesh] = useState<boolean>(Boolean(selectedMeshcode));
  const [locationConsent, setLocationConsent] = useState<boolean>(false);
  const [similarMatches, setSimilarMatches] = useState<DamageReport[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [localAuthMap, setLocalAuthMap] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setLocalAuthMap(readLocalReportAuth());
    });
  }, []);

  const hasSimilarQuery = mode === "create" && Boolean(title.trim() || selectedMeshcode || pickedCoords);

  // Duplicate check debounce on create form
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
          meshcode: attachMesh ? selectedMeshcode : null,
          lat: locationConsent && pickedCoords ? pickedCoords.lat : null,
          lon: locationConsent && pickedCoords ? pickedCoords.lon : null,
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
    attachMesh,
    selectedMeshcode,
    locationConsent,
    pickedCoords,
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
      const hay = `${r.title} ${r.description} ${r.ward_name} ${r.location_label || ""}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (pickedCoords && !locationConsent) {
      setFeedback({
        type: "error",
        text: "地図上の座標を登録するには、下の「位置情報の記録・地図表示に同意する」をチェックしてください。",
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
        meshcode: locationConsent && attachMesh ? selectedMeshcode : null,
        location_label: locationLabel.trim() || null,
        lat: locationConsent && pickedCoords ? pickedCoords.lat : null,
        lon: locationConsent && pickedCoords ? pickedCoords.lon : null,
        location_consent: locationConsent,
        reporter_alias: reporterAlias.trim() || undefined,
        passcode: effPasscode,
      });
      saveLocalReportAuth(res.report.id, effPasscode);
      setLocalAuthMap(readLocalReportAuth());
      setFeedback({
        type: "success",
        text: `被害状況を「未確認（市民報告）」として登録しました（ID: ${res.report.id} / 管理用暗証番号: ${effPasscode}）。`,
      });
      setTitle("");
      setDescription("");
      setLocationLabel("");
      onClearPickedLocation();
      onReportsChanged();
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
        text: `報告 ${reportId} の同種・現場確認数を +1 しました（未確認区分は維持されます）。`,
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

  return (
    <div className="flex h-full flex-col text-xs">
      {/* Sub-header mode switch & export bar */}
      <div className="shrink-0 space-y-2 border-b border-slate-800 bg-slate-950/60 p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setMode("list")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-semibold transition ${
              mode === "list"
                ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/50"
                : "border border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            状況一覧・集計 ({filteredReports.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("create");
              setFeedback(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-semibold transition ${
              mode === "create"
                ? "bg-rose-600 text-white shadow"
                : "border border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
            }`}
          >
            <PlusCircle className="h-3.5 w-3.5" />
            + 被害状況を報告
          </button>
        </div>

        {/* Verification notice banner */}
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span>
            市民投稿はすべて<strong>「未確認（市民報告）」</strong>として表示され、公的機関の確定情報や訓練サンプルとは点線枠・アイコンで明確に区別されます。
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {feedback && (
          <div
            className={`flex items-start gap-2 rounded-lg border p-2.5 text-[11px] ${
              feedback.type === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{feedback.text}</span>
          </div>
        )}

        {mode === "list" && (
          <>
            {/* Summary Breakdown Strip */}
            {summary && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-200">
                    報告サマリー（{selectedWard === "all" ? "京都市全域" : selectedWard}）
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeSamples}
                      onChange={(e) => onToggleIncludeSamples(e.target.checked)}
                      className="h-3.5 w-3.5 accent-amber-500"
                    />
                    訓練サンプル表示
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 py-1.5">
                    <div className="text-[9px] text-amber-300">未確認(市民)</div>
                    <div className="font-mono text-sm font-bold text-amber-100">
                      {summary.unverified_count}
                    </div>
                  </div>
                  <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 py-1.5">
                    <div className="text-[9px] text-cyan-300">確認済/公式</div>
                    <div className="font-mono text-sm font-bold text-cyan-100">
                      {summary.verified_count + summary.official_count}
                    </div>
                  </div>
                  <div className="rounded-lg border border-dotted border-slate-600 bg-slate-900 py-1.5">
                    <div className="text-[9px] text-slate-400">訓練サンプル</div>
                    <div className="font-mono text-sm font-bold text-slate-200">
                      {summary.demo_sample_count}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <a
                      href={csvUrl}
                      download
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-sky-300 hover:border-sky-500/60"
                    >
                      <Download className="h-3 w-3" />
                      CSV出力
                    </a>
                    <a
                      href={xlsxUrl}
                      download
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-emerald-300 hover:border-emerald-500/60"
                    >
                      <FileSpreadsheet className="h-3 w-3" />
                      Excel出力
                    </a>
                  </div>
                  {onOpenRouteSimulator && (
                    <button
                      type="button"
                      onClick={onOpenRouteSimulator}
                      className="inline-flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/15 px-2 py-1 text-[10px] font-semibold text-purple-200 hover:bg-purple-500/25"
                    >
                      <Route className="h-3 w-3" />
                      通行止め回避ルート試算
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Category & Verification Filters */}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setCatFilter("all")}
                  className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${
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
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold transition ${
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
                  placeholder="キーワード検索"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500"
                />
                <select
                  value={verFilter}
                  onChange={(e) => setVerFilter(e.target.value as VerificationStatus | "all")}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-white"
                >
                  <option value="all">すべての信頼度区分</option>
                  <option value="unverified">未確認（市民報告）のみ</option>
                  <option value="verified">確認済のみ</option>
                  <option value="official">公式発表のみ</option>
                  <option value="demo_sample">訓練サンプルのみ</option>
                </select>
              </div>
            </div>

            {/* Report Cards */}
            {filteredReports.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-slate-400">
                条件に一致する報告はまだありません。
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredReports.map((rep) => {
                  const catMeta = REPORT_CATEGORY_META[rep.category];
                  const sevMeta = REPORT_SEVERITY_META[rep.severity];
                  const isOwn = Boolean(localAuthMap[rep.id]);
                  const cardBorder =
                    rep.verification_status === "unverified"
                      ? "border-dashed border-amber-500/45 bg-slate-950/90"
                      : rep.verification_status === "demo_sample"
                        ? "border-dotted border-slate-700 bg-slate-950/60"
                        : "border-slate-700 bg-slate-950/95";
                  return (
                    <div
                      key={rep.id}
                      className={`rounded-xl border p-3 space-y-2 ${cardBorder} ${
                        rep.resolved ? "opacity-65" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <VerificationBadge status={rep.verification_status} />
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
                          {rep.resolved && (
                            <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                              対応済
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-slate-400">{rep.id}</span>
                      </div>

                      <div>
                        <h4 className="text-xs font-bold text-white">{rep.title}</h4>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {rep.ward_name}
                          {rep.location_label ? ` ・ ${rep.location_label}` : ""}
                          {rep.meshcode ? ` (メッシュ ${rep.meshcode})` : ""}
                        </div>
                      </div>

                      <p className="rounded-lg bg-slate-900/90 p-2 text-[11px] leading-relaxed text-slate-200">
                        {rep.description}
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                        <span>
                          報告: {rep.reporter_alias} ・ 確認数{" "}
                          <strong className="font-mono text-slate-200">{rep.corroborations}</strong>
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onFocusReport(rep)}
                            className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-semibold text-sky-300 hover:bg-sky-500/20"
                          >
                            <MapPin className="h-3 w-3" />
                            地図で確認
                          </button>
                          {!rep.is_sample && !rep.resolved && (
                            <button
                              type="button"
                              disabled={busyId === rep.id}
                              onClick={() => void handleConfirm(rep.id)}
                              className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-200 hover:bg-amber-500/20"
                              title="現地で同様の状況を確認した（重複投稿を防ぎ確認件数を加算します）"
                            >
                              <ThumbsUp className="h-3 w-3" />
                              +1 同種確認
                            </button>
                          )}
                          {!rep.is_sample && (isOwn || rep.has_passcode) && (
                            <>
                              <button
                                type="button"
                                disabled={busyId === rep.id}
                                onClick={() => void handleToggleResolve(rep)}
                                className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-300 hover:text-white"
                              >
                                {rep.resolved ? "再開" : "解決済"}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === rep.id}
                                onClick={() => void handleDelete(rep)}
                                className="inline-flex items-center gap-0.5 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-rose-300 hover:bg-rose-500/20"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {mode === "create" && (
          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            <div>
              <label className="mb-1.5 block font-semibold text-slate-200">
                1. 報告カテゴリを選択 <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(REPORT_CATEGORY_META) as ReportCategory[]).map((catKey) => {
                  const meta = REPORT_CATEGORY_META[catKey];
                  const active = category === catKey;
                  return (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => setCategory(catKey)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold transition ${
                        active
                          ? `${meta.badgeClass} ring-1 ring-white/40`
                          : "border-slate-800 bg-slate-950/70 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <CategoryIcon category={catKey} className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold text-slate-200">緊急度</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as ReportSeverity)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
                >
                  {(Object.keys(REPORT_SEVERITY_META) as ReportSeverity[]).map((sv) => (
                    <option key={sv} value={sv}>
                      {REPORT_SEVERITY_META[sv].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-200">発生地域（区）</label>
                <select
                  value={wardName}
                  onChange={(e) => setWardOverride(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
                >
                  {wards.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                  <option value="京都市全域">京都市全域</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-200">
                見出し（80文字以内）<span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 大手筋通東側でブロック塀倒壊による通行止め"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-200">
                詳細な現場状況（600文字以内）<span className="text-rose-400">*</span>
              </label>
              <textarea
                required
                rows={3}
                maxLength={600}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="通行可否、被害の程度、避難所・支援ニーズ等の具体状況を記入"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500"
              />
            </div>

            {/* Map Location Picker with Explicit Consent */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-200">位置情報の紐付け（任意）</span>
                {!isPickingLocation ? (
                  <button
                    type="button"
                    onClick={onStartPickLocation}
                    className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/25"
                  >
                    <MapPin className="h-3 w-3" />
                    地図をクリックして位置指定
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onCancelPickLocation}
                    className="rounded border border-rose-500/50 bg-rose-500/20 px-2 py-1 text-[10px] font-semibold text-rose-200"
                  >
                    地図指定をキャンセル
                  </button>
                )}
              </div>

              {pickedCoords && (
                <div className="flex items-center justify-between rounded bg-sky-500/10 px-2 py-1 text-[10px] text-sky-200">
                  <span className="font-mono">
                    指定地点: {pickedCoords.lat.toFixed(5)}, {pickedCoords.lon.toFixed(5)}
                  </span>
                  <button
                    type="button"
                    onClick={onClearPickedLocation}
                    className="text-slate-300 underline hover:text-white"
                  >
                    クリア
                  </button>
                </div>
              )}

              <input
                type="text"
                maxLength={80}
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                placeholder="場所の目安（例: ○○交差点付近 ※自宅番地は非推奨）"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500"
              />

              {selectedMeshcode && (
                <label className="flex cursor-pointer items-center gap-2 text-[10px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={attachMesh}
                    onChange={(e) => setAttachMesh(e.target.checked)}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                  選択中の250mメッシュ ({selectedMeshcode}) を紐付ける
                </label>
              )}

              <label className="flex cursor-pointer items-start gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-[10px] leading-relaxed text-emerald-100">
                <input
                  type="checkbox"
                  checked={locationConsent}
                  onChange={(e) => setLocationConsent(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-500"
                />
                <span>
                  上記の位置情報（地図ピン座標または250mメッシュ）を災害状況の地図可視化および経路シミュレーション用に公開・保存することに明示的に同意します（同意なしの場合、座標は送信・保存されません）。
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold text-slate-200">投稿者名（任意）</label>
                <input
                  type="text"
                  maxLength={32}
                  value={reporterAlias}
                  onChange={(e) => setReporterAlias(e.target.value)}
                  placeholder="未入力時は 匿名市民"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-200">管理用暗証番号</label>
                <input
                  type="text"
                  maxLength={16}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="未入力時は4桁自動発行"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            {/* Duplicate warning */}
            {activeSimilarMatches.length > 0 && (
              <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-2.5 space-y-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 font-bold text-amber-200">
                  <HelpCircle className="h-3.5 w-3.5 text-amber-400" />
                  同じ区・カテゴリで類似・近接する既存の報告が見つかりました
                </div>
                {activeSimilarMatches.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded border border-amber-500/30 bg-slate-950/70 p-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{m.title}</div>
                      <div className="text-[10px] text-amber-300">
                        {m.duplicate_reasons?.join(" / ")} ・ 確認数 {m.corroborations}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleConfirm(m.id)}
                      className="shrink-0 rounded bg-amber-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-amber-500"
                    >
                      既存報告に+1
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow transition hover:bg-rose-500 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              <span>未確認情報（市民報告）として送信する</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
