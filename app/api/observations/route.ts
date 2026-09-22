import { getObservationsBundle } from "@/lib/observations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// On-demand fetch does 2 Census Reporter calls + a few upserts; allow headroom.
export const maxDuration = 60;

/**
 * GET /api/observations?geo_id=05000US06001
 * All stored ACS variables for one geography, nested by table.
 * See lib/observations.ts for the bundle (incl. on-demand live fetch).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const geoId = (searchParams.get("geo_id") || "").trim();
    if (!geoId) {
      return Response.json({ error: "geo_id is required" }, { status: 400 });
    }
    const bundle = await getObservationsBundle(geoId);
    return Response.json(bundle);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    const status = msg === "unknown geo_id" || msg === "no data for this geography" ? 404 : 500;
    return Response.json({ error: msg }, { status });
  }
}
