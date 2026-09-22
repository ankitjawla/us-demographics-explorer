"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import { geoAlbersUsa } from "d3-geo";

export interface MapGeography {
  geo_id: string;
  name: string;
  geo_type: string;
  state_fips: string;
  state_name: string;
}

type MetricKey = "population" | "income" | "poverty" | "housing";

const METRICS: Array<{
  key: MetricKey;
  label: string;
  hint: string;
  format: (v: number | null) => string;
}> = [
  {
    key: "population",
    label: "Population",
    hint: "Where people live",
    format: (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-US")),
  },
  {
    key: "income",
    label: "Median income",
    hint: "Where paychecks are biggest",
    format: (v) => (v == null ? "—" : "$" + Math.round(v).toLocaleString("en-US")),
  },
  {
    key: "poverty",
    label: "Poverty rate",
    hint: "Where hardship concentrates",
    format: (v) => (v == null ? "—" : `${v.toFixed(1)}%`),
  },
  {
    key: "housing",
    label: "Housing units",
    hint: "Where the homes are",
    format: (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-US")),
  },
];

/**
 * Colorblind-safe sequential ramps (ColorBrewer):
 * population = Blues, income = Blue-Green, poverty = Yellow-Orange-Brown, housing = Purples.
 */
const RAMPS: Record<MetricKey, string[]> = {
  population: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
  income: ["#edf8fb", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"],
  poverty: ["#ffffd4", "#fed98e", "#fe9929", "#d95f0e", "#993404"],
  housing: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"],
};
const NO_DATA = "#e7e5e4";

const TOPO_URLS = [
  "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json",
  "https://unpkg.com/us-atlas@3/counties-10m.json",
];

let topoPromise: Promise<any> | null = null;
function loadTopology(): Promise<any> {
  if (!topoPromise) {
    topoPromise = (async () => {
      let lastErr: unknown = null;
      for (const url of TOPO_URLS) {
        try {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return await r.json();
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("map geometry unavailable");
    })();
  }
  return topoPromise;
}

/**
 * us-atlas ships UNPROJECTED lon/lat — project into the 975x610 viewBox with
 * Albers USA (handles the Alaska/Hawaii insets). Without this the whole
 * country renders as a tiny off-screen blob (the "blank map" bug).
 */
function makeProjection() {
  return geoAlbersUsa().fitSize([975, 610], { type: "Sphere" } as any);
}
type Projection = ReturnType<typeof makeProjection>;

/** Minimal SVG path builder: project lon/lat rings into viewBox space. */
function ringPath(ring: number[][], projection: Projection): string | null {
  const pts: string[] = [];
  for (const p of ring) {
    const q = projection([p[0], p[1]] as [number, number]);
    if (!q) continue;
    pts.push(`${q[0].toFixed(1)},${q[1].toFixed(1)}`);
  }
  if (pts.length < 3) return null;
  return "M" + pts.join("L") + "Z";
}
function geomPath(geom: any, projection: Projection): string {
  if (!geom) return "";
  if (geom.type === "Polygon")
    return geom.coordinates.map((r: number[][]) => ringPath(r, projection)).filter(Boolean).join("");
  if (geom.type === "MultiPolygon")
    return geom.coordinates.map((poly: number[][][]) => poly.map((r) => ringPath(r, projection)).filter(Boolean).join("")).join("");
  return "";
}

interface CountyFeature {
  fips: string;
  d: string;
}

function quantileBreaks(values: number[], classes = 5): number[] {
  const s = [...values].sort((a, b) => a - b);
  const breaks: number[] = [];
  for (let i = 1; i < classes; i++) {
    breaks.push(s[Math.min(s.length - 1, Math.floor((i / classes) * s.length))]);
  }
  return breaks;
}

export default function CountyMap({
  stateFips,
  onSelectCounty,
  selectedGeoId,
}: {
  stateFips?: string;
  onSelectCounty: (g: MapGeography) => void;
  selectedGeoId?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("income");
  const [features, setFeatures] = useState<CountyFeature[] | null>(null);
  const [statePaths, setStatePaths] = useState<CountyFeature[]>([]);
  const [values, setValues] = useState<
    Record<string, { value: number | null; name: string; state_fips: string; state_name: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; geoId: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load geometry once (counties + state outlines).
  useEffect(() => {
    let cancelled = false;
    loadTopology()
      .then((topo) => {
        if (cancelled) return;
        const projection = makeProjection();
        const fc: any = feature(topo, topo.objects.counties);
        const feats: CountyFeature[] = [];
        for (const f of fc.features || []) {
          const fips = String(f.id || "").padStart(5, "0");
          if (!/^\d{5}$/.test(fips)) continue;
          const d = geomPath(f.geometry, projection);
          if (!d) continue;
          feats.push({ fips, d });
        }
        const sf: any = feature(topo, topo.objects.states);
        const spaths: CountyFeature[] = [];
        for (const f of sf.features || []) {
          const fips = String(f.id || "").padStart(2, "0");
          const d = geomPath(f.geometry, projection);
          if (!d) continue;
          spaths.push({ fips, d });
        }
        setFeatures(feats);
        setStatePaths(spaths);
      })
      .catch(() => {
        if (!cancelled) setError("Map geometry failed to load.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load metric values.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = `/api/metric-values?metric=${metric}${stateFips ? `&state_fips=${stateFips}` : ""}`;
    fetch(url)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      })
      .then((j) => {
        if (cancelled) return;
        const map: Record<
          string,
          { value: number | null; name: string; state_fips: string; state_name: string }
        > = {};
        for (const g of j.geos || []) {
          map[g.geo_id] = {
            value: typeof g.value === "number" ? g.value : null,
            name: g.name,
            state_fips: g.state_fips,
            state_name: g.state_name,
          };
        }
        setValues(map);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load map data.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [metric, stateFips]);

  const shown = useMemo(() => {
    if (!features) return [];
    return stateFips ? features.filter((f) => f.fips.startsWith(stateFips)) : features;
  }, [features, stateFips]);

  const shownStates = useMemo(() => {
    if (!stateFips) return statePaths;
    return statePaths.filter((s) => s.fips === stateFips);
  }, [statePaths, stateFips]);

  const metricDef = METRICS.find((m) => m.key === metric)!;

  const { colorFor, legend } = useMemo(() => {
    const ramp = RAMPS[metric];
    const fmt = metricDef.format;
    const vals = Object.values(values)
      .map((v) => v.value)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) {
      return {
        colorFor: (_: number | null) => NO_DATA,
        legend: [] as Array<{ color: string; min: string; max: string; range: string }>,
      };
    }
    const breaks = quantileBreaks(vals, 5);
    const colorFor = (v: number | null) => {
      if (v == null) return NO_DATA;
      let i = 0;
      while (i < breaks.length && v > breaks[i]) i++;
      return ramp[Math.min(i, ramp.length - 1)];
    };
    const bounds = [Math.min(...vals), ...breaks, Math.max(...vals)];
    const legend = ramp.map((color, i) => ({
      color,
      min: fmt(bounds[i]),
      max: fmt(bounds[i + 1]),
      range: `${fmt(bounds[i])} – ${fmt(bounds[i + 1])}`,
    }));
    return { colorFor, legend };
  }, [values, metric, metricDef]);

  /** Highest / lowest county for the current metric — the story at a glance. */
  const extremes = useMemo(() => {
    const entries = Object.values(values).filter(
      (v): v is { value: number; name: string; state_fips: string; state_name: string } =>
        typeof v.value === "number" && Number.isFinite(v.value)
    );
    if (entries.length < 2) return null;
    let lo = entries[0];
    let hi = entries[0];
    for (const e of entries) {
      if (e.value < lo.value) lo = e;
      if (e.value > hi.value) hi = e;
    }
    return { lo, hi };
  }, [values]);

  const onMove = (e: React.MouseEvent, geoId: string) => {
    if (!values[geoId]) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    setTip({
      x: e.clientX - (rect?.left || 0),
      y: e.clientY - (rect?.top || 0),
      geoId,
    });
  };

  const clickCounty = (geoId: string) => {
    const v = values[geoId];
    if (!v) return;
    onSelectCounty({
      geo_id: geoId,
      name: v.name,
      geo_type: "county",
      state_fips: v.state_fips,
      state_name: v.state_name,
    });
  };

  const tipV = tip ? values[tip.geoId] : null;
  const tipW = wrapRef.current?.clientWidth || 300;

  return (
    <div>
      {/* metric selector */}
      <div className="mb-3 flex items-center gap-2.5">
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-stone-400">
          Color by
        </span>
        <div className="nice-scroll flex flex-1 gap-1.5 overflow-x-auto pb-0.5">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              title={m.hint}
              aria-pressed={metric === m.key}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                metric === m.key
                  ? "bg-stone-900 text-white shadow-sm"
                  : "border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* story line */}
      {!loading && !error && extremes && (
        <p className="mb-2.5 text-xs leading-relaxed text-stone-500">
          <span className="font-semibold text-stone-700">Highest {metricDef.label.toLowerCase()}:</span>{" "}
          <span className="font-medium tabular-nums">{metricDef.format(extremes.hi.value)}</span> ·{" "}
          {extremes.hi.name}
          <span className="mx-1.5 text-stone-300">|</span>
          <span className="font-semibold text-stone-700">Lowest:</span>{" "}
          <span className="font-medium tabular-nums">{metricDef.format(extremes.lo.value)}</span> ·{" "}
          {extremes.lo.name}
        </p>
      )}

      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-xl border border-stone-200/70 bg-[#fbfbfa]"
      >
        {(loading || !features) && !error && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 sm:h-80">
            <svg
              className="h-8 w-8 animate-spin text-stone-300"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <div className="text-sm text-stone-400">Loading counties…</div>
          </div>
        )}
        {error && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center sm:h-80">
            <div className="text-sm text-stone-500">{error}</div>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700"
            >
              Retry
            </button>
          </div>
        )}
        {features && !error && (
          <svg
            viewBox="0 0 975 610"
            className="block h-auto w-full touch-manipulation"
            role="img"
            aria-label={`County choropleth map colored by ${metricDef.label}`}
            onMouseLeave={() => {
              setTip(null);
              setHovered(null);
            }}
          >
            <g>
              {shown.map((f) => {
                const geoId = `05000US${f.fips}`;
                const v = values[geoId]?.value ?? null;
                const isSel = selectedGeoId === geoId;
                const isHov = hovered === f.fips;
                return (
                  <path
                    key={f.fips}
                    d={f.d}
                    fill={colorFor(v)}
                    stroke={isSel ? "#1c1917" : isHov ? "#57534e" : "#ffffff"}
                    strokeWidth={isSel ? 1.8 : isHov ? 1 : 0.4}
                    className="cursor-pointer"
                    style={{ transition: "fill 160ms ease" }}
                    onMouseMove={(e) => onMove(e, geoId)}
                    onMouseEnter={() => setHovered(f.fips)}
                    onClick={() => clickCounty(geoId)}
                  />
                );
              })}
            </g>
            {/* crisp state outlines on top */}
            <g pointerEvents="none">
              {shownStates.map((s) => (
                <path key={s.fips} d={s.d} fill="none" stroke="#a8a29e" strokeWidth={0.9} opacity={0.85} />
              ))}
            </g>
          </svg>
        )}
        {tip && tipV && (
          <div
            className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 rounded-xl bg-stone-900/95 px-3 py-2 text-white shadow-xl backdrop-blur"
            style={{
              left: Math.max(76, Math.min(tip.x, tipW - 76)),
              top: Math.max(8, tip.y - 92),
            }}
          >
            <div className="truncate text-[13px] font-bold leading-tight">{tipV.name}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-stone-300">
              {metricDef.label}
            </div>
            <div className="text-lg font-extrabold tabular-nums leading-tight">
              {metricDef.format(tipV.value)}
            </div>
          </div>
        )}
      </div>

      {/* legend: segmented quantile bar with real value ranges */}
      {legend.length > 0 && !error && (
        <div className="mt-3">
          <div className="flex h-3 overflow-hidden rounded-full ring-1 ring-inset ring-stone-900/10">
            {legend.map((l, i) => (
              <div key={i} className="h-full flex-1" style={{ background: l.color }} title={l.range} />
            ))}
          </div>
          <div className="mt-1 flex text-[10px] tabular-nums text-stone-500">
            {legend.map((l, i) => (
              <span
                key={i}
                className={`flex-1 ${
                  i === 0 ? "text-left" : i === legend.length - 1 ? "text-right" : "hidden text-center sm:block"
                }`}
              >
                {i === 0 ? l.min : i === legend.length - 1 ? l.max : l.range}
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-[11px] text-stone-400">
              Quantile bands — each shade ≈ one-fifth of counties
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-stone-400">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NO_DATA }} />
              No data
            </span>
          </div>
          <ul className="sr-only">
            {legend.map((l, i) => (
              <li key={i}>Band {i + 1}: {l.range}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[11px] text-stone-400">
        Tap a county to explore it.
      </p>
    </div>
  );
}
