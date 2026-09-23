import { getInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/insights?geo_id=05000US06001
 * Percentile ranks vs U.S. peers, in-state ranks, lookalike places and
 * plain-language quick facts. See lib/insights.ts.
 */
export async function GET(req: Request) {
  const geoId = new URL(req.url).searchParams.get("geo_id") || "";
  try {
    return Response.json(await getInsights(geoId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: msg }, { status: msg === "geo_id is required" ? 400 : 500 });
  }
}
