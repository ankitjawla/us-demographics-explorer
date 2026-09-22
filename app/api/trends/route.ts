import { getTrendData } from "@/lib/trends";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/trends?geo_id=05000US06001
 * Headline-indicator change vs the previous ACS 5-year release.
 * See lib/trends.ts for the computation.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const geoId = (searchParams.get("geo_id") || "").trim();
    if (!geoId) return Response.json({ error: "geo_id is required" }, { status: 400 });
    return Response.json(await getTrendData(geoId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
