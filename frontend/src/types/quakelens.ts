export type AgeCategory = "pre_1981" | "1982_2000" | "post_2001" | "unknown";
export type HazardTier = "very_high" | "elevated" | "moderate" | "low" | "unknown";
export type UsageGroup = "all" | "residential" | "non_residential";
export type MeshOverlayMode = "hazard" | "arv" | "pre1981";

export interface DataSourceInfo {
  id: string;
  name: string;
  provider: string;
  reference_year: string;
  license: string;
  url: string;
  notes: string;
}

export interface OfficialProgram {
  title: string;
  organization: string;
  summary: string;
  url: string;
}

export interface MetadataResponse {
  municipality: {
    code: string;
    name: string;
    name_en: string;
    plateau_package_id: string;
    center: [number, number];
    default_zoom: number;
  };
  generated_at_utc?: string;
  is_partial_sample?: boolean;
  plateau_metadata?: {
    title?: string;
    license_title?: string;
    metadata_modified?: string;
  };
  data_sources: DataSourceInfo[];
  counts: {
    total_buildings: number;
    known_year_count: number;
    unknown_year_count: number;
    known_year_rate: number;
    unknown_year_rate: number;
    known_usage_rate: number;
    known_structure_rate: number;
    known_storeys_rate: number;
    known_measured_height_count?: number;
    known_measured_height_rate?: number;
    mesh_count: number;
  };
  hazard_summary?: {
    mesh_count?: number;
    min_t30_i55_ps?: number;
    max_t30_i55_ps?: number;
    sand_gravel_terrace_count?: number;
    sand_gravel_terrace_mean?: number;
    backmarsh_count?: number;
    backmarsh_mean?: number;
    backmarsh_max?: number;
    max_arv?: number;
  };
  wards: string[];
  age_labels: Record<string, string>;
  hazard_labels: Record<string, string>;
  usage_group_labels: Record<string, string>;
  official_programs: OfficialProgram[];
}

export interface StatsResponse {
  scope: {
    ward: string;
    usage_group: string;
    age_categories: string[];
    hazard_tiers: string[];
    meshcode: string | null;
    scope_denominator_buildings: number;
  };
  total_buildings: number;
  known_year_count: number;
  unknown_year_count: number;
  known_year_rate: number;
  unknown_year_rate: number;
  pre_1981_count: number;
  pre_1981_share_of_total: number;
  pre_1981_share_of_known: number | null;
  overlap_very_high_pre1981: number;
  overlap_elevated_or_higher_pre1981: number;
  age_breakdown: Array<{
    key: AgeCategory;
    label: string;
    count: number;
    share: number;
  }>;
  hazard_breakdown: Array<{
    key: HazardTier;
    label: string;
    count: number;
    share: number;
  }>;
  usage_breakdown: Array<{
    key: string;
    label: string;
    count: number;
  }>;
  structure_breakdown: Array<{
    label: string;
    count: number;
  }>;
  cross_tab: Array<{
    hazard_tier: HazardTier;
    hazard_label: string;
    pre_1981: number;
    "1982_2000": number;
    post_2001: number;
    unknown: number;
    total: number;
  }>;
  ward_summary: Array<{
    ward_name: string;
    total_buildings: number;
    known_year_count: number;
    unknown_year_count: number;
    known_year_rate: number;
    pre_1981_count: number;
    overlap_high_pre1981: number;
    avg_t30_i55_ps: number | null;
  }>;
}

export interface PriorityArea {
  meshcode: string;
  ward_name: string;
  total_buildings: number;
  known_year_count: number;
  unknown_year_count: number;
  known_year_rate: number;
  pre_1981_count: number;
  pre_1981_residential_count: number;
  wooden_pre_1981_count: number;
  pre_1981_share_total: number;
  pre_1981_share_known: number | null;
  t30_i55_ps: number | null;
  t30_i60_ps: number | null;
  hazard_tier: HazardTier;
  hazard_label: string;
  arv: number | null;
  avs: number | null;
  jname: string;
  centroid_lon: number;
  centroid_lat: number;
}

export interface BuildingDetail {
  building_id: string;
  ward_name: string;
  year_built: number | null;
  age_category: AgeCategory;
  age_label: string;
  era_note: string;
  usage_code: string;
  usage_label: string;
  usage_group: string;
  usage_group_label: string;
  structure_code: string;
  structure_label: string;
  measured_height: number | null;
  storeys_above: number | null;
  footprint_area_m2: number | null;
  meshcode: string;
  t30_i55_ps: number | null;
  t30_i60_ps: number | null;
  t30_i50_ps: number | null;
  hazard_tier: HazardTier;
  hazard_label: string;
  arv: number | null;
  avs: number | null;
  jname: string;
  centroid_lon: number;
  centroid_lat: number;
  hazard_disclaimer: string;
  official_programs: OfficialProgram[];
}

export interface MeshDetail {
  meshcode: string;
  ward_name: string;
  total_buildings: number;
  known_year_count: number;
  unknown_year_count: number;
  known_year_rate: number;
  pre_1981_count: number;
  b1982_2000_count: number;
  post_2001_count: number;
  residential_count: number;
  pre_1981_residential_count: number;
  wooden_pre_1981_count: number;
  pre_1981_share_total: number;
  pre_1981_share_known: number | null;
  t30_i45_ps: number | null;
  t30_i50_ps: number | null;
  t30_i55_ps: number | null;
  t30_i60_ps: number | null;
  hazard_tier: HazardTier;
  hazard_label: string;
  arv: number | null;
  avs: number | null;
  jname: string;
  centroid_lon: number;
  centroid_lat: number;
  official_programs: OfficialProgram[];
}

export interface EarthquakeEvent {
  eid: string;
  at: string;
  anm: string;
  en_anm?: string;
  ttl: string;
  mag: number | null;
  maxi: string;
  lat: number;
  lon: number;
  depth_km: number | null;
}

export interface ToolCallTrace {
  name: string;
  arguments: Record<string, unknown>;
  summary?: string;
}

export interface MapAction {
  type:
    | "fly_to_mesh"
    | "fly_to_ward"
    | "focus_building"
    | "focus_report"
    | "download_export"
    | "show_route_simulation";
  key: string;
  label: string;
  meshcode?: string;
  ward?: string;
  building_id?: string;
  report_id?: string;
  url?: string;
  format?: "csv" | "xlsx";
  origin_id?: string;
  destination_id?: string;
  lon?: number;
  lat?: number;
  zoom?: number;
}

export interface AiProtectionStatus {
  server_key_enabled: boolean;
  access_code_required: boolean;
  premium_models_allowed: boolean;
  daily_limit: number;
  daily_used: number;
  daily_remaining: number;
  per_minute_limit: number;
  max_message_chars: number;
}

export interface GroundingVerification {
  status: "verified" | "warning" | "no_tools" | "no_numeric_claims";
  tool_count: number;
  checked_claims_count: number;
  verified_claims: string[];
  unverified_claims: string[];
  unverified_urls: string[];
  contains_unverified_reports?: boolean;
  contains_sample_data?: boolean;
  note: string;
}

export interface ChatResponse {
  configured: boolean;
  answer: string;
  interaction_id: string | null;
  tool_calls: ToolCallTrace[];
  map_actions?: MapAction[];
  model?: string | null;
  incomplete?: boolean;
  verification?: GroundingVerification;
}

export type ChatStreamEvent =
  | { type: "status"; message: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_result"; name: string; arguments: Record<string, unknown>; summary?: string }
  | { type: "text_delta"; delta: string }
  | { type: "reset_draft" }
  | ({ type: "verification" } & GroundingVerification)
  | ({ type: "done" } & ChatResponse)
  | { type: "error"; message: string };

export type BoardStatus = "safe" | "shelter" | "home" | "minor_injury" | "waiting";

export interface BoardEntry {
  id: string;
  phone_masked: string;
  name: string;
  status: BoardStatus;
  status_label: string;
  ward_name: string;
  meshcode: string | null;
  location_consent?: boolean;
  message: string;
  has_passcode: boolean;
  is_sample: boolean;
  created_at: string;
  updated_at?: string;
}

export interface BoardListResponse {
  count: number;
  status_labels: Record<string, string>;
  entries: BoardEntry[];
}

export interface BoardWardSummary {
  ward_name: string;
  lon: number;
  lat: number;
  total_count: number;
  user_count: number;
  sample_count: number;
  support_needed_count: number;
  status_counts: Record<BoardStatus, number>;
  latest_at: string;
}

export interface BoardMeshSummary {
  meshcode: string;
  ward_name: string;
  centroid_lon: number | null;
  centroid_lat: number | null;
  total_count: number;
  user_count: number;
  sample_count: number;
  status_counts: Record<BoardStatus, number>;
}

export interface BoardSummaryResponse {
  scope: { ward: string; include_samples: boolean };
  total_entries: number;
  user_entries_count: number;
  sample_entries_count: number;
  status_labels: Record<string, string>;
  status_counts: Record<BoardStatus, number>;
  user_status_counts: Record<BoardStatus, number>;
  by_ward: BoardWardSummary[];
  by_mesh: BoardMeshSummary[];
  privacy_note: string;
}

export type ReportCategory =
  | "building_damage"
  | "road_blocked"
  | "shelter_status"
  | "rescue_support"
  | "other_disaster";

export type ReportSeverity = "critical" | "high" | "moderate" | "info";

export type VerificationStatus = "unverified" | "verified" | "official" | "demo_sample";

export interface DamageReport {
  id: string;
  category: ReportCategory;
  category_label: string;
  severity: ReportSeverity;
  severity_label: string;
  verification_status: VerificationStatus;
  verification_label: string;
  title: string;
  description: string;
  ward_name: string;
  meshcode: string | null;
  building_id?: string | null;
  location_label: string | null;
  lat: number | null;
  lon: number | null;
  location_consent: boolean;
  reporter_alias: string;
  corroborations: number;
  is_sample: boolean;
  resolved: boolean;
  has_passcode: boolean;
  reported_at: string;
  created_at: string;
  updated_at: string;
  duplicate_reasons?: string[];
}

export interface DamageReportListResponse {
  count: number;
  category_labels: Record<ReportCategory, string>;
  severity_labels: Record<ReportSeverity, string>;
  verification_labels: Record<VerificationStatus, string>;
  reports: DamageReport[];
}

export interface DamageReportWardSummary {
  ward_name: string;
  lon: number;
  lat: number;
  total_count: number;
  unverified_count: number;
  verified_or_official_count: number;
  sample_count: number;
  critical_or_high_count: number;
  by_category: Record<ReportCategory, number>;
}

export interface DamageReportSummaryResponse {
  scope: {
    ward: string;
    category: string;
    include_samples: boolean;
    include_resolved: boolean;
  };
  total_reports: number;
  unverified_count: number;
  verified_count: number;
  official_count: number;
  demo_sample_count: number;
  by_category: Array<{ key: ReportCategory; label: string; count: number }>;
  by_severity: Array<{ key: ReportSeverity; label: string; count: number }>;
  by_verification_status: Array<{ key: VerificationStatus; label: string; count: number }>;
  by_ward: DamageReportWardSummary[];
  linked_mesh_risks: Array<{
    meshcode: string;
    ward_name: string;
    pre_1981_count: number;
    t30_i55_ps: number | null;
    arv: number | null;
  }>;
  verification_notice: string;
}

export interface DisasterOverviewResponse {
  ward: string;
  include_samples: boolean;
  board_summary: BoardSummaryResponse;
  report_summary: DamageReportSummaryResponse;
}

export interface RouteNode {
  id: string;
  name: string;
  ward: string;
  lon: number;
  lat: number;
}

export interface RoutePathResult {
  reachable: boolean;
  node_ids: string[];
  node_names: string[];
  segments: string[];
  coordinates: [number, number][];
  distance_km: number | null;
}

export interface RouteBlockedSegment {
  from_id: string;
  to_id: string;
  label: string;
  distance_km: number;
  coordinates: [number, number][];
  triggered_by: Array<{
    report_id: string;
    title: string;
    verification_status: VerificationStatus;
    verification_label: string;
    is_sample: boolean;
    distance_m: number;
  }>;
}

export interface NetworkEdgeFeature {
  from_id: string;
  to_id: string;
  label: string;
  status: "clear" | "blocked";
  coordinates: [number, number][];
  mid_lon: number;
  mid_lat: number;
  triggered_by: Array<{
    report_id: string;
    title: string;
    verification_status: VerificationStatus;
    verification_label: string;
    is_sample: boolean;
    distance_m: number;
  }>;
}

export interface ClosureMarker {
  id: string;
  label: string;
  mid_lon: number;
  mid_lat: number;
  triggered_by: Array<{
    report_id: string;
    title: string;
    verification_status: VerificationStatus;
    verification_label: string;
    is_sample: boolean;
  }>;
}

export interface ShelterHub {
  id: string;
  name: string;
  role: string;
  ward: string;
  lon: number;
  lat: number;
  hub_status: "open" | "restricted" | "support_needed";
  status_note: string;
  related_reports: Array<{
    report_id: string;
    title: string;
    verification_label: string;
  }>;
}

export interface NetworkStatusResponse {
  is_simulation: boolean;
  simulation_disclaimer: string;
  blocked_count: number;
  total_segments: number;
  edges: NetworkEdgeFeature[];
  closure_markers?: ClosureMarker[];
  hubs: ShelterHub[];
}

export interface RouteSimulationResponse {
  mode?: "evacuate" | "rescue" | "custom";
  is_simulation: boolean;
  simulation_disclaimer: string;
  note?: string | null;
  origin: RouteNode;
  destination: RouteNode;
  settings: {
    include_samples: boolean;
    avoid_unverified: boolean;
    block_radius_m: number;
    active_road_hazard_points: number;
  };
  blocked_segments: RouteBlockedSegment[];
  rerouted: boolean;
  detour_delta_km: number | null;
  baseline_route: RoutePathResult;
  alternative_route: RoutePathResult;
}
