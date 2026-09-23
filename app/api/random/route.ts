import { getRandomCounty } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/random — a random U.S. county ("Surprise me"). */
export async function GET() {
  try {
    return Response.json({ geography: await getRandomCounty() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
