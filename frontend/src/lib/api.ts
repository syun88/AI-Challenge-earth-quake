import {
  BuildingDetail,
  ChatResponse,
  EarthquakeEvent,
  MeshDetail,
  MetadataResponse,
  PriorityArea,
  StatsResponse,
} from "@/types/quakelens";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

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
    throw new Error(`API Error ${res.status}: ${text || res.statusText}`);
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

export function sendChatMessage(body: {
  message: string;
  context?: Record<string, unknown>;
  previous_interaction_id?: string | null;
}) {
  return fetchJson<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
