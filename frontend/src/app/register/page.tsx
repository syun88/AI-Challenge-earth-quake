"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Building2,
  CheckCircle2,
  KeyRound,
  Landmark,
  Loader2,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { getAuthPolicy } from "@/lib/api";
import { ROLE_META } from "@/lib/firebase";
import { UserRole } from "@/types/quakelens";

function parseInitialRole(raw: string | null): UserRole {
  if (raw === "government" || raw === "enterprise" || raw === "citizen") {
    return raw;
  }
  return "citizen";
}

function RegisterFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    firebaseReady,
    firebaseUser,
    profile,
    authLoading,
    needsRegistration,
    registerWithEmail,
    completeGoogleRegistration,
    logout,
  } = useAuth();

  const [role, setRole] = useState<UserRole>(() =>
    parseInitialRole(searchParams.get("role"))
  );
  const [displayNameOverride, setDisplayNameOverride] = useState<string | null>(null);
  const displayName = displayNameOverride ?? (firebaseUser?.displayName || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [department, setDepartment] = useState("");
  const [govCode, setGovCode] = useState("");
  const [govCodeConfigured, setGovCodeConfigured] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && firebaseUser && profile) {
      router.replace("/");
    }
  }, [authLoading, firebaseUser, profile, router]);

  useEffect(() => {
    let active = true;
    getAuthPolicy()
      .then((res) => {
        if (active) setGovCodeConfigured(res.gov_code_required);
      })
      .catch(() => {
        if (active) setGovCodeConfigured(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const validateRoleFields = (requireDisplayName: boolean): string | null => {
    if (requireDisplayName && !displayName.trim()) {
      return "氏名（または担当者名）を入力してください。";
    }
    if ((role === "enterprise" || role === "government") && !organizationName.trim()) {
      return role === "enterprise"
        ? "企業・組織名を入力してください。"
        : "政府・自治体・機関名を入力してください。";
    }
    if (role === "government" && !govCode.trim()) {
      return "政府関連機関として登録するには機関認証コードが必要です。";
    }
    return null;
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const roleErr = validateRoleFields(true);
    if (roleErr) {
      setErrorMsg(roleErr);
      return;
    }
    if (!email.trim()) {
      setErrorMsg("メールアドレスを入力してください。");
      return;
    }
    if (password.length < 6) {
      setErrorMsg("パスワードは6文字以上で設定してください。");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("確認用パスワードが一致しません。");
      return;
    }

    setSubmitting(true);
    try {
      await registerWithEmail({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        role,
        organizationName: organizationName.trim(),
        department: department.trim(),
        govCode: govCode.trim(),
      });
      router.replace("/");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "登録に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleRegister = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);
    const roleErr = validateRoleFields(needsRegistration);
    if (roleErr) {
      setErrorMsg(roleErr);
      return;
    }
    setSubmitting(true);
    try {
      await completeGoogleRegistration({
        displayName: displayName.trim(),
        role,
        organizationName: organizationName.trim(),
        department: department.trim(),
        govCode: govCode.trim(),
      });
      router.replace("/");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Google登録に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 text-slate-200">
        <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-sky-600">
              <UserPlus className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                新規アカウント登録（市民 / 企業 / 政府機関）
              </h1>
              <p className="text-xs text-slate-400">
                全3区分とも「メールアドレス登録」「Googleアカウント登録」の両方に対応し、閲覧権限が自動分離されます
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/guide"
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
            >
              <BookOpen className="h-3.5 w-3.5" />
              ご利用ガイド・ログイン方法
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              ログイン画面へ戻る
            </Link>
          </div>
        </div>

        {!firebaseReady && (
          <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-950/40 p-4 text-xs text-amber-200">
            Firebase 設定が未完了のため登録機能は待機中です。`.env.local` に Firebase 構成を追加してください。
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl">
          {/* Step 1: Role Picker */}
          <div className="mb-6">
            <label className="mb-2 block text-xs font-bold text-slate-300">
              1. 登録区分（登録後の権限変更はできません）
            </label>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {(
                [
                  {
                    id: "citizen" as UserRole,
                    label: "一般市民",
                    desc: "避難誘導・共通被害・安否",
                    icon: Users,
                    cls: "border-sky-500/70 bg-sky-500/15",
                  },
                  {
                    id: "enterprise" as UserRole,
                    label: "企業",
                    desc: "BCP診断・非公開拠点保護",
                    icon: Building2,
                    cls: "border-emerald-500/70 bg-emerald-500/15",
                  },
                  {
                    id: "government" as UserRole,
                    label: "政府関連機関",
                    desc: "全通報・検証・救助ルート",
                    icon: Landmark,
                    cls: "border-amber-500/70 bg-amber-500/15",
                  },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = role === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setRole(item.id);
                      setErrorMsg(null);
                    }}
                    className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                      active
                        ? `${item.cls} text-white`
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <div className="text-xs font-bold">{item.label}</div>
                      <div className="mt-0.5 text-[11px] opacity-80">{item.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {needsRegistration && firebaseUser && (
            <div className="mb-5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3.5 text-xs text-emerald-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Googleログイン済み: {firebaseUser.email || firebaseUser.uid}
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="text-xs text-slate-300 underline hover:text-white"
                >
                  別アカウントに切替
                </button>
              </div>
              <p className="mt-1 text-emerald-100/80">
                以下の区分・組織情報を入力し、下のボタンから登録を完了してください。
              </p>
            </div>
          )}

          <form
            onSubmit={needsRegistration ? handleGoogleRegister : handleEmailRegister}
            className="space-y-4"
          >
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                氏名 / 担当者名{" "}
                <span className="text-[11px] font-normal text-slate-400">
                  （メール登録は必須 / Google登録時は省略可）
                </span>
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayNameOverride(e.target.value)}
                placeholder={
                  role === "citizen" ? "例: 京都 太郎" : "例: 防災対策 担当者"
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            {(role === "enterprise" || role === "government") && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                    {role === "enterprise" ? "企業・法人名" : "政府・自治体機関名"}{" "}
                    <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder={
                      role === "enterprise"
                        ? "例: 株式会社○○データセンター"
                        : "例: 京都市防災危機管理室"
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                    部署名（任意）
                  </label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder={
                      role === "enterprise" ? "例: インフラ・BCP推進部" : "例: 災害対策本部"
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {role === "government" && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-950/25 p-4">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-amber-200">
                  <KeyRound className="h-4 w-4 text-amber-400" />
                  政府関連機関 認証コード <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={govCode}
                  onChange={(e) => setGovCode(e.target.value)}
                  placeholder="管理者から発行された機関認証コードを入力"
                  className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
                <p className="mt-1.5 text-[11px] text-amber-100/80">
                  政府機関アカウントは一般市民・企業の個人通報詳細を閲覧するため、サーバー側の機関認証コード照合が必須です。
                  {govCodeConfigured === false &&
                    "（※現在、サーバー側に機関認証コードが未設定のため政府機関登録は無効です）"}
                </p>
                <div className="mt-2.5 rounded-lg border border-amber-400/25 bg-slate-950/80 p-2.5 text-[11px] leading-relaxed text-slate-300">
                  <div className="font-bold text-amber-200">
                    アカウント登録に関するご案内
                  </div>
                  <p className="mt-1">
                    <strong>一般市民・企業アカウントは認証コード不要</strong>ですぐに登録できます。
                    政府関連機関アカウントのみ不正閲覧を防ぐため機関認証コードが必要です（審査・試用でお使いの場合は、配布のご利用ガイドPDFに記載された専用認証コードをご入力ください）。
                  </p>
                  <div className="mt-1.5">
                    <Link
                      href="/guide"
                      className="inline-flex items-center gap-1 font-semibold text-amber-300 underline underline-offset-4 hover:text-amber-200"
                    >
                      <BookOpen className="h-3 w-3" />
                      ログイン・登録方法と権限ガイドを見る
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {!needsRegistration && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                    メールアドレス <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      パスワード（6文字以上） <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="6文字以上"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      パスワード確認 <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="もう一度入力"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                </div>
              </>
            )}

            {role === "enterprise" && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-[11px] text-emerald-200">
                <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-400" />
                企業登録後に登録するサーバー室・データセンター等の位置情報は Firestore のセキュリティルールにより自社アカウントのみに隔離され、一般市民や競合他社からは参照できません。
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {needsRegistration ? (
              <button
                type="submit"
                disabled={submitting || !firebaseReady}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Googleアカウントで {ROLE_META[role].label} 登録を完了
              </button>
            ) : (
              <div className="space-y-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting || !firebaseReady}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-500 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  メールアドレスで {ROLE_META[role].label} として登録
                </button>
                <button
                  type="button"
                  disabled={submitting || !firebaseReady}
                  onClick={() => void handleGoogleRegister()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-50"
                >
                  Googleアカウントを使用して {ROLE_META[role].label} として登録
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-slate-950 text-slate-200">
          <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
        </div>
      }
    >
      <RegisterFormContent />
    </Suspense>
  );
}
