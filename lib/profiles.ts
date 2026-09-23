import { getSql } from "@/lib/db";
import { METRIC_KEYS, type MetricKey } from "./metricDefs";

/**
 * Per-geography "profiles": every headline metric for every state and
 * county, computed in ONE aggregated SQL query (one row per geography) and
 * cached in memory. Powers the map, rankings, percentile ranks, lookalike
 * places, superlatives and the guessing game without hammering Neon.
 *
 * Metrics (all ACS 5-year):
 *  population     B02001001
 *  income         B19013001 (median household income)
 *  poverty        B17001002 / B17001001 × 100
 *  housing        B25002001
 *  diversity      Simpson diversity index over the 8 B03002 race/ethnicity
 *                 groups: 100 × (1 − Σ share²) = chance (%) that two random
 *                 residents belong to different groups
 *  college        B15003022–025 / B15003001 × 100
 *  hispanic       B03002012 / B03002001 × 100
 *  homeownership  B25003002 / B25003001 × 100
 *  seniors        B01001 65+ (m 020–025, f 044–049) / B01001001 × 100
 *  youth          B01001 <18 (m 003–006, f 027–030) / B01001001 × 100
 *  vacancy        B25002003 / B25002001 × 100
 */

export interface Profile {
  geo_id: string;
  name: string;
  geo_type: string;
  state_fips: string;
  state_name: string;
  metrics: Record<MetricKey, number | null>;
  /** Non-Hispanic race/ethnicity shares (%) — used for lookalike matching. */
  mix: { white: number | null; black: number | null; asian: number | null };
}

const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `'${prefix}${String(from + i).padStart(3, "0")}'`).join(",");

const SENIOR_CODES = `${range("B01001", 20, 25)},${range("B01001", 44, 49)}`;
const YOUTH_CODES = `${range("B01001", 3, 6)},${range("B01001", 27, 30)}`;
const RACE_ETH_CODES = `${range("B03002", 3, 9)},'B03002012'`;

const VARS = [
  "B02001001", "B19013001", "B17001001", "B17001002",
  "B15003001", "B15003022", "B15003023", "B15003024", "B15003025",
  "B03002001", "B03002003", "B03002004", "B03002005", "B03002006", "B03002007", "B03002008", "B03002009", "B03002012",
  "B25002001", "B25002003", "B25003001", "B25003002",
  "B01001001",
  ...[20, 21, 22, 23, 24, 25, 44, 45, 46, 47, 48, 49, 3, 4, 5, 6, 27, 28, 29, 30].map(
    (n) => `B01001${String(n).padStart(3, "0")}`
  ),
];

/** One row per geography. `$1` = variable list, `$2` = extra filter param. */
function profileSql(where: string): string {
  const one = (code: string) => `MAX(o.value) FILTER (WHERE o.variable_code = '${code}')`;
  return `
    SELECT g.geo_id, g.name, g.geo_type, g.state_fips, g.state_name,
      ${one("B02001001")} AS pop,
      ${one("B19013001")} AS income,
      ${one("B17001001")} AS pov_den,
      ${one("B17001002")} AS pov_num,
      ${one("B15003001")} AS edu_den,
      SUM(o.value) FILTER (WHERE o.variable_code IN ('B15003022','B15003023','B15003024','B15003025')) AS edu_ba,
      ${one("B03002001")} AS eth_den,
      ${one("B03002003")} AS nh_white,
      ${one("B03002004")} AS nh_black,
      ${one("B03002006")} AS nh_asian,
      ${one("B03002012")} AS hisp,
      SUM(o.value * o.value) FILTER (WHERE o.variable_code IN (${RACE_ETH_CODES})) AS eth_sq,
      ${one("B25002001")} AS hu,
      ${one("B25002003")} AS hu_vacant,
      ${one("B25003001")} AS ten_den,
      ${one("B25003002")} AS ten_own,
      ${one("B01001001")} AS age_den,
      SUM(o.value) FILTER (WHERE o.variable_code IN (${SENIOR_CODES})) AS age_65,
      SUM(o.value) FILTER (WHERE o.variable_code IN (${YOUTH_CODES})) AS age_u18
    FROM geographies g
    JOIN observations o ON o.geo_id = g.geo_id AND o.variable_code = ANY($1)
    WHERE ${where}
    GROUP BY g.geo_id, g.name, g.geo_type, g.state_fips, g.state_name`;
}

type Row = Record<string, string | number | null>;

const num = (x: unknown): number | null => {
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const share = (part: unknown, whole: unknown): number | null => {
  const p = num(part);
  const w = num(whole);
  return p !== null && w !== null && w > 0 ? (p / w) * 100 : null;
};

export function rowToProfile(r: Row): Profile {
  const ethDen = num(r.eth_den);
  const ethSq = num(r.eth_sq);
  const diversity = ethDen && ethDen > 0 && ethSq !== null ? Math.max(0, 100 * (1 - ethSq / (ethDen * ethDen))) : null;
  const income = num(r.income);
  return {
    geo_id: String(r.geo_id),
    name: String(r.name),
    geo_type: String(r.geo_type),
    state_fips: String(r.state_fips),
    state_name: String(r.state_name),
    metrics: {
      population: num(r.pop),
      income: income !== null && income > 0 ? income : null,
      poverty: share(r.pov_num, r.pov_den),
      housing: num(r.hu),
      diversity,
      college: share(r.edu_ba, r.edu_den),
      hispanic: share(r.hisp, r.eth_den),
      homeownership: share(r.ten_own, r.ten_den),
      seniors: share(r.age_65, r.age_den),
      youth: share(r.age_u18, r.age_den),
      vacancy: share(r.hu_vacant, r.hu),
    },
    mix: {
      white: share(r.nh_white, r.eth_den),
      black: share(r.nh_black, r.eth_den),
      asian: share(r.nh_asian, r.eth_den),
    },
  };
}

export interface ProfileSet {
  counties: Profile[];
  states: Profile[];
  byId: Map<string, Profile>;
  loadedAt: number;
}

const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; promise: Promise<ProfileSet> } | null = null;

/** All state + county profiles, cached per server instance for 30 minutes. */
export function getProfiles(): Promise<ProfileSet> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = (async () => {
    const sql = getSql();
    const rows = (await sql.query(profileSql("g.geo_type IN ('county', 'state')"), [VARS])) as Row[];
    const counties: Profile[] = [];
    const states: Profile[] = [];
    const byId = new Map<string, Profile>();
    for (const r of rows) {
      const p = rowToProfile(r);
      byId.set(p.geo_id, p);
      (p.geo_type === "state" ? states : counties).push(p);
    }
    return { counties, states, byId, loadedAt: Date.now() };
  })();
  cache = { at: Date.now(), promise };
  promise.catch(() => {
    if (cache?.promise === promise) cache = null;
  });
  return promise;
}

/** Drop the cache (after a data refresh). */
export function invalidateProfiles() {
  cache = null;
}

/** Profile for any stored geography — including places / tracts fetched on demand. */
export async function getProfile(geoId: string): Promise<Profile | null> {
  const set = await getProfiles();
  const hit = set.byId.get(geoId);
  if (hit) return hit;
  const sql = getSql();
  const rows = (await sql.query(profileSql("g.geo_id = $2"), [VARS, geoId])) as Row[];
  return rows[0] ? rowToProfile(rows[0]) : null;
}

export { METRIC_KEYS };
