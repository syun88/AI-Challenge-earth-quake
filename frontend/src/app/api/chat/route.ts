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
  const xff = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip");
  if (xff) headers["X-Forwarded-For"] = xff;

  const upstream = await fetch(`${backendUrl}/api/chat`, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    signal: req.signal,
  });

  const text = await upstream.text();
  const respHeaders = new Headers({
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) respHeaders.set("Retry-After", retryAfter);
  return new Response(text, { status: upstream.status, headers: respHeaders });
}
