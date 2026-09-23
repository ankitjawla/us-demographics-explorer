import { getQuizRounds } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/quiz?rounds=10 — random county pairs for the Higher-or-Lower game. */
export async function GET(req: Request) {
  const n = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("rounds") || "10", 10) || 10, 1), 25);
  try {
    return Response.json({ rounds: await getQuizRounds(n) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
