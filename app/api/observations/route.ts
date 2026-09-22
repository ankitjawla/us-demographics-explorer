import { getSql } from "@/lib/db";
import {
  TABLES,
  FIPS_TO_NAME,
  fetchGeoName,
  fetchTableChunk,
  parseGeoId,
  upsertGeographies,
  upsertObservations,
} from "../../../lib/census.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// On-demand fetch does 2 Census Reporter calls + a few upserts; allow headroom.
export const maxDuration = 60;

/**
 * GET /api/observations?geo_id=05000US06001
 * Returns all stored ACS variables for one geography, nested by table,
 * plus the geography's name and the data release.
 *
 * On-demand granular geographies: if the geo_id is a valid state / county /
 * place / county-subdivision / tract id that is NOT in the DB yet, its data
 * is fetched live from Census Reporter, cached in Neon, and returned with
 * `fetched_live: true`. The UI shows a "Live" pill in that case.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const geoId = (searchParams.get("geo_id") || "").trim();
    if (!geoId) {
      return Response.json({ error: "geo_id is required" }, { status: 400 });
    }

    const sql = getSql();
    let fetchedLive = false;

    let geos = await sql`
      SELECT geo_id, name, geo_type, state_fips, state_name FROM geographies
      WHERE geo_id = ${geoId} LIMIT 1`;

    if (geos.length === 0) {
      // On-demand path: validate, fetch live, cache, then serve.
      const parsed = parseGeoId(geoId);
      if (!parsed) {
        return Response.json({ error: "unknown geo_id" }, { status: 404 });
      }

      // Current release (the seed/refresh target).
      let release: string | null = null;
      try {
        const m = await sql`SELECT release FROM refresh_meta WHERE id = 1 LIMIT 1`;
        release = (m[0] as { release?: string } | undefined)?.release || null;
      } catch { /* table may not exist yet */ }
      if (!release) {
        const { detectLatest5yrRelease } = await import("../../../lib/census.js");
        release = await detectLatest5yrRelease();
      }

      const rows = await fetchTableChunk([geoId], TABLES, release);
      if (rows.length === 0) {
        return Response.json({ error: "no data for this geography" }, { status: 404 });
      }

      // Display name: Census Reporter geo service ("Paramus borough, NJ").
      let name: string | null = null;
      try {
        name = await fetchGeoName(geoId);
      } catch { /* fall through to constructed name */ }
      if (!name) {
        const abbr: Record<string, string> = { "72": "PR", "11": "DC" };
        name = `${parsed.label} ${parsed.fips}${abbr[parsed.state_fips] ? ", " + abbr[parsed.state_fips] : ""}`;
      }
      const stateName = FIPS_TO_NAME[parsed.state_fips] || "";

      await upsertGeographies(sql, [
        {
          geo_id: geoId,
          name,
          geo_type: parsed.geo_type,
          state_fips: parsed.state_fips,
          state_name: stateName,
        },
      ]);
      await upsertObservations(sql, rows, release);
      fetchedLive = true;

      geos = await sql`
        SELECT geo_id, name, geo_type, state_fips, state_name FROM geographies
        WHERE geo_id = ${geoId} LIMIT 1`;
    }

    const rows = await sql`
      SELECT table_id, variable_code, value, error, release FROM observations
      WHERE geo_id = ${geoId}`;

    const tables: Record<string, Record<string, { value: number | null; error: number | null }>> = {};
    let release: string | null = null;
    for (const r of rows as Array<{
      table_id: string; variable_code: string; value: number | null; error: number | null; release: string;
    }>) {
      (tables[r.table_id] ||= {})[r.variable_code] = { value: r.value, error: r.error };
      release ||= r.release;
    }

    const meta = await sql`SELECT release, refreshed_at FROM refresh_meta WHERE id = 1 LIMIT 1`;

    return Response.json({
      geography: geos[0],
      tables,
      release: release || (meta[0] as { release?: string } | undefined)?.release || null,
      refreshed_at: (meta[0] as { refreshed_at?: string } | undefined)?.refreshed_at || null,
      fetched_live: fetchedLive,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
