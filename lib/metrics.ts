import { getSql } from "@/lib/db";
import { getProfiles } from "./profiles";
import { isMetricKey, type MetricKey } from "./metricDefs";

/**
 * Shared headline-metric query (used by /api/metric-values and the chat assistant).
 * Returns one headline value per county or state for the choropleth map / rankings.
 * Rates (poverty, college, …) are returned as 0–100; see `lib/profiles.ts`.
 */

export type { MetricKey };
export { isMetricKey };

export interface MetricGeo {
  geo_id: string;
  name: string;
  state_fips: string;
  state_name: string;
  value: number | null;
}

export interface MetricValuesResult {
  metric: MetricKey;
  geo_type: "county" | "state";
  mode: "all" | "top" | "bottom";
  release: string | null;
  count: number;
  geos: MetricGeo[];
}

export async function getMetricValues(opts: {
  metric: MetricKey;
  stateFips?: string;
  geoType?: "county" | "state";
  mode?: "all" | "top" | "bottom";
  limit?: number;
  /** Ignore geographies below this population (keeps rankings of rates meaningful). */
  minPopulation?: number;
}): Promise<MetricValuesResult> {
  const { metric, stateFips = "", geoType = "county", mode = "all", limit = 10, minPopulation = 0 } = opts;
  if (!isMetricKey(metric)) throw new Error("unknown metric");
  if (stateFips && !/^\d{2}$/.test(stateFips)) throw new Error("bad state_fips");
  const lim = Math.min(Math.max(limit, 1), 100);

  const set = await getProfiles();
  let pool = geoType === "state" ? set.states : set.counties;
  if (stateFips && geoType === "county") pool = pool.filter((p) => p.state_fips === stateFips);
  if (minPopulation > 0) pool = pool.filter((p) => (p.metrics.population ?? 0) >= minPopulation);

  const geos: MetricGeo[] = pool.map((p) => ({
    geo_id: p.geo_id,
    name: p.name,
    state_fips: p.state_fips,
    state_name: p.state_name,
    value: p.metrics[metric],
  }));

  // Optional top/bottom ranking (nulls always last).
  let out = geos;
  if (mode === "top" || mode === "bottom") {
    out = [...geos]
      .sort((a, b) => {
        if (a.value == null && b.value == null) return 0;
        if (a.value == null) return 1;
        if (b.value == null) return -1;
        return mode === "top" ? b.value - a.value : a.value - b.value;
      })
      .slice(0, lim);
  }

  let release: string | null = null;
  try {
    const sql = getSql();
    const m = await sql`SELECT release FROM refresh_meta WHERE id = 1 LIMIT 1`;
    release = (m[0] as { release?: string } | undefined)?.release || null;
  } catch { /* ignore */ }

  return { metric, geo_type: geoType, mode, release, count: out.length, geos: out };
}
