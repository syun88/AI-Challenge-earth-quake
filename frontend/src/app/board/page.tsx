"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DisasterBoard } from "@/components/DisasterBoard";
import { useAuth } from "@/contexts/AuthContext";

export default function DisasterBoardPage() {
  const router = useRouter();
  const { firebaseReady, firebaseUser, profile, authLoading, needsRegistration } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!firebaseReady || !firebaseUser) {
      router.replace("/login");
    } else if (needsRegistration || !profile) {
      router.replace("/register");
    }
  }, [authLoading, firebaseReady, firebaseUser, profile, needsRegistration, router]);

  if (authLoading || !firebaseUser || !profile) {
    return (
      <main className="flex h-[100dvh] w-full items-center justify-center bg-slate-950 px-4 text-slate-200">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-6 py-4">
          <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
          <span className="text-sm font-medium">認証状態を確認しています...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-slate-950 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] sm:p-6">
      <div className="h-full max-h-[820px] w-full max-w-xl">
        <DisasterBoard userRole={profile.role} onBack={() => router.push("/")} />
      </div>
    </main>
  );
}
