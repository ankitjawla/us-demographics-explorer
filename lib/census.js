/**
 * Shared Census Reporter client + Neon upsert helpers.
 *
 * Plain ESM (no TypeScript) so it can be imported both by
 * `scripts/seed.mjs` (plain node) and by the Next.js API routes.
 *
 * Data source: Census Reporter API (https://api.censusreporter.org) — keyless.
 * NOTE: the API's `latest` alias points at the ACS 1-year release, which does
 * NOT cover all counties. detectLatest5yrRelease() resolves the newest
 * ACS 5-year release id (e.g. "acs2024_5yr") instead.
 */

export const CENSUS_API = "https://api.censusreporter.org/1.0";

/** Census Reporter's WAF 403s Node's default UA — identify ourselves. */
const USER_AGENT = "us-demographics-explorer/1.0";

/** ACS detailed tables we store. */
export const TABLES = [
  "B02001", // Race
  "B03002", // Hispanic or Latino origin by race
  "B01001", // Sex by age
  "B15003", // Educational attainment (25+)
  "B19013", // Median household income
  "B17001", // Poverty status
  "B25002", // Occupancy status
  "B25003", // Tenure
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** FIPS -> full state name (incl. DC + PR), for on-demand geo resolution.
 * @type {Record<string, string>} */
export const FIPS_TO_NAME = {
  "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas",
  "06": "California", "08": "Colorado", "09": "Connecticut", "10": "Delaware",
  "11": "District of Columbia", "12": "Florida", "13": "Georgia", "15": "Hawaii",
  "16": "Idaho", "17": "Illinois", "18": "Indiana", "19": "Iowa",
  "20": "Kansas", "21": "Kentucky", "22": "Louisiana", "23": "Maine",
  "24": "Maryland", "25": "Massachusetts", "26": "Michigan", "27": "Minnesota",
  "28": "Mississippi", "29": "Missouri", "30": "Montana", "31": "Nebraska",
  "32": "Nevada", "33": "New Hampshire", "34": "New Jersey", "35": "New Mexico",
  "36": "New York", "37": "North Carolina", "38": "North Dakota", "39": "Ohio",
  "40": "Oklahoma", "41": "Oregon", "42": "Pennsylvania", "44": "Rhode Island",
  "45": "South Carolina", "46": "South Dakota", "47": "Tennessee", "48": "Texas",
  "49": "Utah", "50": "Vermont", "51": "Virginia", "53": "Washington",
  "54": "West Virginia", "55": "Wisconsin", "56": "Wyoming", "72": "Puerto Rico",
};

/**
 * On-demand geography prefixes: Census Reporter geo_id prefix ->
 * { fipsLen (digits after prefix), geo_type, friendly label }.
 * 040/050 exist in the DB; 160/060/140 are fetched on demand.
 */
export const GEO_PREFIXES = {
  "04000US": { fipsLen: 2, geo_type: "state", label: "state" },
  "05000US": { fipsLen: 5, geo_type: "county", label: "county" },
  "16000US": { fipsLen: 7, geo_type: "place", label: "place" },
  "06000US": { fipsLen: 10, geo_type: "county_subdivision", label: "township" },
  "14000US": { fipsLen: 11, geo_type: "tract", label: "census tract" },
};

/** Validate a geo_id and return its prefix info, or null. */
export function parseGeoId(geoId) {
  if (typeof geoId !== "string") return null;
  for (const [prefix, info] of Object.entries(GEO_PREFIXES)) {
    if (geoId.startsWith(prefix)) {
      const fips = geoId.slice(prefix.length);
      if (new RegExp(`^\\d{${info.fipsLen}}$`).test(fips)) {
        return { prefix, fips, state_fips: fips.slice(0, 2), ...info };
      }
    }
  }
  return null;
}

/** Display name for a geo from Census Reporter geo/show. */
export async function fetchGeoName(geoId) {
  const res = await fetchWithRetry(
    `${CENSUS_API}/geo/show/latest?geo_ids=${encodeURIComponent(geoId)}`,
    { retries: 3 }
  );
  const j = await res.json();
  const name = j?.features?.[0]?.properties?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/** GET with retries + exponential backoff for 429/5xx. */
export async function fetchWithRetry(url, { retries = 6, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(t);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
      } else {
        throw new Error(`HTTP ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      lastErr = e;
    }
    const backoff = Math.min(1000 * 2 ** attempt, 30000);
    await sleep(backoff + Math.random() * 500);
  }
  throw lastErr;
}

/**
 * Resolve the newest ACS 5-year release id hosted by Census Reporter.
 * "latest" currently maps to the 1-year release (incomplete county coverage),
 * so we derive the 5-year id for the same vintage and probe it, walking back
 * a few years as a fallback.
 */
export async function detectLatest5yrRelease() {
  let year = 2024;
  try {
    const res = await fetchWithRetry(
      `${CENSUS_API}/data/show/latest?table_ids=B02001&geo_ids=04000US06`
    );
    const j = await res.json();
    const m = String(j?.release?.id || "").match(/^acs(\d{4})_/);
    if (m) year = parseInt(m[1], 10);
  } catch {
    // fall through to probing
  }
  for (let y = year; y >= year - 4; y--) {
    const cand = `acs${y}_5yr`;
    try {
      const res = await fetchWithRetry(
        `${CENSUS_API}/data/show/${cand}?table_ids=B19013&geo_ids=04000US06`,
        { retries: 2 }
      );
      const j = await res.json();
      if (j?.data?.["04000US06"]) return cand;
    } catch {
      // try older
    }
  }
  throw new Error("Could not detect a working ACS 5-year release on Census Reporter");
}

/**
 * Fetch one chunk of geographies x tables from /data/show.
 * Returns flat rows: { geo_id, table_id, variable_code, value, error }.
 */
export async function fetchTableChunk(geoIds, tableIds, release) {
  const url =
    `${CENSUS_API}/data/show/${release}` +
    `?table_ids=${tableIds.join(",")}&geo_ids=${geoIds.join(",")}`;
  const j = await (await fetchWithRetry(url)).json();
  const rows = [];
  for (const [geoId, tables] of Object.entries(j.data || {})) {
    for (const [tableId, payload] of Object.entries(tables)) {
      const est = payload.estimate || {};
      const err = payload.error || {};
      for (const [code, value] of Object.entries(est)) {
        rows.push({
          geo_id: geoId,
          table_id: tableId,
          variable_code: code,
          value: value === null || value === undefined ? null : Number(value),
          error: err[code] === null || err[code] === undefined ? null : Number(err[code]),
        });
      }
    }
  }
  return rows;
}

/** Idempotent chunked upsert of geography rows. `sql` is a neon query fn. */
export async function upsertGeographies(sql, geos, chunkSize = 500) {
  for (let i = 0; i < geos.length; i += chunkSize) {
    const chunk = geos.slice(i, i + chunkSize);
    const vals = [];
    const params = [];
    chunk.forEach((g, k) => {
      const o = k * 5;
      vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5})`);
      params.push(g.geo_id, g.name, g.geo_type, g.state_fips, g.state_name);
    });
    await sql.query(
      `INSERT INTO geographies (geo_id, name, geo_type, state_fips, state_name)
       VALUES ${vals.join(",")}
       ON CONFLICT (geo_id) DO UPDATE SET
         name = EXCLUDED.name, geo_type = EXCLUDED.geo_type,
         state_fips = EXCLUDED.state_fips, state_name = EXCLUDED.state_name`,
      params
    );
  }
}

/** Idempotent chunked upsert of observation rows. */
export async function upsertObservations(sql, rows, release, chunkSize = 4000) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const vals = [];
    const params = [];
    chunk.forEach((r, k) => {
      const o = k * 6;
      vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6})`);
      params.push(r.geo_id, r.table_id, r.variable_code, r.value, r.error, release);
    });
    await sql.query(
      `INSERT INTO observations (geo_id, table_id, variable_code, value, error, release)
       VALUES ${vals.join(",")}
       ON CONFLICT (geo_id, table_id, variable_code) DO UPDATE SET
         value = EXCLUDED.value, error = EXCLUDED.error, release = EXCLUDED.release`,
      params
    );
  }
}

/** Record a completed refresh in refresh_meta. */
export async function recordRefreshMeta(sql, release, geoCount) {
  await sql.query(
    `INSERT INTO refresh_meta (id, release, refreshed_at, geo_count)
     VALUES (1, $1, NOW(), $2)
     ON CONFLICT (id) DO UPDATE SET
       release = EXCLUDED.release,
       refreshed_at = EXCLUDED.refreshed_at,
       geo_count = EXCLUDED.geo_count`,
    [release, geoCount]
  );
}
