/**
 * Client-safe catalogue of every headline metric the map, rankings,
 * insights and chat can use. Values for all of these are derived from the
 * per-geography profiles in `lib/profiles.ts`.
 */

export const METRIC_KEYS = [
  "population",
  "income",
  "poverty",
  "housing",
  "diversity",
  "college",
  "hispanic",
  "homeownership",
  "seniors",
  "youth",
  "vacancy",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export function isMetricKey(k: string): k is MetricKey {
  return (METRIC_KEYS as readonly string[]).includes(k);
}

export interface MetricDef {
  key: MetricKey;
  label: string;
  /** Lower-case noun phrase for sentences ("median household income"). */
  noun: string;
  /** Short hint shown on the map pill. */
  hint: string;
  unit: "count" | "money" | "pct" | "index";
  /** Sentence fragments for "higher/lower than X% of counties". */
  high: string;
  low: string;
}

export const METRIC_DEFS: Record<MetricKey, MetricDef> = {
  population: {
    key: "population", label: "Population", noun: "population", hint: "Where people live",
    unit: "count", high: "more populous", low: "less populous",
  },
  income: {
    key: "income", label: "Median income", noun: "median household income", hint: "Where paychecks are biggest",
    unit: "money", high: "higher-earning", low: "lower-earning",
  },
  poverty: {
    key: "poverty", label: "Poverty rate", noun: "poverty rate", hint: "Where hardship concentrates",
    unit: "pct", high: "higher poverty", low: "lower poverty",
  },
  housing: {
    key: "housing", label: "Housing units", noun: "housing units", hint: "Where the homes are",
    unit: "count", high: "more homes", low: "fewer homes",
  },
  diversity: {
    key: "diversity", label: "Diversity", noun: "diversity index", hint: "Chance two random residents differ in race/ethnicity",
    unit: "index", high: "more diverse", low: "less diverse",
  },
  college: {
    key: "college", label: "College grads", noun: "share of adults with a bachelor's degree+", hint: "Bachelor's degree or higher, age 25+",
    unit: "pct", high: "more college-educated", low: "less college-educated",
  },
  hispanic: {
    key: "hispanic", label: "Hispanic / Latino", noun: "Hispanic / Latino share", hint: "Share of residents who are Hispanic or Latino",
    unit: "pct", high: "more Hispanic / Latino", low: "less Hispanic / Latino",
  },
  homeownership: {
    key: "homeownership", label: "Homeownership", noun: "homeownership rate", hint: "Owner-occupied share of occupied homes",
    unit: "pct", high: "more owners", low: "more renters",
  },
  seniors: {
    key: "seniors", label: "Age 65+", noun: "share of residents 65+", hint: "Where retirees live",
    unit: "pct", high: "older", low: "younger",
  },
  youth: {
    key: "youth", label: "Under 18", noun: "share of residents under 18", hint: "Where the kids are",
    unit: "pct", high: "more kids", low: "fewer kids",
  },
  vacancy: {
    key: "vacancy", label: "Vacancy", noun: "housing vacancy rate", hint: "Empty homes — often vacation or seasonal",
    unit: "pct", high: "more vacant homes", low: "fewer vacant homes",
  },
};

export function formatMetric(key: MetricKey, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (METRIC_DEFS[key].unit) {
    case "money":
      return "$" + Math.round(v).toLocaleString("en-US");
    case "pct":
      return `${v.toFixed(1)}%`;
    case "index":
      return `${Math.round(v)} / 100`;
    default:
      return Math.round(v).toLocaleString("en-US");
  }
}
