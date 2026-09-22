import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/metric-values?metric=income&state_fips=06
 * Returns one headline value per county (optionally filtered to a state)
 * for the choropleth map. Poverty is returned as a rate (0–100).
 *
 * metric: population | income | poverty | housing
 * geo_type: county (default) | state   — which geographies to return
 * mode: all (default) | top | bottom   — sort by value desc/asc (nulls last)
 * limit: max rows when mode is top|bottom (default 10, max 100)
 */
const METRICS: Record<
  string,
  { table: string; vars: string[]; kind: "raw" | "poverty_rate" }
> = {
  population: { table: "B02001", vars: ["B02001001"], kind: "raw" },
  income: { table: "B19013", vars: ["B19013001"], kind: "raw" },
  poverty: { table: "B17001", vars: ["B17001001", "B17001002"], kind: "poverty_rate" },
  housing: { table: "B25002", vars: ["B25002001"], kind: "raw" },
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const metricKey = searchParams.get("metric") || "income";
    const stateFips = searchParams.get("state_fips") || "";
    const geoType = searchParams.get("geo_type") || "county";
    const mode = searchParams.get("mode") || "all";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 100);
    const def = METRICS[metricKey];
    if (!def) return Response.json({ error: "unknown metric" }, { status: 400 });
    if (geoType !== "county" && geoType !== "state") {
      return Response.json({ error: "geo_type must be county or state" }, { status: 400 });
    }
    if (stateFips && !/^\d{2}$/.test(stateFips)) {
      return Response.json({ error: "bad state_fips" }, { status: 400 });
    }
    if (!["all", "top", "bottom"].includes(mode)) {
      return Response.json({ error: "mode must be all, top, or bottom" }, { status: 400 });
    }

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

    const geos = [...byGeo.entries()].map(([geo_id, e]) => {
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
        .slice(0, limit);
    }

    let release: string | null = null;
    try {
      const m = await sql`SELECT release FROM refresh_meta WHERE id = 1 LIMIT 1`;
      release = (m[0] as { release?: string } | undefined)?.release || null;
    } catch { /* ignore */ }

    return Response.json({ metric: metricKey, geo_type: geoType, mode, release, count: out.length, geos: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
