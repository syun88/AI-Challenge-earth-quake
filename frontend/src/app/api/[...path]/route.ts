import { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

  const target = `${backendUrl}/api/${path.join("/")}${req.nextUrl.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: {
        // Request identity encoding between server & backend so Node fetch never double-decompresses
        "Accept-Encoding": "identity",
      },
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

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
