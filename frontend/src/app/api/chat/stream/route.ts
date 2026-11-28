import { NextRequest } from "next/server";

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(req: NextRequest) {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

  const body = await req.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return new Response(
      JSON.stringify({ detail: "リクエストサイズが上限（32KB）を超えています。" }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeader = req.headers.get("authorization");
  if (authHeader) headers["Authorization"] = authHeader;
  const apiKeyHeader = req.headers.get("x-gemini-api-key");
  if (apiKeyHeader) headers["X-Gemini-Api-Key"] = apiKeyHeader;
  const accessCodeHeader = req.headers.get("x-ai-access-code");
  if (accessCodeHeader) headers["X-Ai-Access-Code"] = accessCodeHeader;
  if (process.env.AI_TRUST_PROXY_HEADERS === "true") {
    const xff = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip");
    if (xff) headers["X-Forwarded-For"] = xff;
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
    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const respHeaders = new Headers({ "Content-Type": contentType });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) respHeaders.set("Retry-After", retryAfter);
    return new Response(text || upstream.statusText, {
      status: upstream.status,
      headers: respHeaders,
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
