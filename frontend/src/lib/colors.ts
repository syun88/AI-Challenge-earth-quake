import {
  AgeCategory,
  BoardStatus,
  HazardTier,
  ReportCategory,
  ReportSeverity,
  VerificationStatus,
} from "@/types/quakelens";

// Okabe-Ito inspired colorblind-safe palette for building construction eras
export const AGE_COLORS: Record<AgeCategory, string> = {
  pre_1981: "#D55E00", // Vermilion (distinct from blue & amber even in deuteranopia)
  "1982_2000": "#E69F00", // Amber / Orange
  post_2001: "#0072B2", // Strong Blue
  unknown: "#64748B", // Neutral Slate
};

export const AGE_LABELS: Record<AgeCategory, string> = {
  pre_1981: "1981年以前",
  "1982_2000": "1982〜2000年",
  post_2001: "2001年以降",
  unknown: "建築年不明",
};

// Purple/Magenta ramp for 250m seismic hazard mesh overlay so it separates cleanly from building colors
export const HAZARD_COLORS: Record<HazardTier, string> = {
  very_high: "#7E22CE", // Deep Purple (26%+)
  elevated: "#C026D3", // Fuchsia (6% - <26%)
  moderate: "#E879F9", // Light Orchid (3% - <6%)
  low: "#DDD6FE", // Pale Lavender (<3%)
  unknown: "#475569",
};

export const HAZARD_SHORT_LABELS: Record<HazardTier, string> = {
  very_high: "26%以上",
  elevated: "6〜26%",
  moderate: "3〜6%",
  low: "3%未満",
  unknown: "不明",
};

// Kyoto Ward approximate centers for quick flyTo navigation
export const WARD_CENTERS: Record<string, { lon: number; lat: number; zoom: number }> = {
  all: { lon: 135.7588, lat: 34.9858, zoom: 12.0 },
  北区: { lon: 135.745, lat: 35.048, zoom: 13.8 },
  上京区: { lon: 135.756, lat: 35.029, zoom: 14.3 },
  左京区: { lon: 135.788, lat: 35.045, zoom: 13.8 },
  中京区: { lon: 135.751, lat: 35.01, zoom: 14.3 },
  東山区: { lon: 135.776, lat: 34.996, zoom: 14.3 },
  下京区: { lon: 135.753, lat: 34.989, zoom: 14.3 },
  南区: { lon: 135.736, lat: 34.971, zoom: 14.0 },
  右京区: { lon: 135.71, lat: 35.015, zoom: 13.8 },
  伏見区: { lon: 135.761, lat: 34.936, zoom: 13.8 },
  山科区: { lon: 135.814, lat: 34.985, zoom: 13.9 },
  西京区: { lon: 135.691, lat: 34.977, zoom: 13.8 },
};

export const BOARD_STATUS_META: Record<
  BoardStatus,
  { label: string; short: string; color: string; badgeClass: string }
> = {
  safe: {
    label: "無事です",
    short: "無事",
    color: "#10B981",
    badgeClass: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  },
  shelter: {
    label: "避難所にいます",
    short: "避難所",
    color: "#0EA5E9",
    badgeClass: "border-sky-500/50 bg-sky-500/15 text-sky-200",
  },
  home: {
    label: "自宅にいます",
    short: "自宅",
    color: "#6366F1",
    badgeClass: "border-indigo-500/50 bg-indigo-500/15 text-indigo-200",
  },
  minor_injury: {
    label: "軽傷・支援が必要",
    short: "支援要",
    color: "#F59E0B",
    badgeClass: "border-amber-500/60 bg-amber-500/20 text-amber-200",
  },
  waiting: {
    label: "連絡待ち・安否確認中",
    short: "確認中",
    color: "#F43F5E",
    badgeClass: "border-rose-500/60 bg-rose-500/20 text-rose-200",
  },
};

export const REPORT_CATEGORY_META: Record<
  ReportCategory,
  { label: string; short: string; color: string; symbol: string; badgeClass: string }
> = {
  building_damage: {
    label: "建物の損傷・倒壊",
    short: "建物損傷",
    color: "#F97316",
    symbol: "建",
    badgeClass: "border-orange-500/50 bg-orange-500/15 text-orange-200",
  },
  road_blocked: {
    label: "道路の通行止め・損壊",
    short: "道路通行止",
    color: "#E11D48",
    symbol: "道",
    badgeClass: "border-rose-500/60 bg-rose-500/20 text-rose-200",
  },
  shelter_status: {
    label: "避難所の状況",
    short: "避難所",
    color: "#0284C7",
    symbol: "避",
    badgeClass: "border-sky-500/50 bg-sky-500/15 text-sky-200",
  },
  rescue_support: {
    label: "救助・支援の必要性",
    short: "救助・支援",
    color: "#EF4444",
    symbol: "援",
    badgeClass: "border-red-500/70 bg-red-500/25 text-red-100",
  },
  other_disaster: {
    label: "その他の災害情報",
    short: "その他",
    color: "#A855F7",
    symbol: "他",
    badgeClass: "border-purple-500/50 bg-purple-500/15 text-purple-200",
  },
};

export const REPORT_SEVERITY_META: Record<
  ReportSeverity,
  { label: string; badgeClass: string }
> = {
  critical: { label: "緊急・重大", badgeClass: "border-red-500 bg-red-500/25 text-red-100" },
  high: { label: "警戒・大", badgeClass: "border-amber-500 bg-amber-500/20 text-amber-100" },
  moderate: { label: "注意・中", badgeClass: "border-sky-500/60 bg-sky-500/15 text-sky-200" },
  info: { label: "情報共有", badgeClass: "border-slate-500 bg-slate-700/40 text-slate-200" },
};

// Non-color-only visual differentiation for Unverified vs Verified vs Official vs Sample
export const VERIFICATION_META: Record<
  VerificationStatus,
  { label: string; short: string; badgeClass: string; mapStroke: string }
> = {
  unverified: {
    label: "未確認（市民報告）",
    short: "未確認",
    badgeClass: "border-dashed border-amber-400/80 bg-amber-500/15 text-amber-200",
    mapStroke: "#FBBF24",
  },
  verified: {
    label: "確認済（複数照合）",
    short: "確認済",
    badgeClass: "border-solid border-cyan-400/80 bg-cyan-500/20 text-cyan-100",
    mapStroke: "#22D3EE",
  },
  official: {
    label: "公式発表",
    short: "公式",
    badgeClass: "border-solid border-emerald-400 bg-emerald-500/25 text-emerald-100",
    mapStroke: "#34D399",
  },
  demo_sample: {
    label: "訓練用サンプル",
    short: "訓練サンプル",
    badgeClass: "border-dotted border-slate-400/80 bg-slate-800/90 text-slate-300",
    mapStroke: "#CBD5E1",
  },
};
