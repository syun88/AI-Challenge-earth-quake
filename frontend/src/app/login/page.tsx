"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CheckCircle2,
  Landmark,
  Loader2,
  Lock,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { ROLE_META } from "@/lib/firebase";
import { UserRole } from "@/types/quakelens";

const ROLE_CARDS: Array<{
  id: UserRole;
  title: string;
  tagline: string;
  visibleItems: string[];
  restrictedItems: string[];
  icon: React.ComponentType<{ className?: string }>;
  accentBorder: string;
  accentBg: string;
}> = [
  {
    id: "citizen",
    title: "一般市民",
    tagline: "避難・生活防衛・地域情報共有",
    visibleItems: [
      "指定緊急避難場所・Top5推奨ルート（避難誘導）",
      "共通被害マップ（被害建物・通行止め道路・避難所状況 ※投稿者詳細なし）",
      "PLATEAU建物・J-SHIS地震ハザード・災害用伝言板（集計・番号照会）",
    ],
    restrictedItems: [
      "他者の救助要請・通報本文・投稿者情報・全件CSV出力",
      "企業のサーバー室・データセンター等の非公開拠点・BCP診断",
    ],
    icon: Users,
    accentBorder: "border-sky-500/60",
    accentBg: "bg-sky-500/10",
  },
  {
    id: "enterprise",
    title: "企業（BCP・施設管理）",
    tagline: "事業継続・重要インフラ防衛",
    visibleItems: [
      "自社専用・非公開施設台帳（サーバー室・DC・重要拠点の隔離管理）",
      "企業BCP安全立地診断・任意2拠点迂回ルート・区別ハザード統計CSV",
      "共通被害マップ（被害建物・通行止め道路）および避難支援機能",
    ],
    restrictedItems: [
      "登録企業以外の他社拠点・一般市民の個別救助通報明細",
      "政府専用の救助出動ルート・通報真偽ステータス変更",
    ],
    icon: Building2,
    accentBorder: "border-emerald-500/60",
    accentBg: "bg-emerald-500/10",
  },
  {
    id: "government",
    title: "政府関連機関",
    tagline: "災害対策本部・消防・自治体運用",
    visibleItems: [
      "全件被害通報閲覧（救助要請詳細・未確認投稿・投稿情報含む）",
      "真偽区分管理（確認済・公式発表への昇格）・通報対応ステータス更新",
      "救助出動ルート探索・全明細CSV/Excel出力・R8市有建築物管理",
    ],
    restrictedItems: [
      "企業側が「政府緊急共有」に設定していない企業秘密拠点は不可視",
    ],
    icon: Landmark,
    accentBorder: "border-amber-500/60",
    accentBg: "bg-amber-500/10",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const {
    firebaseReady,
    firebaseUser,
    profile,
    authLoading,
    needsRegistration,
    loginWithEmailAndRole,
    loginWithGoogleAndRole,
    logout,
  } = useAuth();

  const [selectedRole, setSelectedRole] = useState<UserRole>("citizen");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && firebaseUser && profile) {
      router.replace("/");
    }
  }, [authLoading, firebaseUser, profile, router]);

  const activeRoleCard =
    ROLE_CARDS.find((r) => r.id === selectedRole) ?? ROLE_CARDS[0];

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !password) {
      setErrorMsg("メールアドレスとパスワードを入力してください。");
      return;
    }
    setSubmitting(true);
    try {
      await loginWithEmailAndRole({
        email: email.trim(),
        password,
        role: selectedRole,
      });
      router.replace("/");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "ログインに失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await loginWithGoogleAndRole(selectedRole);
      if (res.status === "needs_registration") {
        router.push(`/register?role=${selectedRole}&google=1`);
        return;
      }
      router.replace("/");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Googleログインに失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-6 py-4">
          <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
          <span className="text-sm font-medium">認証セッションを確認しています...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] overflow-x-hidden overflow-y-auto bg-slate-950 pb-[env(safe-area-inset-bottom,0px)] text-slate-100">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-3.5 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-lg shadow-sky-900/30">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                QuakeLens Japan 認証ゲート
              </h1>
              <p className="text-xs text-slate-400">
                京都 統合防災・被害把握・BCPプラットフォーム（ロール別アクセス制御 / RBAC）
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/guide"
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25"
            >
              <BookOpen className="h-4 w-4" />
              ご利用ガイド・ログイン方法
            </Link>
            <Link
              href={`/register?role=${selectedRole}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/25"
            >
              <UserCheck className="h-4 w-4" />
              新規登録（市民 / 企業 / 政府・メール / Google）
            </Link>
          </div>
        </div>

        {!firebaseReady && (
          <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-950/40 p-4 text-xs text-amber-200">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              Firebase Web SDK 環境変数が未設定です
            </div>
            <p className="mt-1 text-amber-100/80">
              `.env.local` に `NEXT_PUBLIC_FIREBASE_*` を設定するか、`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` を有効にして再起動してください。
            </p>
          </div>
        )}

        {needsRegistration && firebaseUser && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-500/40 bg-sky-950/40 p-4 text-xs text-sky-100">
            <div>
              <p className="font-semibold">
                認証済みアカウント（{firebaseUser.email || firebaseUser.uid}）の利用区分が未登録です。
              </p>
              <p className="mt-0.5 text-sky-200/80">
                利用開始前に「一般市民」「企業」「政府関連機関」の登録手続きを完了してください。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/register?role=${selectedRole}&google=1`}
                className="rounded-lg bg-sky-600 px-3.5 py-2 font-semibold text-white hover:bg-sky-500"
              >
                登録を完了する
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-300 hover:bg-slate-800"
              >
                ログアウト
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-5 sm:gap-6 lg:grid-cols-12">
          {/* Left: Login Form */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl sm:p-6 lg:col-span-7">
            <div className="mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                1. ログイン区分を選択
              </span>
              <div className="mt-2 grid grid-cols-3 gap-1.5 sm:gap-2">
                {ROLE_CARDS.map((role) => {
                  const Icon = role.icon;
                  const active = selectedRole === role.id;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => {
                        setSelectedRole(role.id);
                        setErrorMsg(null);
                      }}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2.5 text-center transition sm:gap-1.5 sm:px-3 sm:py-3 ${
                        active
                          ? `${role.accentBorder} ${role.accentBg} text-white shadow-sm`
                          : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-[11px] font-bold leading-tight sm:text-xs">{role.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                  メールアドレス
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-base text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none sm:text-sm"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                  パスワード
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-base text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none sm:text-sm"
                />
              </div>

              {errorMsg && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-200">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !firebaseReady}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-900/30 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                {ROLE_META[selectedRole].label}としてログイン
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
              <div className="h-px flex-1 bg-slate-800" />
              <span>または</span>
              <div className="h-px flex-1 bg-slate-800" />
            </div>

            <button
              type="button"
              disabled={submitting || !firebaseReady}
              onClick={handleGoogleLogin}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              Googleアカウントでログイン（{ROLE_META[selectedRole].shortLabel}）
            </button>

            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-200">
                  初めてご利用の方・別区分での新規登録
                </span>
                <span className="text-[11px] text-sky-300">
                  メール登録／Google登録どちらも全区分対応
                </span>
              </div>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                <Link
                  href="/register?role=citizen"
                  className="rounded-lg border border-sky-500/35 bg-sky-500/10 px-2.5 py-2 text-center text-[11px] font-semibold text-sky-200 transition hover:bg-sky-500/20"
                >
                  一般市民で新規登録
                  <span className="mt-0.5 block text-[10px] font-normal text-sky-200/75">
                    メール / Google・コード不要
                  </span>
                </Link>
                <Link
                  href="/register?role=enterprise"
                  className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-2 text-center text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
                >
                  企業（BCP）で新規登録
                  <span className="mt-0.5 block text-[10px] font-normal text-emerald-200/75">
                    メール / Google・コード不要
                  </span>
                </Link>
                <Link
                  href="/register?role=government"
                  className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-center text-[11px] font-semibold text-amber-200 transition hover:bg-amber-500/20"
                >
                  政府機関で新規登録
                  <span className="mt-0.5 block text-[10px] font-normal text-amber-200/75">
                    メール / Google・要認証コード
                  </span>
                </Link>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5 text-[11px] text-slate-400">
                <span>
                  初めての方・各区分の違いやログイン手順を確認したい方はこちら
                </span>
                <Link
                  href="/guide"
                  className="inline-flex items-center gap-1 font-semibold text-amber-300 underline underline-offset-4 hover:text-amber-200"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  ご利用ガイドを見る
                </Link>
              </div>
            </div>
          </div>

          {/* Right: Role Classification Matrix */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-5">
            <div>
              <div className="flex items-center gap-2">
                <activeRoleCard.icon className="h-5 w-5 text-sky-400" />
                <div>
                  <h2 className="text-sm font-bold text-white">
                    {activeRoleCard.title}のアクセス範囲
                  </h2>
                  <p className="text-[11px] text-slate-400">{activeRoleCard.tagline}</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3">
                  <div className="mb-2 text-[11px] font-bold text-emerald-300">
                    閲覧・利用可能な情報と機能
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-200">
                    {activeRoleCard.visibleItems.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-slate-700/70 bg-slate-950/60 p-3">
                  <div className="mb-2 text-[11px] font-bold text-slate-300">
                    プライバシー・機密保護により制限される情報
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-400">
                    {activeRoleCard.restrictedItems.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-400">
              <div className="font-semibold text-slate-200">セキュリティ設計</div>
              認証基盤には Firebase Authentication、機密拠点管理には Cloud Firestore Security Rules を採用し、全API通信は ID Token + サーバー側 RBAC で検証されます。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
