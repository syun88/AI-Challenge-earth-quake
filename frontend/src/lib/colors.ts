import { AgeCategory, HazardTier } from "@/types/quakelens";

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
  北区: { lon: 135.745, lat: 35.048, zoom: 13.0 },
  上京区: { lon: 135.756, lat: 35.029, zoom: 13.8 },
  左京区: { lon: 135.788, lat: 35.045, zoom: 13.0 },
  中京区: { lon: 135.751, lat: 35.01, zoom: 14.0 },
  東山区: { lon: 135.776, lat: 34.996, zoom: 14.0 },
  下京区: { lon: 135.753, lat: 34.989, zoom: 14.0 },
  南区: { lon: 135.736, lat: 34.971, zoom: 13.6 },
  右京区: { lon: 135.71, lat: 35.015, zoom: 13.0 },
  伏見区: { lon: 135.761, lat: 34.936, zoom: 13.2 },
  山科区: { lon: 135.814, lat: 34.985, zoom: 13.4 },
  西京区: { lon: 135.691, lat: 34.977, zoom: 13.2 },
};
