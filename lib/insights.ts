import { getProfile, getProfiles, type Profile } from "./profiles";
import { METRIC_DEFS, formatMetric, type MetricKey } from "./metricDefs";

/**
 * Derived, "story" views over the cached profiles:
 *  - getInsights: percentile ranks, in-state rank, lookalike places, quick facts
 *  - getHighlights: national county superlatives ("Did you know?")
 *  - getQuizRounds: Higher-or-Lower game rounds
 *  - getRandomCounty: "Surprise me"
 * Every number here comes straight from stored ACS values — nothing is invented.
 */

export interface Standing {
  metric: MetricKey;
  label: string;
  value: number | null;
  display: string;
  /** Share of peers with a lower value (0–100). */
  percentile: number | null;
  peerMedian: number | null;
  peerMedianDisplay: string;
  /** 1 = highest. */
  rank: number | null;
  of: number;
  stateRank: { rank: number; of: number } | null;
}

export interface Twin {
  geo_id: string;
  name: string;
  geo_type: string;
  state_fips: string;
  state_name: string;
  /** 0–100; 50 ≈ as similar as a typical random peer. */
  match: number;
  population: number | null;
  income: number | null;
  /** The two metrics where the twin is closest. */
  sharedTraits: string[];
}

export interface Fact {
  metric: MetricKey;
  text: string;
  direction: "high" | "low";
}

export interface InsightsResult {
  geo_id: string;
  peerLabel: string;
  peerCount: number;
  standings: Standing[];
  twins: Twin[];
  facts: Fact[];
  diversity: number | null;
}

const STANDING_METRICS: MetricKey[] = [
  "population", "income", "poverty", "college", "diversity",
  "hispanic", "homeownership", "seniors", "youth", "vacancy",
];

/** Size metrics only make sense against peers of the same kind. */
const SIZE_METRICS: MetricKey[] = ["population", "housing"];

const TWIN_FEATURES: Array<{ key: string; get: (p: Profile) => number | null; label: string }> = [
  { key: "income", get: (p) => (p.metrics.income ? Math.log(p.metrics.income) : null), label: "income" },
  { key: "poverty", get: (p) => p.metrics.poverty, label: "poverty" },
  { key: "college", get: (p) => p.metrics.college, label: "education" },
  { key: "hispanic", get: (p) => p.metrics.hispanic, label: "Hispanic share" },
  { key: "white", get: (p) => p.mix.white, label: "racial mix" },
  { key: "black", get: (p) => p.mix.black, label: "racial mix" },
  { key: "asian", get: (p) => p.mix.asian, label: "racial mix" },
  { key: "homeownership", get: (p) => p.metrics.homeownership, label: "homeownership" },
  { key: "seniors", get: (p) => p.metrics.seniors, label: "age profile" },
  { key: "youth", get: (p) => p.metrics.youth, label: "age profile" },
  { key: "vacancy", get: (p) => p.metrics.vacancy, label: "vacancy" },
];
const POP_FEATURE = {
  key: "population",
  get: (p: Profile) => (p.metrics.population && p.metrics.population > 0 ? Math.log(p.metrics.population) : null),
  label: "size",
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stats(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1)) || 1;
  return { mean, sd };
}

function ordinalRank(values: number[], v: number): number {
  let above = 0;
  for (const x of values) if (x > v) above++;
  return above + 1;
}

export function computeStandings(target: Profile, peers: Profile[], sameKind: boolean): Standing[] {
  const out: Standing[] = [];
  for (const key of STANDING_METRICS) {
    if (!sameKind && SIZE_METRICS.includes(key)) continue;
    const v = target.metrics[key];
    const others = peers.filter((p) => p.geo_id !== target.geo_id);
    const vals = others.map((p) => p.metrics[key]).filter((x): x is number => x != null);
    let percentile: number | null = null;
    let rank: number | null = null;
    if (v != null && vals.length > 0) {
      let below = 0;
      let equal = 0;
      for (const x of vals) {
        if (x < v) below++;
        else if (x === v) equal++;
      }
      percentile = ((below + equal / 2) / vals.length) * 100;
      rank = sameKind ? ordinalRank(vals, v) : null;
    }
    let stateRank: Standing["stateRank"] = null;
    if (sameKind && v != null && target.geo_type === "county") {
      const inState = others
        .filter((p) => p.state_fips === target.state_fips)
        .map((p) => p.metrics[key])
        .filter((x): x is number => x != null);
      if (inState.length >= 2) stateRank = { rank: ordinalRank(inState, v), of: inState.length + 1 };
    }
    const med = median(vals);
    out.push({
      metric: key,
      label: METRIC_DEFS[key].label,
      value: v,
      display: formatMetric(key, v),
      percentile,
      peerMedian: med,
      peerMedianDisplay: formatMetric(key, med),
      rank,
      of: vals.length + (sameKind ? 1 : 0),
      stateRank,
    });
  }
  return out;
}

export function computeTwins(target: Profile, peers: Profile[], useSize: boolean, limit = 6): Twin[] {
  const feats = useSize ? [...TWIN_FEATURES, POP_FEATURE] : TWIN_FEATURES;
  const norms = feats.map((f) => stats(peers.map(f.get).filter((x): x is number => x != null)));
  const tv = feats.map((f) => f.get(target));

  const scored: Array<{ p: Profile; d2: number; diffs: number[] }> = [];
  for (const p of peers) {
    if (p.geo_id === target.geo_id) continue;
    let sum = 0;
    let n = 0;
    const diffs: number[] = [];
    feats.forEach((f, i) => {
      const a = tv[i];
      const b = f.get(p);
      if (a == null || b == null) {
        diffs.push(Infinity);
        return;
      }
      const z = (a - b) / norms[i].sd;
      diffs.push(Math.abs(z));
      sum += z * z;
      n++;
    });
    if (n < feats.length * 0.7) continue; // too sparse to compare fairly
    scored.push({ p, d2: sum / n, diffs });
  }
  if (scored.length === 0) return [];

  // Calibrate: a peer at the median distance scores 50%.
  const medD2 = median(scored.map((s) => s.d2)) || 1;
  scored.sort((a, b) => a.d2 - b.d2);
  return scored.slice(0, limit).map(({ p, d2, diffs }) => {
    const traits: string[] = [];
    [...diffs.keys()]
      .sort((i, j) => diffs[i] - diffs[j])
      .forEach((i) => {
        const l = feats[i].label;
        if (traits.length < 2 && !traits.includes(l)) traits.push(l);
      });
    return {
      geo_id: p.geo_id,
      name: p.name,
      geo_type: p.geo_type,
      state_fips: p.state_fips,
      state_name: p.state_name,
      match: Math.round(100 * Math.pow(0.5, d2 / medD2)),
      population: p.metrics.population,
      income: p.metrics.income,
      sharedTraits: traits,
    };
  });
}

export function computeFacts(target: Profile, standings: Standing[], peerLabel: string): Fact[] {
  const ranked = standings
    .filter((s) => s.percentile != null && s.metric !== "housing")
    .map((s) => ({ s, extremity: Math.abs((s.percentile as number) - 50) }))
    .filter((x) => x.extremity >= 30)
    .sort((a, b) => b.extremity - a.extremity)
    .slice(0, 4);

  return ranked.map(({ s }) => {
    const def = METRIC_DEFS[s.metric];
    const high = (s.percentile as number) >= 50;
    const pct = Math.round(high ? (s.percentile as number) : 100 - (s.percentile as number));
    const ord = (n: number) => (n === 1 ? "" : `${n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`}-`);
    const word = high ? "highest" : "lowest";
    // Position from the extreme that matches the national direction (1 = most extreme).
    const fromEdge = (r: { rank: number; of: number }) => (high ? r.rank : r.of - r.rank + 1);
    let text: string;
    if (s.stateRank && s.stateRank.of >= 5 && fromEdge(s.stateRank) <= 3) {
      text = `${ord(fromEdge(s.stateRank))}${word} ${def.noun} of ${s.stateRank.of} counties in ${target.state_name} (${s.display}).`;
    } else if (s.rank != null && s.of >= 20 && fromEdge({ rank: s.rank, of: s.of }) <= 5) {
      text = `${ord(fromEdge({ rank: s.rank, of: s.of }))}${word} ${def.noun} of all ${s.of.toLocaleString("en-US")} ${peerLabel} (${s.display}).`;
    } else {
      text = `${high ? "Higher" : "Lower"} ${def.noun} than ${Math.min(pct, 99)}% of ${peerLabel} — ${s.display} vs a typical ${s.peerMedianDisplay}.`;
    }
    text = text.charAt(0).toUpperCase() + text.slice(1);
    return { metric: s.metric, text, direction: high ? "high" : "low" };
  });
}

export async function getInsights(geoId: string): Promise<InsightsResult> {
  if (!geoId) throw new Error("geo_id is required");
  const set = await getProfiles();
  const target = await getProfile(geoId);
  if (!target) throw new Error("no data for this geography");

  const isState = target.geo_type === "state";
  const sameKind = isState || target.geo_type === "county";
  const peers = isState ? set.states : set.counties;
  const peerLabel = isState ? "U.S. states" : "U.S. counties";

  const standings = computeStandings(target, peers, sameKind);
  const twins = computeTwins(target, peers, sameKind);
  const facts = computeFacts(target, standings, peerLabel);

  return {
    geo_id: target.geo_id,
    peerLabel,
    peerCount: peers.length,
    standings,
    twins,
    facts,
    diversity: target.metrics.diversity,
  };
}

/* ---------------- overview: superlatives ---------------- */

export interface Highlight {
  id: string;
  title: string;
  blurb: string;
  metric: MetricKey;
  value: number | null;
  display: string;
  geo: { geo_id: string; name: string; geo_type: string; state_fips: string; state_name: string };
}

const HIGHLIGHT_DEFS: Array<{ id: string; title: string; metric: MetricKey; order: "top" | "bottom"; blurb: (d: string) => string }> = [
  { id: "diverse", title: "Most diverse county", metric: "diversity", order: "top", blurb: (d) => `Diversity index ${d} — two random residents most likely differ in race or ethnicity.` },
  { id: "income", title: "Highest median income", metric: "income", order: "top", blurb: (d) => `Typical household earns ${d} a year.` },
  { id: "college", title: "Most college grads", metric: "college", order: "top", blurb: (d) => `${d} of adults 25+ hold a bachelor's degree or higher.` },
  { id: "oldest", title: "Oldest county", metric: "seniors", order: "top", blurb: (d) => `${d} of residents are 65 or older.` },
  { id: "youngest", title: "Most kids", metric: "youth", order: "top", blurb: (d) => `${d} of residents are under 18.` },
  { id: "owners", title: "Nation of homeowners", metric: "homeownership", order: "top", blurb: (d) => `${d} of occupied homes are owner-occupied.` },
  { id: "renters", title: "Renters' capital", metric: "homeownership", order: "bottom", blurb: (d) => `Only ${d} of homes are owner-occupied.` },
  { id: "vacant", title: "Most empty homes", metric: "vacancy", order: "top", blurb: (d) => `${d} of housing units are vacant — many are seasonal getaways.` },
  { id: "hispanic", title: "Most Hispanic / Latino", metric: "hispanic", order: "top", blurb: (d) => `${d} of residents are Hispanic or Latino.` },
  { id: "lowpov", title: "Lowest poverty", metric: "poverty", order: "bottom", blurb: (d) => `Just ${d} of residents live below the poverty line.` },
  { id: "uniform", title: "Least diverse county", metric: "diversity", order: "bottom", blurb: (d) => `Diversity index ${d} — nearly everyone shares one race/ethnicity.` },
  { id: "populous", title: "Biggest county", metric: "population", order: "top", blurb: (d) => `${d} residents — more than most states.` },
];

/** Counties under this size are skipped for rate superlatives (noisy estimates). */
const MIN_POP = 10_000;

export async function getHighlights(): Promise<Highlight[]> {
  const set = await getProfiles();
  const pool = set.counties.filter((p) => (p.metrics.population ?? 0) >= MIN_POP);
  const out: Highlight[] = [];
  for (const h of HIGHLIGHT_DEFS) {
    let best: Profile | null = null;
    for (const p of pool) {
      const v = p.metrics[h.metric];
      if (v == null) continue;
      const b = best?.metrics[h.metric];
      if (b == null || (h.order === "top" ? v > b : v < b)) best = p;
    }
    if (!best) continue;
    const value = best.metrics[h.metric];
    const display = formatMetric(h.metric, value);
    out.push({
      id: h.id,
      title: h.title,
      blurb: h.blurb(display),
      metric: h.metric,
      value,
      display,
      geo: {
        geo_id: best.geo_id,
        name: best.name,
        geo_type: best.geo_type,
        state_fips: best.state_fips,
        state_name: best.state_name,
      },
    });
  }
  return out;
}

/* ---------------- Higher or Lower game ---------------- */

export interface QuizSide {
  geo_id: string;
  name: string;
  state_fips: string;
  state_name: string;
  value: number;
  display: string;
}
export interface QuizRound {
  metric: MetricKey;
  question: string;
  a: QuizSide;
  b: QuizSide;
}

const QUIZ_METRICS: MetricKey[] = [
  "income", "poverty", "college", "seniors", "youth", "diversity", "homeownership", "hispanic", "vacancy", "population",
];

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

export async function getQuizRounds(count = 10): Promise<QuizRound[]> {
  const set = await getProfiles();
  const pool = set.counties.filter((p) => (p.metrics.population ?? 0) >= 20_000);
  if (pool.length < 2) return [];
  const rounds: QuizRound[] = [];
  let guard = 0;
  while (rounds.length < count && guard++ < count * 50) {
    const metric = pick(QUIZ_METRICS);
    const a = pick(pool);
    const b = pick(pool);
    const va = a.metrics[metric];
    const vb = b.metrics[metric];
    if (a.geo_id === b.geo_id || va == null || vb == null) continue;
    // Answerable but not trivial: 10%–60% relative gap.
    const gap = Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb));
    if (gap < 0.1 || gap > 0.6) continue;
    const side = (p: Profile, v: number): QuizSide => ({
      geo_id: p.geo_id, name: p.name, state_fips: p.state_fips, state_name: p.state_name,
      value: v, display: formatMetric(metric, v),
    });
    rounds.push({
      metric,
      question: `Which has the higher ${METRIC_DEFS[metric].noun}?`,
      a: side(a, va),
      b: side(b, vb),
    });
  }
  return rounds;
}

export async function getRandomCounty() {
  const set = await getProfiles();
  const pool = set.counties.filter((p) => (p.metrics.population ?? 0) >= 1_000);
  if (pool.length === 0) throw new Error("no counties loaded");
  const p = pick(pool);
  return { geo_id: p.geo_id, name: p.name, geo_type: p.geo_type, state_fips: p.state_fips, state_name: p.state_name };
}
