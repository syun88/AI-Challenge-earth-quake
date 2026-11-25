"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  Wrench,
  AlertCircle,
  AlertTriangle,
  MapPin,
  RotateCcw,
  KeyRound,
  Square,
  ChevronDown,
  ChevronRight,
  Compass,
  CheckCircle2,
  Shield,
  Download,
  FileSpreadsheet,
  Volume2,
} from "lucide-react";
import { downloadAuthenticatedFile, sendChatMessage, streamChatMessage } from "@/lib/api";
import { useMochimamoVoice } from "@/lib/useMochimamoVoice";
import { MarkdownLite } from "@/components/MarkdownLite";
import { MochimamoChatStage } from "@/components/MochimamoChatStage";
import { MochimamoMood } from "@/components/MochimamoLive2D";
import {
  AgeCategory,
  AiProtectionStatus,
  BuildingDetail,
  GroundingVerification,
  HazardTier,
  MapAction,
  MeshDetail,
  ToolCallTrace,
  UsageGroup,
  UserRole,
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
  incomplete?: boolean;
  aborted?: boolean;
  error?: string;
  verification?: GroundingVerification;
}

interface AiAssistantPanelProps {
  userRole?: UserRole;
  geminiConfigured: boolean;
  aiProtection?: AiProtectionStatus | null;
  totalBuildings?: number | null;
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
  onExecuteMapActionsBatch?: (actions: MapAction[]) => void;
}

const ROLE_PROMPTS: Record<UserRole, string[]> = {
  citizen: [
    "京都駅から通行止めを回避した安全な避難先までナビして地図にピンを立てて",
    "中京区の安全な指定緊急避難場所を教えて",
    "道路損壊・通行止めが報告されている地域は？",
    "伏見区と東山区で地震ハザードや古い建物の分布を比較して",
    "現在の地域の耐震診断や補助制度について教えて",
  ],
  enterprise: [
    "BCP代替拠点を置く際に避けるべき高リスクエリアを教えて（ピン表示もして）",
    "京都市内でサーバー室・データセンターに適した低リスク候補地は？",
    "自社の登録拠点のリスク状況と周辺通行止めを診断して",
    "道路損壊・通行止めが報告されている主要幹線周辺は？",
    "R8市有耐震リストの区ごとの耐震化状況と周辺建物リスクを教えて",
  ],
  government: [
    "伏見区の現在の被害報告（救助要請含む）と建物リスクをまとめて",
    "緊急時共有に設定された企業拠点のリスク状況を確認して",
    "道路損壊・通行止めが報告されている地域は？",
    "現在の地域の災害状況をCSVにまとめて",
    "1981年以前の建物が多い優先確認エリアを地図で確認して",
  ],
};

function buildWelcomeText(totalBuildings?: number | null): string {
  const countLabel =
    totalBuildings && totalBuildings > 0
      ? `（${totalBuildings.toLocaleString("ja-JP")}棟）`
      : "";
  return `**QuakeLens Japan 統合防災AIアシスタント「もちまも」**です。京都市のPLATEAU建物データ${countLabel}・J-SHIS 2024ハザード・**指定緊急避難場所（514件）**に加え、**災害用伝言板（安否）**と**被害状況報告**を **Function Calling** で横断分析します。\n\n※ 市民投稿は「未確認情報」、訓練データは「訓練サンプル」として区別して集計し、CSV／Excel出力にも対応します。`;
}

function deriveMascotState(params: {
  sending: boolean;
  audioPlaying: boolean;
  justCompleted: boolean;
  inputText: string;
  selectedWard: string;
  lastAssistant?: ChatTurn;
}): { mood: MochimamoMood; statusText: string } {
  const { sending, audioPlaying, justCompleted, inputText, selectedWard, lastAssistant } = params;
  if (audioPlaying) {
    return {
      mood: "speaking",
      statusText: "音声でご案内しています…",
    };
  }
  if (sending) {
    if (lastAssistant?.streaming && lastAssistant.content.trim().length > 0) {
      return {
        mood: "thinking",
        statusText: "回答をまとめています…",
      };
    }
    return {
      mood: "thinking",
      statusText: lastAssistant?.statusMessage || "京都市の防災データを照会・分析中…",
    };
  }
  if (lastAssistant?.error) {
    return {
      mood: "alert",
      statusText: "通信または設定の確認が必要です。メッセージをご確認ください。",
    };
  }
  if (lastAssistant?.verification?.contains_unverified_reports && messagesHaveResponse(lastAssistant)) {
    return {
      mood: "alert",
      statusText: "未確認の市民報告を含む集計です。参考情報としてご確認ください。",
    };
  }
  if (justCompleted) {
    return {
      mood: "happy",
      statusText: "分析が完了しました！地図ボタンやCSV出力もご活用ください。",
    };
  }
  if (inputText.trim().length > 0) {
    return {
      mood: "listening",
      statusText: "ご質問を聞いています。送信ボタンを押してくださいね！",
    };
  }
  return {
    mood: "idle",
    statusText:
      selectedWard === "all"
        ? "京都市全域（11区）を見守り中。下の質問チップからすぐ試せます！"
        : `${selectedWard} を注目中！「現在エリアをAI診断」でもすぐ分析できます。`,
  };
}

function messagesHaveResponse(turn?: ChatTurn): boolean {
  return Boolean(turn && turn.id !== "welcome" && !turn.streaming && turn.content.trim().length > 0);
}

const INITIAL_MESSAGE: ChatTurn = {
  id: "welcome",
  role: "assistant",
  content: "",
};

type AiModelId = "gemini-3.5-flash-lite" | "gemini-4-hydrogen" | "gemini-4-argon";

export function AiAssistantPanel({
  userRole = "citizen",
  geminiConfigured,
  aiProtection,
  totalBuildings,
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
  onExecuteMapActionsBatch,
}: AiAssistantPanelProps) {
  const demoPrompts = ROLE_PROMPTS[userRole] || ROLE_PROMPTS.citizen;
  const [messages, setMessages] = useState<ChatTurn[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [autoAgentMap, setAutoAgentMap] = useState(true);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [model, setModel] = useState<AiModelId>("gemini-3.5-flash-lite");
  const [tempApiKey, setTempApiKey] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [showKeyBox, setShowKeyBox] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const [justCompleted, setJustCompleted] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const completedTimerRef = useRef<number | null>(null);

  const {
    muted,
    audioLoading,
    audioPlaying,
    playingMessageId,
    audioError,
    audioLevelRef,
    unlockAudio,
    toggleMute,
    stopAudio,
    speakText,
    clearAudioError,
  } = useMochimamoVoice();

  useEffect(() => {
    return () => {
      if (completedTimerRef.current !== null) {
        window.clearTimeout(completedTimerRef.current);
      }
    };
  }, []);

  const triggerHappyCompletion = useCallback(() => {
    if (completedTimerRef.current !== null) {
      window.clearTimeout(completedTimerRef.current);
    }
    setJustCompleted(true);
    completedTimerRef.current = window.setTimeout(() => {
      setJustCompleted(false);
      completedTimerRef.current = null;
    }, 3600);
  }, []);

  useEffect(() => {
    if (messages.length > 1 || sending) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sending]);

  const handleReset = () => {
    abortRef.current?.abort();
    stopAudio();
    setSending(false);
    setInteractionId(null);
    setMessages([INITIAL_MESSAGE]);
  };

  const handleSend = useCallback(
    async (promptText?: string) => {
      const q = (promptText ?? input).trim();
      if (!q || sending) return;
      if (!promptText) setInput("");
      unlockAudio();
      stopAudio();

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
      setJustCompleted(false);
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
      let receivedTerminal = false;
      let receivedSuccessDone = false;
      let completedAnswer = "";
      let completedConfigured = false;
      let completedMapActions: MapAction[] = [];

      const applyAutoMapActions = (actions?: MapAction[]) => {
        if (!autoAgentMap || !actions || actions.length === 0) return;
        const runnable = actions.filter((a) => a.type !== "download_export");
        if (runnable.length === 0) return;
        if (onExecuteMapActionsBatch) {
          onExecuteMapActionsBatch(runnable);
        } else {
          runnable.forEach((a) => onExecuteMapAction(a));
        }
      };

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
            } else if (ev.type === "reset_draft") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: "" } : m))
              );
            } else if (ev.type === "verification") {
              const verificationPayload: GroundingVerification = {
                status: ev.status,
                tool_count: ev.tool_count,
                checked_claims_count: ev.checked_claims_count,
                verified_claims: ev.verified_claims,
                unverified_claims: ev.unverified_claims,
                unverified_urls: ev.unverified_urls,
                note: ev.note,
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, verification: verificationPayload } : m
                )
              );
            } else if (ev.type === "done") {
              receivedTerminal = true;
              receivedSuccessDone = true;
              completedAnswer = ev.answer || "";
              completedConfigured = ev.configured !== false;
              completedMapActions = ev.map_actions || [];
              if (!ev.incomplete && ev.interaction_id) {
                setInteractionId(ev.interaction_id);
              }
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
                        incomplete: Boolean(ev.incomplete),
                        verification: ev.verification ?? m.verification,
                        error: undefined,
                      }
                    : m
                )
              );
            } else if (ev.type === "error") {
              receivedTerminal = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        streaming: false,
                        statusMessage: undefined,
                        error: ev.message,
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

        if (receivedSuccessDone) {
          onRefreshHealth?.();
          triggerHappyCompletion();
          applyAutoMapActions(completedMapActions);
          if (completedConfigured && completedAnswer.trim()) {
            void speakText(assistantId, completedAnswer, {
              apiKey: tempApiKey,
              accessCode,
            });
          }
        } else if (!receivedTerminal && !controller.signal.aborted) {
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
                    aborted: true,
                  }
                : m
            )
          );
        } else if (!receivedTerminal) {
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
                      error: initialMsg,
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
              if (!res.incomplete && res.interaction_id) {
                setInteractionId(res.interaction_id);
              }
              onRefreshHealth?.();
              triggerHappyCompletion();
              applyAutoMapActions(res.map_actions);
              if (res.configured !== false && res.answer.trim()) {
                void speakText(assistantId, res.answer, {
                  apiKey: tempApiKey,
                  accessCode,
                });
              }
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
                        incomplete: Boolean(res.incomplete),
                        verification: res.verification,
                        error: undefined,
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
                        error: hint,
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
      autoAgentMap,
      onExecuteMapAction,
      onExecuteMapActionsBatch,
      onRefreshHealth,
      triggerHappyCompletion,
      unlockAudio,
      stopAudio,
      speakText,
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

  let lastAssistant: ChatTurn | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistant = messages[i];
      break;
    }
  }
  const mascotState = deriveMascotState({
    sending,
    audioPlaying,
    justCompleted,
    inputText: input,
    selectedWard,
    lastAssistant,
  });

  return (
    <div className="flex h-full flex-col p-3">
      {/* Live2D Mascot Stage synced with ChatBot state & Gemini TTS */}
      <MochimamoChatStage
        mood={mascotState.mood}
        statusText={mascotState.statusText}
        speechPulseKey={0}
        selectedWard={selectedWard}
        muted={muted}
        onToggleMute={toggleMute}
        audioLoading={audioLoading}
        audioPlaying={audioPlaying}
        audioLevelRef={audioLevelRef}
        audioError={audioError}
        onClearAudioError={clearAudioError}
      />

      {/* Top AI Controls & Context Strip */}
      <div className="mb-2 space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-2">
        <div className="flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <select
              value={premiumAllowed ? model : "gemini-3.5-flash-lite"}
              onChange={(e) => setModel(e.target.value as AiModelId)}
              aria-label="Geminiモデル選択"
              className="max-w-[144px] truncate rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] font-medium text-emerald-300 focus:border-emerald-500 focus:outline-none"
            >
              <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite</option>
              <option value="gemini-4-hydrogen" disabled={!premiumAllowed}>
                Gemini 4 Hydrogen{!premiumAllowed ? "（要キー）" : ""}
              </option>
              <option value="gemini-4-argon" disabled={!premiumAllowed}>
                Gemini 4 Argon{!premiumAllowed ? "（要キー）" : ""}
              </option>
            </select>
            <button
              type="button"
              onClick={() => setShowKeyBox((v) => !v)}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-1 text-[10px] font-medium transition ${
                !hasAnyKey || (accessCodeRequired && !accessCode.trim())
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
              }`}
              title="個人APIキー（BYOK）やアクセスコードを設定"
            >
              <KeyRound className="h-3 w-3" />
              {hasOwnKey ? "個人キー" : accessCodeRequired ? "認証/キー" : "キー"}
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={sending}
              onClick={handleBriefing}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600/90 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Compass className="h-3 w-3" />
              現在エリア診断
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
          <span>参照:</span>
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
          <button
            type="button"
            data-testid="toggle-auto-agent-map"
            onClick={() => setAutoAgentMap((v) => !v)}
            title="AI回答時に推奨地点ピン・避難ルート・カメラ移動を自動で地図へ反映します"
            className={`ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition ${
              autoAgentMap
                ? "border-sky-400/60 bg-sky-500/15 text-sky-200"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            <MapPin className="h-2.5 w-2.5" />
            自律地図操作 {autoAgentMap ? "ON" : "OFF"}
          </button>
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

      {/* Chat stream */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
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

                  {(() => {
                    const displayText =
                      m.id === "welcome" ? buildWelcomeText(totalBuildings) : m.content;
                    const isThisPlaying = playingMessageId === m.id && (audioLoading || audioPlaying);
                    if (displayText) {
                      return (
                        <>
                          <MarkdownLite text={displayText} />
                          {!m.streaming && (
                            <div className="mt-2 flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                data-testid={`speak-msg-${m.id}`}
                                onClick={() => {
                                  if (isThisPlaying) {
                                    stopAudio();
                                    return;
                                  }
                                  void (async () => {
                                    const ok = await speakText(m.id, displayText, {
                                      apiKey: tempApiKey,
                                      accessCode,
                                      force: true,
                                    });
                                    if (!ok && !hasAnyKey) {
                                      setShowKeyBox(true);
                                    }
                                  })();
                                }}
                                title={
                                  !hasAnyKey
                                    ? "音声読み上げにはAPIキー設定が必要です"
                                    : isThisPlaying
                                      ? "読み上げを停止"
                                      : "もちまもに読み上げてもらう"
                                }
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                                  isThisPlaying
                                    ? "border-rose-500/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                                    : "border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-500/20"
                                }`}
                              >
                                {playingMessageId === m.id && audioLoading ? (
                                  <>
                                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                    <span>音声準備中</span>
                                  </>
                                ) : isThisPlaying ? (
                                  <>
                                    <Square className="h-2.5 w-2.5" />
                                    <span>停止</span>
                                  </>
                                ) : (
                                  <>
                                    <Volume2 className="h-2.5 w-2.5" />
                                    <span>読み上げ</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </>
                      );
                    }
                    if (m.streaming) {
                      return (
                        <div className="text-[11px] text-slate-400">回答を生成しています...</div>
                      );
                    }
                    return null;
                  })()}

                  {m.verification && !m.streaming && (
                    <div
                      className={`mt-2 rounded-md border px-2 py-1.5 text-[10px] ${
                        m.verification.status === "verified"
                          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                          : m.verification.status === "no_numeric_claims"
                            ? "border-slate-700 bg-slate-900/70 text-slate-300"
                            : "border-amber-500/50 bg-amber-500/10 text-amber-200"
                      }`}
                    >
                      <div className="flex items-start gap-1.5">
                        {m.verification.status === "verified" ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        ) : (
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                        )}
                        <div>
                          <div className="font-medium">{m.verification.note}</div>
                          {(m.verification.unverified_claims.length > 0 ||
                            m.verification.unverified_urls.length > 0) && (
                            <div className="mt-1 text-[10px] text-amber-300">
                              未照合項目:{" "}
                              {[
                                ...m.verification.unverified_claims,
                                ...m.verification.unverified_urls,
                              ].join(" / ")}
                            </div>
                          )}
                          {traceOpen && m.verification.verified_claims.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {m.verification.verified_claims.map((c) => (
                                <span
                                  key={c}
                                  className="rounded border border-emerald-500/30 bg-emerald-950/60 px-1 py-0.5 font-mono text-[9px] text-emerald-300"
                                >
                                  ✓ {c}
                                </span>
                              ))}
                            </div>
                          )}
                          {(m.verification.contains_unverified_reports ||
                            m.verification.contains_sample_data) && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px]">
                              {m.verification.contains_unverified_reports && (
                                <span className="inline-flex items-center gap-1 rounded border border-dashed border-amber-400/70 bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-200">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  未確認の市民報告を含むため参考情報としてご確認ください
                                </span>
                              )}
                              {m.verification.contains_sample_data && (
                                <span className="rounded border border-dotted border-slate-500 bg-slate-800 px-1.5 py-0.5 text-slate-300">
                                  訓練用サンプルを含む集計
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {m.incomplete && !m.streaming && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>出力トークン上限等により回答が途中で終了しました（未完了の可能性があります）</span>
                    </div>
                  )}

                  {m.aborted && !m.streaming && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>ユーザー操作により途中で生成を停止しました（未完了）</span>
                    </div>
                  )}

                  {m.error && !m.streaming && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                      <span>生成が途中で中断されました: {m.error}</span>
                    </div>
                  )}

                  {/* Clickable Map & Export Action Chips */}
                  {m.mapActions && m.mapActions.length > 0 && (
                    <div className="mt-2.5 border-t border-slate-800/80 pt-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-sky-300">
                        <MapPin className="h-3 w-3" />
                        <span>関連アクション（地図移動・データ出力）:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.mapActions.map((act) =>
                          act.type === "download_export" && act.url ? (
                            <button
                              key={act.key}
                              type="button"
                              onClick={() => {
                                void downloadAuthenticatedFile(
                                  act.url!,
                                  act.format === "xlsx"
                                    ? "quakelens_kyoto_summary.xlsx"
                                    : "quakelens_kyoto_overview.csv"
                                ).catch(() => {});
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
                            >
                              {act.format === "xlsx" ? (
                                <FileSpreadsheet className="h-3 w-3 shrink-0" />
                              ) : (
                                <Download className="h-3 w-3 shrink-0" />
                              )}
                              <span>{act.label}</span>
                            </button>
                          ) : (
                            <button
                              key={act.key}
                              type="button"
                              onClick={() => onExecuteMapAction(act)}
                              className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20"
                            >
                              <MapPin className="h-2.5 w-2.5 shrink-0 text-sky-400" />
                              <span>{act.label}</span>
                            </button>
                          )
                        )}
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

        {/* Suggested starter prompts shown inside scroll stream when idle or toggled */}
        {(messages.length === 1 || showPrompts) && (
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-slate-400">
              <span>質問例（クリックで送信）</span>
              {messages.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowPrompts(false)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  閉じる
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {demoPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    setShowPrompts(false);
                    void handleSend(p);
                  }}
                  className="rounded-full border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 text-left text-[10px] text-slate-200 transition hover:border-cyan-500/60 hover:bg-cyan-500/10 hover:text-cyan-100 disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Chat input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="mt-2 flex gap-1.5 border-t border-slate-800 pt-2"
      >
        {messages.length > 1 && (
          <button
            type="button"
            onClick={() => setShowPrompts((v) => !v)}
            title="質問例を表示"
            className={`shrink-0 rounded-lg border px-2 py-2 text-[10px] font-medium transition ${
              showPrompts
                ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-white"
            }`}
          >
            質問例
          </button>
        )}
        <input
          type="text"
          value={input}
          maxLength={maxMessageChars}
          onChange={(e) => setInput(e.target.value)}
          placeholder="京都市の建物・避難場所・災害状況を質問..."
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        {sending ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-500"
            title="生成を停止"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
        <Sparkles className="h-3 w-3 shrink-0 text-emerald-500" />
        <span className="truncate">
          PLATEAU・J-SHIS・国土地理院データに基づき回答（倒壊予測ではありません）
        </span>
      </div>
    </div>
  );
}
