import {
  AiProtectionStatus,
  BuildingDetail,
  ChatResponse,
  ChatStreamEvent,
  EarthquakeEvent,
  MeshDetail,
  MetadataResponse,
  PriorityArea,
  StatsResponse,
} from "@/types/quakelens";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

function formatApiError(status: number, rawText: string, statusText: string): string {
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText) as { detail?: string };
      if (typeof parsed?.detail === "string" && parsed.detail.trim()) {
        return parsed.detail.trim();
      }
    } catch {
      // plain text fallback
    }
  }
  return `API Error ${status}: ${rawText || statusText}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(formatApiError(res.status, text, res.statusText));
  }
  return res.json() as Promise<T>;
}

export function getHealth() {
  return fetchJson<{
    status: string;
    data_loaded: boolean;
    building_count: number;
    mesh_count: number;
    gemini_configured: boolean;
    ai_protection?: AiProtectionStatus;
  }>("/api/health");
}

export function getMetadata() {
  return fetchJson<MetadataResponse>("/api/metadata");
}

export interface FilterParams {
  ward?: string;
  ageCategories?: string[];
  hazardTiers?: string[];
  usageGroup?: string;
  meshcode?: string | null;
}

function buildFilterQuery(params: FilterParams): string {
  const sp = new URLSearchParams();
  if (params.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params.ageCategories && params.ageCategories.length > 0 && params.ageCategories.length < 4) {
    sp.set("age_categories", params.ageCategories.join(","));
  }
  if (params.hazardTiers && params.hazardTiers.length > 0 && params.hazardTiers.length < 4) {
    sp.set("hazard_tiers", params.hazardTiers.join(","));
  }
  if (params.usageGroup && params.usageGroup !== "all") {
    sp.set("usage_group", params.usageGroup);
  }
  if (params.meshcode) {
    sp.set("meshcode", params.meshcode);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export function getStats(params: FilterParams) {
  return fetchJson<StatsResponse>(`/api/stats${buildFilterQuery(params)}`);
}

export function getMeshesGeoJson(ward?: string) {
  const qs = ward && ward !== "all" ? `?ward=${encodeURIComponent(ward)}` : "";
  return fetchJson<GeoJSON.FeatureCollection>(`/api/meshes${qs}`);
}

export function getMeshDetail(meshcode: string) {
  return fetchJson<MeshDetail>(`/api/meshes/${encodeURIComponent(meshcode)}`);
}

export function getPriorityAreas(params: {
  ward?: string;
  sortBy?: string;
  minT30I55?: number;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params.sortBy) sp.set("sort_by", params.sortBy);
  if (params.minT30I55 !== undefined && params.minT30I55 > 0) {
    sp.set("min_t30_i55", String(params.minT30I55));
  }
  sp.set("limit", String(params.limit ?? 20));
  return fetchJson<{ count: number; sort_by: string; areas: PriorityArea[] }>(
    `/api/priority-areas?${sp.toString()}`
  );
}

export function getBuildingsInBbox(
  bbox: [number, number, number, number],
  params: FilterParams,
  limit = 3500
) {
  const sp = new URLSearchParams();
  sp.set("bbox", bbox.map((n) => n.toFixed(6)).join(","));
  sp.set("limit", String(limit));
  if (params.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params.ageCategories && params.ageCategories.length > 0 && params.ageCategories.length < 4) {
    sp.set("age_categories", params.ageCategories.join(","));
  }
  if (params.hazardTiers && params.hazardTiers.length > 0 && params.hazardTiers.length < 4) {
    sp.set("hazard_tiers", params.hazardTiers.join(","));
  }
  if (params.usageGroup && params.usageGroup !== "all") {
    sp.set("usage_group", params.usageGroup);
  }
  return fetchJson<
    GeoJSON.FeatureCollection & {
      meta?: { returned: number; total_matching: number; truncated: boolean; limit: number };
    }
  >(`/api/buildings?${sp.toString()}`);
}

export function getBuildingDetail(buildingId: string) {
  return fetchJson<BuildingDetail>(`/api/buildings/${encodeURIComponent(buildingId)}`);
}

export function getEarthquakes(limit = 50) {
  return fetchJson<{
    source: string;
    error?: string;
    earthquakes: EarthquakeEvent[];
  }>(`/api/earthquakes?limit=${limit}`);
}

export function sendChatMessage(
  body: {
    message: string;
    context?: Record<string, unknown>;
    previous_interaction_id?: string | null;
    model?: string;
  },
  apiKeyOverride?: string,
  accessCode?: string
) {
  const headers: Record<string, string> = {};
  if (apiKeyOverride?.trim()) {
    headers["X-Gemini-Api-Key"] = apiKeyOverride.trim();
  }
  if (accessCode?.trim()) {
    headers["X-Ai-Access-Code"] = accessCode.trim();
  }
  return fetchJson<ChatResponse>("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function streamChatMessage(
  body: {
    message: string;
    context?: Record<string, unknown>;
    previous_interaction_id?: string | null;
    model?: string;
  },
  onEvent: (ev: ChatStreamEvent) => void,
  apiKeyOverride?: string,
  signal?: AbortSignal,
  accessCode?: string
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKeyOverride?.trim()) {
    headers["X-Gemini-Api-Key"] = apiKeyOverride.trim();
  }
  if (accessCode?.trim()) {
    headers["X-Ai-Access-Code"] = accessCode.trim();
  }
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(formatApiError(res.status, text, res.statusText));
  }
  if (!res.body) {
    throw new Error("Streaming response body is empty");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    } else if (done) {
      buffer += decoder.decode();
    }
    const chunks = buffer.split("\n\n");
    buffer = done ? "" : chunks.pop() || "";

    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          const rawJson = line.slice(6).trim();
          if (!rawJson) continue;
          try {
            const parsed = JSON.parse(rawJson) as ChatStreamEvent;
            onEvent(parsed);
          } catch {
            // ignore malformed partial frames
          }
        }
      }
    }
    if (done) break;
  }
}
