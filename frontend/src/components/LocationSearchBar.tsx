"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  Clock,
  Compass,
  Grid,
  History,
  Landmark,
  Loader2,
  LocateFixed,
  MapPin,
  Route,
  Search,
  ShieldCheck,
  TrainFront,
  X,
} from "lucide-react";
import { reverseGeocode, searchLocations } from "@/lib/api";
import { LocationSearchKind, LocationSearchResult } from "@/types/quakelens";

const RECENT_STORAGE_KEY = "quakelens_recent_searches_v1";
const QUICK_SPOTS = [
  "京都駅",
  "京都市役所",
  "清水寺",
  "二条城",
  "四条河原町",
  "伏見桃山",
  "烏丸通",
];

function KindIcon({ kind, className = "h-4 w-4" }: { kind: LocationSearchKind; className?: string }) {
  switch (kind) {
    case "shelter":
      return <ShieldCheck className={`${className} text-teal-400`} />;
    case "landmark":
      return <Landmark className={`${className} text-amber-400`} />;
    case "station":
      return <TrainFront className={`${className} text-sky-400`} />;
    case "street":
      return <Route className={`${className} text-cyan-400`} />;
    case "ward":
      return <Compass className={`${className} text-indigo-400`} />;
    case "building":
      return <Building2 className={`${className} text-orange-400`} />;
    case "mesh":
      return <Grid className={`${className} text-fuchsia-400`} />;
    case "coordinates":
      return <LocateFixed className={`${className} text-emerald-400`} />;
    default:
      return <MapPin className={`${className} text-rose-400`} />;
  }
}

function hazardPillClass(tier: string | null | undefined): string {
  switch (tier) {
    case "very_high":
      return "border-fuchsia-500/50 bg-fuchsia-500/20 text-fuchsia-200";
    case "elevated":
      return "border-amber-500/50 bg-amber-500/20 text-amber-200";
    case "moderate":
      return "border-sky-500/40 bg-sky-500/15 text-sky-200";
    case "low":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
    default:
      return "border-slate-700 bg-slate-800 text-slate-300";
  }
}

function readRecentSearches(): LocationSearchResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(item: LocationSearchResult): LocationSearchResult[] {
  if (typeof window === "undefined") return [];
  try {
    const current = readRecentSearches().filter((x) => x.id !== item.id && x.title !== item.title);
    // Strip large street_segments before storing in localStorage
    const compact: LocationSearchResult = { ...item, street_segments: null };
    const next = [compact, ...current].slice(0, 5);
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

interface LocationSearchBarProps {
  activeSearchPlace: LocationSearchResult | null;
  candidateCount: number;
  drawerOpen: boolean;
  hidden?: boolean;
  onSelectResult: (result: LocationSearchResult, allCandidates?: LocationSearchResult[]) => void;
  onClearSearch: () => void;
}

export function LocationSearchBar({
  activeSearchPlace,
  candidateCount,
  drawerOpen,
  hidden = false,
  onSelectResult,
  onClearSearch,
}: LocationSearchBarProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState<string>("");
  const [highlightIdx, setHighlightIdx] = useState<number>(-1);
  const [recentItems, setRecentItems] = useState<LocationSearchResult[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    queueMicrotask(() => {
      setRecentItems(readRecentSearches());
    });
  }, []);

  // Sync displayed text if user clears from outside (e.g., SelectedFeatureCard close button)
  const prevActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextId = activeSearchPlace?.id ?? null;
    if (prevActiveIdRef.current && !nextId) {
      queueMicrotask(() => {
        setQuery("");
        setResults([]);
        setSearchedQuery("");
      });
    }
    prevActiveIdRef.current = nextId;
  }, [activeSearchPlace]);

  // Close dropdown on outside click
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const executeSearch = useCallback(async (q: string): Promise<LocationSearchResult[]> => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setSearchedQuery("");
      setNotice(null);
      setError(null);
      return [];
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const res = await searchLocations(trimmed, 8, ctrl.signal);
      if (ctrl.signal.aborted) return [];
      setResults(res.results || []);
      setSearchedQuery(trimmed);
      setNotice(res.notice || null);
      setHighlightIdx(res.results.length > 0 ? 0 : -1);
      return res.results || [];
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return [];
      setError(err instanceof Error ? err.message : "場所の検索に失敗しました。");
      setResults([]);
      return [];
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // Debounced live autocomplete while typing
  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < 2) return;
    if (trimmed === searchedQuery && results.length > 0) return;

    const timer = setTimeout(() => {
      void executeSearch(trimmed);
    }, 260);
    return () => clearTimeout(timer);
  }, [query, open, searchedQuery, results.length, executeSearch]);

  const chooseResult = useCallback(
    (item: LocationSearchResult, allList?: LocationSearchResult[]) => {
      setQuery(item.title);
      setOpen(false);
      setError(null);
      setRecentItems(saveRecentSearch(item));
      onSelectResult(item, allList && allList.length > 0 ? allList : [item]);
    },
    [onSelectResult]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    if (open && highlightIdx >= 0 && results[highlightIdx] && trimmed === searchedQuery) {
      chooseResult(results[highlightIdx], results);
      return;
    }

    if (trimmed === searchedQuery && results.length > 0) {
      chooseResult(results[0], results);
      return;
    }

    setOpen(true);
    const fetched = await executeSearch(trimmed);
    if (fetched.length > 0) {
      chooseResult(fetched[0], fetched);
    }
  };

  const handleQuickSpot = async (spot: string) => {
    setQuery(spot);
    setOpen(true);
    const fetched = await executeSearch(spot);
    if (fetched.length > 0) {
      chooseResult(fetched[0], fetched);
    }
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setQuery("");
    setResults([]);
    setSearchedQuery("");
    setNotice(null);
    setError(null);
    setHighlightIdx(-1);
    onClearSearch();
    inputRef.current?.focus();
  };

  const handleGpsLocate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setOpen(true);
      setError("このブラウザではGPS現在地取得が利用できません。");
      return;
    }
    setGpsLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));
        try {
          const rev = await reverseGeocode(lat, lon);
          const item: LocationSearchResult = {
            id: `gps:${lat.toFixed(5)},${lon.toFixed(5)}`,
            title: "現在地（GPS）",
            subtitle: rev.address || `緯度 ${lat.toFixed(5)}, 経度 ${lon.toFixed(5)}`,
            address: rev.address || `緯度 ${lat.toFixed(5)}, 経度 ${lon.toFixed(5)}`,
            kind: "coordinates",
            kind_label: "現在地",
            source: rev.source,
            source_label: "GPS現在地",
            lat,
            lon,
            zoom: 16.2,
            bbox: null,
            ward_name: rev.ward_name ?? null,
            meshcode: rev.kyoto_context?.meshcode ?? null,
            kyoto_context: rev.kyoto_context ?? null,
          };
          chooseResult(item);
        } catch {
          const item: LocationSearchResult = {
            id: `gps:${lat.toFixed(5)},${lon.toFixed(5)}`,
            title: "現在地（GPS）",
            subtitle: `緯度 ${lat.toFixed(5)}, 経度 ${lon.toFixed(5)}`,
            address: `緯度 ${lat.toFixed(5)}, 経度 ${lon.toFixed(5)}`,
            kind: "coordinates",
            kind_label: "現在地",
            source: "coordinates",
            source_label: "GPS現在地",
            lat,
            lon,
            zoom: 16.2,
            bbox: null,
          };
          chooseResult(item);
        } finally {
          setGpsLoading(false);
        }
      },
      () => {
        setGpsLoading(false);
        setOpen(true);
        setError("位置情報の利用権限が許可されていないため現在地を取得できませんでした。");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current || e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      if (results.length > 0) {
        setHighlightIdx((idx) => (idx + 1) % results.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) {
        setHighlightIdx((idx) => (idx <= 0 ? results.length - 1 : idx - 1));
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  if (hidden) return null;

  const hasQuery = query.trim().length > 0;
  const showEmptyTips = open && !hasQuery;
  const showSearchResults = open && hasQuery;

  return (
    <div
      ref={containerRef}
      data-testid="location-search-container"
      className={`pointer-events-auto fixed top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-[25] transition-all duration-200 sm:top-[66px] ${
        drawerOpen
          ? "hidden lg:block lg:left-[min(444px,calc(100vw-460px))] lg:w-[min(360px,calc(100vw-608px))] xl:left-[444px]"
          : "inset-x-2 w-auto sm:left-3 sm:right-auto sm:w-[min(404px,calc(100vw-24px))]"
      }`}
    >
      {/* Floating Google-Maps-Style Search Pill */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className={`flex items-center gap-1.5 rounded-2xl border bg-slate-900/95 px-2.5 py-1.5 shadow-2xl backdrop-blur-xl transition ${
          open
            ? "border-sky-400/80 ring-2 ring-sky-500/20"
            : "border-slate-700/85 hover:border-slate-500/80"
        }`}
      >
        <button
          type="submit"
          aria-label="検索を実行"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-800 hover:text-sky-300"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
          ) : (
            <Search className="h-4 w-4 text-sky-400" />
          )}
        </button>

        <input
          ref={inputRef}
          type="text"
          value={query}
          data-testid="location-search-input"
          aria-label="住所・施設・避難場所・駅を検索"
          placeholder="住所・施設・避難場所・駅・通り名を検索..."
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const val = e.target.value;
            setQuery(val);
            if (!val.trim()) {
              abortRef.current?.abort();
              setResults([]);
              setSearchedQuery("");
              setNotice(null);
              setError(null);
              setLoading(false);
            }
            if (!open) setOpen(true);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent py-1 text-base sm:text-sm text-white placeholder-slate-400 outline-none"
        />

        {activeSearchPlace && candidateCount > 1 && !open && (
          <button
            type="button"
            data-testid="location-search-show-candidates"
            onClick={() => {
              setOpen(true);
              if (results.length === 0 && query.trim()) {
                void executeSearch(query.trim());
              }
            }}
            className="shrink-0 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[10px] font-bold text-sky-200 hover:bg-sky-500/25"
          >
            候補{candidateCount}
          </button>
        )}

        {(hasQuery || activeSearchPlace) && (
          <button
            type="button"
            data-testid="location-search-clear"
            onClick={handleClear}
            title="検索をクリア"
            aria-label="検索をクリア"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="h-5 w-px bg-slate-800" />

        <button
          type="button"
          data-testid="location-search-gps"
          onClick={handleGpsLocate}
          disabled={gpsLoading}
          title="GPS現在地へ移動"
          aria-label="GPS現在地へ移動"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-800 hover:text-emerald-300 disabled:opacity-50"
        >
          {gpsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          ) : (
            <LocateFixed className="h-4 w-4 text-emerald-400" />
          )}
        </button>
      </form>

      {/* Dropdown: Quick Spots & Recent Searches when Empty */}
      {showEmptyTips && (
        <div
          data-testid="location-search-dropdown"
          className="mt-1.5 overflow-hidden rounded-2xl border border-slate-700/85 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur-xl space-y-3"
        >
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/50 bg-rose-950/50 px-2.5 py-2 text-[11px] text-rose-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              京都市 クイック検索
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SPOTS.map((spot) => (
                <button
                  key={spot}
                  type="button"
                  onClick={() => void handleQuickSpot(spot)}
                  className="rounded-full border border-slate-700/90 bg-slate-950/80 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:border-sky-400/70 hover:bg-sky-500/15 hover:text-white"
                >
                  {spot}
                </button>
              ))}
            </div>
          </div>

          {recentItems.length > 0 && (
            <div className="border-t border-slate-800 pt-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <History className="h-3 w-3" />
                  最近の検索
                </span>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      window.localStorage.removeItem(RECENT_STORAGE_KEY);
                    } catch {
                      // ignore
                    }
                    setRecentItems([]);
                  }}
                  className="text-[10px] text-slate-400 hover:text-slate-200"
                >
                  履歴を消去
                </button>
              </div>
              <div className="space-y-0.5">
                {recentItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseResult(item)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-800/80"
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-100">{item.title}</div>
                      <div className="truncate text-[10px] text-slate-400">{item.address}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-slate-800 pt-2 text-[10px] leading-relaxed text-slate-400">
            住所（例: <code className="text-slate-300">中京区上本能寺前町488</code>）、通り名、避難場所、
            緯度経度（<code className="text-slate-300">35.0116, 135.7681</code>）、建物ID、メッシュ番号に対応
          </div>
        </div>
      )}

      {/* Dropdown: Live Search Candidates */}
      {showSearchResults && (
        <div
          data-testid="location-search-dropdown"
          className="mt-1.5 max-h-[min(52dvh,420px)] overflow-y-auto rounded-2xl border border-slate-700/85 bg-slate-900/95 p-1.5 text-xs text-slate-200 shadow-2xl backdrop-blur-xl"
        >
          {notice && (
            <div className="mx-1 mb-1 rounded-lg border border-amber-500/40 bg-amber-950/40 px-2.5 py-1.5 text-[10px] text-amber-200">
              {notice}
            </div>
          )}

          {error && (
            <div className="mx-1 my-1 flex items-start gap-2 rounded-xl border border-rose-500/50 bg-rose-950/50 px-2.5 py-2 text-[11px] text-rose-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {loading && results.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
              <span>住所・施設を検索中...</span>
            </div>
          )}

          {!loading && !error && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-3 py-4 text-xs leading-relaxed text-slate-400">
              「<strong className="text-slate-200">{query.trim()}</strong>」に一致する場所が見つかりませんでした。
              <div className="mt-1 text-[11px] text-slate-500">
                区名・町名、駅・施設名、または緯度経度（例: 35.0116, 135.7681）をお試しください。
              </div>
            </div>
          )}

          {!loading && results.length === 0 && query.trim().length < 2 && (
            <div className="px-3 py-3 text-[11px] text-slate-400">
              2文字以上入力するか、Enterキーで検索します。
            </div>
          )}

          <div className="space-y-0.5">
            {results.map((item, idx) => {
              const isHighlighted = idx === highlightIdx;
              const ctx = item.kyoto_context;
              const t30Pct =
                ctx?.t30_i55_ps != null ? `${(ctx.t30_i55_ps * 100).toFixed(0)}%` : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid="location-search-result-item"
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => chooseResult(item, results)}
                  className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                    isHighlighted
                      ? "bg-sky-500/20 text-white ring-1 ring-sky-400/50"
                      : "hover:bg-slate-800/80"
                  }`}
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-950/80">
                    <KindIcon kind={item.kind} className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-bold text-white">{item.title}</span>
                      <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-slate-300">
                        {item.kind_label}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400">
                      {item.address !== item.title ? item.address : item.subtitle}
                    </div>
                  </div>
                  <div className="mt-0.5 flex shrink-0 flex-col items-end gap-1">
                    {item.is_wide_area ? (
                      <span className="rounded border border-orange-500/50 bg-orange-500/20 px-1.5 py-0.5 text-[9px] font-bold text-orange-200">
                        広域避難
                      </span>
                    ) : t30Pct ? (
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${hazardPillClass(
                          ctx?.hazard_tier
                        )}`}
                        title="J-SHIS 30年震度6弱以上確率"
                      >
                        6弱+ {t30Pct}
                      </span>
                    ) : ctx && !ctx.in_kyoto_coverage ? (
                      <span className="rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 text-[9px] text-slate-400">
                        京都市外
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
