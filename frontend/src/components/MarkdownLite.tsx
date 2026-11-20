"use client";

import React from "react";

/** Safe Markdown renderer for Gemini Japanese responses (headings, lists, tables, code, links, bold). */
export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");

  const renderInline = (line: string) => {
    const tokens = line.split(
      /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s)）」>]+)/g
    );
    return tokens.map((tok, i) => {
      if (tok.startsWith("**") && tok.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold text-white">
            {tok.slice(2, -2)}
          </strong>
        );
      }
      if (tok.startsWith("`") && tok.endsWith("`")) {
        return (
          <code
            key={i}
            className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[10.5px] text-sky-300"
          >
            {tok.slice(1, -1)}
          </code>
        );
      }
      const mdLink = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (mdLink) {
        return (
          <a
            key={i}
            href={mdLink[2]}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline hover:text-sky-300"
          >
            {mdLink[1]}
          </a>
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

  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Detect markdown table block
    if (line.trim().startsWith("|") && i + 1 < lines.length && lines[i + 1].trim().match(/^\|[\s\-:|]+\|$/)) {
      const parseRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

      const headers = parseRow(line);
      i += 2; // skip header and separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseRow(lines[i]));
        i++;
      }

      elements.push(
        <div key={`tbl-${i}`} className="my-2 overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full border-collapse text-[11px]">
            <thead className="bg-slate-900/90 text-slate-300">
              <tr>
                {headers.map((h, hi) => (
                  <th
                    key={hi}
                    className="border-b border-slate-800 px-2 py-1.5 text-left font-semibold"
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 bg-slate-950/60">
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1.5 text-slate-200">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (!line.trim()) {
      elements.push(<div key={`sp-${i}`} className="h-1" />);
      i++;
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      const clean = line.replace(/^#+\s+/, "");
      elements.push(
        <div key={`h-${i}`} className="pt-1.5 text-xs font-bold text-sky-300">
          {renderInline(clean)}
        </div>
      );
      i++;
      continue;
    }

    const numMatch = line.trimStart().match(/^(\d+\.)\s+(.*)$/);
    if (numMatch) {
      elements.push(
        <div key={`ol-${i}`} className="flex gap-1.5 pl-1">
          <span className="font-mono text-[11px] font-semibold text-emerald-400">
            {numMatch[1]}
          </span>
          <span className="flex-1">{renderInline(numMatch[2])}</span>
        </div>
      );
      i++;
      continue;
    }

    if (/^[-*•]\s+/.test(line.trimStart())) {
      const clean = line.trimStart().replace(/^[-*•]\s+/, "");
      elements.push(
        <div key={`ul-${i}`} className="flex gap-1.5 pl-1">
          <span className="text-sky-400">•</span>
          <span className="flex-1">{renderInline(clean)}</span>
        </div>
      );
      i++;
      continue;
    }

    elements.push(<p key={`p-${i}`}>{renderInline(line)}</p>);
    i++;
  }

  return <div className="space-y-1.5 text-xs leading-relaxed text-slate-200">{elements}</div>;
}
