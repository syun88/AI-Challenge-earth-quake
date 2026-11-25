import { NextRequest } from "next/server";

async function forwardProxyRequest(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

  const target = `${backendUrl}/api/${path.join("/")}${req.nextUrl.search}`;
  const forwardHeaders: Record<string, string> = {
    // Request identity encoding between server & backend so Node fetch never double-decompresses
    "Accept-Encoding": "identity",
  };
  const contentTypeIn = req.headers.get("content-type");
  if (contentTypeIn) {
    forwardHeaders["Content-Type"] = contentTypeIn;
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader) forwardHeaders["Authorization"] = authHeader;
  const geminiKey = req.headers.get("x-gemini-api-key");
  if (geminiKey) forwardHeaders["X-Gemini-Api-Key"] = geminiKey;
  const accessCode = req.headers.get("x-ai-access-code");
  if (accessCode) forwardHeaders["X-Ai-Access-Code"] = accessCode;

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.text();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: forwardHeaders,
      body,
      cache: "no-store",
      signal: req.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Backend unreachable";
    return new Response(JSON.stringify({ detail: `Backend proxy error: ${msg}` }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  const contentDisposition = upstream.headers.get("content-disposition");
  if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
  const ttsModelHeader = upstream.headers.get("x-tts-model");
  if (ttsModelHeader) headers.set("X-TTS-Model", ttsModelHeader);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return forwardProxyRequest(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return forwardProxyRequest(req, context);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return forwardProxyRequest(req, context);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return forwardProxyRequest(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return forwardProxyRequest(req, context);
}
