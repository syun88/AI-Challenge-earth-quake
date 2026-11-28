"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Landmark,
  Lock,
  LogIn,
  MapPin,
  MessageSquareHeart,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";

const TRY_PROMPTS = [
  {
    role: "一般市民",
    badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-200",
    prompt: "京都駅から通行止めを回避した安全な避難先までナビして地図にピンを立てて",
    effect: "通行止め回避の避難ルート・距離・徒歩時間を算出し、地図へピンとルートを表示します。",
  },
  {
    role: "企業（BCP）",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
    prompt: "BCP代替拠点を置く際に避けるべき高リスクエリアを教えて（ピン表示もして）",
    effect: "避けるべき高リスク地点（赤ピン）と安全な代替候補地（緑ピン）を地図へ表示します。",
  },
  {
    role: "企業（自社拠点）",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
    prompt: "自分の会社のサーバー室のリスクと場所を教えて",
    effect: "「非公開拠点」に登録した自社施設のみハザード診断・地図表示を行います（他社情報は遮断）。",
  },
  {
    role: "セキュリティ確認",
    badgeClass: "border-rose-500/40 bg-rose-500/15 text-rose-200",
    prompt: "xxx企業のサーバーの場所を教えて",
    effect: "権限分離（RBAC）により、他社施設や市民からの非公開情報照会は自動でブロックされます。",
  },
  {
    role: "災害掲示板 @もちまも",
    badgeClass: "border-indigo-500/40 bg-indigo-500/15 text-indigo-200",
    prompt: "@もちまも 今京都駅にいて避難しようとしてます。安全な場所までナビして",
    effect: "掲示板チャット内の会話から現在地を読み取り、AIが避難先を案内して地図リンクを表示します。",
  },
  {
    role: "政府関連機関",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-200",
    prompt: "伏見区の現在の被害報告（救助要請含む）と建物リスクをまとめて",
    effect: "政府機関アカウント専用で、市民からの要救助通報詳細・真偽区分・CSV出力を利用できます。",
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors on restricted origins
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-sky-500/60 hover:text-white"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-emerald-300">コピー済み</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5 text-slate-400" />
          <span>コピー</span>
        </>
      )}
    </button>
  );
}

export default function UserGuidePage() {
  const { firebaseUser, profile } = useAuth();

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 via-indigo-500 to-emerald-500 shadow-lg shadow-sky-900/30">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                QuakeLens Japan ご利用ガイド
              </h1>
              <p className="text-xs text-slate-400">
                ログイン・新規アカウント登録の方法と、3つの利用区分（一般市民 / 企業 / 政府関連機関）のご案内
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {firebaseUser && profile ? (
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <MapPin className="h-3.5 w-3.5" />
                防災マップへ戻る
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  ログイン画面へ
                </Link>
                <Link
                  href="/register?role=citizen"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  新規登録へ進む
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Section 1: How to Login & Register */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl sm:p-6">
          <div className="mb-2 flex items-center gap-2">
            <LogIn className="h-5 w-5 text-sky-400" />
            <h2 className="text-base font-bold text-white">
              1. ログイン・新規アカウント登録の手順
            </h2>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-slate-300">
            本サービスは安全確保と機密保護のため、最初に利用区分を選んでログインまたは新規登録を行います。
            <strong>すべての区分で「メールアドレス＋パスワード」「Googleアカウント」のどちらでも登録・ログインできます。</strong>
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            {/* Citizen */}
            <div className="flex flex-col justify-between rounded-xl border border-sky-500/40 bg-sky-950/20 p-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-sky-200">
                  <Users className="h-4 w-4 text-sky-400" />
                  一般市民アカウント
                </div>
                <div className="mt-1 inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                  認証コード不要・すぐ登録可能
                </div>
                <ol className="mt-2.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-300">
                  <li>「一般市民として新規登録」を開く</li>
                  <li>メールアドレス登録、または Googleアカウントボタンをクリック</li>
                  <li>氏名を入力（Googleの場合は省略可）して完了</li>
                </ol>
              </div>
              <Link
                href="/register?role=citizen"
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-sky-500/50 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
              >
                <UserPlus className="h-3.5 w-3.5" />
                一般市民で新規登録する
              </Link>
            </div>

            {/* Enterprise */}
            <div className="flex flex-col justify-between rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-200">
                  <Building2 className="h-4 w-4 text-emerald-400" />
                  企業（BCP・施設管理）
                </div>
                <div className="mt-1 inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                  認証コード不要・企業名のみ入力
                </div>
                <ol className="mt-2.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-300">
                  <li>「企業で新規登録」を開く</li>
                  <li>担当者名と任意の企業・組織名を入力</li>
                  <li>メール登録、または Googleアカウントボタンで登録完了</li>
                </ol>
              </div>
              <Link
                href="/register?role=enterprise"
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                <UserPlus className="h-3.5 w-3.5" />
                企業（BCP）で新規登録する
              </Link>
            </div>

            {/* Government */}
            <div className="flex flex-col justify-between rounded-xl border border-amber-500/40 bg-amber-950/20 p-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
                  <Landmark className="h-4 w-4 text-amber-400" />
                  政府関連機関アカウント
                </div>
                <div className="mt-1 inline-block rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                  機関認証コードが必要
                </div>
                <ol className="mt-2.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-300">
                  <li>「政府関連機関で新規登録」を開く</li>
                  <li>担当者名・機関名と<strong>機関認証コード</strong>を入力</li>
                  <li>メール登録、または Googleアカウントボタンで登録完了</li>
                </ol>
              </div>
              <Link
                href="/register?role=government"
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
              >
                <UserPlus className="h-3.5 w-3.5" />
                政府関連機関の登録画面へ
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-3.5 text-xs leading-relaxed text-slate-200">
              <div className="flex items-center gap-1.5 font-bold text-amber-200">
                <KeyRound className="h-4 w-4 text-amber-400" />
                「政府関連機関 認証コード」について
              </div>
              <p className="mt-1 text-slate-300">
                政府機関アカウントでは個人の救助要請・通報詳細や公式発表の更新権限を扱うため、一般の方の誤登録を防ぐ認証コードを設けています。
                審査・試用でご利用になる場合は、<strong>配布資料（ご利用ガイドPDF）に記載の機関認証コード（または審査用デモアカウント）</strong>をご利用ください。
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 text-xs leading-relaxed text-slate-200">
              <div className="font-bold text-sky-200">複数区分を切り替えて確認したい場合</div>
              <p className="mt-1 text-slate-300">
                セキュリティ上、1つのアカウントは最初に登録した区分に固定されます（登録後の変更不可）。
                「一般市民」「企業」「政府機関」の違いを比較したい場合は、右上の「ログアウト」から別のメールアドレス／別アカウントでログインしてください。
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Role Access Matrix */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl sm:p-6">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              2. アカウント区分ごとのアクセス権限・機能比較
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 pr-3 font-semibold">機能・データ</th>
                  <th className="px-3 py-2.5 font-semibold text-sky-300">一般市民</th>
                  <th className="px-3 py-2.5 font-semibold text-emerald-300">企業（BCP）</th>
                  <th className="pl-3 py-2.5 font-semibold text-amber-300">政府関連機関</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-200">
                <tr>
                  <td className="py-2.5 pr-3 font-medium">被害建物・通行止め道路・避難場所514件・ハザード統計</td>
                  <td className="px-3 py-2.5 text-emerald-300">
                    <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />閲覧可
                  </td>
                  <td className="px-3 py-2.5 text-emerald-300">
                    <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />閲覧可
                  </td>
                  <td className="pl-3 py-2.5 text-emerald-300">
                    <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />閲覧可
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-medium">市民からの個別救助要請・通報者詳細・真偽ステータス更新</td>
                  <td className="px-3 py-2.5 text-slate-400">
                    <Lock className="mr-1 inline h-3.5 w-3.5" />自己投稿のみ詳細可
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">
                    <Lock className="mr-1 inline h-3.5 w-3.5" />詳細・救助不可
                  </td>
                  <td className="pl-3 py-2.5 text-emerald-300">
                    <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />全件閲覧・真偽更新・救助ルート可
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-medium">企業のサーバー室・DC・BCP高リスク回避診断</td>
                  <td className="px-3 py-2.5 text-rose-300">
                    <Lock className="mr-1 inline h-3.5 w-3.5" />閲覧・AI照会ともに遮断
                  </td>
                  <td className="px-3 py-2.5 text-emerald-300">
                    <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />自社拠点のみ隔離管理・診断可
                  </td>
                  <td className="pl-3 py-2.5 text-amber-200">
                    企業側が「緊急時共有」にした拠点のみ可
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-medium">リアルタイム防災掲示板・AIエージェント（@もちまも）</td>
                  <td className="px-3 py-2.5">公開チャンネル</td>
                  <td className="px-3 py-2.5">公開 ＋ 自社×行政連携</td>
                  <td className="pl-3 py-2.5">公開 ＋ 各社連携 ＋ 対策本部専用</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: AI Assistant & Agent Examples */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl sm:p-6">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <MessageSquareHeart className="h-5 w-5 text-sky-400" />
            <h2 className="text-base font-bold text-white">
              3. AI状況分析・地図連携エージェントの活用例
            </h2>
          </div>
          <p className="mb-4 text-xs text-slate-400">
            ログイン後、画面上部の「AI分析」または掲示板チャットでお試しいただける質問例です。
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {TRY_PROMPTS.map((item) => (
              <div
                key={item.prompt}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/80 p-3.5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold ${item.badgeClass}`}
                    >
                      {item.role}
                    </span>
                    <CopyButton text={item.prompt} />
                  </div>
                  <p className="mt-2 font-mono text-xs text-white">{item.prompt}</p>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">→ {item.effect}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {firebaseUser && profile ? (
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <MapPin className="h-3.5 w-3.5" />
                防災マップへ戻る
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  ログイン画面へ
                </Link>
                <Link
                  href="/register?role=citizen"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  新規登録へ進む
                </Link>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
