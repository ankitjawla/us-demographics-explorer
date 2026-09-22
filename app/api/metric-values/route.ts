import { getMetricValues, isMetricKey } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/metric-values?metric=income&state_fips=06
 * One headline value per county (or state) for the choropleth map / rankings.
 * See lib/metrics.ts for the query.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const metricKey = searchParams.get("metric") || "income";
    const stateFips = searchParams.get("state_fips") || "";
    const geoType = searchParams.get("geo_type") || "county";
    const mode = searchParams.get("mode") || "all";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 100);
    if (!isMetricKey(metricKey)) return Response.json({ error: "unknown metric" }, { status: 400 });
    if (geoType !== "county" && geoType !== "state") {
      return Response.json({ error: "geo_type must be county or state" }, { status: 400 });
    }
    if (!["all", "top", "bottom"].includes(mode)) {
      return Response.json({ error: "mode must be all, top, or bottom" }, { status: 400 });
    }
    const result = await getMetricValues({
      metric: metricKey,
      stateFips,
      geoType,
      mode: mode as "all" | "top" | "bottom",
      limit,
    });
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
