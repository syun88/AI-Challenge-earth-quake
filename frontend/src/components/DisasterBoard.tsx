"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardEdit,
  Search,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Phone,
  ShieldCheck,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { createBoardEntry, deleteBoardEntry, getBoardEntries } from "@/lib/api";
import { BoardEntry, BoardStatus } from "@/types/quakelens";

type BoardView = "menu" | "register" | "check" | "history" | "web";

interface LocalHistoryItem {
  id: string;
  phone_masked: string;
  name: string;
  status_label: string;
  ward_name: string;
  message: string;
  created_at: string;
  passcode: string;
}

const HISTORY_STORAGE_KEY = "quakelens_disaster_board_history_v1";

const STATUS_OPTIONS: Array<{
  value: BoardStatus;
  label: string;
  badgeClass: string;
}> = [
  {
    value: "safe",
    label: "無事です",
    badgeClass: "border-emerald-500/50 bg-emerald-500/15 text-emerald-300",
  },
  {
    value: "shelter",
    label: "避難所にいます",
    badgeClass: "border-sky-500/50 bg-sky-500/15 text-sky-300",
  },
  {
    value: "home",
    label: "自宅にいます",
    badgeClass: "border-indigo-500/50 bg-indigo-500/15 text-indigo-300",
  },
  {
    value: "minor_injury",
    label: "軽傷・支援が必要",
    badgeClass: "border-amber-500/50 bg-amber-500/15 text-amber-300",
  },
  {
    value: "waiting",
    label: "連絡待ち・安否確認中",
    badgeClass: "border-rose-500/50 bg-rose-500/15 text-rose-300",
  },
];

const QUICK_MESSAGES = [
  "家族全員無事です。自宅にいます。",
  "近くの指定避難所に避難しています。",
  "怪我はありませんが停電・断水しています。",
  "無事です。落ち着いたらこちらから連絡します。",
];

const DEFAULT_WARDS = [
  "北区",
  "上京区",
  "左京区",
  "中京区",
  "東山区",
  "下京区",
  "南区",
  "右京区",
  "伏見区",
  "山科区",
  "西京区",
];

function statusBadgeStyle(status: string): string {
  return (
    STATUS_OPTIONS.find((s) => s.value === status)?.badgeClass ||
    "border-slate-600 bg-slate-800 text-slate-200"
  );
}

function formatIsoTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function readStoredHistory(): LocalHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredHistory(items: LocalHistoryItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore quota errors
  }
}

interface DisasterBoardProps {
  onBack: () => void;
  wards?: string[];
  defaultWard?: string;
  defaultMeshcode?: string | null;
  onFocusArea?: (wardName: string, meshcode: string | null) => void;
}

export function DisasterBoard({
  onBack,
  wards = DEFAULT_WARDS,
  defaultWard = "all",
  defaultMeshcode = null,
  onFocusArea,
}: DisasterBoardProps) {
  const [view, setView] = useState<BoardView>("menu");
  const [recentCount, setRecentCount] = useState<number | null>(null);

  // Register form state
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<BoardStatus>("safe");
  const [wardName, setWardName] = useState<string>(
    defaultWard !== "all" ? defaultWard : "京都市全域"
  );
  const [attachMesh, setAttachMesh] = useState<boolean>(Boolean(defaultMeshcode));
  const [message, setMessage] = useState("");
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registerFeedback, setRegisterFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Check/Search state
  const [searchPhone, setSearchPhone] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchWard, setSearchWard] = useState<string>("all");
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // History / Delete state
  const [historyItems, setHistoryItems] = useState<LocalHistoryItem[]>([]);
  const [serverHistoryEntries, setServerHistoryEntries] = useState<BoardEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);
  const [manualDeleteId, setManualDeleteId] = useState("");
  const [manualDeletePasscode, setManualDeletePasscode] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      setHistoryItems(readStoredHistory());
    });
    (async () => {
      try {
        const res = await getBoardEntries({ limit: 50 });
        setRecentCount(res.count);
      } catch {
        // ignore initial count error
      }
    })();
  }, []);

  const fetchSearchResults = useCallback(
    async (opts?: { phone?: string; q?: string; ward?: string }) => {
      setLoadingEntries(true);
      setSearchError(null);
      try {
        const res = await getBoardEntries({
          phone: opts?.phone ?? searchPhone,
          q: opts?.q ?? searchQuery,
          ward: opts?.ward ?? searchWard,
          limit: 50,
        });
        setEntries(res.entries);
        if (!opts?.phone && !opts?.q && (opts?.ward ?? searchWard) === "all") {
          setRecentCount(res.count);
        }
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "伝言の読み込みに失敗しました。"
        );
      } finally {
        setLoadingEntries(false);
      }
    },
    [searchPhone, searchQuery, searchWard]
  );

  const syncHistoryFromServer = useCallback(async (items: LocalHistoryItem[]) => {
    if (items.length === 0) {
      setServerHistoryEntries([]);
      return;
    }
    setLoadingHistory(true);
    try {
      const res = await getBoardEntries({
        ids: items.map((i) => i.id),
        limit: 50,
      });
      setServerHistoryEntries(res.entries);
    } catch {
      setServerHistoryEntries([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const openView = (next: BoardView) => {
    setView(next);
    setRegisterFeedback(null);
    setHistoryFeedback(null);
    if (next === "check") {
      void fetchSearchResults();
    } else if (next === "history") {
      const stored = readStoredHistory();
      setHistoryItems(stored);
      void syncHistoryFromServer(stored);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setRegisterFeedback(null);

    const effectivePasscode =
      passcode.trim() || String(Math.floor(1000 + Math.random() * 9000));

    try {
      const res = await createBoardEntry({
        phone: phone.trim(),
        name: name.trim(),
        status,
        message: message.trim(),
        ward_name: wardName,
        meshcode: attachMesh ? defaultMeshcode : null,
        passcode: effectivePasscode,
      });
      const created = res.entry;
      const newHist: LocalHistoryItem = {
        id: created.id,
        phone_masked: created.phone_masked,
        name: created.name,
        status_label: created.status_label,
        ward_name: created.ward_name,
        message: created.message,
        created_at: created.created_at,
        passcode: effectivePasscode,
      };
      const updated = [newHist, ...readStoredHistory()].slice(0, 30);
      writeStoredHistory(updated);
      setHistoryItems(updated);
      setRecentCount((prev) => (prev !== null ? prev + 1 : null));
      setRegisterFeedback({
        type: "success",
        text: `安否情報を登録しました（登録ID: ${created.id} / 削除用暗証番号: ${effectivePasscode}）。`,
      });
      setMessage("");
    } catch (err) {
      setRegisterFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "登録に失敗しました。",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteHistoryItem = async (item: LocalHistoryItem) => {
    setHistoryFeedback(null);
    try {
      await deleteBoardEntry(item.id, item.passcode);
      const next = historyItems.filter((h) => h.id !== item.id);
      writeStoredHistory(next);
      setHistoryItems(next);
      setServerHistoryEntries((prev) => prev.filter((e) => e.id !== item.id));
      setRecentCount((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
      setHistoryFeedback(`登録ID ${item.id} を削除しました。`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "削除に失敗しました。";
      if (msg.includes("見つかりません")) {
        const next = historyItems.filter((h) => h.id !== item.id);
        writeStoredHistory(next);
        setHistoryItems(next);
      }
      setHistoryFeedback(msg);
    }
  };

  const handleManualDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDeleteId.trim()) return;
    setHistoryFeedback(null);
    try {
      await deleteBoardEntry(manualDeleteId.trim(), manualDeletePasscode.trim());
      const next = historyItems.filter((h) => h.id !== manualDeleteId.trim());
      writeStoredHistory(next);
      setHistoryItems(next);
      setServerHistoryEntries((prev) =>
        prev.filter((entry) => entry.id !== manualDeleteId.trim())
      );
      setHistoryFeedback(`登録ID ${manualDeleteId.trim()} を削除しました。`);
      setManualDeleteId("");
      setManualDeletePasscode("");
    } catch (err) {
      setHistoryFeedback(err instanceof Error ? err.message : "削除に失敗しました。");
    }
  };

  const handleHeaderBack = () => {
    if (view === "menu") {
      onBack();
    } else {
      setView("menu");
    }
  };

  const viewTitle =
    view === "menu"
      ? "災害用伝言板"
      : view === "register"
        ? "安否情報の登録"
        : view === "check"
          ? "安否情報の確認"
          : view === "history"
            ? "登録履歴の確認/削除"
            : "災害用伝言板（Web版）";

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 text-slate-100 shadow-2xl">
      {/* Top Bar matching screenshot */}
      <header className="relative flex shrink-0 items-center justify-center border-b border-slate-800 bg-slate-950/90 px-4 py-3.5">
        <button
          type="button"
          onClick={handleHeaderBack}
          className="absolute left-3 inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow transition hover:border-slate-500 hover:bg-slate-800"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          戻る
        </button>
        <h2 className="text-sm font-bold tracking-wide text-white">{viewTitle}</h2>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {view === "menu" && (
          <div className="space-y-4">
            <p className="px-1 text-xs leading-relaxed text-slate-300">
              自分の安否状況を登録、またはご家族や友人の安否状況が登録されているか確認できます。
            </p>

            {/* Primary Menu Cards (登録する / 確認する) */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => openView("register")}
                className="flex w-full items-center justify-between rounded-xl border border-slate-700/90 bg-slate-800/80 px-4 py-4 text-left shadow transition hover:border-emerald-500/60 hover:bg-slate-800"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                    <ClipboardEdit className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">登録する</div>
                    <div className="text-[11px] text-slate-400">
                      自分の安否状況・避難場所・伝言を登録
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={() => openView("check")}
                className="flex w-full items-center justify-between rounded-xl border border-slate-700/90 bg-slate-800/80 px-4 py-4 text-left shadow transition hover:border-sky-500/60 hover:bg-slate-800"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/15 text-sky-300">
                    <Search className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">確認する</div>
                    <div className="text-[11px] text-slate-400">
                      電話番号や名前・区から安否情報を検索
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            </div>

            {/* Secondary Pill Buttons (登録履歴の確認/削除 / 災害用伝言板（Web版）) */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => openView("history")}
                className="relative flex w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-xs font-semibold text-sky-300 transition hover:border-sky-500/60 hover:bg-slate-800/70"
              >
                <span className="absolute left-4 h-2.5 w-2.5 rounded-full bg-sky-400" />
                <span>登録履歴の確認/削除</span>
                {historyItems.length > 0 && (
                  <span className="absolute right-4 rounded-full bg-sky-500/20 px-2 py-0.5 font-mono text-[10px] text-sky-200">
                    {historyItems.length}件
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => openView("web")}
                className="relative flex w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-xs font-semibold text-sky-300 transition hover:border-sky-500/60 hover:bg-slate-800/70"
              >
                <span className="absolute left-4 h-2.5 w-2.5 rounded-full bg-sky-400" />
                <span>災害用伝言板（Web版）</span>
              </button>
            </div>

            {/* QuakeLens Integration Status Box */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px] leading-relaxed text-slate-400">
              <div className="mb-1 flex items-center justify-between font-semibold text-slate-300">
                <span>QuakeLens 防災訓練・地域共有ボード</span>
                {recentCount !== null && (
                  <span className="font-mono text-sky-300">登録 {recentCount}件</span>
                )}
              </div>
              <p>
                本画面の登録データは本アプリのローカルDBに保存されます（訓練・デモ用）。実際の災害時は「災害用伝言板（Web版）」から NTT{" "}
                <strong className="text-slate-200">web171</strong>{" "}
                等の公式サービスもあわせてご利用ください。
              </p>
            </div>
          </div>
        )}

        {view === "register" && (
          <form onSubmit={handleRegisterSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="mb-1 block font-semibold text-slate-200">
                電話番号（または連絡ID）<span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="例: 090-1234-5678"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-200">
                お名前（ニックネーム可）<span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 京都 太郎"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block font-semibold text-slate-200">
                現在の安否状況 <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatus(opt.value)}
                    className={`rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold transition ${
                      status === opt.value
                        ? `${opt.badgeClass} ring-1 ring-white/30`
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold text-slate-200">現在エリア（区）</label>
                <select
                  value={wardName}
                  onChange={(e) => setWardName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  <option value="京都市全域">京都市全域</option>
                  {wards.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                  <option value="京都市外">京都市外</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-200">
                  削除用暗証番号（任意）
                </label>
                <input
                  type="text"
                  maxLength={16}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="未入力時は自動発行"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            {defaultMeshcode && (
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
                <span>選択中の250mメッシュ ({defaultMeshcode}) を紐付ける</span>
                <input
                  type="checkbox"
                  checked={attachMesh}
                  onChange={(e) => setAttachMesh(e.target.checked)}
                  className="h-4 w-4 accent-sky-500"
                />
              </label>
            )}

            <div>
              <label className="mb-1 block font-semibold text-slate-200">
                伝言メッセージ <span className="text-rose-400">*</span>
              </label>
              <div className="mb-1.5 flex flex-wrap gap-1">
                {QUICK_MESSAGES.map((qm) => (
                  <button
                    key={qm}
                    type="button"
                    onClick={() => setMessage(qm)}
                    className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-sky-500/50 hover:text-sky-200"
                  >
                    + {qm}
                  </button>
                ))}
              </div>
              <textarea
                required
                rows={3}
                maxLength={400}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="避難場所・体調・連絡手段などを入力（400文字以内）"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            {registerFeedback && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-[11px] ${
                  registerFeedback.type === "success"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-200"
                }`}
              >
                {registerFeedback.type === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                )}
                <span>{registerFeedback.text}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>この内容で安否情報を登録する</span>
            </button>
          </form>
        )}

        {view === "check" && (
          <div className="space-y-3.5 text-xs">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void fetchSearchResults();
              }}
              className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3"
            >
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={searchPhone}
                  onChange={(e) => setSearchPhone(e.target.value)}
                  placeholder="電話番号 (例: 09000000001)"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="お名前・本文キーワード"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={searchWard}
                  onChange={(e) => setSearchWard(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  <option value="all">すべての地域</option>
                  {wards.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={loadingEntries}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
                >
                  <Search className="h-3.5 w-3.5" />
                  検索
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px] text-slate-400">
                <span>サンプル検索:</span>
                <button
                  type="button"
                  onClick={() => {
                    setSearchPhone("090-0000-0001");
                    setSearchQuery("");
                    setSearchWard("all");
                    void fetchSearchResults({ phone: "090-0000-0001", q: "", ward: "all" });
                  }}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-sky-300 hover:border-sky-500/50"
                >
                  090-0000-0001
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearchPhone("");
                    setSearchQuery("");
                    setSearchWard("all");
                    void fetchSearchResults({ phone: "", q: "", ward: "all" });
                  }}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-300 hover:border-slate-500"
                >
                  全件表示
                </button>
              </div>
            </form>

            {searchError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">
                {searchError}
              </div>
            )}

            {loadingEntries ? (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                <span>検索中...</span>
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-slate-400">
                条件に一致する安否情報は見つかりませんでした。
              </div>
            ) : (
              <div className="space-y-2.5">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 font-bold text-white">
                          <span>{entry.name}</span>
                          {entry.is_sample && (
                            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.2 text-[9px] text-amber-300">
                              訓練サンプル
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-400">
                          <span>{entry.phone_masked}</span>
                          <span>• {entry.ward_name}</span>
                          {entry.meshcode && <span>• メッシュ {entry.meshcode}</span>}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeStyle(entry.status)}`}
                      >
                        {entry.status_label}
                      </span>
                    </div>

                    <p className="rounded-lg bg-slate-900/90 p-2.5 text-xs leading-relaxed text-slate-200">
                      {entry.message}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>登録: {formatIsoTime(entry.created_at)}</span>
                      {onFocusArea && entry.ward_name !== "京都市外" && (
                        <button
                          type="button"
                          onClick={() => onFocusArea(entry.ward_name, entry.meshcode)}
                          className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-medium text-sky-300 transition hover:bg-sky-500/20"
                        >
                          <MapPin className="h-3 w-3" />
                          地図でこのエリアを見る
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === "history" && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300">
                この端末から登録した伝言履歴（{historyItems.length}件）
              </span>
              <button
                type="button"
                onClick={() => void syncHistoryFromServer(historyItems)}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-300 hover:text-white"
              >
                <RefreshCw className={`h-3 w-3 ${loadingHistory ? "animate-spin" : ""}`} />
                再読込
              </button>
            </div>

            {historyFeedback && (
              <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-2.5 text-[11px] text-sky-200">
                {historyFeedback}
              </div>
            )}

            {historyItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-center text-slate-400">
                この端末で登録した履歴はまだありません。「登録する」から安否情報を登録できます。
              </div>
            ) : (
              <div className="space-y-2.5">
                {historyItems.map((item) => {
                  const activeOnServer = serverHistoryEntries.some((s) => s.id === item.id);
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-white">{item.name}</div>
                          <div className="font-mono text-[10px] text-slate-400">
                            ID: {item.id} • {item.phone_masked} • {item.ward_name}
                          </div>
                        </div>
                        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200">
                          {item.status_label}
                        </span>
                      </div>
                      <p className="rounded bg-slate-900 p-2 text-[11px] text-slate-300">
                        {item.message}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>
                          暗証番号: <strong className="font-mono text-slate-200">{item.passcode}</strong>
                          {!loadingHistory && !activeOnServer && "（サーバー削除済み）"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleDeleteHistoryItem(item)}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 font-semibold text-rose-200 transition hover:bg-rose-500/25"
                        >
                          <Trash2 className="h-3 w-3" />
                          削除する
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Manual Delete by ID + Passcode */}
            <form
              onSubmit={handleManualDelete}
              className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
            >
              <div className="font-semibold text-slate-300">登録IDを指定して削除</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={manualDeleteId}
                  onChange={(e) => setManualDeleteId(e.target.value)}
                  placeholder="登録ID (例: a1b2c3d4e5f6)"
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white"
                />
                <input
                  type="text"
                  value={manualDeletePasscode}
                  onChange={(e) => setManualDeletePasscode(e.target.value)}
                  placeholder="削除用暗証番号"
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white"
                />
              </div>
              <button
                type="submit"
                disabled={!manualDeleteId.trim()}
                className="w-full rounded-lg border border-rose-500/40 bg-rose-500/15 py-1.5 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-40"
              >
                指定した伝言を削除
              </button>
            </form>
          </div>
        )}

        {view === "web" && (
          <div className="space-y-3 text-xs">
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-[11px] leading-relaxed text-sky-100">
              実際の災害発生時は、通信各社・NTT が提供する以下の公式災害用伝言サービスをあわせてご利用ください。
            </div>

            <a
              href="https://www.web171.jp/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950/80 p-3.5 transition hover:border-sky-500/50"
            >
              <div>
                <div className="font-bold text-sky-300">NTT 災害用伝言板（web171）</div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  被災地の電話番号をキーにWebから安否情報の登録・確認が可能（全国対応・毎月1日等体験利用可）。
                </p>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0 text-sky-400" />
            </a>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <Phone className="h-4 w-4" />
                災害用伝言ダイヤル（局番なし 171）
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                電話から <strong className="font-mono text-white">171</strong>{" "}
                に発信し、音声ガイダンスに従って録音（1）・再生（2）を行います。web171 とも相互連携しています。
              </p>
            </div>

            <a
              href="https://www.city.kyoto.lg.jp/tokei/soshiki/9-2-4-0-0.html"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 transition hover:border-emerald-500/50"
            >
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <div>
                  <div className="font-bold text-emerald-300">京都市 建築安全推進課（耐震化窓口）</div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    京都市の耐震診断・耐震改修支援や宅地耐震化に関する公式案内。
                  </p>
                </div>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0 text-emerald-400" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
