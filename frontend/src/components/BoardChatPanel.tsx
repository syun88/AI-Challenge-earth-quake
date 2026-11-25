"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Building2,
  Landmark,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type FirestoreError,
  type Timestamp,
} from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { askBoardChatAgent } from "@/lib/api";
import { WARD_CENTERS } from "@/lib/colors";
import { getFirebaseDb, ROLE_META } from "@/lib/firebase";
import type {
  BoardChatChannel,
  BoardChatMessage,
  MapAction,
  UserRole,
} from "@/types/quakelens";

interface BoardChatPanelProps {
  defaultWard?: string;
  onExecuteMapActions?: (actions: MapAction[]) => void;
}

const KYOTO_WARDS = Object.keys(WARD_CENTERS).filter((w) => w !== "all");
const MAX_CHAT_LENGTH = 500;
const MENTION_PATTERN = /(?:@|＠)(?:もちまも|mochimamo)/i;
export const PENDING_BOARD_MAP_ACTIONS_KEY = "quakelens_pending_map_actions";

const CHANNEL_META: Record<
  BoardChatChannel,
  {
    label: string;
    shortLabel: string;
    description: string;
    pillClass: string;
    activeClass: string;
  }
> = {
  public: {
    label: "地域共有チャット",
    shortLabel: "地域チャット",
    description:
      "市民・企業・行政機関の全ロールで状況共有や @もちまも 避難ナビ連携ができます（公開チャンネルのため機密・個人情報は遮断）。",
    pillClass: "text-slate-300 hover:text-white",
    activeClass: "bg-sky-500/20 text-sky-100 border-sky-400/70",
  },
  enterprise_liaison: {
    label: "行政⇄企業 緊急連携",
    shortLabel: "行政連携",
    description:
      "自社アカウントと認証済み政府・自治体機関のみ閲覧・送受信できる1:1秘匿連絡チャンネルです。",
    pillClass: "text-slate-300 hover:text-emerald-200",
    activeClass: "bg-emerald-500/20 text-emerald-100 border-emerald-400/70",
  },
  government: {
    label: "政府機関 専用指令チャット",
    shortLabel: "政府専用",
    description:
      "認証済み政府・自治体機関（verifiedAgency）のみ閲覧・送信可能な秘匿連絡チャンネルです。",
    pillClass: "text-slate-300 hover:text-amber-200",
    activeClass: "bg-amber-500/20 text-amber-100 border-amber-400/70",
  },
};

function formatChatTime(ms: number | null): string {
  if (!ms) return "送信中...";
  try {
    return new Date(ms).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function serializeCompactMapActions(actions: MapAction[] | undefined): string {
  if (!actions || actions.length === 0) return "";
  const full = JSON.stringify(actions);
  if (full.length <= 3900) return full;
  for (let count = Math.min(actions.length, 4); count >= 1; count--) {
    const sub = JSON.stringify(actions.slice(0, count));
    if (sub.length <= 3900) return sub;
  }
  return "";
}

function mapFirestoreChatError(err: FirestoreError | Error): string {
  const code = "code" in err ? err.code : "";
  if (code === "permission-denied") {
    return (
      "Firestore 権限エラー: 政府専用または企業連携チャンネルの利用には、" +
      "サーバー側 Firebase Custom Claim 同期（backend/firebase-service-account.json の設定および認証トークン更新）が必要です。"
    );
  }
  if (code === "failed-precondition") {
    return "チャット用 Firestore インデックスを作成・反映中です。数秒〜1分後に自動的に再同期されます。";
  }
  if (code === "unavailable") {
    return "Firestore に一時的に接続できません。ネットワーク状態をご確認ください。";
  }
  return err.message || "チャットの読み込みに失敗しました。";
}

export function BoardChatPanel({
  defaultWard = "all",
  onExecuteMapActions,
}: BoardChatPanelProps) {
  const router = useRouter();
  const { profile, firebaseUser } = useAuth();
  const db = getFirebaseDb();

  const [channel, setChannel] = useState<BoardChatChannel>("public");
  const [wardOverride, setWardOverride] = useState<string | null>(null);
  const [selectedTenantUid, setSelectedTenantUid] = useState<string>("");
  const [filterSelectedThread, setFilterSelectedThread] = useState<boolean>(false);

  const [messages, setMessages] = useState<BoardChatMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [agentThinking, setAgentThinking] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const availableChannels = useMemo<BoardChatChannel[]>(() => {
    if (!profile) return ["public"];
    if (profile.role === "government") {
      return ["public", "enterprise_liaison", "government"];
    }
    if (profile.role === "enterprise") {
      return ["public", "enterprise_liaison"];
    }
    return ["public"];
  }, [profile]);

  const activeChannel: BoardChatChannel = availableChannels.includes(channel)
    ? channel
    : "public";
  const activeWard = wardOverride ?? (defaultWard || "all");

  useEffect(() => {
    if (!db || !profile || !firebaseUser) {
      queueMicrotask(() => {
        setMessages([]);
        setLoading(false);
      });
      return;
    }

    queueMicrotask(() => {
      setLoading(true);
      setChatError(null);
    });

    const col = collection(db, "board_chat_messages");
    let q;
    if (activeChannel === "public") {
      q =
        activeWard === "all"
          ? query(
              col,
              where("channel", "==", "public"),
              orderBy("createdAt", "desc"),
              limit(50)
            )
          : query(
              col,
              where("channel", "==", "public"),
              where("wardName", "==", activeWard),
              orderBy("createdAt", "desc"),
              limit(50)
            );
    } else if (activeChannel === "enterprise_liaison") {
      q =
        profile.role === "enterprise"
          ? query(
              col,
              where("channel", "==", "enterprise_liaison"),
              where("tenantUid", "==", profile.uid),
              orderBy("createdAt", "desc"),
              limit(50)
            )
          : query(
              col,
              where("channel", "==", "enterprise_liaison"),
              orderBy("createdAt", "desc"),
              limit(50)
            );
    } else {
      q = query(
        col,
        where("channel", "==", "government"),
        orderBy("createdAt", "desc"),
        limit(50)
      );
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: BoardChatMessage[] = snap.docs
          .map((d) => {
            const data = d.data({ serverTimestamps: "estimate" });
            const ts = data.createdAt as Timestamp | null | undefined;
            const roleRaw = String(data.senderRole || "citizen");
            const senderRole: UserRole | "assistant" =
              roleRaw === "government" ||
              roleRaw === "enterprise" ||
              roleRaw === "assistant"
                ? roleRaw
                : "citizen";

            let parsedActions: MapAction[] = [];
            if (typeof data.mapActionsJson === "string" && data.mapActionsJson.trim()) {
              try {
                const raw = JSON.parse(data.mapActionsJson);
                if (Array.isArray(raw)) {
                  parsedActions = raw as MapAction[];
                }
              } catch {
                parsedActions = [];
              }
            }

            const replyKind: "ai_proxy" | "assistant" | "user" =
              data.replyKind === "ai_proxy" || data.replyKind === "assistant"
                ? (data.replyKind as "ai_proxy" | "assistant")
                : "user";

            return {
              id: d.id,
              channel: (data.channel as BoardChatChannel) || "public",
              tenantUid: String(data.tenantUid || ""),
              senderUid: String(data.senderUid || ""),
              senderName: String(data.senderName || "匿名ユーザー"),
              senderRole,
              senderOrg: String(data.senderOrg || ""),
              wardName: String(data.wardName || "京都市全域"),
              text: String(data.text || ""),
              replyKind,
              mapActions: parsedActions,
              createdAtMs: ts && typeof ts.toMillis === "function" ? ts.toMillis() : null,
            };
          })
          .reverse();
        setMessages(list);
        setLoading(false);
        setChatError(null);
      },
      (err) => {
        setLoading(false);
        setChatError(mapFirestoreChatError(err));
      }
    );

    return () => unsub();
  }, [db, profile, firebaseUser, activeChannel, activeWard]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, activeChannel, agentThinking]);

  const enterpriseThreads = useMemo(() => {
    if (
      activeChannel !== "enterprise_liaison" ||
      profile?.role !== "government"
    ) {
      return [];
    }
    const map = new Map<
      string,
      { tenantUid: string; orgLabel: string; count: number }
    >();
    for (const m of messages) {
      if (!m.tenantUid) continue;
      const existing = map.get(m.tenantUid);
      const nextOrgLabel =
        m.senderRole === "enterprise"
          ? m.senderOrg || m.senderName || `企業(${m.tenantUid.slice(0, 6)})`
          : existing?.orgLabel || `企業(${m.tenantUid.slice(0, 6)})`;
      map.set(m.tenantUid, {
        tenantUid: m.tenantUid,
        orgLabel: nextOrgLabel,
        count: (existing?.count ?? 0) + 1,
      });
    }
    return Array.from(map.values());
  }, [activeChannel, messages, profile?.role]);

  const resolvedTenantUid =
    profile?.role === "enterprise"
      ? profile.uid
      : selectedTenantUid &&
          enterpriseThreads.some((t) => t.tenantUid === selectedTenantUid)
        ? selectedTenantUid
        : enterpriseThreads[0]?.tenantUid || "";

  const visibleMessages = useMemo(() => {
    if (
      activeChannel === "enterprise_liaison" &&
      profile?.role === "government" &&
      filterSelectedThread &&
      resolvedTenantUid
    ) {
      return messages.filter((m) => m.tenantUid === resolvedTenantUid);
    }
    return messages;
  }, [
    activeChannel,
    messages,
    profile?.role,
    filterSelectedThread,
    resolvedTenantUid,
  ]);

  const handleApplyMessageActions = (actions: MapAction[]) => {
    const runnable = actions.filter((a) => a.type !== "download_export");
    if (runnable.length === 0) return;
    if (onExecuteMapActions) {
      onExecuteMapActions(runnable);
      return;
    }
    try {
      window.sessionStorage.setItem(
        PENDING_BOARD_MAP_ACTIONS_KEY,
        JSON.stringify(runnable)
      );
    } catch {
      // ignore storage quota errors
    }
    router.push("/");
  };

  const canSend =
    Boolean(db && profile && firebaseUser && draft.trim().length > 0 && !sending) &&
    (activeChannel !== "enterprise_liaison" || Boolean(resolvedTenantUid));

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = draft.trim();
    if (!db || !profile || !firebaseUser || !trimmed || sending) return;
    if (trimmed.length > MAX_CHAT_LENGTH) {
      setChatError(`メッセージは ${MAX_CHAT_LENGTH} 文字以内で入力してください。`);
      return;
    }
    if (activeChannel === "enterprise_liaison" && !resolvedTenantUid) {
      setChatError("返信先の企業スレッドを選択してください。");
      return;
    }

    const senderDisplayName =
      profile.display_name || firebaseUser.displayName || "登録ユーザー";
    const wardLabel =
      activeChannel === "public"
        ? activeWard === "all"
          ? "京都市全域"
          : activeWard
        : "連絡専用";
    const tenantForPost =
      activeChannel === "enterprise_liaison" ? resolvedTenantUid : "";
    const recentSnapshot = visibleMessages.slice(-12).map((m) => ({
      senderName: m.senderName,
      senderRole: m.senderRole,
      wardName: m.wardName,
      text: m.text,
    }));

    setSending(true);
    setChatError(null);
    try {
      await addDoc(collection(db, "board_chat_messages"), {
        channel: activeChannel,
        tenantUid: tenantForPost,
        senderUid: profile.uid,
        senderName: senderDisplayName,
        senderRole: profile.role,
        senderOrg: profile.organization_name || "",
        wardName: wardLabel,
        text: trimmed,
        createdAt: serverTimestamp(),
      });
      setDraft("");
    } catch (err) {
      setChatError(
        err instanceof Error
          ? mapFirestoreChatError(err)
          : "メッセージ送信に失敗しました。"
      );
      setSending(false);
      return;
    } finally {
      setSending(false);
    }

    // Trigger @もちまも AI Agent when mentioned inside this isolated channel
    if (MENTION_PATTERN.test(trimmed)) {
      setAgentThinking(true);
      try {
        const agentRes = await askBoardChatAgent({
          channel: activeChannel,
          ward_name: activeWard,
          tenant_uid: tenantForPost,
          trigger_message: trimmed,
          recent_messages: [
            ...recentSnapshot,
            {
              senderName: senderDisplayName,
              senderRole: profile.role,
              wardName: wardLabel,
              text: trimmed,
            },
          ],
        });

        // Apply Agent map actions directly when inside map workspace
        const runnable = (agentRes.map_actions || []).filter(
          (a) => a.type !== "download_export"
        );
        if (onExecuteMapActions && runnable.length > 0) {
          onExecuteMapActions(runnable);
        }

        // Persist Spark-fallback AI reply card in Firestore when backend Admin SDK isn't configured locally
        if (!agentRes.persisted_to_firestore && agentRes.answer?.trim()) {
          const actionsJson = serializeCompactMapActions(runnable);
          const aiPayload: Record<string, unknown> = {
            channel: activeChannel,
            tenantUid: tenantForPost,
            senderUid: profile.uid,
            senderName: "もちまも (AI防災エージェント)",
            senderRole: profile.role,
            senderOrg: "QuakeLens 防災AI",
            wardName: wardLabel,
            replyKind: "ai_proxy",
            text: agentRes.answer.trim().slice(0, 1450),
            createdAt: serverTimestamp(),
          };
          if (actionsJson) {
            aiPayload.mapActionsJson = actionsJson;
          }
          await addDoc(collection(db, "board_chat_messages"), aiPayload);
        }
      } catch (err) {
        setChatError(
          err instanceof Error
            ? `もちまも応答エラー: ${err.message}`
            : "もちまもエージェントの応答に失敗しました。"
        );
      } finally {
        setAgentThinking(false);
      }
    }
  };

  const handleDeleteMessage = async (msg: BoardChatMessage) => {
    if (!db || !profile) return;
    if (msg.senderUid !== profile.uid && profile.role !== "government") return;
    setDeletingId(msg.id);
    setChatError(null);
    try {
      await deleteDoc(doc(db, "board_chat_messages", msg.id));
    } catch (err) {
      setChatError(
        err instanceof Error
          ? mapFirestoreChatError(err)
          : "メッセージの削除に失敗しました。"
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (!db || !profile || !firebaseUser) {
    return (
      <div
        data-testid="board-chat-unauthenticated"
        className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-300"
      >
        リアルタイム災害チャットを利用するには、Firebase 認証でログインしてください。
      </div>
    );
  }

  const channelMeta = CHANNEL_META[activeChannel];

  return (
    <div data-testid="board-chat-panel" className="flex flex-col gap-2.5">
      {/* Role-based Channel Switcher */}
      <div
        className={`grid gap-1 rounded-xl border border-slate-800 bg-slate-950/70 p-1 text-[11px] ${
          availableChannels.length === 3
            ? "grid-cols-3"
            : availableChannels.length === 2
              ? "grid-cols-2"
              : "grid-cols-1"
        }`}
      >
        {availableChannels.map((ch) => {
          const meta = CHANNEL_META[ch];
          const active = activeChannel === ch;
          return (
            <button
              key={ch}
              type="button"
              data-testid={`chat-channel-${ch}`}
              onClick={() => setChannel(ch)}
              className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 font-semibold transition ${
                active
                  ? meta.activeClass
                  : `border-transparent ${meta.pillClass}`
              }`}
            >
              {ch === "public" && <Users className="h-3 w-3 shrink-0" />}
              {ch === "enterprise_liaison" && (
                <Building2 className="h-3 w-3 shrink-0" />
              )}
              {ch === "government" && <Landmark className="h-3 w-3 shrink-0" />}
              <span className="truncate">{meta.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Channel Security & Scope Banner */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/75 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-white">
            {activeChannel === "public" ? (
              <MessageCircle className="h-3.5 w-3.5 text-sky-400" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-amber-300" />
            )}
            <span>{channelMeta.label}</span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300">
            <ShieldCheck className="h-3 w-3 text-emerald-400" />
            @もちまも AI連携対応
          </span>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          {channelMeta.description}
        </p>

        {/* Public Ward Filter */}
        {activeChannel === "public" && (
          <div className="mt-2 flex items-center gap-2 border-t border-slate-800/80 pt-2">
            <label
              htmlFor="chat-ward-select"
              className="shrink-0 text-[10px] font-semibold text-slate-400"
            >
              チャンネル区域:
            </label>
            <select
              id="chat-ward-select"
              data-testid="chat-ward-select"
              value={activeWard}
              onChange={(e) => setWardOverride(e.target.value)}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-white outline-none focus:border-sky-500"
            >
              <option value="all">京都市 全域 (共通部屋)</option>
              {KYOTO_WARDS.map((w) => (
                <option key={w} value={w}>
                  {w} チャンネル
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Government B2G Target Enterprise Selector */}
        {activeChannel === "enterprise_liaison" &&
          profile.role === "government" && (
            <div className="mt-2 space-y-1.5 border-t border-slate-800/80 pt-2">
              {enterpriseThreads.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-emerald-300">
                    返信先企業:
                  </span>
                  <select
                    aria-label="返信先企業スレッド"
                    data-testid="chat-enterprise-thread-select"
                    value={resolvedTenantUid}
                    onChange={(e) => setSelectedTenantUid(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-emerald-500/40 bg-slate-900 px-2 py-1 text-[11px] text-emerald-100 outline-none focus:border-emerald-400"
                  >
                    {enterpriseThreads.map((t) => (
                      <option key={t.tenantUid} value={t.tenantUid}>
                        {t.orgLabel} ({t.count}件)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setFilterSelectedThread((v) => !v)}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
                      filterSelectedThread
                        ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-100"
                        : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {filterSelectedThread ? "選択企業のみ" : "全企業を表示"}
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-200/90">
                  企業アカウントからの行政連携メッセージを受信すると、企業別スレッドが選択可能になります。
                </p>
              )}
            </div>
          )}
      </div>

      {/* Error Alert */}
      {chatError && (
        <div
          role="alert"
          data-testid="board-chat-error"
          className="rounded-xl border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-[11px] leading-relaxed text-rose-200"
        >
          {chatError}
        </div>
      )}

      {/* Message Stream */}
      <div
        data-testid="board-chat-messages"
        className="flex max-h-[300px] min-h-[190px] flex-col gap-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-2.5"
      >
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-8 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
            チャット履歴を読み込み中...
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center text-xs text-slate-400">
            <MessageCircle className="h-5 w-5 text-slate-600" />
            <span>このチャンネルにはまだ投稿がありません。</span>
            <span className="text-[10px] text-slate-500">
              {activeChannel === "public"
                ? "「@もちまも 京都駅から安全な避難先へナビして」のようにAIへ直接依頼もできます。"
                : activeChannel === "enterprise_liaison"
                  ? "BCP拠点被害や行政への支援要請を秘匿送信できます。"
                  : "政府・自治体間の運用連絡を送信できます。"}
            </span>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isAiMsg =
              msg.senderRole === "assistant" ||
              msg.replyKind === "ai_proxy" ||
              msg.replyKind === "assistant";
            const isMine = !isAiMsg && msg.senderUid === profile.uid;
            const canDelete =
              msg.senderUid === profile.uid || profile.role === "government";
            const rMeta =
              msg.senderRole === "assistant"
                ? {
                    shortLabel: "もちまも AI",
                    badgeClass:
                      "bg-emerald-500/20 text-emerald-200 border-emerald-400/50",
                  }
                : ROLE_META[msg.senderRole];
            const runnableMapActions = (msg.mapActions || []).filter(
              (a) => a.type !== "download_export"
            );

            return (
              <div
                key={msg.id}
                data-testid={`chat-message-${msg.id}`}
                className={`rounded-xl border px-3 py-2 text-xs transition ${
                  isAiMsg
                    ? "mr-2 border-emerald-500/45 bg-emerald-950/35"
                    : isMine
                      ? "ml-4 border-sky-500/35 bg-sky-950/35"
                      : "mr-4 border-slate-800 bg-slate-900/80"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold ${
                        isAiMsg
                          ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                          : rMeta.badgeClass
                      }`}
                    >
                      {isAiMsg && <Bot className="h-2.5 w-2.5" />}
                      {isAiMsg ? "もちまも AI" : rMeta.shortLabel}
                    </span>
                    <span className="truncate font-semibold text-white">
                      {msg.senderName}
                    </span>
                    {msg.senderOrg && !isAiMsg && (
                      <span className="truncate text-[10px] text-slate-400">
                        ({msg.senderOrg})
                      </span>
                    )}
                    {activeChannel === "public" && msg.wardName && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300">
                        {msg.wardName}
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="font-mono text-[10px] text-slate-500">
                      {formatChatTime(msg.createdAtMs)}
                    </span>
                    {activeChannel === "enterprise_liaison" &&
                      profile.role === "government" &&
                      msg.tenantUid &&
                      msg.tenantUid !== resolvedTenantUid && (
                        <button
                          type="button"
                          onClick={() => setSelectedTenantUid(msg.tenantUid)}
                          className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-200 hover:bg-emerald-500/30"
                        >
                          返信対象に選択
                        </button>
                      )}
                    {canDelete && (
                      <button
                        type="button"
                        aria-label="メッセージを削除"
                        disabled={deletingId === msg.id}
                        onClick={() => void handleDeleteMessage(msg)}
                        className="rounded p-1 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-50"
                      >
                        {deletingId === msg.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-100">
                  {msg.text}
                </p>

                {runnableMapActions.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-emerald-500/25 pt-1.5">
                    <button
                      type="button"
                      data-testid="board-chat-apply-map"
                      onClick={() => handleApplyMessageActions(runnableMapActions)}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-2.5 py-1 text-[10.5px] font-bold text-emerald-100 transition hover:bg-emerald-500/35"
                    >
                      <MapPin className="h-3 w-3 text-emerald-300" />
                      地図にルート・ピンを表示 ({runnableMapActions.length}操作)
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {agentThinking && (
          <div
            data-testid="board-chat-agent-thinking"
            className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-200"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300" />
            <span>
              もちまも（AI防災エージェント）が会話履歴とハザード・通行止め状況を確認し、案内と地図操作を準備中です...
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick @もちまも Mention Helper */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
        <button
          type="button"
          data-testid="insert-mochimamo-mention"
          onClick={() =>
            setDraft((prev) =>
              MENTION_PATTERN.test(prev)
                ? prev
                : `@もちまも ${prev}`.trimStart()
            )
          }
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
        >
          <Sparkles className="h-3 w-3 text-emerald-300" />
          @もちまも を挿入
        </button>
        <span className="text-slate-400">
          例: <code className="text-sky-300">@もちまも Bさんに安全な場所までナビゲーションをして</code>
        </span>
      </div>

      {/* Composer */}
      <form onSubmit={(e) => void handleSend(e)} className="flex flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            maxLength={MAX_CHAT_LENGTH}
            data-testid="board-chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (canSend) {
                  void handleSend();
                }
              }
            }}
            placeholder={
              activeChannel === "public"
                ? `${activeWard === "all" ? "京都市全域" : activeWard} へ送信 / 「@もちまも 〜」でAIに避難ナビ等を依頼`
                : activeChannel === "enterprise_liaison"
                  ? profile.role === "government"
                    ? resolvedTenantUid
                      ? "選択中の企業へ指示・連絡を送信..."
                      : "企業からのメッセージ待機中..."
                    : "政府・行政機関へ秘匿連携メッセージを送信..."
                  : "認証済み政府・自治体関係者へ指令連絡を送信..."
            }
            className="flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            data-testid="board-chat-send"
            disabled={!canSend}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 text-xs font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            送信
          </button>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>
            送信者: {profile.display_name} ({ROLE_META[profile.role].shortLabel})
          </span>
          <span className="font-mono">
            {draft.length}/{MAX_CHAT_LENGTH}
          </span>
        </div>
      </form>
    </div>
  );
}
