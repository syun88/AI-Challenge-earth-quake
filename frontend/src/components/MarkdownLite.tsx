"use client";

import React from "react";

/** Lightweight safe text formatter for Gemini Japanese markdown responses (bold, bullets, URLs). */
export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");

  const renderInline = (line: string) => {
    // Split on **bold** and https:// URLs safely
    const tokens = line.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)）」]+)/g);
    return tokens.map((tok, i) => {
      if (tok.startsWith("**") && tok.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold text-white">
            {tok.slice(2, -2)}
          </strong>
        );
      }
      if (tok.startsWith("http://") || tok.startsWith("https://")) {
        return (
          <a
            key={i}
            href={tok}
            target="_blank"
            rel="noreferrer"
            className="break-all text-sky-400 underline hover:text-sky-300"
          >
            {tok}
          </a>
        );
      }
      return <React.Fragment key={i}>{tok}</React.Fragment>;
    });
  };

  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-slate-200">
      {lines.map((raw, idx) => {
        const line = raw.trimEnd();
        if (!line.trim()) {
          return <div key={idx} className="h-1" />;
        }
        if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
          const clean = line.replace(/^#+\s+/, "");
          return (
            <div key={idx} className="pt-1 font-bold text-sky-300">
              {renderInline(clean)}
            </div>
          );
        }
        if (/^[-*•]\s+/.test(line.trimStart())) {
          const clean = line.trimStart().replace(/^[-*•]\s+/, "");
          return (
            <div key={idx} className="flex gap-1.5 pl-1">
              <span className="text-sky-400">•</span>
              <span className="flex-1">{renderInline(clean)}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInline(line)}</p>;
      })}
    </div>
  );
}
