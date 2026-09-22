import { searchPlaces } from "@/lib/placeSearch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/places?q=Teaneck
 * Smart place search — see lib/placeSearch.ts for the engine.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    if (q.length < 2) return Response.json({ suggestions: [] });
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "5", 10) || 5, 1), 8);

    const r = await searchPlaces(q, limit);
    if (r.lookupUnavailable) {
      return Response.json({ suggestions: [], error: "place lookup unavailable" }, { status: 502 });
    }
    return Response.json(
      r.cached ? { suggestions: r.suggestions, cached: true } : { suggestions: r.suggestions }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({ suggestions: [], error: msg }, { status: 500 });
  }
}
