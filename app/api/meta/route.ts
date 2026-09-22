import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/meta — dataset vintage label for the UI header. */
export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`SELECT release, refreshed_at, geo_count FROM refresh_meta WHERE id = 1 LIMIT 1`;
    if (rows.length === 0) {
      return Response.json({ release: null, refreshed_at: null, geo_count: 0, seeded: false });
    }
    const m = rows[0] as { release: string | null; refreshed_at: string | null; geo_count: number | null };
    let obsCount = 0;
    try {
      const c = await sql`SELECT count(*)::int AS c FROM observations`;
      obsCount = c[0]?.c ?? 0;
    } catch {
      /* observations table may not exist yet */
    }
    return Response.json({ release: m.release, refreshed_at: m.refreshed_at, geo_count: m.geo_count ?? 0, obs_count: obsCount, seeded: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
