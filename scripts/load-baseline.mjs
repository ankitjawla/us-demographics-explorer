#!/usr/bin/env node
/**
 * One-time load of 2019–2023 ACS 5-year headline values into `trend_baseline`.
 *
 * Why: Census Reporter only hosts the current ACS 5-year release, so there is
 * no API for "previous release" values. The Census Bureau's official 2023
 * 5-year summary file (no API key needed) provides them. This script downloads
 * the four needed tables, parses them streaming, and upserts one row per
 * state / county / county-subdivision / place / tract.
 *
 * Usage: DATABASE_URL=... node scripts/load-baseline.mjs
 * Idempotent: upserts on geo_id.
 */

import { neon } from "@neondatabase/serverless";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const BASE = "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData";
// table -> estimate columns we need
const TABLES = {
  b02001: ["B02001_E001"], // total population
  b19013: ["B19013_E001"], // median household income
  b17001: ["B17001_E001", "B17001_E002"], // poverty universe, below poverty
  b25002: ["B25002_E001"], // housing units
};
const SUMLEVELS = new Set(["040", "050", "060", "140", "160"]);

const UA = "us-demographics-explorer/1.0 (baseline-load)";

async function download(table, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  cached ${dest}`);
    return;
  }
  const url = `${BASE}/acsdt5y2023-${table}.dat`;
  console.log(`  downloading ${url} ...`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`  saved ${dest} (${(statSync(dest).size / 1048576).toFixed(1)} MB)`);
}

function toOurGeoId(censusGeoId) {
  // Only canonical "full" GEO_IDs (sumlevel + "0000" + "US" + code), e.g.
  // "0400000US34". The table-based summary files also contain annotated
  // variants ("04000A0US34"), urban/rural splits ("04000C1US34") and
  // component rows ("040C201US34") which must NOT collapse into the same id.
  const m = /^(\d{3})0000US(.+)$/.exec(censusGeoId || "");
  if (!m || !SUMLEVELS.has(m[1])) return null;
  return `${m[1]}00US${m[2]}`;
}

function numOrNull(s) {
  if (s === undefined || s === null || s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null; // Census uses negatives for suppressed
  return n;
}

/** Stream-parse one .dat file; calls onRow(geoId, values) for wanted rows. */
async function parseTable(table, cols, onRow) {
  const path = `/tmp/acs2023-${table}.dat`;
  await download(table, path);
  const rl = createInterface({ input: (await import("node:fs")).createReadStream(path), crlfDelay: Infinity });
  let header = null;
  let idx = [];
  let kept = 0;
  for await (const line of rl) {
    if (!header) {
      header = line.split("|");
      idx = cols.map((c) => header.indexOf(c));
      if (idx.some((i) => i < 0)) throw new Error(`missing columns in ${table}: ${cols}`);
      continue;
    }
    const parts = line.split("|");
    const geoId = toOurGeoId(parts[0]);
    if (!geoId) continue;
    const values = idx.map((i) => numOrNull(parts[i]));
    onRow(geoId, values);
    kept++;
  }
  console.log(`  ${table}: kept ${kept.toLocaleString()} geographies`);
}

const sql = neon(DATABASE_URL);

console.log("Creating trend_baseline table...");
await sql.query(`
  CREATE TABLE IF NOT EXISTS trend_baseline (
    geo_id       TEXT PRIMARY KEY,
    pop_2023     DOUBLE PRECISION,
    income_2023  DOUBLE PRECISION,
    pov_num_2023 DOUBLE PRECISION,
    pov_den_2023 DOUBLE PRECISION,
    housing_2023 DOUBLE PRECISION,
    loaded_at    TIMESTAMPTZ DEFAULT NOW()
  );
`);

// geo_id -> {pop_2023, income_2023, pov_den_2023, pov_num_2023, housing_2023}
const acc = new Map();
function entry(id) {
  let e = acc.get(id);
  if (!e) {
    e = { pop_2023: null, income_2023: null, pov_den_2023: null, pov_num_2023: null, housing_2023: null };
    acc.set(id, e);
  }
  return e;
}

for (const [table, cols] of Object.entries(TABLES)) {
  console.log(`Parsing ${table}...`);
  await parseTable(table, cols, (geoId, values) => {
    const e = entry(geoId);
    if (table === "b02001") e.pop_2023 = values[0];
    else if (table === "b19013") e.income_2023 = values[0];
    else if (table === "b17001") { e.pov_den_2023 = values[0]; e.pov_num_2023 = values[1]; }
    else if (table === "b25002") e.housing_2023 = values[0];
  });
}

console.log(`Upserting ${acc.size.toLocaleString()} baseline rows...`);
const rows = [...acc.entries()];
const CHUNK = 2000;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const vals = [];
  const params = [];
  chunk.forEach(([id, e], k) => {
    const o = k * 6;
    vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6})`);
    params.push(id, e.pop_2023, e.income_2023, e.pov_num_2023, e.pov_den_2023, e.housing_2023);
  });
  await sql.query(
    `INSERT INTO trend_baseline (geo_id, pop_2023, income_2023, pov_num_2023, pov_den_2023, housing_2023)
     VALUES ${vals.join(",")}
     ON CONFLICT (geo_id) DO UPDATE SET
       pop_2023 = EXCLUDED.pop_2023, income_2023 = EXCLUDED.income_2023,
       pov_num_2023 = EXCLUDED.pov_num_2023, pov_den_2023 = EXCLUDED.pov_den_2023,
       housing_2023 = EXCLUDED.housing_2023, loaded_at = NOW()`,
    params
  );
  if (i % 20000 === 0) console.log(`  ${Math.min(i + CHUNK, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}`);
}

const check = await sql`SELECT count(*)::int AS c FROM trend_baseline`;
console.log(`Done. trend_baseline rows: ${check[0].c}`);
