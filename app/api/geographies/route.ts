import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/geographies?q=...&state_fips=..&type=..&limit=..
 * - q=...            : search states + counties by name (ILIKE)
 * - no q             : list all states (default landing)
 * - state_fips=06    : list counties of a state (drill-down)
 * - type=county|state : filter by type (with q)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const stateFips = searchParams.get("state_fips");
    const type = searchParams.get("type");
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "25", 10) || 25, 1), 200);

    const sql = getSql();
    let rows;
    if (q) {
      const pattern = `%${q.replace(/[%_]/g, "")}%`;
      if (type === "county" || type === "state") {
        rows = await sql`
          SELECT geo_id, name, geo_type, state_fips, state_name FROM geographies
          WHERE name ILIKE ${pattern} AND geo_type = ${type}
          ORDER BY name LIMIT ${limit}`;
      } else {
        rows = await sql`
          SELECT geo_id, name, geo_type, state_fips, state_name FROM geographies
          WHERE name ILIKE ${pattern}
          ORDER BY CASE geo_type WHEN 'state' THEN 0 ELSE 1 END, name
          LIMIT ${limit}`;
      }
    } else if (stateFips) {
      rows = await sql`
        SELECT geo_id, name, geo_type, state_fips, state_name FROM geographies
        WHERE state_fips = ${stateFips} AND geo_type = 'county'
        ORDER BY name LIMIT 500`;
    } else {
      rows = await sql`
        SELECT g.geo_id, g.name, g.geo_type, g.state_fips, g.state_name,
               (SELECT count(*)::int FROM geographies c WHERE c.geo_type = 'county' AND c.state_fips = g.state_fips) AS county_count
        FROM geographies g
        WHERE g.geo_type = 'state' ORDER BY g.name`;
    }
    return Response.json({ geographies: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    const status = msg.includes("DATABASE_URL") ? 500 : 500;
    return Response.json({ error: msg }, { status });
  }
}
