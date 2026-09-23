import { getHighlights } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/highlights — national county superlatives for the overview. */
export async function GET() {
  try {
    return Response.json({ highlights: await getHighlights() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
