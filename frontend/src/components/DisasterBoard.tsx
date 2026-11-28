"use client";

import { MessageCircle as ChatTabIcon } from "lucide-react";
import { BoardChatPanel } from "@/components/BoardChatPanel";
import type { MapAction } from "@/types/quakelens";

import React, { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
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
  Pencil,
  Users,
  Lock,
} from "lucide-react";
import {
  createBoardEntry,
  deleteBoardEntry,
  getBoardEntries,
  getBoardSummary,
  updateBoardEntry,
} from "@/lib/api";
import { BOARD_STATUS_META } from "@/lib/colors";
import { generateRandomPasscode } from "@/lib/reportAuth";
import { BoardEntry, BoardStatus, BoardSummaryResponse, UserRole } from "@/types/quakelens";

type BoardView = "check" | "chat" | "register" | "history" | "web";

interface LocalHistoryItem {
  id: string;
  phone_masked: string;
  name: string;
  status: BoardStatus;
  status_label: string;
  ward_name: string;
  meshcode?: string | null;
  message: string;
  created_at: string;
  passcode: string;
}

const HISTORY_STORAGE_KEY = "quakelens_disaster_board_history_v1";

const STATUS_OPTIONS: Array<{
  value: BoardStatus;
  label: string;
  short: string;
  badgeClass: string;
}> = [
  { value: "safe", label: BOARD_STATUS_META.safe.label, short: BOARD_STATUS_META.safe.short, badgeClass: BOARD_STATUS_META.safe.badgeClass },
  { value: "shelter", label: BOARD_STATUS_META.shelter.label, short: BOARD_STATUS_META.shelter.short, badgeClass: BOARD_STATUS_META.shelter.badgeClass },
  { value: "home", label: BOARD_STATUS_META.home.label, short: BOARD_STATUS_META.home.short, badgeClass: BOARD_STATUS_META.home.badgeClass },
  { value: "minor_injury", label: BOARD_STATUS_META.minor_injury.label, short: BOARD_STATUS_META.minor_injury.short, badgeClass: BOARD_STATUS_META.minor_injury.badgeClass },
  { value: "waiting", label: BOARD_STATUS_META.waiting.label, short: BOARD_STATUS_META.waiting.short, badgeClass: BOARD_STATUS_META.waiting.badgeClass },
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

function formatIsoTime(iso?: string): string {
  if (!iso) return "—";
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

export interface DisasterBoardProps {
  userRole?: UserRole;
  onBack?: () => void;
  embedded?: boolean;
  wards?: string[];
  defaultWard?: string;
  defaultMeshcode?: string | null;
  includeSamples?: boolean;
  onToggleIncludeSamples?: (next: boolean) => void;
  onFocusArea?: (wardName: string, meshcode: string | null) => void;
  onSelectWardFilter?: (ward: string) => void;
  onDataMutated?: () => void;
  initialView?: BoardView;
  onExecuteMapActions?: (actions: MapAction[]) => void;
}

export function DisasterBoard({
  userRole = "citizen",
  onBack,
  embedded = false,
  wards = DEFAULT_WARDS,
  defaultWard = "all",
  defaultMeshcode = null,
  includeSamples: controlledIncludeSamples,
  onToggleIncludeSamples,
  onFocusArea,
  onSelectWardFilter,
  onDataMutated,
  initialView = "check",
  onExecuteMapActions,
}: DisasterBoardProps) {
  const [view, setView] = useState<BoardView>(initialView);
  const [localIncludeSamples, setLocalIncludeSamples] = useState(true);
  const includeSamples =
    controlledIncludeSamples !== undefined ? controlledIncludeSamples : localIncludeSamples;

  const [summary, setSummary] = useState<BoardSummaryResponse | null>(null);

  // Search / Check state
  const [searchPhone, setSearchPhone] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchWardOverride, setSearchWardOverride] = useState<string | null>(null);
  const searchWard = searchWardOverride ?? defaultWard;
  const [meshFilterOverride, setMeshFilterOverride] = useState<boolean | null>(null);
  const filterMeshOnly = meshFilterOverride ?? Boolean(defaultMeshcode);
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Register form state
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<BoardStatus>("safe");
  const [regWardOverride, setRegWardOverride] = useState<string | null>(null);
  const wardName = regWardOverride ?? (defaultWard !== "all" ? defaultWard : "京都市全域");
  const [locationConsent, setLocationConsent] = useState<boolean>(false);
  const [message, setMessage] = useState("");
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registerFeedback, setRegisterFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // History & Inline Edit / Delete state
  const [historyItems, setHistoryItems] = useState<LocalHistoryItem[]>([]);
  const [serverHistoryEntries, setServerHistoryEntries] = useState<BoardEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<BoardStatus>("safe");
  const [editMessage, setEditMessage] = useState("");
  const [editPasscode, setEditPasscode] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [manualId, setManualId] = useState("");
  const [manualPasscode, setManualPasscode] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      setHistoryItems(readStoredHistory());
    });
  }, []);

  const refreshSummaryAndEntries = useCallback(
    async (opts?: { phone?: string; q?: string; ward?: string; mesh?: string | null }) => {
      setLoadingEntries(true);
      setSearchError(null);
      const effectiveWard = opts?.ward ?? searchWard;
      const effectiveMesh = opts?.mesh !== undefined ? opts.mesh : (filterMeshOnly ? defaultMeshcode : null);
      try {
        const [sumRes, listRes] = await Promise.all([
          getBoardSummary({ ward: effectiveWard, includeSamples }),
          getBoardEntries({
            phone: opts?.phone ?? searchPhone,
            q: opts?.q ?? searchQuery,
            ward: effectiveWard,
            meshcode: effectiveMesh ?? undefined,
            includeSamples,
            limit: 60,
          }),
        ]);
        setSummary(sumRes);
        setEntries(listRes.entries);
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "伝言板データの読み込みに失敗しました。"
        );
      } finally {
        setLoadingEntries(false);
      }
    },
    [searchPhone, searchQuery, searchWard, filterMeshOnly, defaultMeshcode, includeSamples]
  );

  useEffect(() => {
    let cancelled = false;
    const effectiveMesh = filterMeshOnly ? defaultMeshcode : null;
    Promise.all([
      getBoardSummary({ ward: searchWard, includeSamples }),
      getBoardEntries({
        phone: searchPhone,
        q: searchQuery,
        ward: searchWard,
        meshcode: effectiveMesh ?? undefined,
        includeSamples,
        limit: 60,
      }),
    ])
      .then(([sumRes, listRes]) => {
        if (cancelled) return;
        setSummary(sumRes);
        setEntries(listRes.entries);
        setSearchError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSearchError(
          err instanceof Error ? err.message : "伝言板データの読み込みに失敗しました。"
        );
      });
    return () => {
      cancelled = true;
    };
  }, [searchWard, filterMeshOnly, defaultMeshcode, includeSamples, searchPhone, searchQuery]);

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

  const handleSwitchView = (next: BoardView) => {
    setView(next);
    setRegisterFeedback(null);
    setHistoryFeedback(null);
    if (next === "check") {
      void refreshSummaryAndEntries();
    } else if (next === "history") {
      const stored = readStoredHistory();
      setHistoryItems(stored);
      void syncHistoryFromServer(stored);
    }
  };

  const handleToggleSamples = (next: boolean) => {
    if (onToggleIncludeSamples) {
      onToggleIncludeSamples(next);
    } else {
      setLocalIncludeSamples(next);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setRegisterFeedback(null);

    const effectivePasscode =
      passcode.trim() || generateRandomPasscode();

    try {
      const res = await createBoardEntry({
        phone: phone.trim(),
        name: name.trim(),
        status,
        message: message.trim(),
        ward_name: wardName,
        meshcode: locationConsent && defaultMeshcode ? defaultMeshcode : null,
        location_consent: locationConsent,
        passcode: effectivePasscode,
      });
      const created = res.entry;
      const newHist: LocalHistoryItem = {
        id: created.id,
        phone_masked: created.phone_masked,
        name: created.name,
        status: created.status,
        status_label: created.status_label,
        ward_name: created.ward_name,
        meshcode: created.meshcode,
        message: created.message,
        created_at: created.created_at,
        passcode: effectivePasscode,
      };
      const updated = [newHist, ...readStoredHistory()].slice(0, 30);
      writeStoredHistory(updated);
      setHistoryItems(updated);
      setRegisterFeedback({
        type: "success",
        text: `安否情報を登録しました（登録ID: ${created.id} / 管理用暗証番号: ${effectivePasscode}）。自分の履歴タブから後から状況更新・削除ができます。`,
      });
      setMessage("");
      onDataMutated?.();
      void refreshSummaryAndEntries();
    } catch (err) {
      setRegisterFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "登録に失敗しました。",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (item: LocalHistoryItem) => {
    setEditingId(item.id);
    setEditStatus(item.status || "safe");
    setEditMessage(item.message);
    setEditPasscode(item.passcode);
    setHistoryFeedback(null);
  };

  const handleSaveEdit = async (itemId: string) => {
    if (savingEdit) return;
    setSavingEdit(true);
    setHistoryFeedback(null);
    try {
      const res = await updateBoardEntry(itemId, {
        passcode: editPasscode,
        status: editStatus,
        message: editMessage,
      });
      const updatedEntry = res.entry;
      const nextHist = historyItems.map((h) =>
        h.id === itemId
          ? {
              ...h,
              status: updatedEntry.status,
              status_label: updatedEntry.status_label,
              message: updatedEntry.message,
            }
          : h
      );
      writeStoredHistory(nextHist);
      setHistoryItems(nextHist);
      setEditingId(null);
      setHistoryFeedback(`登録ID ${itemId} の安否状況を「${updatedEntry.status_label}」へ更新しました。`);
      onDataMutated?.();
      void syncHistoryFromServer(nextHist);
      void refreshSummaryAndEntries();
    } catch (err) {
      setHistoryFeedback(err instanceof Error ? err.message : "更新に失敗しました。");
    } finally {
      setSavingEdit(false);
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
      setHistoryFeedback(`登録ID ${item.id} を削除しました。`);
      onDataMutated?.();
      void refreshSummaryAndEntries();
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
    if (!manualId.trim()) return;
    setHistoryFeedback(null);
    try {
      await deleteBoardEntry(manualId.trim(), manualPasscode.trim());
      const next = historyItems.filter((h) => h.id !== manualId.trim());
      writeStoredHistory(next);
      setHistoryItems(next);
      setServerHistoryEntries((prev) => prev.filter((en) => en.id !== manualId.trim()));
      setHistoryFeedback(`登録ID ${manualId.trim()} を削除しました。`);
      setManualId("");
      setManualPasscode("");
      onDataMutated?.();
      void refreshSummaryAndEntries();
    } catch (err) {
      setHistoryFeedback(err instanceof Error ? err.message : "削除に失敗しました。");
    }
  };

  const outerClass = embedded
    ? "flex h-full flex-col bg-transparent text-slate-100"
    : "mx-auto flex h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 text-slate-100 shadow-2xl";

  return (
    <div className={outerClass}>
      {/* Standalone Header when rendered at /board or modal */}
      {!embedded && (
        <header className="relative flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/90 px-3 py-2.5 sm:flex-nowrap sm:px-4 sm:py-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-100 hover:border-slate-500"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="sm:hidden">マップへ</span>
              <span className="hidden sm:inline">統合防災マップへ</span>
            </button>
          ) : (
            <span />
          )}
          <div className="min-w-0 text-center">
            <h2 className="truncate text-sm font-bold text-white">災害用伝言板（安否確認）</h2>
            <p className="truncate text-[10px] text-slate-400">京都市エリア連携・SQLite永続化</p>
          </div>
          <div className="shrink-0 text-right font-mono text-[10px] text-sky-300 sm:w-20">
            {summary ? `${summary.total_entries}件` : ""}
          </div>
        </header>
      )}

      {/* Sub-navigation tabs */}
      <div className="grid shrink-0 grid-cols-5 gap-1 border-b border-slate-800 bg-slate-950/60 p-1.5 text-[9.5px] sm:text-[10.5px]">
        <button
          type="button"
          onClick={() => handleSwitchView("check")}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 font-semibold transition sm:flex-row sm:gap-1 ${
            view === "check"
              ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/50"
              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
          }`}
        >
          <Search className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
          <span className="truncate">確認</span>
        </button>
        <button
          type="button"
          data-testid="board-tab-chat"
          onClick={() => handleSwitchView("chat")}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 font-semibold transition sm:flex-row sm:gap-1 ${
            view === "chat"
              ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/50"
              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
          }`}
        >
          <ChatTabIcon className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
          <span className="truncate">チャット</span>
        </button>
        <button
          type="button"
          onClick={() => handleSwitchView("register")}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 font-semibold transition sm:flex-row sm:gap-1 ${
            view === "register"
              ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/50"
              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
          }`}
        >
          <ClipboardEdit className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
          <span className="truncate">安否登録</span>
        </button>
        <button
          type="button"
          onClick={() => handleSwitchView("history")}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 font-semibold transition sm:flex-row sm:gap-1 ${
            view === "history"
              ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-500/50"
              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
          }`}
        >
          <Pencil className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
          <span className="truncate">管理({historyItems.length})</span>
        </button>
        <button
          type="button"
          onClick={() => handleSwitchView("web")}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 font-semibold transition sm:flex-row sm:gap-1 ${
            view === "web"
              ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/50"
              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
          }`}
        >
          <Phone className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
          <span className="truncate">web171</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-3.5 text-xs">
        {view === "check" && (
          <div className="space-y-3">
            {/* Regional Aggregation Summary Card */}
            {summary && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <Users className="h-3.5 w-3.5 text-sky-400" />
                    <span>
                      {searchWard === "all" ? "京都市全域" : searchWard} の安否集計
                    </span>
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeSamples}
                      onChange={(e) => handleToggleSamples(e.target.checked)}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                    訓練サンプルを含む
                  </label>
                </div>

                {/* Real User vs Sample separation */}
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 font-semibold text-sky-200">
                    一般登録: {summary.user_entries_count}件
                  </span>
                  <span className="rounded border border-dotted border-slate-500 bg-slate-800/80 px-2 py-0.5 text-slate-300">
                    訓練サンプル: {summary.sample_entries_count}件
                  </span>
                </div>

                {/* Status breakdown chips */}
                <div className="grid grid-cols-5 gap-1">
                  {STATUS_OPTIONS.map((opt) => (
                    <div
                      key={opt.value}
                      className="rounded-lg border border-slate-800 bg-slate-900/90 px-1.5 py-1.5 text-center"
                    >
                      <div className="text-[9px] text-slate-400 truncate">{opt.short}</div>
                      <div className="font-mono text-xs font-bold text-white">
                        {summary.status_counts[opt.value] ?? 0}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Ward pills for instant map + board sync */}
                {summary.by_ward.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {summary.by_ward.slice(0, 6).map((w) => (
                      <button
                        key={w.ward_name}
                        type="button"
                        onClick={() => {
                          setSearchWardOverride(w.ward_name);
                          onSelectWardFilter?.(w.ward_name);
                          onFocusArea?.(w.ward_name, null);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${
                          searchWard === w.ward_name
                            ? "border-sky-400 bg-sky-500/20 text-sky-100"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:border-sky-500/50"
                        }`}
                      >
                        <span>{w.ward_name}</span>
                        <span className="font-mono font-bold text-sky-300">{w.total_count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Search & Filter Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void refreshSummaryAndEntries();
              }}
              className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
            >
              {userRole !== "government" && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-400">
                  ※ 個人情報保護のため、他の方の安否伝言を確認する際は「電話番号検索」または「ご自身の登録履歴」をご利用ください（政府関連機関のみ区単位の要支援一覧照会が可能）。
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={searchPhone}
                  onChange={(e) => setSearchPhone(e.target.value)}
                  placeholder="電話番号で安否検索"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <select
                  value={searchWard}
                  onChange={(e) => {
                    const nextW = e.target.value;
                    setSearchWardOverride(nextW === defaultWard ? null : nextW);
                    onSelectWardFilter?.(nextW);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  <option value="all">全区（京都市全域）</option>
                  {wards.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                  <option value="京都市全域">京都市全域指定のみ</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="名前・キーワード検索"
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-500"
                >
                  <Search className="h-3.5 w-3.5" />
                  検索
                </button>
              </div>
              {defaultMeshcode && (
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[10px] text-sky-200">
                  <span>選択中250mメッシュ ({defaultMeshcode}) に限定</span>
                  <input
                    type="checkbox"
                    checked={filterMeshOnly}
                    onChange={(e) => setMeshFilterOverride(e.target.checked)}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                </label>
              )}
            </form>

            {searchError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">
                {searchError}
              </div>
            )}

            {/* Entries List */}
            {loadingEntries ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                読み込み中...
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-center text-slate-400">
                条件に一致する安否登録はありません。
              </div>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) => {
                  const meta = BOARD_STATUS_META[entry.status];
                  return (
                    <div
                      key={entry.id}
                      className={`rounded-xl border p-3 transition ${
                        entry.is_sample
                          ? "border-dotted border-slate-700 bg-slate-950/60"
                          : "border-slate-800 bg-slate-950/90"
                      }`}
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-white">{entry.name}</span>
                            {entry.is_sample ? (
                              <span className="rounded border border-dotted border-slate-500 bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-slate-300">
                                訓練サンプル
                              </span>
                            ) : (
                              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                                利用者登録
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                            {entry.phone_masked} • {entry.ward_name}
                            {entry.meshcode ? ` (${entry.meshcode})` : ""}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            meta?.badgeClass || "border-slate-700 bg-slate-800 text-slate-200"
                          }`}
                        >
                          {entry.status_label}
                        </span>
                      </div>
                      <p className="rounded-lg bg-slate-900/90 p-2 text-[11px] leading-relaxed text-slate-200">
                        {entry.message}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                        <span>
                          更新: {formatIsoTime(entry.updated_at || entry.created_at)}
                        </span>
                        {onFocusArea && entry.ward_name !== "京都市外" && (
                          <button
                            type="button"
                            onClick={() => onFocusArea(entry.ward_name, entry.meshcode)}
                            className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-medium text-sky-300 hover:bg-sky-500/20"
                          >
                            <MapPin className="h-3 w-3" />
                            地図でこのエリアへ移動
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[10px] text-slate-400">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>
                個人の電話番号は一覧では伏せ字表示され、個人の精密GPS座標は同意なく取得・公開されません。
              </span>
            </div>
          </div>
        )}

        {view === "register" && (
          <form onSubmit={handleRegisterSubmit} className="space-y-3 text-xs">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-100">
              ご自身やご家族の安否状況を登録できます。登録内容は統計・地図（区・250mメッシュ単位）と連携しますが、個人の正確な位置座標は取得・保存しません。
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
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
                        ? `${opt.badgeClass} ring-1 ring-white/40`
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
                  onChange={(e) => setRegWardOverride(e.target.value)}
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
                  更新・削除用暗証番号
                </label>
                <input
                  type="text"
                  maxLength={16}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="未入力時は4桁自動発行"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Explicit consent before linking coarse 250m mesh */}
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-2.5 text-[11px] text-sky-100">
              <input
                type="checkbox"
                checked={locationConsent}
                onChange={(e) => setLocationConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-sky-500"
              />
              <span>
                選択中の地域・250mメッシュ
                {defaultMeshcode ? ` (${defaultMeshcode})` : ""}
                との統計・地図連携に同意する（個人の精密なGPS位置情報は取得・公開されません）
              </span>
            </label>

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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
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

        {view === "history" && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300">
                この端末の登録履歴（{historyItems.length}件）— 状況更新・削除が可能
              </span>
              <button
                type="button"
                onClick={() => void syncHistoryFromServer(historyItems)}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-300 hover:text-white"
              >
                <RefreshCw className={`h-3 w-3 ${loadingHistory ? "animate-spin" : ""}`} />
                同期
              </button>
            </div>

            {historyFeedback && (
              <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-2.5 text-[11px] text-sky-200">
                {historyFeedback}
              </div>
            )}

            {historyItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-center text-slate-400">
                この端末からの登録履歴はまだありません。
              </div>
            ) : (
              <div className="space-y-2.5">
                {historyItems.map((item) => {
                  const activeOnServer = serverHistoryEntries.some((s) => s.id === item.id);
                  const isEditing = editingId === item.id;
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

                      {!isEditing ? (
                        <>
                          <p className="rounded bg-slate-900 p-2 text-[11px] text-slate-300">
                            {item.message}
                          </p>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                            <span>
                              暗証番号: <strong className="font-mono text-slate-200">{item.passcode}</strong>
                              {!loadingHistory && !activeOnServer && "（サーバー削除済み）"}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(item)}
                                className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-1 font-semibold text-sky-200 hover:bg-sky-500/25"
                              >
                                <Pencil className="h-3 w-3" />
                                状況更新
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteHistoryItem(item)}
                                className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2 py-1 font-semibold text-rose-200 hover:bg-rose-500/25"
                              >
                                <Trash2 className="h-3 w-3" />
                                削除
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-2 rounded-lg border border-sky-500/30 bg-slate-900/90 p-2.5">
                          <select
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value as BoardStatus)}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                          >
                            {STATUS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <textarea
                            rows={2}
                            maxLength={400}
                            value={editMessage}
                            onChange={(e) => setEditMessage(e.target.value)}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              disabled={savingEdit}
                              onClick={() => void handleSaveEdit(item.id)}
                              className="flex-1 rounded bg-sky-600 py-1.5 font-semibold text-white hover:bg-sky-500"
                            >
                              保存する
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded border border-slate-700 px-3 py-1.5 text-slate-300"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <form
              onSubmit={handleManualDelete}
              className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
            >
              <div className="font-semibold text-slate-300">IDを指定して削除</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="登録ID"
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white"
                />
                <input
                  type="text"
                  value={manualPasscode}
                  onChange={(e) => setManualPasscode(e.target.value)}
                  placeholder="暗証番号"
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white"
                />
              </div>
              <button
                type="submit"
                disabled={!manualId.trim()}
                className="w-full rounded-lg border border-rose-500/40 bg-rose-500/15 py-1.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-40"
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
                  被災地の電話番号をキーにWebから安否情報の登録・確認が可能（全国対応）。
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
                電話から <strong className="font-mono text-white">171</strong> に発信し、録音（1）・再生（2）を行います。
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
                  <div className="font-bold text-emerald-300">京都市 建築安全推進課</div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    京都市の耐震診断・耐震改修支援に関する公式案内。
                  </p>
                </div>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0 text-emerald-400" />
            </a>
          </div>
        )}

        {view === "chat" && (
          <BoardChatPanel
            defaultWard={searchWard}
            onExecuteMapActions={onExecuteMapActions}
          />
        )}
      </div>
    </div>
  );
}
