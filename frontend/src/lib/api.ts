import {
  AiProtectionStatus,
  BoardEntry,
  BoardListResponse,
  BoardStatus,
  BoardSummaryResponse,
  BuildingDetail,
  ChatResponse,
  ChatStreamEvent,
  DamageReport,
  DamageReportListResponse,
  DamageReportSummaryResponse,
  DisasterOverviewResponse,
  DisasterUpdatesPeriod,
  DisasterUpdatesResponse,
  EarthquakeEvent,
  InteractiveRoadsGeoJSON,
  MeshDetail,
  MetadataResponse,
  NetworkStatusResponse,
  OfficialSheltersListResponse,
  PriorityArea,
  ReportCategory,
  ReportSeverity,
  RoadSelectionResult,
  RouteNode,
  RouteSimulationResponse,
  ShelterRecommendationResponse,
  ShelterScenario,
  SnappedRoadInfo,
  StatsResponse,
  VerificationStatus,
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
  hazardTiers?: string[];
  usageGroup?: string;
  sortBy?: string;
  minT30I55?: number;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params.hazardTiers && params.hazardTiers.length > 0 && params.hazardTiers.length < 4) {
    sp.set("hazard_tiers", params.hazardTiers.join(","));
  }
  if (params.usageGroup && params.usageGroup !== "all") {
    sp.set("usage_group", params.usageGroup);
  }
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
  limit = 20000
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
  if (params.meshcode) {
    sp.set("meshcode", params.meshcode);
  }
  return fetchJson<
    GeoJSON.FeatureCollection & {
      meta?: { returned: number; total_matching: number; truncated: boolean; limit: number };
    }
  >(`/api/buildings?${sp.toString()}`);
}

export function getBuildingsCountInBbox(
  bbox: [number, number, number, number],
  params: FilterParams
) {
  const sp = new URLSearchParams();
  sp.set("bbox", bbox.map((n) => n.toFixed(6)).join(","));
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
  return fetchJson<{ total_matching: number }>(`/api/buildings/count?${sp.toString()}`);
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
  let sawTerminalEvent = false;

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    } else if (done) {
      buffer += decoder.decode();
    }
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : chunks.pop() || "";

    for (const chunk of chunks) {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.startsWith("data: ")) {
          const rawJson = line.slice(6).trim();
          if (!rawJson) continue;
          try {
            const parsed = JSON.parse(rawJson) as ChatStreamEvent;
            if (parsed.type === "done" || parsed.type === "error") {
              sawTerminalEvent = true;
            }
            onEvent(parsed);
          } catch {
            // ignore malformed partial frames
          }
        }
      }
    }
    if (done) break;
  }

  if (!sawTerminalEvent && !signal?.aborted) {
    throw new Error("ストリーミング応答が完了前に切断されました（未完了）。");
  }
}

export function getBoardEntries(params?: {
  phone?: string;
  q?: string;
  ward?: string;
  meshcode?: string;
  status?: BoardStatus | "all";
  includeSamples?: boolean;
  ids?: string[];
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.phone?.trim()) sp.set("phone", params.phone.trim());
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  if (params?.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params?.meshcode?.trim()) sp.set("meshcode", params.meshcode.trim());
  if (params?.status && params.status !== "all") sp.set("status", params.status);
  if (params?.includeSamples === false) sp.set("include_samples", "false");
  if (params?.ids && params.ids.length > 0) sp.set("ids", params.ids.join(","));
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return fetchJson<BoardListResponse>(`/api/board${qs ? `?${qs}` : ""}`);
}

export function getBoardSummary(params?: { ward?: string; includeSamples?: boolean }) {
  const sp = new URLSearchParams();
  if (params?.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params?.includeSamples === false) sp.set("include_samples", "false");
  const qs = sp.toString();
  return fetchJson<BoardSummaryResponse>(`/api/board/summary${qs ? `?${qs}` : ""}`);
}

export function createBoardEntry(body: {
  phone: string;
  name: string;
  status: BoardStatus;
  message: string;
  ward_name: string;
  meshcode?: string | null;
  location_consent?: boolean;
  passcode?: string;
}) {
  return fetchJson<{ entry: BoardEntry }>("/api/board", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateBoardEntry(
  entryId: string,
  body: {
    passcode?: string;
    status?: BoardStatus;
    message?: string;
    ward_name?: string;
    meshcode?: string | null;
    location_consent?: boolean;
  }
) {
  return fetchJson<{ entry: BoardEntry }>(`/api/board/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteBoardEntry(entryId: string, passcode?: string) {
  const qs = passcode?.trim() ? `?passcode=${encodeURIComponent(passcode.trim())}` : "";
  return fetchJson<{ deleted: boolean; id: string }>(
    `/api/board/${encodeURIComponent(entryId)}${qs}`,
    { method: "DELETE" }
  );
}

export function getDamageReports(params?: {
  ward?: string;
  category?: ReportCategory | "all";
  severity?: ReportSeverity | "all";
  verificationStatus?: VerificationStatus | "all";
  meshcode?: string | null;
  q?: string;
  includeSamples?: boolean;
  includeResolved?: boolean;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params?.category && params.category !== "all") sp.set("category", params.category);
  if (params?.severity && params.severity !== "all") sp.set("severity", params.severity);
  if (params?.verificationStatus && params.verificationStatus !== "all") {
    sp.set("verification_status", params.verificationStatus);
  }
  if (params?.meshcode) sp.set("meshcode", params.meshcode);
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  if (params?.includeSamples === false) sp.set("include_samples", "false");
  if (params?.includeResolved === false) sp.set("include_resolved", "false");
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return fetchJson<DamageReportListResponse>(`/api/reports${qs ? `?${qs}` : ""}`);
}

export function getDamageReportsSummary(params?: {
  ward?: string;
  category?: ReportCategory | "all";
  includeSamples?: boolean;
  includeResolved?: boolean;
}) {
  const sp = new URLSearchParams();
  if (params?.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params?.category && params.category !== "all") sp.set("category", params.category);
  if (params?.includeSamples === false) sp.set("include_samples", "false");
  if (params?.includeResolved === true) sp.set("include_resolved", "true");
  const qs = sp.toString();
  return fetchJson<DamageReportSummaryResponse>(`/api/reports/summary${qs ? `?${qs}` : ""}`);
}

export function checkSimilarDamageReports(body: {
  ward_name: string;
  category: ReportCategory;
  title?: string;
  description?: string;
  meshcode?: string | null;
  lat?: number | null;
  lon?: number | null;
}) {
  return fetchJson<{ count: number; similar_reports: DamageReport[] }>("/api/reports/similar", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createDamageReport(body: {
  category: ReportCategory;
  severity: ReportSeverity;
  title: string;
  description: string;
  ward_name: string;
  meshcode?: string | null;
  building_id?: string | null;
  location_label?: string | null;
  lat?: number | null;
  lon?: number | null;
  location_consent: boolean;
  blocked_edge_ids?: number[] | null;
  reporter_alias?: string;
  passcode?: string;
  reported_at?: string;
  force_duplicate?: boolean;
}) {
  return fetchJson<{ report: DamageReport; similar_reports: DamageReport[] }>("/api/reports", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function confirmDamageReport(reportId: string) {
  return fetchJson<{ report: DamageReport }>(
    `/api/reports/${encodeURIComponent(reportId)}/confirm`,
    { method: "POST" }
  );
}

export function updateDamageReport(
  reportId: string,
  body: {
    passcode?: string;
    severity?: ReportSeverity;
    title?: string;
    description?: string;
    resolved?: boolean;
    ward_name?: string;
  }
) {
  return fetchJson<{ report: DamageReport }>(`/api/reports/${encodeURIComponent(reportId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteDamageReport(reportId: string, passcode?: string) {
  const qs = passcode?.trim() ? `?passcode=${encodeURIComponent(passcode.trim())}` : "";
  return fetchJson<{ deleted: boolean; id: string }>(
    `/api/reports/${encodeURIComponent(reportId)}${qs}`,
    { method: "DELETE" }
  );
}

export function getDisasterOverview(params?: { ward?: string; includeSamples?: boolean }) {
  const sp = new URLSearchParams();
  if (params?.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params?.includeSamples === false) sp.set("include_samples", "false");
  const qs = sp.toString();
  return fetchJson<DisasterOverviewResponse>(`/api/disaster-overview${qs ? `?${qs}` : ""}`);
}

export function buildDisasterCsvUrl(params?: {
  scope?: "overview" | "wards" | "reports" | "board";
  ward?: string;
  category?: string;
  verificationStatus?: string;
  includeSamples?: boolean;
}): string {
  const sp = new URLSearchParams();
  sp.set("scope", params?.scope ?? "overview");
  if (params?.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params?.category && params.category !== "all") sp.set("category", params.category);
  if (params?.verificationStatus && params.verificationStatus !== "all") {
    sp.set("verification_status", params.verificationStatus);
  }
  if (params?.includeSamples === false) sp.set("include_samples", "false");
  return `${API_BASE}/api/exports/disaster-summary.csv?${sp.toString()}`;
}

export function buildDisasterXlsxUrl(params?: {
  ward?: string;
  category?: string;
  verificationStatus?: string;
  includeSamples?: boolean;
}): string {
  const sp = new URLSearchParams();
  if (params?.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params?.category && params.category !== "all") sp.set("category", params.category);
  if (params?.verificationStatus && params.verificationStatus !== "all") {
    sp.set("verification_status", params.verificationStatus);
  }
  if (params?.includeSamples === false) sp.set("include_samples", "false");
  const qs = sp.toString();
  return `${API_BASE}/api/exports/disaster-summary.xlsx${qs ? `?${qs}` : ""}`;
}

export function getRouteNodes() {
  return fetchJson<{ is_simulation: boolean; nodes: RouteNode[] }>("/api/routes/nodes");
}

export function getNetworkStatus(params?: {
  includeSamples?: boolean;
  avoidUnverified?: boolean;
}) {
  const sp = new URLSearchParams({
    include_samples: params?.includeSamples === false ? "false" : "true",
    avoid_unverified: params?.avoidUnverified === false ? "false" : "true",
  });
  return fetchJson<NetworkStatusResponse>(`/api/network/status?${sp.toString()}`);
}

export function snapRoadInfo(lat: number, lon: number) {
  const sp = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  });
  return fetchJson<SnappedRoadInfo>(`/api/network/snap-road?${sp.toString()}`);
}

export function getRoadsInBbox(params: {
  bbox: [number, number, number, number];
  includeSamples?: boolean;
  avoidUnverified?: boolean;
}) {
  const sp = new URLSearchParams({
    bbox: params.bbox.map((n) => n.toFixed(5)).join(","),
    include_samples: params.includeSamples === false ? "false" : "true",
    avoid_unverified: params.avoidUnverified === false ? "false" : "true",
  });
  return fetchJson<InteractiveRoadsGeoJSON>(`/api/network/roads?${sp.toString()}`);
}

export function resolveRoadCorridor(params: {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
}) {
  return fetchJson<RoadSelectionResult>("/api/network/corridor", {
    method: "POST",
    body: JSON.stringify({
      start_lat: params.startLat,
      start_lon: params.startLon,
      end_lat: params.endLat,
      end_lon: params.endLon,
    }),
  });
}

export function resolveRoadStroke(points: Array<{ lat: number; lon: number }>) {
  return fetchJson<RoadSelectionResult>("/api/network/stroke", {
    method: "POST",
    body: JSON.stringify({ points }),
  });
}

export function simulateRoute(params: {
  originId: string;
  destinationId: string;
  includeSamples?: boolean;
  avoidUnverified?: boolean;
}) {
  const sp = new URLSearchParams({
    origin_id: params.originId,
    destination_id: params.destinationId,
    include_samples: params.includeSamples === false ? "false" : "true",
    avoid_unverified: params.avoidUnverified === false ? "false" : "true",
  });
  return fetchJson<RouteSimulationResponse>(`/api/routes/simulate?${sp.toString()}`);
}

export function simulateNavigation(params: {
  mode: "evacuate" | "rescue" | "custom";
  originId?: string;
  destinationId?: string;
  startLat?: number;
  startLon?: number;
  targetLat?: number;
  targetLon?: number;
  targetReportId?: string;
  includeSamples?: boolean;
  avoidUnverified?: boolean;
}) {
  const sp = new URLSearchParams({
    mode: params.mode,
    include_samples: params.includeSamples === false ? "false" : "true",
    avoid_unverified: params.avoidUnverified === false ? "false" : "true",
  });
  if (params.originId) sp.set("origin_id", params.originId);
  if (params.destinationId) sp.set("destination_id", params.destinationId);
  if (params.startLat != null && params.startLon != null) {
    sp.set("start_lat", String(params.startLat));
    sp.set("start_lon", String(params.startLon));
  }
  if (params.targetLat != null && params.targetLon != null) {
    sp.set("target_lat", String(params.targetLat));
    sp.set("target_lon", String(params.targetLon));
  }
  if (params.targetReportId) sp.set("target_report_id", params.targetReportId);
  return fetchJson<RouteSimulationResponse>(`/api/routes/navigate?${sp.toString()}`);
}

export function getOfficialShelters(params?: {
  ward?: string;
  disasterType?: string;
  wideAreaOnly?: boolean;
}) {
  const sp = new URLSearchParams();
  if (params?.ward && params.ward !== "all") sp.set("ward", params.ward);
  if (params?.disasterType && params.disasterType !== "all") {
    sp.set("disaster_type", params.disasterType);
  }
  if (params?.wideAreaOnly) sp.set("wide_area_only", "true");
  const qs = sp.toString();
  return fetchJson<OfficialSheltersListResponse>(`/api/shelters${qs ? `?${qs}` : ""}`);
}

export function recommendShelters(params: {
  lat?: number;
  lon?: number;
  ward?: string;
  scenario?: ShelterScenario;
  includeSamples?: boolean;
  avoidUnverified?: boolean;
  limit?: number;
}) {
  const sp = new URLSearchParams({
    scenario: params.scenario ?? "earthquake",
    include_samples: params.includeSamples === false ? "false" : "true",
    avoid_unverified: params.avoidUnverified === false ? "false" : "true",
    limit: String(params.limit ?? 5),
  });
  if (params.lat != null && params.lon != null) {
    sp.set("lat", String(params.lat));
    sp.set("lon", String(params.lon));
  }
  if (params.ward && params.ward !== "all") {
    sp.set("ward", params.ward);
  }
  return fetchJson<ShelterRecommendationResponse>(`/api/shelters/recommend?${sp.toString()}`);
}

export function getDisasterUpdates(params?: {
  period?: DisasterUpdatesPeriod;
  kind?: "all" | "earthquakes" | "municipality";
}) {
  const sp = new URLSearchParams({
    period: params?.period ?? "all",
    kind: params?.kind ?? "all",
  });
  return fetchJson<DisasterUpdatesResponse>(`/api/updates/disaster?${sp.toString()}`);
}

export function refreshDisasterUpdates() {
  return fetchJson<DisasterUpdatesResponse>("/api/updates/disaster/refresh", {
    method: "POST",
  });
}
