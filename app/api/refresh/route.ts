import { getSql } from "@/lib/db";
import {
  TABLES,
  detectLatest5yrRelease,
  fetchTableChunk,
  recordRefreshMeta,
  sleep,
  upsertGeographies,
  upsertObservations,
} from "../../../lib/census.js";
import geoList from "../../../data/geographies.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Full refresh does ~17 Census Reporter requests + ~600k upserts; allow headroom.
// (Vercel Hobby caps at 60s — for large refreshes use `npm run seed` instead.)
export const maxDuration = 300;

const SIX_HOURS_MS = 6 * 3600 * 1000;
const GEO_CHUNK = 200; // geos per Census Reporter request

/**
 * POST /api/refresh — pull the latest ACS 5-year release from Census Reporter
 * and upsert it into Neon.
 *
 * Guard: 429 when the last refresh finished < 6h ago, unless ?force=1 with a
 * matching REFRESH_TOKEN (x-refresh-token header or ?token=).
 *
 * Returns { release, geos, observations, refreshed_at }.
 */
export async function POST(req: Request) {
  let sql;
  try {
    sql = getSql();
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "DB unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";

  if (force) {
    const expected = process.env.REFRESH_TOKEN;
    const provided = req.headers.get("x-refresh-token") || searchParams.get("token");
    if (!expected || provided !== expected) {
      return Response.json({ error: "invalid refresh token" }, { status: 401 });
    }
  } else {
    try {
      const meta = await sql`SELECT refreshed_at FROM refresh_meta WHERE id = 1 LIMIT 1`;
      const last = (meta[0] as { refreshed_at?: string } | undefined)?.refreshed_at;
      if (last && Date.now() - new Date(last).getTime() < SIX_HOURS_MS) {
        return Response.json(
          { error: "refreshed less than 6 hours ago; use ?force=1 with REFRESH_TOKEN to override" },
          { status: 429 }
        );
      }
    } catch {
      // table may not exist yet on first run — proceed
    }
  }

  try {
    const release = await detectLatest5yrRelease();
    const geos = geoList as Array<{
      geo_id: string; name: string; geo_type: string; state_fips: string; state_name: string;
    }>;

    await upsertGeographies(sql, geos);

    let totalRows = 0;
    const chunks = Math.ceil(geos.length / GEO_CHUNK);
    for (let i = 0; i < chunks; i++) {
      const ids = geos.slice(i * GEO_CHUNK, (i + 1) * GEO_CHUNK).map((g) => g.geo_id);
      const rows = await fetchTableChunk(ids, TABLES, release);
      await upsertObservations(sql, rows, release);
      totalRows += rows.length;
      if (i < chunks - 1) await sleep(400); // be polite to the free API
    }

    await recordRefreshMeta(sql, release, geos.length);
    const refreshedAt = new Date().toISOString();

    return Response.json({
      release,
      geos: geos.length,
      observations: totalRows,
      refreshed_at: refreshedAt,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "refresh failed" },
      { status: 500 }
    );
  }
}
