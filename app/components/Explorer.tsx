"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CountyMap from "./CountyMap";
import { Highlights, HigherLower, PlaceInsights } from "./Insights";
import { METRIC_DEFS, formatMetric, type MetricKey } from "@/lib/metricDefs";
import { Donut, HBar, Pyramid, ChartEmpty, CHART_COLORS, COMPARE_COLORS } from "./Charts";
import {
  computeIndicators,
  formatInt,
  formatMoney,
  formatPct,
  type Indicators,
  type ObsMap,
} from "@/lib/indicators";

interface Geography {
  geo_id: string;
  name: string;
  geo_type: string;
  state_fips: string;
  state_name: string;
  county_count?: number;
}

interface PlaceSuggestion {
  place: string;
  placeType: string;
  county: string;
  state: string;
  geo_id: string;
  geo_type: string;
  state_fips: string;
}

interface Meta {
  release: string | null;
  refreshed_at: string | null;
  geo_count: number;
  obs_count?: number;
  seeded: boolean;
}

/* ---------- icons ---------- */

function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}
const I = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  pin: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  columns: "M12 3v18M3 8h18M3 16h18",
  map: "M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16",
  db: "M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5",
  chart: "M18 20V10M12 20V4M6 20v-6",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  x: "M18 6L6 18M6 6l12 12",
  menu: "M3 12h18M3 6h18M3 18h18",
  arrow: "M5 12h14M12 5l7 7-7 7",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  spark: "M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5 2.3-7.2-6-4.6h7.6z",
  game: "M6 12h4M8 10v4M15 13h.01M18 11h.01M17.32 5H6.68a4 4 0 0 0-3.978 3.59l-.9 8.1A3 3 0 0 0 4.78 20c1 0 1.9-.5 2.4-1.3L9 16h6l1.8 2.7c.5.8 1.4 1.3 2.4 1.3a3 3 0 0 0 2.98-3.31l-.9-8.1A4 4 0 0 0 17.32 5z",
};

const AVATAR_COLORS = ["bg-blue-600", "bg-orange-500", "bg-teal-600", "bg-purple-600", "bg-rose-500", "bg-emerald-600"];

/* ---------- presentational pieces ---------- */

function StatCard({ label, value, sub, action, trend }: { label: string; value: string; sub?: string; action?: React.ReactNode; trend?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200/80 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-stone-600">{label}</div>
        {action}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-3xl font-extrabold tracking-tight tabular-nums">{value}</span>
        {trend}
      </div>
      {sub && <div className="mt-1.5 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

/** Small change badge vs the 2019–2023 ACS baseline. Hidden when unavailable.
 *  Green = moved in the "good" direction (rising income falls back to red for
 *  poverty via `invert`), red = bad direction, stone = essentially flat. */
function TrendBadge({
  change,
  unit,
  invert,
  current,
  previous,
  format,
}: {
  change: number | null | undefined;
  unit: "%" | "pp";
  invert?: boolean;
  current: number | null | undefined;
  previous: number | null | undefined;
  format: (v: number | null) => string;
}) {
  if (change == null || !Number.isFinite(change)) return null;
  const rounded = Math.round(change * 10) / 10;
  const flat = Math.abs(rounded) < 0.05;
  const up = rounded > 0;
  const good = flat ? null : invert ? !up : up;
  const cls =
    good == null
      ? "bg-stone-100 text-stone-500 ring-stone-300/50"
      : good
        ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
        : "bg-rose-50 text-rose-700 ring-rose-600/20";
  const arrow = flat ? "→" : up ? "↑" : "↓";
  const sign = flat ? "" : up ? "+" : "−";
  const delta = unit === "pp" ? `${Math.abs(rounded).toFixed(1)} pts` : `${Math.abs(rounded).toFixed(1)}%`;
  const tip = `vs 2019–2023 ACS 5-year: ${format(previous ?? null)} → ${format(current ?? null)}`;
  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ring-inset ${cls}`}
    >
      <span aria-hidden="true">{arrow}</span>
      {sign}
      {delta}
    </span>
  );
}

/** Best-guess geo_type from a Census Reporter geo_id (for ?geo= deep links). */
function geoTypeFromId(id: string): string {
  if (id.startsWith("04000US")) return "state";
  if (id.startsWith("05000US")) return "county";
  if (id.startsWith("16000US")) return "place";
  if (id.startsWith("06000US")) return "county_subdivision";
  if (id.startsWith("14000US")) return "tract";
  return "county";
}

/** Friendly label for geo types, incl. on-demand granularities. */
function geoTypeLabel(g: { geo_type: string; name: string }): string {
  if (g.geo_type === "county_subdivision") {
    if (/\btownship$/i.test(g.name)) return "Township";
    if (/\btown$/i.test(g.name)) return "Town";
    return "County subdivision";
  }
  if (g.geo_type === "tract") return "Census tract";
  if (g.geo_type === "place") return "Place";
  if (g.geo_type === "state") return "State";
  return "County";
}

function Card({ title, sub, link, children, id }: { title: string; sub?: string; link?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="scroll-mt-32 rounded-2xl border border-stone-200/80 bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-bold tracking-tight">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
        </div>
        {link}
      </div>
      {children}
    </div>
  );
}

function LegendRow({ color, label, pct, value }: { color: string; label: string; pct: number | null; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-50">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
      <span className="min-w-0 flex-1 truncate text-stone-700">
        {label} <span className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-500">{formatPct(pct)}</span>
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Avatar({ name, index = 0, size = "h-9 w-9 text-sm" }: { name: string; index?: number; size?: string }) {
  const letter = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-xl font-bold text-white ${AVATAR_COLORS[index % AVATAR_COLORS.length]}`}>
      {letter}
    </span>
  );
}

/* ---------- overview chart cards ---------- */

const RANK_METRIC_KEYS: MetricKey[] = [
  "income", "population", "poverty", "diversity", "college", "seniors", "youth", "homeownership", "vacancy", "hispanic",
];
const RANK_METRICS = RANK_METRIC_KEYS.map((key) => ({
  key,
  label: METRIC_DEFS[key].label,
  format: (v: number | null) => formatMetric(key, v),
  // Rates on tiny counties are noisy — rank rate metrics among 10k+ residents only.
  minPop: METRIC_DEFS[key].unit === "count" ? 0 : 10_000,
}));

interface RankRow {
  geo_id: string;
  name: string;
  state_fips: string;
  state_name: string;
  value: number | null;
}

function ChartSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i}>
          <div className="flex justify-between gap-2">
            <div className="h-3.5 w-2/5 animate-pulse rounded bg-stone-100" />
            <div className="h-3.5 w-16 animate-pulse rounded bg-stone-100" />
          </div>
          <div className="mt-1.5 h-2.5 animate-pulse rounded-full bg-stone-100" />
        </div>
      ))}
    </div>
  );
}

function metricPills<T extends string>(options: Array<{ key: T; label: string }>, active: T, onPick: (k: T) => void) {
  return (
    <div className="nice-scroll flex flex-1 gap-1.5 overflow-x-auto pb-0.5">
      {options.map((m) => (
        <button
          key={m.key}
          onClick={() => onPick(m.key)}
          aria-pressed={active === m.key}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
            active === m.key
              ? "bg-stone-900 text-white shadow-sm"
              : "border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function RankingsCard({ onSelect }: { onSelect: (g: Geography) => void }) {
  const [metric, setMetric] = useState<MetricKey>("income");
  const [mode, setMode] = useState<"top" | "bottom">("top");
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const minPop = RANK_METRICS.find((m) => m.key === metric)?.minPop ?? 0;
    fetch(`/api/metric-values?metric=${metric}&mode=${mode}&limit=10${minPop ? `&min_pop=${minPop}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) {
          setRows((j.geos || []).filter((g: RankRow) => g.value != null));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metric, mode]);

  const def = RANK_METRICS.find((m) => m.key === metric)!;
  return (
    <Card
      title="County rankings"
      sub={`${mode === "top" ? "Highest" : "Lowest"} 10 U.S. counties by ${METRIC_DEFS[metric].noun}${def.minPop ? " (10,000+ residents)" : ""} — tap a bar to open it`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {metricPills(RANK_METRICS.map((m) => ({ key: m.key, label: m.label })), metric, setMetric)}
        <div className="flex shrink-0 overflow-hidden rounded-full border border-stone-200 text-xs font-semibold">
          {(["top", "bottom"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`px-3.5 py-1.5 capitalize transition-colors ${
                mode === m ? "bg-blue-600 text-white" : "bg-white text-stone-500 hover:text-stone-900"
              }`}
            >
              {m === "top" ? "Top 10" : "Bottom 10"}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <ChartSkeleton rows={10} />
      ) : rows.length > 0 ? (
        <HBar
          ariaLabel={`${mode === "top" ? "Top" : "Bottom"} 10 counties by ${def.label}`}
          items={rows.map((r) => ({
            label: r.name,
            value: r.value ?? 0,
            display: def.format(r.value),
            color: "#2563eb",
            title: `${r.name} · ${def.format(r.value)}`,
            onClick: () =>
              onSelect({
                geo_id: r.geo_id,
                name: r.name,
                geo_type: "county",
                state_fips: r.state_fips,
                state_name: r.state_name,
              }),
          }))}
        />
      ) : (
        <ChartEmpty />
      )}
    </Card>
  );
}

function LargestStatesCard({ onSelect }: { onSelect: (g: Geography) => void }) {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/metric-values?metric=population&geo_type=state&mode=top&limit=15")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) {
          setRows((j.geos || []).filter((g: RankRow) => g.value != null));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card title="Largest states" sub="Top 15 states by population · ACS 5-year — tap a bar to open it">
      {loading ? (
        <ChartSkeleton rows={8} />
      ) : rows.length > 0 ? (
        <HBar
          ariaLabel="Top 15 states by population"
          items={rows.map((r) => ({
            label: r.name,
            value: r.value ?? 0,
            display: formatInt(r.value),
            color: "#0d9488",
            title: `${r.name} · ${formatInt(r.value)}`,
            onClick: () =>
              onSelect({
                geo_id: r.geo_id,
                name: r.name,
                geo_type: "state",
                state_fips: r.state_fips,
                state_name: r.state_name,
              }),
          }))}
        />
      ) : (
        <ChartEmpty />
      )}
    </Card>
  );
}

/* ---------- compare chart ---------- */

function CompareChart({
  compare,
  rows,
}: {
  compare: Array<{ geo: Geography; ind: Indicators }>;
  rows: Array<{
    label: string;
    num: (i: Indicators) => number | null;
    format: (n: number | null | undefined) => string;
  }>;
}) {
  const [label, setLabel] = useState(rows[0]?.label ?? "");
  const row = rows.find((r) => r.label === label) ?? rows[0];
  if (!row) return null;
  return (
    <Card title="Visual comparison" sub="Pick an indicator to compare every geography side by side">
      <div className="mb-4">
        {metricPills(rows.map((r) => ({ key: r.label, label: r.label })), label, setLabel)}
      </div>
      <HBar
        ariaLabel={`Comparison chart: ${row.label}`}
        items={compare.map((c, i) => {
          const n = row.num(c.ind);
          return {
            label: c.geo.name,
            value: n ?? 0,
            display: row.format(n),
            color: COMPARE_COLORS[i % COMPARE_COLORS.length],
            title: `${c.geo.name}: ${row.format(n)}`,
          };
        })}
      />
    </Card>
  );
}

/* ---------- main component ---------- */

export default function Explorer() {  const [meta, setMeta] = useState<Meta | null>(null);
  const [states, setStates] = useState<Geography[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Geography[]>([]);
  const [placeResults, setPlaceResults] = useState<PlaceSuggestion[]>([]);
  const [placesNote, setPlacesNote] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<Geography | null>(null);
  const [obs, setObs] = useState<ObsMap | null>(null);
  const [obsLoading, setObsLoading] = useState(false);
  const [obsError, setObsError] = useState<string | null>(null);
  const [fetchedLive, setFetchedLive] = useState(false);

  interface TrendSet {
    baseline_release: string;
    trends: Record<string, { current: number | null; previous: number | null; change: number | null; unit: "%" | "pp" }>;
  }
  const [trendSet, setTrendSet] = useState<TrendSet | null>(null);

  const [counties, setCounties] = useState<Geography[]>([]);
  const [countyFilter, setCountyFilter] = useState("");

  const [compare, setCompare] = useState<Array<{ geo: Geography; ind: Indicators }>>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [surprising, setSurprising] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const r = await fetch("/api/meta");
      if (r.ok) setMeta(await r.json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    loadMeta();
    fetch("/api/geographies")
      .then((r) => r.json())
      .then((j) => setStates(j.geographies || []))
      .catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && t && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadMeta]);

  /* debounced merged search: direct matches + smart place resolution */
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setPlaceResults([]);
      setPlacesNote(null);
      setShowResults(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const [gRes, pRes] = await Promise.allSettled([
        fetch(`/api/geographies?q=${encodeURIComponent(q)}&limit=12`).then((r) => r.json()),
        fetch(`/api/places?q=${encodeURIComponent(q)}&limit=5`).then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          return j;
        }),
      ]);
      if (gRes.status === "fulfilled") setResults(gRes.value.geographies || []);
      else setResults([]);
      if (pRes.status === "fulfilled") {
        setPlaceResults(pRes.value.suggestions || []);
        setPlacesNote(null);
      } else {
        setPlaceResults([]);
        setPlacesNote("Place search is unavailable right now — showing direct matches.");
      }
      setShowResults(true);
      setSearching(false);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const selectGeo = useCallback(async (g: Geography, push = true) => {
    // Shareable deep link: ?geo=<geo_id> (back button returns to the previous view).
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("geo") !== g.geo_id) {
        url.searchParams.set("geo", g.geo_id);
        if (push) window.history.pushState({ geo: g.geo_id }, "", url);
        else window.history.replaceState({ geo: g.geo_id }, "", url);
      }
    } catch { /* non-browser */ }
    setSelected(g);
    setQuery("");
    setShowResults(false);
    setObs(null);
    setObsError(null);
    setObsLoading(true);
    setFetchedLive(false);
    setTrendSet(null);
    setCounties([]);
    setCountyFilter("");
    let geo = g;
    try {
      const r = await fetch(`/api/observations?geo_id=${encodeURIComponent(g.geo_id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setObs(j.tables || {});
      setFetchedLive(!!j.fetched_live);
      if (j.geography) {
        geo = j.geography as Geography;
        setSelected(geo);
      }
      if (Object.keys(j.tables || {}).length === 0) setObsError("No data for this geography yet — run a refresh.");
      // Trends load in parallel; badges appear when ready, hidden on failure.
      fetch(`/api/trends?geo_id=${encodeURIComponent(g.geo_id)}`)
        .then((tr) => tr.json())
        .then((tj) => {
          if (tj.trends) setTrendSet(tj as TrendSet);
        })
        .catch(() => {});
    } catch (e) {
      setObsError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setObsLoading(false);
    }
    if (geo.geo_type === "state") {
      try {
        const r = await fetch(`/api/geographies?state_fips=${geo.state_fips}`);
        const j = await r.json();
        setCounties(j.geographies || []);
      } catch {
        /* ignore */
      }
    }
  }, []);

  /* Chat widget deep-link: "View in dashboard" from a chat answer selects the place. */
  useEffect(() => {
    const onChatSelect = (e: Event) => {
      const g = (e as CustomEvent<Geography>).detail;
      if (g && g.geo_id) {
        selectGeo(g);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener("chat:select-place", onChatSelect);
    return () => window.removeEventListener("chat:select-place", onChatSelect);
  }, [selectGeo]);

  /* Deep links: open ?geo= on load, and follow browser back/forward. */
  useEffect(() => {
    const fromUrl = (push: boolean) => {
      const id = new URL(window.location.href).searchParams.get("geo");
      if (id && /^[0-9A-Za-z]{7,40}$/.test(id)) {
        selectGeo({ geo_id: id, name: "Loading…", geo_type: geoTypeFromId(id), state_fips: id.slice(7, 9), state_name: "" }, push);
        return true;
      }
      return false;
    };
    fromUrl(false);
    const onPop = () => {
      if (!fromUrl(false)) goHome(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openGeo = useCallback(
    (g: Geography) => {
      selectGeo(g);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [selectGeo]
  );

  const surprise = useCallback(async () => {
    setSurprising(true);
    setSidebarOpen(false);
    try {
      const r = await fetch("/api/random");
      const j = await r.json();
      if (r.ok && j.geography) openGeo(j.geography as Geography);
    } catch {
      /* ignore */
    } finally {
      setSurprising(false);
    }
  }, [openGeo]);

  const share = useCallback(async () => {
    const url = window.location.href;
    const title = selected ? `${selected.name} · US Demographics Explorer` : "US Demographics Explorer";
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareMsg("Link copied");
    } catch {
      setShareMsg("Copy failed — use the address bar");
    }
    setTimeout(() => setShareMsg(null), 2200);
  }, [selected]);

  const selectPlace = useCallback(
    (p: PlaceSuggestion) => {
      selectGeo({
        geo_id: p.geo_id,
        name: p.place,
        geo_type: p.geo_type,
        state_fips: p.state_fips,
        state_name: p.state,
      });
    },
    [selectGeo]
  );

  const goHome = useCallback((push = true) => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("geo")) {
        url.searchParams.delete("geo");
        if (push) window.history.pushState({}, "", url);
        else window.history.replaceState({}, "", url);
      }
    } catch { /* non-browser */ }
    setSelected(null);
    setObs(null);
    setCounties([]);
    setQuery("");
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollTo = useCallback((id: string) => {
    setSidebarOpen(false);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const focusSearch = useCallback(() => {
    setSidebarOpen(false);
    if (!selected) window.scrollTo({ top: 0, behavior: "smooth" });
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [selected]);

  const addToCompare = useCallback(
    (g: Geography, ind: Indicators) => {
      setCompare((prev) => {
        if (prev.some((c) => c.geo.geo_id === g.geo_id)) return prev;
        if (prev.length >= 3) return [...prev.slice(1), { geo: g, ind }];
        return [...prev, { geo: g, ind }];
      });
      setTimeout(() => scrollTo("compare"), 50);
    },
    [scrollTo]
  );

  /** Add any geography to the comparison (fetches its indicators first). */
  const compareGeo = useCallback(
    async (g: Geography) => {
      try {
        const r = await fetch(`/api/observations?geo_id=${encodeURIComponent(g.geo_id)}`);
        const j = await r.json();
        if (!r.ok) return;
        addToCompare((j.geography as Geography) || g, computeIndicators(j.tables || {}));
      } catch {
        /* ignore */
      }
    },
    [addToCompare]
  );

  async function doRefresh(force: boolean) {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      let url = "/api/refresh";
      if (force) {
        const token = window.prompt("Enter REFRESH_TOKEN to force a refresh:");
        if (!token) {
          setRefreshing(false);
          return;
        }
        url += `?force=1&token=${encodeURIComponent(token)}`;
      }
      const r = await fetch(url, { method: "POST" });
      const j = await r.json();
      if (r.status === 429) {
        setRefreshMsg("Data was refreshed less than 6 hours ago — use Force refresh to override.");
      } else if (r.status === 401) {
        setRefreshMsg("Force refresh rejected: wrong token.");
      } else if (!r.ok) {
        setRefreshMsg(`Refresh failed: ${j.error || r.status}`);
      } else {
        setRefreshMsg(`Done — ${j.release} · ${Number(j.geos).toLocaleString()} geographies · ${Number(j.observations).toLocaleString()} values.`);
        await loadMeta();
        if (selected) selectGeo(selected);
      }
    } catch {
      setRefreshMsg("Refresh failed: network error.");
    } finally {
      setRefreshing(false);
    }
  }

  const ind = obs ? computeIndicators(obs) : null;
  const T = trendSet?.trends ?? null;
  const shownCounties = countyFilter
    ? counties.filter((c) => c.name.toLowerCase().includes(countyFilter.toLowerCase()))
    : counties;
  const hasAnyResults = results.length > 0 || placeResults.length > 0;

  const compareRows: Array<{
    label: string;
    get: (i: Indicators) => string;
    num: (i: Indicators) => number | null;
    format: (n: number | null | undefined) => string;
  }> = [
    { label: "Population", get: (i) => formatInt(i.population), num: (i) => i.population, format: formatInt },
    { label: "Median household income", get: (i) => formatMoney(i.medianIncome), num: (i) => i.medianIncome, format: formatMoney },
    { label: "Poverty rate", get: (i) => formatPct(i.povertyRate), num: (i) => i.povertyRate, format: formatPct },
    {
      label: "Hispanic / Latino",
      get: (i) => formatPct((i.hispanic / Math.max(1, i.population)) * 100),
      num: (i) => (i.hispanic / Math.max(1, i.population)) * 100,
      format: formatPct,
    },
    {
      label: "White alone, non-Hispanic",
      get: (i) => formatPct(i.raceNH[0]?.pct),
      num: (i) => i.raceNH[0]?.pct ?? null,
      format: formatPct,
    },
    {
      label: "Bachelor's degree or higher (25+)",
      get: (i) => formatPct((i.education[3]?.pct ?? 0) + (i.education[4]?.pct ?? 0)),
      num: (i) => (i.education[3]?.pct ?? 0) + (i.education[4]?.pct ?? 0),
      format: formatPct,
    },
    { label: "Homeownership rate", get: (i) => formatPct(i.ownerRate), num: (i) => i.ownerRate, format: formatPct },
    { label: "Housing units", get: (i) => formatInt(i.housingUnits), num: (i) => i.housingUnits, format: formatInt },
  ];

  const releaseLabel = meta?.release ? meta.release.replace("acs", "ACS ").replace("_5yr", " 5-year") : "—";
  const updatedLabel = meta?.refreshed_at ? new Date(meta.refreshed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

  const navGroups: Array<{
    label: string;
    items: Array<{ label: string; icon: string; badge?: number; onClick: () => void; active?: boolean }>;
  }> = [
    {
      label: "Essentials",
      items: [
        { label: "Overview", icon: I.grid, onClick: () => goHome(), active: !selected },
        { label: "Compare", icon: I.columns, badge: compare.length || undefined, onClick: () => scrollTo("compare") },
        { label: "Refresh data", icon: I.refresh, onClick: () => doRefresh(false) },
      ],
    },
    {
      label: "Explore",
      items: [
        { label: "Find a place", icon: I.pin, onClick: focusSearch },
        { label: "Surprise me", icon: I.dice, onClick: surprise },
        { label: "Did you know?", icon: I.spark, onClick: () => { if (selected) goHome(); setTimeout(() => scrollTo("highlights"), 60); } },
        { label: "Higher or lower", icon: I.game, onClick: () => { if (selected) goHome(); setTimeout(() => scrollTo("game"), 60); } },
        { label: "Browse states", icon: I.map, onClick: () => { if (selected) goHome(); setTimeout(() => scrollTo("states"), 60); } },
      ],
    },
    {
      label: "Data",
      items: [{ label: "Data source", icon: I.db, onClick: () => scrollTo("source") }],
    },
  ];

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2.5 border-b border-stone-200/70 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
          <Icon d={I.chart} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold tracking-tight">US Demographics</div>
          <div className="text-[11px] text-stone-500">Explorer</div>
        </div>
      </div>

      <nav className="nice-scroll flex-1 overflow-y-auto px-3 py-4">
        {navGroups.map((g) => (
          <div key={g.label} className="mb-5">
            <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{g.label}</div>
            {g.items.map((it) => (
              <button
                key={it.label}
                onClick={it.onClick}
                className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  it.active ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-100/70 hover:text-stone-900"
                }`}
              >
                <Icon d={it.icon} className="h-4 w-4 shrink-0 text-stone-400" />
                <span className="flex-1 text-left">{it.label}</span>
                {it.badge != null && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white">
                    {it.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-stone-200/70 p-3">
        <div className="rounded-2xl bg-gradient-to-br from-blue-50 via-indigo-50 to-amber-50 p-4">
          <div className="text-sm font-bold">Latest release</div>
          <p className="mt-0.5 text-xs text-stone-600">
            {releaseLabel} · {meta?.seeded ? `${Number(meta.geo_count).toLocaleString()} geographies` : "not seeded yet"}
          </p>
          <button
            onClick={() => doRefresh(true)}
            disabled={refreshing}
            className="mt-2.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          >
            Force refresh
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f6f6f4] text-stone-900 antialiased">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-stone-200/70 lg:block">{sidebar}</aside>
      {/* mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-stone-900/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* top bar */}
        <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-[#f6f6f4]/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 hover:bg-stone-200/60 lg:hidden" aria-label="Open menu">
              <Icon d={I.menu} />
            </button>
            <h1 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <Icon d={I.grid} className="h-5 w-5 text-stone-500" />
              {selected ? selected.name : "Overview"}
            </h1>
            <div className="ml-auto flex items-center gap-2">
              {shareMsg && <span className="text-xs font-semibold text-emerald-700" role="status">{shareMsg}</span>}
              <button
                onClick={share}
                className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100"
                title="Share a link to this view"
              >
                <Icon d={I.share} />
                <span className="hidden sm:inline">Share</span>
              </button>
              <span className="hidden rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 sm:inline">
                {releaseLabel} · updated {updatedLabel}
              </span>
              <button
                onClick={() => doRefresh(false)}
                disabled={refreshing}
                className="rounded-lg bg-stone-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
          {refreshMsg && (
            <div className="mx-4 mb-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:mx-6">{refreshMsg}</div>
          )}
          {selected && ind && !obsLoading && (
            <div className="nice-scroll flex gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
              {[
                ["Snapshot", "snapshot"],
                ["Quick take", "sec-quicktake"],
                ["Where it stands", "sec-standing"],
                ["Lookalikes", "sec-twins"],
                ["Race", "sec-race"],
                ["Ethnicity", "sec-ethnicity"],
                ["Age", "sec-age"],
                ["Education", "sec-education"],
                ["Housing", "sec-housing"],
              ].map(([label, id]) => (
                <button
                  key={id}
                  onClick={() => scrollTo(id)}
                  className="shrink-0 rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-stone-600 hover:border-stone-300 hover:text-stone-900"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          {/* search */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-stone-400">
              <Icon d={I.search} />
            </div>
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => query.trim() && setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
              placeholder="Search a town, township, borough, county, or state…"
              className="w-full rounded-2xl border border-stone-200 bg-white py-3.5 pl-11 pr-14 text-[15px] shadow-sm outline-none placeholder:text-stone-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <kbd className="pointer-events-none absolute inset-y-0 right-4 hidden items-center rounded-md border border-stone-200 bg-stone-50 px-2 text-xs font-semibold text-stone-400 sm:flex">
              /
            </kbd>
            {showResults && (hasAnyResults || placesNote) && (
              <div className="nice-scroll absolute z-10 mt-2 max-h-96 w-full overflow-y-auto rounded-2xl border border-stone-200 bg-white p-2 shadow-xl">
                {results.length > 0 && (
                  <>
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Direct matches</div>
                    {results.map((g) => (
                      <button
                        key={g.geo_id}
                        onMouseDown={() => selectGeo(g)}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-stone-100"
                      >
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ${g.geo_type === "state" ? "bg-blue-100 text-blue-800" : "bg-stone-200 text-stone-700"}`}>
                          {g.geo_type}
                        </span>
                        <span className="text-sm font-medium">{g.name}</span>
                      </button>
                    ))}
                  </>
                )}
                {placeResults.length > 0 && (
                  <>
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Places & areas</div>
                    {placeResults.map((p) => (
                      <button
                        key={p.geo_id + p.place}
                        onMouseDown={() => selectPlace(p)}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-stone-100"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
                          <Icon d={I.pin} className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {p.place} <span className="font-normal text-stone-500">· {p.placeType}</span>
                          </span>
                          {p.geo_type !== "county" && (
                            <span className="block truncate text-xs text-stone-500">in {p.county}</span>
                          )}
                        </span>
                        <Icon d={I.arrow} className="ml-auto h-4 w-4 shrink-0 text-stone-300" />
                      </button>
                    ))}
                  </>
                )}
                {placesNote && <div className="px-3 py-2 text-xs text-stone-400">{placesNote}</div>}
              </div>
            )}
            {showResults && !searching && query.trim() && !hasAnyResults && (
              <div className="absolute z-10 mt-2 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500 shadow-xl">
                No matches. Try a city, town, ZIP code, county, or state.
                {placesNote && <span className="block pt-1 text-xs text-stone-400">{placesNote}</span>}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={surprise}
              disabled={surprising}
              className="flex items-center gap-1.5 rounded-full bg-stone-900 px-3.5 py-1.5 font-semibold text-white hover:bg-stone-700 disabled:opacity-60"
            >
              <Icon d={I.dice} className={`h-3.5 w-3.5 ${surprising ? "animate-spin" : ""}`} />
              {surprising ? "Rolling…" : "Surprise me"}
            </button>
            <span className="text-stone-400">or try</span>
            {[
              { geo_id: "05000US06037", name: "Los Angeles County, CA", geo_type: "county", state_fips: "06", state_name: "California" },
              { geo_id: "05000US36061", name: "New York County, NY", geo_type: "county", state_fips: "36", state_name: "New York" },
              { geo_id: "05000US12086", name: "Miami-Dade County, FL", geo_type: "county", state_fips: "12", state_name: "Florida" },
              { geo_id: "04000US48", name: "Texas", geo_type: "state", state_fips: "48", state_name: "Texas" },
            ].map((g) => (
              <button
                key={g.geo_id}
                onClick={() => openGeo(g)}
                className="rounded-full border border-stone-200 bg-white px-3 py-1.5 font-semibold text-stone-600 hover:border-blue-400 hover:text-blue-700"
              >
                {g.name.split(",")[0]}
              </button>
            ))}
          </div>

          {!selected && (
            <>
              {/* stat cards */}
              <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
                <StatCard label="Geographies" value={meta?.seeded ? Number(meta.geo_count).toLocaleString() : "—"} sub="States + counties tracked" />
                <StatCard label="Data points" value={meta?.obs_count ? Number(meta.obs_count).toLocaleString() : "—"} sub="ACS estimates in the database" />
                <StatCard label="Release" value={meta?.release ? "2024" : "—"} sub={releaseLabel} />
                <StatCard label="Last updated" value={updatedLabel} sub="Manual refresh available anytime" />
              </div>

              {/* national superlatives */}
              <div id="highlights" className="mt-8 scroll-mt-32">
                <Highlights onSelect={openGeo} />
              </div>

              {/* national county map */}
              <div className="mt-8">
                <Card title="County map" sub="Every U.S. county, colored by the selected metric — click a county to open it">
                  <CountyMap onSelectCounty={selectGeo} />
                </Card>
              </div>

              {/* county rankings */}
              <div className="mt-8">
                <RankingsCard onSelect={selectGeo} />
              </div>

              {/* guessing game */}
              <div className="mt-8">
                <HigherLower onSelect={openGeo} />
              </div>

              {/* largest states */}
              <div className="mt-8">
                <LargestStatesCard onSelect={selectGeo} />
              </div>

              {/* states table */}
              <div id="states" className="mt-8 scroll-mt-32">
                <h2 className="mb-3 text-lg font-extrabold tracking-tight">Browse states</h2>
                <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white">
                  <div className="nice-scroll max-h-[480px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-stone-200/70 text-left text-xs text-stone-400">
                          <th className="px-5 py-3 font-semibold">State</th>
                          <th className="px-5 py-3 font-semibold">Counties</th>
                          <th className="px-5 py-3 text-right font-semibold">Explore</th>
                        </tr>
                      </thead>
                      <tbody>
                        {states.map((s, i) => (
                          <tr key={s.geo_id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/70">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-3">
                                <Avatar name={s.name} index={i} />
                                <span className="font-semibold">{s.name}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3 tabular-nums text-stone-500">{s.county_count ?? "—"}</td>
                            <td className="px-5 py-3 text-right">
                              <button onClick={() => selectGeo(s)} className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:border-blue-400 hover:text-blue-700">
                                View →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* detail */}
          {selected && (
            <div id="snapshot" className="mt-6 scroll-mt-32">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <Avatar name={selected.name} size="h-11 w-11 text-lg" />
                <div>
                  <h2 className="text-2xl font-extrabold tracking-tight">{selected.name}</h2>
                  <div className="mt-0.5 flex items-center gap-2 text-xs">
                    <span className={`rounded-md px-1.5 py-0.5 font-semibold uppercase ${selected.geo_type === "state" ? "bg-blue-100 text-blue-800" : "bg-stone-200 text-stone-700"}`}>
                      {geoTypeLabel(selected)}
                    </span>
                    {fetchedLive && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700" title="Fetched live from the Census just now and cached for next time">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
                      </span>
                    )}
                    {selected.geo_type !== "state" && <span className="text-stone-500">{selected.state_name}</span>}
                  </div>
                </div>
                <div className="ml-auto flex gap-2">
                  {ind && (
                    <button onClick={() => addToCompare(selected, ind)} className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
                      + Compare
                    </button>
                  )}
                  <button onClick={() => goHome()} className="rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100">
                    Clear
                  </button>
                </div>
              </div>

              {obsLoading && (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-28 animate-pulse rounded-2xl bg-white" />
                  ))}
                </div>
              )}
              {obsError && !obsLoading && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">{obsError}</div>
              )}

              {ind && !obsLoading && (
                <>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <StatCard
                      label="Population"
                      value={formatInt(ind.population)}
                      sub="ACS 5-year estimate"
                      trend={
                        T ? (
                          <TrendBadge
                            change={T.population?.change}
                            unit="%"
                            current={T.population?.current}
                            previous={T.population?.previous}
                            format={formatInt}
                          />
                        ) : undefined
                      }
                    />
                    <StatCard
                      label="Median household income"
                      value={formatMoney(ind.medianIncome)}
                      sub={ind.incomeMoe != null ? `± ${formatMoney(ind.incomeMoe)} margin of error` : undefined}
                      trend={
                        T ? (
                          <TrendBadge
                            change={T.income?.change}
                            unit="%"
                            current={T.income?.current}
                            previous={T.income?.previous}
                            format={formatMoney}
                          />
                        ) : undefined
                      }
                    />
                    <StatCard
                      label="Poverty rate"
                      value={formatPct(ind.povertyRate)}
                      sub={`${formatInt(ind.povertyBase)} people in universe`}
                      trend={
                        T ? (
                          <TrendBadge
                            change={T.poverty?.change}
                            unit="pp"
                            invert
                            current={T.poverty?.current}
                            previous={T.poverty?.previous}
                            format={formatPct}
                          />
                        ) : undefined
                      }
                    />
                    <StatCard
                      label="Housing units"
                      value={formatInt(ind.housingUnits)}
                      sub={`${formatPct(ind.occupancyRate)} occupied`}
                      trend={
                        T ? (
                          <TrendBadge
                            change={T.housing?.change}
                            unit="%"
                            current={T.housing?.current}
                            previous={T.housing?.previous}
                            format={formatInt}
                          />
                        ) : undefined
                      }
                    />
                  </div>
                  {T && (
                    <p className="mt-2 text-[11px] text-stone-400">
                      Trend badges compare the 2024 ACS 5-year estimates with the 2019–2023 ACS 5-year — hover a badge for the before/after values.
                    </p>
                  )}

                  <PlaceInsights geo={selected} onSelect={openGeo} onCompare={compareGeo} />

                  <div className="mt-8">
                    <Card
                      title={selected.geo_type === "state" ? `Counties in ${selected.state_name || selected.name}` : "Explore nearby counties"}
                      sub="Colored by the selected metric — click a county to open it"
                    >
                      <CountyMap
                        stateFips={selected.state_fips}
                        onSelectCounty={selectGeo}
                        selectedGeoId={selected.geo_id}
                      />
                    </Card>
                  </div>

                  <h2 className="mb-3 mt-8 text-lg font-extrabold tracking-tight">Demographics</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card id="sec-race" title="Race" sub="B02001 · share of total population">
                      <div className="flex flex-col items-center gap-5 sm:flex-row">
                        <div className="w-full max-w-[220px] shrink-0">
                          <Donut
                            slices={ind.race.map((r, i) => ({
                              label: r.label,
                              value: r.value,
                              pct: r.pct,
                              color: CHART_COLORS[i % CHART_COLORS.length],
                            }))}
                            centerTop={formatInt(ind.population)}
                            centerBottom="population"
                            ariaLabel="Race breakdown donut chart"
                          />
                        </div>
                        <div className="w-full min-w-0 flex-1">
                          {ind.race.map((r, i) => (
                            <LegendRow
                              key={r.label}
                              color={["bg-blue-600", "bg-orange-500", "bg-teal-600", "bg-purple-500", "bg-rose-500", "bg-amber-500", "bg-slate-500"][i % 7]}
                              label={r.label}
                              pct={r.pct}
                              value={formatInt(r.value)}
                            />
                          ))}
                        </div>
                      </div>
                    </Card>

                    <Card id="sec-ethnicity" title="Ethnicity" sub="B03002 · Hispanic or Latino origin">
                      <div className="flex flex-col items-center gap-5 sm:flex-row">
                        <div className="w-full max-w-[220px] shrink-0">
                          <Donut
                            slices={[
                              {
                                label: "Hispanic / Latino",
                                value: ind.hispanic,
                                pct: (ind.hispanic / Math.max(1, ind.population)) * 100,
                                color: "#2563eb",
                              },
                              {
                                label: "Not Hispanic / Latino",
                                value: ind.nonHispanic,
                                pct: (ind.nonHispanic / Math.max(1, ind.population)) * 100,
                                color: "#a8a29e",
                              },
                            ]}
                            centerTop={formatPct((ind.hispanic / Math.max(1, ind.population)) * 100)}
                            centerBottom="Hispanic / Latino"
                            ariaLabel="Ethnicity donut chart"
                          />
                        </div>
                        <div className="w-full min-w-0 flex-1">
                          <LegendRow
                            color="bg-blue-600"
                            label="Hispanic / Latino"
                            pct={(ind.hispanic / Math.max(1, ind.population)) * 100}
                            value={formatInt(ind.hispanic)}
                          />
                          <LegendRow
                            color="bg-stone-400"
                            label="Not Hispanic / Latino"
                            pct={(ind.nonHispanic / Math.max(1, ind.population)) * 100}
                            value={formatInt(ind.nonHispanic)}
                          />
                        </div>
                      </div>
                      <div className="mt-5 border-t border-stone-100 pt-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400">
                          Non-Hispanic race detail
                        </div>
                        <HBar
                          ariaLabel="Non-Hispanic race detail bar chart"
                          items={ind.raceNH.map((r) => ({
                            label: r.label,
                            value: r.value,
                            display: formatPct(r.pct),
                            color: "#0d9488",
                            title: `Non-Hispanic ${r.label}: ${formatPct(r.pct)} (${formatInt(r.value)})`,
                          }))}
                        />
                      </div>
                    </Card>

                    <Card id="sec-age" title="Sex & age" sub="B01001">
                      <div className="mb-4 grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-sky-50 p-4 text-center">
                          <div className="text-2xl font-extrabold text-sky-800 tabular-nums">{formatPct((ind.male / Math.max(1, ind.population)) * 100)}</div>
                          <div className="mt-0.5 text-xs font-medium text-sky-700">Male · {formatInt(ind.male)}</div>
                        </div>
                        <div className="rounded-xl bg-rose-50 p-4 text-center">
                          <div className="text-2xl font-extrabold text-rose-800 tabular-nums">{formatPct((ind.female / Math.max(1, ind.population)) * 100)}</div>
                          <div className="mt-0.5 text-xs font-medium text-rose-700">Female · {formatInt(ind.female)}</div>
                        </div>
                      </div>
                      <div className="mt-2">
                        <Pyramid bands={ind.pyramidBands} />
                      </div>
                      <div className="mt-2 space-y-1">
                        {ind.ageBands.map((b) => (
                          <div key={b.label} className="flex justify-between text-xs text-stone-500">
                            <span>Age {b.label}</span>
                            <span className="font-semibold tabular-nums text-stone-700">{formatPct(b.pct)} · {formatInt(b.value)}</span>
                          </div>
                        ))}
                      </div>
                    </Card>

                    <Card id="sec-education" title="Education" sub="B15003 · population age 25 and over">
                      <HBar
                        ariaLabel="Educational attainment bar chart"
                        items={ind.education.map((e) => ({
                          label: e.label,
                          value: e.value,
                          display: formatPct(e.pct),
                          color: "#f59e0b",
                          title: `${e.label}: ${formatPct(e.pct)} (${formatInt(e.value)})`,
                        }))}
                      />
                      <p className="mt-3 text-xs text-stone-500">Base: {formatInt(ind.educationBase)} adults 25+</p>
                      <div className="mt-2 rounded-xl bg-amber-50 p-3 text-center">
                        <span className="text-lg font-extrabold text-amber-800 tabular-nums">
                          {formatPct((ind.education[3]?.pct ?? 0) + (ind.education[4]?.pct ?? 0))}
                        </span>
                        <span className="ml-2 text-xs font-medium text-amber-700">Bachelor's degree or higher</span>
                      </div>
                    </Card>

                    <Card id="sec-housing" title="Housing" sub="B25002 occupancy · B25003 tenure">
                      <div className="flex flex-col items-center gap-5 sm:flex-row">
                        <div className="w-full max-w-[220px] shrink-0">
                          <Donut
                            slices={[
                              { label: "Owner-occupied", value: ind.ownerUnits, pct: ind.ownerRate, color: "#059669" },
                              { label: "Renter-occupied", value: ind.renterUnits, pct: ind.renterRate, color: "#ea580c" },
                            ]}
                            centerTop={formatPct(ind.ownerRate)}
                            centerBottom="owner-occupied"
                            ariaLabel="Housing tenure donut chart"
                          />
                        </div>
                        <div className="w-full min-w-0 flex-1">
                          <LegendRow color="bg-emerald-600" label="Owner-occupied" pct={ind.ownerRate} value={formatInt(ind.ownerUnits)} />
                          <LegendRow color="bg-orange-500" label="Renter-occupied" pct={ind.renterRate} value={formatInt(ind.renterUnits)} />
                        </div>
                      </div>
                      <div className="mt-5 border-t border-stone-100 pt-4">
                        <HBar
                          ariaLabel="Occupancy bar chart"
                          items={[
                            {
                              label: "Occupied",
                              value: ind.occupiedUnits,
                              display: formatPct(ind.occupancyRate),
                              color: "#059669",
                              title: `Occupied: ${formatPct(ind.occupancyRate)} (${formatInt(ind.occupiedUnits)})`,
                            },
                            {
                              label: "Vacant",
                              value: ind.vacantUnits,
                              display: formatPct(ind.vacancyRate),
                              color: "#a8a29e",
                              title: `Vacant: ${formatPct(ind.vacancyRate)} (${formatInt(ind.vacantUnits)})`,
                            },
                          ]}
                        />
                      </div>
                      <p className="mt-3 text-xs text-stone-500">{formatInt(ind.housingUnits)} total housing units</p>
                    </Card>

                    <Card title="Gender identity" sub="Availability note">
                      <div className="rounded-xl bg-stone-100 p-4 text-sm text-stone-700">
                        <p className="font-semibold">Unavailable at the county level.</p>
                        <p className="mt-1.5 leading-relaxed">
                          The American Community Survey does not collect gender identity, so this indicator cannot be
                          shown for any state or county. Sex in this app reflects the ACS binary male/female question.
                        </p>
                      </div>
                    </Card>
                  </div>

                  {selected.geo_type === "state" && (
                    <div className="mt-8">
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-extrabold tracking-tight">Counties in {selected.name}</h3>
                        <div className="relative ml-auto">
                          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-400">
                            <Icon d={I.search} className="h-3.5 w-3.5" />
                          </div>
                          <input
                            value={countyFilter}
                            onChange={(e) => setCountyFilter(e.target.value)}
                            placeholder="Filter counties…"
                            className="rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-stone-400 focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white">
                        <div className="nice-scroll max-h-96 overflow-y-auto">
                          <table className="w-full text-sm">
                            <tbody>
                              {shownCounties.map((c, i) => (
                                <tr key={c.geo_id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/70">
                                  <td className="px-5 py-2.5">
                                    <div className="flex items-center gap-3">
                                      <Avatar name={c.name} index={i} size="h-8 w-8 text-xs" />
                                      <span className="font-medium">{c.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-5 py-2.5 text-right">
                                    <button onClick={() => selectGeo(c)} className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:border-blue-400 hover:text-blue-700">
                                      View →
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      {counties.length > 0 && (
                        <p className="mt-2 text-xs text-stone-500">{shownCounties.length} of {counties.length} counties shown</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* compare */}
          {compare.length > 0 && (
            <div id="compare" className="mt-10 scroll-mt-32">
              <div className="mb-3 flex items-center gap-3">
                <h3 className="text-lg font-extrabold tracking-tight">Side-by-side comparison</h3>
                <button onClick={() => setCompare([])} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100">
                  Clear all
                </button>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-stone-200/80 bg-white">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-stone-200/70">
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-stone-400">Indicator</th>
                      {compare.map((c, i) => (
                        <th key={c.geo.geo_id} className="px-5 py-3.5 text-left">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={c.geo.name} index={i} size="h-8 w-8 text-xs" />
                            <div>
                              <div className="font-bold">{c.geo.name}</div>
                              <button onClick={() => setCompare((prev) => prev.filter((x) => x.geo.geo_id !== c.geo.geo_id))} className="text-xs font-normal text-red-600 hover:underline">
                                remove
                              </button>
                            </div>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map((row) => (
                      <tr key={row.label} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
                        <td className="px-5 py-3 font-medium text-stone-500">{row.label}</td>
                        {compare.map((c) => (
                          <td key={c.geo.geo_id} className="px-5 py-3 font-bold tabular-nums">{row.get(c.ind)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4">
                <CompareChart compare={compare} rows={compareRows} />
              </div>
            </div>
          )}

          <footer id="source" className="mt-12 scroll-mt-32 border-t border-stone-200/70 pt-4 text-xs leading-relaxed text-stone-500">
            <span className="font-semibold text-stone-700">Data source.</span> U.S. Census Bureau, American Community Survey 5-year
            estimates via Census Reporter (api.censusreporter.org). Place search via OpenStreetMap Nominatim and the U.S. Census
            Geocoder. Margins of error available on income; other MOEs stored in the database.
          </footer>
        </main>
      </div>
    </div>
  );
}
