import { searchPlaces } from "./placeSearch";
import { getObservationsBundle } from "./observations";
import { getMetricValues, isMetricKey, type MetricKey } from "./metrics";
import { getTrendData } from "./trends";
import { computeIndicators } from "./indicators";

/**
 * Tool implementations for the chat assistant (app/api/chat/route.ts).
 * Each returns small, JSON-serializable, model-friendly payloads.
 * Nothing here touches secrets.
 */

/** Resolve a place name to official geographies. */
export async function toolSearchPlace(query: string) {
  const q = String(query || "").trim();
  if (!q) return { error: "query is required" };
  const r = await searchPlaces(q, 6);
  if (r.lookupUnavailable) return { error: "place lookup is temporarily unavailable" };
  return {
    candidates: r.suggestions.map((s) => ({
      name: s.place,
      type: s.placeType,
      geo_id: s.geo_id,
      geo_type: s.geo_type,
      county: s.county,
      state: s.state,
    })),
  };
}

function round1(n: number | null): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/** Headline stats + demographic highlights for one geo_id (fetches live if not cached). */
export async function toolGetSnapshot(geo_id: string) {
  const id = String(geo_id || "").trim();
  if (!id) return { error: "geo_id is required" };
  const bundle = await getObservationsBundle(id);
  const ind = computeIndicators(bundle.tables);
  const pop = ind.population || 1;
  const raceSorted = [...ind.race].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const bachelorsPlus =
    (ind.education[3]?.pct ?? 0) + (ind.education[4]?.pct ?? 0);
  return {
    name: bundle.geography.name,
    geo_type: bundle.geography.geo_type,
    state: bundle.geography.state_name,
    release: bundle.release,
    population: ind.population || null,
    median_household_income: ind.medianIncome,
    income_margin_of_error: ind.incomeMoe,
    poverty_rate_pct: round1(ind.povertyRate),
    housing_units: ind.housingUnits || null,
    occupancy_rate_pct: round1(ind.occupancyRate),
    owner_rate_pct: round1(ind.ownerRate),
    renter_rate_pct: round1(ind.renterRate),
    hispanic_or_latino_pct: round1((ind.hispanic / pop) * 100),
    largest_race_group: raceSorted[0]
      ? { label: raceSorted[0].label, pct: round1(raceSorted[0].pct) }
      : null,
    bachelors_degree_or_higher_pct: round1(bachelorsPlus),
    fetched_live: bundle.fetched_live,
  };
}

/** Top/bottom rankings for a headline metric. */
export async function toolGetRankings(args: {
  metric?: string;
  state_fips?: string;
  geo_type?: string;
  limit?: number;
  order?: string;
}) {
  const metric = String(args.metric || "").toLowerCase();
  if (!isMetricKey(metric)) {
    return { error: "metric must be one of: population, income, poverty, housing" };
  }
  const geoType = args.geo_type === "state" ? "state" : "county";
  const order = args.order === "bottom" ? "bottom" : "top";
  const limit = Math.min(Math.max(parseInt(String(args.limit ?? 10), 10) || 10, 1), 25);
  const stateFips = /^\d{2}$/.test(String(args.state_fips || "")) ? String(args.state_fips) : "";
  const r = await getMetricValues({
    metric: metric as MetricKey,
    stateFips,
    geoType,
    mode: order,
    limit,
  });
  const unit = metric === "income" ? "$" : metric === "poverty" ? "%" : "";
  return {
    metric,
    unit,
    order,
    geo_type: geoType,
    state_fips: stateFips || null,
    rankings: r.geos.map((g) => ({
      name: g.name,
      state: g.state_name,
      value: g.value == null ? null : Math.round(g.value * 10) / 10,
    })),
  };
}

/** Trend vs previous ACS 5-year release for one geo_id. */
export async function toolGetTrends(geo_id: string) {
  const id = String(geo_id || "").trim();
  if (!id) return { error: "geo_id is required" };
  const t = await getTrendData(id);
  if (!t.trends) return { geo_id: id, trends: null, note: "no comparable baseline data" };
  const fmt = (d: { current: number | null; previous: number | null; change: number | null; unit: "%" | "pp" }) => ({
    current: d.current == null ? null : Math.round(d.current * 10) / 10,
    previous: d.previous == null ? null : Math.round(d.previous * 10) / 10,
    change: d.change == null ? null : Math.round(d.change * 100) / 100,
    unit: d.unit,
  });
  return {
    geo_id: id,
    baseline: "2019–2023 ACS 5-year",
    current_release: "2024 ACS 5-year (2020–2024)",
    trends: {
      population: fmt(t.trends.population),
      median_household_income: fmt(t.trends.income),
      poverty_rate: fmt(t.trends.poverty),
      housing_units: fmt(t.trends.housing),
    },
  };
}
