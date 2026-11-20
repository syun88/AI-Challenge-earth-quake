export type AgeCategory = "pre_1981" | "1982_2000" | "post_2001" | "unknown";
export type HazardTier = "very_high" | "elevated" | "moderate" | "low" | "unknown";
export type UsageGroup = "all" | "residential" | "non_residential";
export type MeshOverlayMode = "hazard" | "arv";

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
  type: "fly_to_mesh" | "fly_to_ward" | "focus_building";
  key: string;
  label: string;
  meshcode?: string;
  ward?: string;
  building_id?: string;
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
