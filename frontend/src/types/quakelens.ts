export type AgeCategory = "pre_1981" | "1982_2000" | "post_2001" | "unknown";
export type HazardTier = "very_high" | "elevated" | "moderate" | "low" | "unknown";
export type UsageGroup = "all" | "residential" | "non_residential";
export type MeshOverlayMode = "hazard" | "arv" | "pre1981";
export type Map3DMode = "auto" | "3d" | "2d";

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
  r8_seismic_assessment?: R8BuildingAssessment;
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
  r8_unlisted_priority_count?: number;
  r8_ward_listed_count?: number;
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
  blocked_edge_ids?: number[] | null;
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

export type RoadPaintTool = "none" | "click" | "corridor" | "brush";

export interface SnappedRoadInfo {
  matched: boolean;
  edge_id?: number | null;
  edge_ids?: number[];
  road_name: string;
  highway: string;
  highway_label: string;
  ward_name: string;
  meshcode: string | null;
  snap_lat: number;
  snap_lon: number;
  distance_m: number | null;
  coordinates: [number, number][];
  preview_segments: [number, number][][];
}

export interface RoadSelectionResult {
  matched: boolean;
  edge_ids: number[];
  road_name: string;
  ward_name: string;
  meshcode: string | null;
  snap_lat: number;
  snap_lon: number;
  length_km: number;
  preview_segments: [number, number][][];
}

export interface InteractiveRoadsGeoJSON {
  type: "FeatureCollection";
  count: number;
  features: Array<{
    type: "Feature";
    id: number;
    properties: {
      edge_id: number;
      name: string;
      highway: string;
      highway_label: string;
      length_m: number;
      status: "open" | "blocked";
    };
    geometry: {
      type: "LineString";
      coordinates: [number, number][];
    };
  }>;
}

export type ShelterScenario = "earthquake" | "post_quake_fire" | "multi_hazard";

export interface ShelterHazardContext {
  meshcode: string;
  ward_name: string;
  hazard_tier: HazardTier;
  hazard_label: string;
  t30_i55_ps: number | null;
  arv: number | null;
  jname: string;
  pre_1981_count: number;
  pre_1981_share_known: number | null;
}

export interface OfficialShelter {
  id: string;
  name: string;
  address: string;
  ward: string;
  lon: number;
  lat: number;
  remarks?: string | null;
  disasters: {
    flood: boolean;
    landslide: boolean;
    storm_surge: boolean;
    earthquake: boolean;
    tsunami: boolean;
    large_fire: boolean;
    inland_flood: boolean;
  };
  disaster_labels: string[];
  is_wide_area: boolean;
  hazard?: ShelterHazardContext | null;
  r8_seismic?: R8FacilityMatch;
}

export interface OfficialSheltersListResponse {
  source: string;
  source_url: string;
  kyoto_hazard_map_url: string;
  web_hazard_map_url: string;
  count: number;
  returned: number;
  shelters: OfficialShelter[];
}

export interface ShelterRecommendationItem extends OfficialShelter {
  rank: number;
  crow_fly_km: number;
  road_distance_km: number | null;
  baseline_distance_km: number | null;
  walk_minutes: number | null;
  rerouted: boolean;
  detour_delta_km: number | null;
  reachable: boolean;
  shelter_hazard: ShelterHazardContext | null;
  shelter_status: "open" | "restricted" | "support_needed";
  status_note: string;
  related_reports: Array<{
    report_id: string;
    title: string;
    verification_label: string;
  }>;
  reasons: string[];
  nav_route: RouteSimulationResponse;
}

export interface HazardMapLinks {
  earthquake_page_url: string;
  web_hazard_map_url: string;
  ward_name: string;
  ward_map_pdf: string;
  ward_info_pdf: string;
  keihoku_map_pdf?: string;
  keihoku_info_pdf?: string;
}

export interface ShelterRecommendationResponse {
  scenario: ShelterScenario;
  scenario_label: string;
  is_simulation: boolean;
  simulation_disclaimer: string;
  origin: {
    lat: number;
    lon: number;
    ward_name: string;
    meshcode: string | null;
    hazard: ShelterHazardContext | null;
    hazard_map_links: HazardMapLinks;
  };
  active_blocked_count: number;
  total_candidates: number;
  recommendations: ShelterRecommendationItem[];
}

export type DisasterUpdatesPeriod = "all" | "recent_2y" | "2026" | "2025" | "archive";

export interface KyotoEarthquakeArchiveItem {
  id: string;
  occurred_at: string;
  date_iso: string;
  year: number;
  is_recent_2y: boolean;
  epicenter: string;
  mag: number | null;
  maxi: string;
  depth_km: number | null;
  lat: number | null;
  lon: number | null;
  observed_kyoto: string[];
  source: string;
  url: string;
  is_kyoto_local?: boolean;
}

export interface MunicipalityUpdateItem {
  id: string;
  date_text: string;
  year: number;
  is_recent_2y: boolean;
  category: string;
  title: string;
  source: string;
  url: string;
}

export interface DisasterUpdatesResponse {
  refreshed?: boolean;
  new_earthquakes_count?: number;
  new_municipality_updates_count?: number;
  last_updated_at: string | null;
  sources: {
    yahoo_kyoto_earthquakes?: string;
    jma_bosai_json?: string;
    kyoto_bousai_portal?: string;
    kyoto_hazard_map?: string;
  };
  period: DisasterUpdatesPeriod;
  kind: "all" | "earthquakes" | "municipality";
  counts: {
    total_earthquakes: number;
    recent_2y_earthquakes: number;
    archive_earthquakes: number;
    total_municipality_updates: number;
    recent_2y_municipality_updates: number;
    archive_municipality_updates: number;
  };
  years_available: number[];
  earthquakes: KyotoEarthquakeArchiveItem[];
  municipality_updates: MunicipalityUpdateItem[];
}

export interface R8SeismicRecord {
  id: string;
  page: number;
  role_marks: number;
  name: string;
  ward: string;
  structure: string;
  storeys: number | null;
  area_m2: number | null;
  era: string;
  year_built: number | null;
  seismic_grade: "新耐震" | "Ⅲ" | "Ⅱ" | "Ⅰ" | "未診断";
  needs_retrofit: boolean;
}

export interface R8BuildingAssessment {
  listed_in_r8: boolean;
  status_label: string;
  priority_tier: "critical" | "high" | "standard" | "listed_needs_work" | "listed_ok";
  priority_badge: string;
  recommendation: string;
  r8_pdf_url: string;
  r8_page_url: string;
  matched_r8_candidates: R8SeismicRecord[];
}

export interface R8FacilityMatch {
  listed_in_r8: boolean;
  matched_entries: R8SeismicRecord[];
  seismic_grade: string | null;
  priority_note: string;
}

export interface R8SeismicListResponse {
  source: string;
  pdf_url: string;
  page_url: string;
  as_of: string;
  total_listed: number;
  filtered_count: number;
  grade_counts: Record<string, number>;
  by_ward: Array<{
    ward: string;
    total: number;
    safe: number;
    needs_retrofit: number;
  }>;
  records: R8SeismicRecord[];
  unlisted_policy: string;
}

export interface R8LocateResponse {
  record: R8SeismicRecord;
  lat: number;
  lon: number;
  geocode_source: string;
  matched_address: string;
  matched_shelter_id: string | null;
  matched_building_id: string | null;
  hazard: ShelterHazardContext | null;
  r8_pdf_url: string;
  r8_page_url: string;
}

export interface R8UnlistedLocateResponse {
  query: string;
  ward: string;
  listed_in_r8: false;
  lat: number;
  lon: number;
  geocode_source: string;
  matched_address: string;
  matched_shelter_id: string | null;
  hazard: ShelterHazardContext | null;
  priority_message: string;
  r8_pdf_url: string;
  r8_page_url: string;
}

export type LocationSearchKind =
  | "address"
  | "landmark"
  | "shelter"
  | "street"
  | "station"
  | "ward"
  | "building"
  | "mesh"
  | "coordinates";

export interface NearestShelterBrief {
  id: string;
  name: string;
  ward: string;
  address: string;
  is_wide_area: boolean;
  distance_m: number;
  lat: number;
  lon: number;
}

export interface LocationKyotoContext {
  in_kyoto_coverage: boolean;
  ward_name: string | null;
  meshcode: string | null;
  hazard_tier: HazardTier | null;
  hazard_label: string | null;
  t30_i55_ps: number | null;
  arv: number | null;
  jname: string | null;
  total_buildings: number | null;
  pre_1981_count: number | null;
  pre_1981_share_known: number | null;
  nearest_shelter: NearestShelterBrief | null;
}

export interface LocationSearchResult {
  id: string;
  title: string;
  subtitle: string;
  address: string;
  kind: LocationSearchKind;
  kind_label: string;
  source: string;
  source_label: string;
  lat: number;
  lon: number;
  zoom: number;
  bbox?: [number, number, number, number] | null;
  ward_name?: string | null;
  meshcode?: string | null;
  building_id?: string | null;
  shelter_id?: string | null;
  is_wide_area?: boolean;
  disaster_labels?: string[];
  street_segments?: [number, number][][] | null;
  kyoto_context?: LocationKyotoContext | null;
}

export interface LocationSearchResponse {
  query: string;
  count: number;
  results: LocationSearchResult[];
  notice?: string | null;
}

export interface ReverseGeocodeResponse {
  lat: number;
  lon: number;
  address: string;
  ward_name?: string | null;
  town_name?: string | null;
  nearest_road?: string | null;
  source: string;
  kyoto_context?: LocationKyotoContext | null;
}

export type BcpPurpose = "datacenter_server" | "bcp_hq" | "logistics_storage";

export interface BcpWardRankItem {
  ward_name: string;
  safety_score: number;
  avg_t30_i55_ps: number;
  avg_arv: number;
  avg_avs: number;
  total_buildings: number;
  pre_1981_count: number;
  unlisted_priority_count: number;
  r8_total: number;
  r8_safe_count: number;
  r8_needs_retrofit: number;
  r8_safe_rate: number;
}

export interface BcpSiteCandidate {
  rank: number;
  meshcode: string;
  ward_name: string;
  centroid_lat: number;
  centroid_lon: number;
  safety_score: number;
  t30_i55_ps: number;
  t30_i60_ps: number | null;
  hazard_tier: HazardTier;
  hazard_label: string;
  arv: number;
  avs: number | null;
  jname: string;
  total_buildings: number;
  pre_1981_count: number;
  wooden_pre_1981_count: number;
  unlisted_priority_count: number;
  pre_1981_share_known: number | null;
  r8_ward_stats: {
    total: number;
    safe: number;
    needs_retrofit: number;
    safe_rate: number;
    sample_safe_facilities: string[];
  };
  nearest_official_shelter: {
    id: string;
    name: string;
    ward: string;
    distance_km: number;
    is_wide_area: boolean;
    disaster_labels: string[];
  } | null;
  reasons: string[];
  cautions: string[];
  bcp_guidance: string;
}

export interface BcpSiteResponse {
  purpose: BcpPurpose;
  purpose_label: string;
  ward: string;
  avoid_mountain: boolean;
  r8_pdf_url: string;
  r8_page_url: string;
  r8_total_listed: number;
  r8_grade_counts: Record<string, number>;
  ward_ranking: BcpWardRankItem[];
  recommendations: BcpSiteCandidate[];
  disclaimer: string;
}
