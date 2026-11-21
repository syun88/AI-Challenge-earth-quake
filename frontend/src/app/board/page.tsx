"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { DisasterBoard } from "@/components/DisasterBoard";

export default function DisasterBoardPage() {
  const router = useRouter();

  return (
    <main className="flex min-h-screen w-screen items-center justify-center bg-slate-950 p-3 sm:p-6">
      <div className="h-[calc(100vh-1.5rem)] max-h-[780px] w-full max-w-md">
        <DisasterBoard onBack={() => router.push("/")} />
      </div>
    </main>
  );
}
