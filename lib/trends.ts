import { getSql } from "@/lib/db";

/**
 * Shared trend computation (used by /api/trends and the chat assistant).
 *
 * Change on the four headline indicators: current ACS 5-year values
 * (from `observations`) vs the 2019–2023 ACS 5-year baseline
 * (`trend_baseline`, loaded one-time from the Census Bureau's official
 * 2023 summary file — Census Reporter hosts only the current release, so
 * there is no API for previous-release values).
 *
 * Returns null trends (never fabricated) when either side is missing.
 * Counts/income/housing report % change; poverty reports percentage-point
 * change of the rate.
 */

export interface TrendDatum {
  current: number | null;
  previous: number | null;
  change: number | null;
  unit: "%" | "pp";
}

export interface TrendData {
  geo_id: string;
  baseline_release: string;
  trends: Record<"population" | "income" | "poverty" | "housing", TrendDatum> | null;
}

export async function getTrendData(geoId: string): Promise<TrendData> {
  if (!geoId) throw new Error("geo_id is required");

  const sql = getSql();

  const cur = (await sql`
    SELECT variable_code, value FROM observations
    WHERE geo_id = ${geoId}
      AND ((table_id = 'B02001' AND variable_code = 'B02001001')
        OR (table_id = 'B19013' AND variable_code = 'B19013001')
        OR (table_id = 'B17001' AND variable_code IN ('B17001001', 'B17001002'))
        OR (table_id = 'B25002' AND variable_code = 'B25002001'))`) as Array<{
    variable_code: string; value: number | null;
  }>;
  const cv: Record<string, number | null> = {};
  for (const r of cur) cv[r.variable_code] = r.value;

  const base = (await sql`
    SELECT pop_2023, income_2023, pov_num_2023, pov_den_2023, housing_2023
    FROM trend_baseline WHERE geo_id = ${geoId} LIMIT 1`) as Array<{
    pop_2023: number | null; income_2023: number | null;
    pov_num_2023: number | null; pov_den_2023: number | null;
    housing_2023: number | null;
  }>;
  const b = base[0] || null;

  const pctChange = (c: number | null, p: number | null): number | null => {
    if (typeof c !== "number" || typeof p !== "number" || p <= 0) return null;
    return ((c - p) / p) * 100;
  };

  let trends: TrendData["trends"] = null;
  if (b) {
    const povCurDen = cv["B17001001"];
    const povCurNum = cv["B17001002"];
    const povCurRate =
      typeof povCurDen === "number" && povCurDen > 0 && typeof povCurNum === "number"
        ? (povCurNum / povCurDen) * 100 : null;
    const povPrevRate =
      typeof b.pov_den_2023 === "number" && b.pov_den_2023 > 0 && typeof b.pov_num_2023 === "number"
        ? (b.pov_num_2023 / b.pov_den_2023) * 100 : null;
    const povChange =
      povCurRate !== null && povPrevRate !== null ? povCurRate - povPrevRate : null;
    trends = {
      population: { current: cv["B02001001"] ?? null, previous: b.pop_2023, change: pctChange(cv["B02001001"] ?? null, b.pop_2023), unit: "%" },
      income: { current: cv["B19013001"] ?? null, previous: b.income_2023, change: pctChange(cv["B19013001"] ?? null, b.income_2023), unit: "%" },
      poverty: { current: povCurRate, previous: povPrevRate, change: povChange, unit: "pp" },
      housing: { current: cv["B25002001"] ?? null, previous: b.housing_2023, change: pctChange(cv["B25002001"] ?? null, b.housing_2023), unit: "%" },
    };
    // If nothing at all is comparable, report null rather than empty badges.
    if (Object.values(trends).every((t) => t.change === null)) trends = null;
  }

  return { geo_id: geoId, baseline_release: "acs2023_5yr", trends };
}
