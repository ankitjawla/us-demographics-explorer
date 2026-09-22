import { getSql } from "@/lib/db";

/**
 * Shared headline-metric query (used by /api/metric-values and the chat assistant).
 * Returns one headline value per county or state for the choropleth map / rankings.
 * Poverty is returned as a rate (0–100).
 */

export type MetricKey = "population" | "income" | "poverty" | "housing";

const METRICS: Record<
  MetricKey,
  { table: string; vars: string[]; kind: "raw" | "poverty_rate" }
> = {
  population: { table: "B02001", vars: ["B02001001"], kind: "raw" },
  income: { table: "B19013", vars: ["B19013001"], kind: "raw" },
  poverty: { table: "B17001", vars: ["B17001001", "B17001002"], kind: "poverty_rate" },
  housing: { table: "B25002", vars: ["B25002001"], kind: "raw" },
};

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

export function isMetricKey(k: string): k is MetricKey {
  return k === "population" || k === "income" || k === "poverty" || k === "housing";
}

export async function getMetricValues(opts: {
  metric: MetricKey;
  stateFips?: string;
  geoType?: "county" | "state";
  mode?: "all" | "top" | "bottom";
  limit?: number;
}): Promise<MetricValuesResult> {
  const { metric, stateFips = "", geoType = "county", mode = "all", limit = 10 } = opts;
  const def = METRICS[metric];
  if (!def) throw new Error("unknown metric");
  if (stateFips && !/^\d{2}$/.test(stateFips)) throw new Error("bad state_fips");
  const lim = Math.min(Math.max(limit, 1), 100);

  const sql = getSql();
  const rows = (stateFips && geoType === "county"
    ? await sql`
        SELECT g.geo_id, g.name, g.state_fips, g.state_name,
               o.variable_code, o.value
        FROM geographies g
        LEFT JOIN observations o
          ON o.geo_id = g.geo_id AND o.table_id = ${def.table}
          AND o.variable_code = ANY(${def.vars})
        WHERE g.geo_type = 'county' AND g.state_fips = ${stateFips}`
    : await sql`
        SELECT g.geo_id, g.name, g.state_fips, g.state_name,
               o.variable_code, o.value
        FROM geographies g
        LEFT JOIN observations o
          ON o.geo_id = g.geo_id AND o.table_id = ${def.table}
          AND o.variable_code = ANY(${def.vars})
        WHERE g.geo_type = ${geoType}`) as Array<{
    geo_id: string; name: string; state_fips: string; state_name: string;
    variable_code: string | null; value: number | null;
  }>;

  // Collapse to one row per geo (poverty needs two variables).
  const byGeo = new Map<string, { name: string; state_fips: string; state_name: string; vars: Record<string, number | null> }>();
  for (const r of rows) {
    let e = byGeo.get(r.geo_id);
    if (!e) {
      e = { name: r.name, state_fips: r.state_fips, state_name: r.state_name, vars: {} };
      byGeo.set(r.geo_id, e);
    }
    if (r.variable_code) e.vars[r.variable_code] = r.value;
  }

  const geos: MetricGeo[] = [...byGeo.entries()].map(([geo_id, e]) => {
    let value: number | null = null;
    if (def.kind === "poverty_rate") {
      const den = e.vars["B17001001"];
      const num = e.vars["B17001002"];
      if (typeof den === "number" && den > 0 && typeof num === "number") {
        value = (num / den) * 100;
      }
    } else {
      const v = e.vars[def.vars[0]];
      value = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    return { geo_id, name: e.name, state_fips: e.state_fips, state_name: e.state_name, value };
  });

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
    const m = await sql`SELECT release FROM refresh_meta WHERE id = 1 LIMIT 1`;
    release = (m[0] as { release?: string } | undefined)?.release || null;
  } catch { /* ignore */ }

  return { metric, geo_type: geoType, mode, release, count: out.length, geos: out };
}
