"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  Wrench,
  AlertCircle,
  MapPin,
  RotateCcw,
  KeyRound,
  Square,
  ChevronDown,
  ChevronRight,
  Compass,
  CheckCircle2,
  Shield,
} from "lucide-react";
import { sendChatMessage, streamChatMessage } from "@/lib/api";
import { MarkdownLite } from "@/components/MarkdownLite";
import {
  AgeCategory,
  AiProtectionStatus,
  BuildingDetail,
  HazardTier,
  MapAction,
  MeshDetail,
  ToolCallTrace,
  UsageGroup,
} from "@/types/quakelens";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallTrace[];
  mapActions?: MapAction[];
  configured?: boolean;
  model?: string | null;
  streaming?: boolean;
  statusMessage?: string;
}

interface AiAssistantPanelProps {
  geminiConfigured: boolean;
  aiProtection?: AiProtectionStatus | null;
  onRefreshHealth?: () => void;
  selectedWard: string;
  ageCategories: AgeCategory[];
  hazardTiers: HazardTier[];
  usageGroup: UsageGroup;
  is3D: boolean;
  selectedBuilding: BuildingDetail | null;
  selectedMesh: MeshDetail | null;
  queuedPrompt: { text: string; ts: number } | null;
  onConsumeQueuedPrompt: () => void;
  onExecuteMapAction: (action: MapAction) => void;
}

const DEMO_PROMPTS = [
  "この地域には1981年以前の古い建物が何棟ありますか？",
  "伏見区と東山区で地震ハザードや古い建物の分布を比較して",
  "1981年以前の建物が多い優先確認エリアを教えて",
  "この地図の数値（震度6弱+確率やARV）は何を意味していますか？",
  "京都市の耐震診断や補助制度はありますか？",
];

const INITIAL_MESSAGE: ChatTurn = {
  id: "welcome",
  role: "assistant",
  content:
    "**QuakeLens Japan 防災AIアシスタント**です。京都市のPLATEAU建物データ（513,815棟）とJ-SHIS 2024年版ハザード・地盤V4、気象庁地震情報を **Function Calling** でリアルタイム照会しながら解説します。\n\n上の「現在エリアをAI診断」または質問チップを押してみてください。",
};

type AiModelId = "gemini-3.5-flash-lite" | "gemini-4-hydrogen" | "gemini-4-argon";

export function AiAssistantPanel({
  geminiConfigured,
  aiProtection,
  onRefreshHealth,
  selectedWard,
  ageCategories,
  hazardTiers,
  usageGroup,
  is3D,
  selectedBuilding,
  selectedMesh,
  queuedPrompt,
  onConsumeQueuedPrompt,
  onExecuteMapAction,
}: AiAssistantPanelProps) {
  const [messages, setMessages] = useState<ChatTurn[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [model, setModel] = useState<AiModelId>("gemini-3.5-flash-lite");
  const [tempApiKey, setTempApiKey] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [showKeyBox, setShowKeyBox] = useState(false);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const handleReset = () => {
    abortRef.current?.abort();
    setSending(false);
    setInteractionId(null);
    setMessages([INITIAL_MESSAGE]);
  };

  const handleSend = useCallback(
    async (promptText?: string) => {
      const q = (promptText ?? input).trim();
      if (!q || sending) return;
      if (!promptText) setInput("");

      const userTurn: ChatTurn = {
        id: `u-${Date.now()}`,
        role: "user",
        content: q,
      };
      const assistantId = `a-${Date.now()}`;
      const assistantPlaceholder: ChatTurn = {
        id: assistantId,
        role: "assistant",
        content: "",
        toolCalls: [],
        mapActions: [],
        streaming: true,
        statusMessage: "実データ照会を準備中...",
      };

      setMessages((prev) => [...prev, userTurn, assistantPlaceholder]);
      setSending(true);

      const controller = new AbortController();
      abortRef.current = controller;
      const contextPayload = {
        ward: selectedWard,
        usage_group: usageGroup,
        age_categories: ageCategories,
        hazard_tiers: hazardTiers,
        selected_meshcode: selectedMesh?.meshcode ?? null,
        selected_building_id: selectedBuilding?.building_id ?? null,
        is_3d: is3D,
      };
      let receivedDone = false;

      try {
        await streamChatMessage(
          {
            message: q,
            context: contextPayload,
            previous_interaction_id: interactionId,
            model,
          },
          (ev) => {
            if (ev.type === "status") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, statusMessage: ev.message } : m))
              );
            } else if (ev.type === "tool_start") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, statusMessage: `${ev.name} で実データを照会中...` }
                    : m
                )
              );
            } else if (ev.type === "tool_result") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: [
                          ...(m.toolCalls || []),
                          {
                            name: ev.name,
                            arguments: ev.arguments,
                            summary: ev.summary,
                          },
                        ],
                      }
                    : m
                )
              );
            } else if (ev.type === "text_delta") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        statusMessage: undefined,
                        content: (m.content || "") + ev.delta,
                      }
                    : m
                )
              );
            } else if (ev.type === "done") {
              receivedDone = true;
              if (ev.interaction_id) setInteractionId(ev.interaction_id);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        streaming: false,
                        statusMessage: undefined,
                        configured: ev.configured,
                        content: ev.answer,
                        toolCalls: ev.tool_calls,
                        mapActions: ev.map_actions || [],
                        model: ev.model,
                      }
                    : m
                )
              );
            } else if (ev.type === "error") {
              receivedDone = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        streaming: false,
                        statusMessage: undefined,
                        content: `エラーが発生しました: ${ev.message}`,
                      }
                    : m
                )
              );
            }
          },
          tempApiKey,
          controller.signal,
          accessCode
        );

        if (receivedDone) {
          onRefreshHealth?.();
        } else if (!controller.signal.aborted) {
          throw new Error("ストリーミング応答が完了前に終了しました");
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                    statusMessage: undefined,
                    content: (m.content || "") + "\n\n（生成を停止しました）",
                  }
                : m
            )
          );
        } else if (!receivedDone) {
          const initialMsg = err instanceof Error ? err.message : "";
          const isGuardRejection =
            initialMsg.includes("アクセスコード") ||
            initialMsg.includes("上限") ||
            initialMsg.includes("制限") ||
            initialMsg.includes("長すぎ") ||
            initialMsg.includes("混み合って");
          if (initialMsg.includes("アクセスコード") || initialMsg.includes("ご自身の Gemini API キー")) {
            setShowKeyBox(true);
          }

          if (isGuardRejection) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      streaming: false,
                      statusMessage: undefined,
                      content: `リクエスト制限: ${initialMsg}`,
                    }
                  : m
              )
            );
          } else {
            // Automatic fallback to unary /api/chat if streaming transport drops (e.g. Safari "Load failed")
            try {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, statusMessage: "通常通信にフォールバックして再試行中..." }
                    : m
                )
              );
              const res = await sendChatMessage(
                {
                  message: q,
                  context: contextPayload,
                  previous_interaction_id: interactionId,
                  model,
                },
                tempApiKey,
                accessCode
              );
              if (res.interaction_id) setInteractionId(res.interaction_id);
              onRefreshHealth?.();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        streaming: false,
                        statusMessage: undefined,
                        configured: res.configured,
                        content: res.answer,
                        toolCalls: res.tool_calls,
                        mapActions: res.map_actions || [],
                        model: res.model,
                      }
                    : m
                )
              );
            } catch (fallbackErr) {
              const rawMsg =
                fallbackErr instanceof Error
                  ? fallbackErr.message
                  : err instanceof Error
                    ? err.message
                    : "通信エラー";
              const hint =
                rawMsg === "Load failed" || rawMsg === "Failed to fetch"
                  ? `${rawMsg}（バックエンドとの通信がタイムアウトまたは中断されました。高速な Gemini 3.5 Flash-Lite をお試しいただくか、バックエンド起動状態をご確認ください）`
                  : rawMsg;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        streaming: false,
                        statusMessage: undefined,
                        content: `エラーが発生しました: ${hint}`,
                      }
                    : m
                )
              );
            }
          }
        }
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    [
      input,
      sending,
      selectedWard,
      usageGroup,
      ageCategories,
      hazardTiers,
      selectedMesh?.meshcode,
      selectedBuilding?.building_id,
      is3D,
      interactionId,
      model,
      tempApiKey,
      accessCode,
      onRefreshHealth,
    ]
  );

  // Trigger external prompt (e.g. from "この建物をAIで解説" button in Detail tab)
  useEffect(() => {
    if (!queuedPrompt) return;
    const text = queuedPrompt.text;
    const timer = window.setTimeout(() => {
      onConsumeQueuedPrompt();
      void handleSend(text);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queuedPrompt, onConsumeQueuedPrompt, handleSend]);

  const handleBriefing = () => {
    if (selectedBuilding) {
      handleSend(
        `現在選択中の建物（${selectedBuilding.building_id}）の築年・構造・地盤・地震ハザード（T30_I55_PS・ARV）の特徴と、確認すべき防災上のポイント・利用可能な京都市の補助制度を教えてください。`
      );
    } else if (selectedMesh) {
      handleSend(
        `現在選択中の250mメッシュ（${selectedMesh.meshcode} / ${selectedMesh.ward_name}）の建物築年構成・判明率・地盤・地震ハザードの特徴を分析し、優先確認ポイントを解説してください。`
      );
    } else if (selectedWard !== "all") {
      handleSend(
        `現在表示中の「京都市 ${selectedWard}」について、1981年以前建物の割合・建築年不明率・高ハザードエリアとの重なり・特に注意すべき250mメッシュをまとめて解説してください。`
      );
    } else {
      handleSend(
        "京都市全域の建物築年分布（1981年以前・不明率）とJ-SHIS地震ハザードの特徴、特に優先確認すべき区・250mメッシュを分かりやすく解説してください。"
      );
    }
  };

  const hasOwnKey = Boolean(tempApiKey.trim());
  const hasAnyKey = geminiConfigured || hasOwnKey;
  const premiumAllowed = hasOwnKey || Boolean(aiProtection?.premium_models_allowed);
  const accessCodeRequired = Boolean(aiProtection?.access_code_required) && !hasOwnKey;
  const maxMessageChars = aiProtection?.max_message_chars ?? 1200;

  return (
    <div className="flex h-full flex-col">
      {/* Top AI Controls & Context Strip */}
      <div className="mb-2.5 space-y-2 rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <select
              value={premiumAllowed ? model : "gemini-3.5-flash-lite"}
              onChange={(e) => setModel(e.target.value as AiModelId)}
              aria-label="Geminiモデル選択"
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-medium text-emerald-300 focus:border-emerald-500 focus:outline-none"
            >
              <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite（高速・標準）</option>
              <option value="gemini-4-hydrogen" disabled={!premiumAllowed}>
                Gemini 4 Hydrogen{!premiumAllowed ? "（要個人APIキー）" : "（高精度・じっくり）"}
              </option>
              <option value="gemini-4-argon" disabled={!premiumAllowed}>
                Gemini 4 Argon{!premiumAllowed ? "（要個人APIキー）" : "（深層推論）"}
              </option>
            </select>
            <button
              type="button"
              onClick={() => setShowKeyBox((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition ${
                !hasAnyKey || (accessCodeRequired && !accessCode.trim())
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
              }`}
              title="個人APIキー（BYOK）やアクセスコードを設定"
            >
              <KeyRound className="h-3 w-3" />
              {hasOwnKey ? "個人キー使用中" : accessCodeRequired ? "認証/キー設定" : "APIキー設定"}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={sending}
              onClick={handleBriefing}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600/90 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Compass className="h-3 w-3" />
              現在エリアをAI診断
            </button>
            <button
              type="button"
              onClick={handleReset}
              title="会話をリセット"
              className="rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-400 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Active Map Context & API Protection Pills */}
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
          <span>参照コンテキスト:</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-sky-300">
            {selectedWard === "all" ? "京都市全域" : selectedWard}
          </span>
          {selectedMesh && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-fuchsia-300">
              メッシュ {selectedMesh.meshcode}
            </span>
          )}
          {selectedBuilding && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-amber-300">
              建物 {selectedBuilding.building_id}
            </span>
          )}
          {is3D && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-amber-200">3D表示中</span>
          )}
          {aiProtection && geminiConfigured && !hasOwnKey && (
            <span
              className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300"
              title={`1分あたり${aiProtection.per_minute_limit}回制限 / 本日の残り共用リクエスト枠`}
            >
              <Shield className="h-2.5 w-2.5" />
              残枠 {aiProtection.daily_remaining}/{aiProtection.daily_limit}
            </span>
          )}
        </div>

        {showKeyBox && (
          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-slate-900 p-2 text-[10px]">
            {aiProtection?.access_code_required && !hasOwnKey && (
              <div>
                <div className="mb-1 text-sky-200">
                  公開サーバー用アクセスコード（`X-Ai-Access-Code`・メモリのみ保持）
                </div>
                <input
                  type="password"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="アクセスコードを入力..."
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
            )}
            <div>
              <div className="mb-1 text-amber-200">
                ご自身の Gemini API キー（BYOK・ブラウザメモリ上のみ保持／制限回避・全モデル利用可）
              </div>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="AIza..."
                  className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKeyBox(false)}
                  className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Suggested question chips */}
      <div className="mb-2.5 flex flex-wrap gap-1">
        {DEMO_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={sending}
            onClick={() => handleSend(p)}
            className="rounded-full border border-slate-700/80 bg-slate-950/80 px-2.5 py-1 text-left text-[10px] text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200 disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Chat stream */}
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((m) => {
          const traceOpen = Boolean(expandedTraces[m.id]);
          return (
            <div
              key={m.id}
              className={`rounded-xl p-3 ${
                m.role === "user"
                  ? "ml-6 border border-sky-500/30 bg-sky-500/15 text-xs text-sky-100"
                  : "mr-1 border border-slate-800 bg-slate-950/85"
              }`}
            >
              {m.role === "user" ? (
                <p>{m.content}</p>
              ) : (
                <>
                  {m.configured === false && (
                    <div className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>実データ集計プレビュー（APIキー未設定モード）</span>
                    </div>
                  )}

                  {m.streaming && m.statusMessage && (
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-300">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{m.statusMessage}</span>
                    </div>
                  )}

                  {m.content ? (
                    <MarkdownLite text={m.content} />
                  ) : (
                    m.streaming && (
                      <div className="text-[11px] text-slate-400">回答を生成しています...</div>
                    )
                  )}

                  {/* Clickable Map Action Chips */}
                  {m.mapActions && m.mapActions.length > 0 && (
                    <div className="mt-2.5 border-t border-slate-800/80 pt-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-sky-300">
                        <MapPin className="h-3 w-3" />
                        <span>地図で確認（クリックで移動）:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.mapActions.map((act) => (
                          <button
                            key={act.key}
                            type="button"
                            onClick={() => onExecuteMapAction(act)}
                            className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20"
                          >
                            <MapPin className="h-2.5 w-2.5 shrink-0 text-sky-400" />
                            <span>{act.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Collapsible Function Calling Provenance */}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="mt-2.5 border-t border-slate-800/80 pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTraces((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
                        }
                        className="flex w-full items-center justify-between text-[10px] text-slate-400 hover:text-emerald-300"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Wrench className="h-3 w-3 text-emerald-400" />
                          <span>
                            参照データ根拠（Function Calling {m.toolCalls.length}件
                            {m.model ? ` / ${m.model}` : ""}）
                          </span>
                        </span>
                        {traceOpen ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </button>

                      {!traceOpen ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m.toolCalls.map((tc, tIdx) => (
                            <span
                              key={tIdx}
                              className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300"
                            >
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              {tc.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1.5 space-y-1.5">
                          {m.toolCalls.map((tc, tIdx) => (
                            <div
                              key={tIdx}
                              className="rounded-lg border border-slate-800 bg-slate-900/80 p-2 text-[10px]"
                            >
                              <div className="font-mono font-semibold text-emerald-300">
                                {tc.name}({JSON.stringify(tc.arguments)})
                              </div>
                              {tc.summary && (
                                <div className="mt-0.5 text-slate-300">{tc.summary}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Chat input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="mt-2.5 flex gap-2 border-t border-slate-800 pt-2.5"
      >
        <input
          type="text"
          value={input}
          maxLength={maxMessageChars}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`京都市の建物・ハザードについて質問（最大${maxMessageChars}文字）...`}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        {sending ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-500"
            title="生成を停止"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500">
        <Sparkles className="h-3 w-3 text-emerald-500" />
        <span>AIの回答はPLATEAU・J-SHIS実測値に基づき生成されます（倒壊予測ではありません）</span>
      </div>
    </div>
  );
}
