import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

  const body = await req.text();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKeyHeader = req.headers.get("x-gemini-api-key");
  if (apiKeyHeader) {
    headers["X-Gemini-Api-Key"] = apiKeyHeader;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl}/api/chat/stream`, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: req.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Backend connection failed";
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: `バックエンド接続エラー: ${msg}` })}\n\n`,
      {
        status: 502,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => upstream.statusText);
    return new Response(text || upstream.statusText, {
      status: upstream.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
