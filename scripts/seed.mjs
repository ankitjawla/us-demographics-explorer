#!/usr/bin/env node
/**
 * Seed Neon Postgres with ACS 5-year demographics for all US states + counties.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/seed.mjs [options]
 *
 * Options:
 *   --release=acs2024_5yr   Census Reporter release id (default: auto-detect newest 5-yr)
 *   --from-index=N          resume: skip the first N geographies (0-based)
 *   --batch=N               geographies per Census Reporter request (default 200)
 *   --tables=B02001,B03002   fetch only these tables (default: all 8)
 *
 * Idempotent: upserts on (geo_id, table_id, variable_code), so re-running or
 * resuming never duplicates rows. Progress is printed per chunk.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TABLES,
  detectLatest5yrRelease,
  fetchTableChunk,
  recordRefreshMeta,
  sleep,
  upsertGeographies,
  upsertObservations,
} from "../lib/census.js";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const fromIndex = parseInt(arg("from-index", "0"), 10) || 0;
const batchSize = parseInt(arg("batch", "200"), 10) || 200;
const tables = (arg("tables", TABLES.join(",")) || "").split(",").filter(Boolean);
let release = arg("release", "");

const geos = JSON.parse(readFileSync(join(here, "../data/geographies.json"), "utf8"));
const schemaSql = readFileSync(join(here, "../schema.sql"), "utf8");

const sql = neon(DATABASE_URL);

console.log(`Applying schema...`);
for (const stmt of schemaSql.split(";").map((s) => s.trim()).filter(Boolean)) {
  await sql.query(stmt);
}
console.log(`Schema OK.`);

if (!release) {
  console.log("Detecting newest ACS 5-year release on Census Reporter...");
  release = await detectLatest5yrRelease();
}
console.log(`Release: ${release}`);
console.log(`Geographies: ${geos.length} (from index ${fromIndex}), tables: ${tables.join(",")}`);

console.log("Upserting geographies...");
await upsertGeographies(sql, geos);
console.log("Geographies OK.");

const work = geos.slice(fromIndex);
const chunks = Math.ceil(work.length / batchSize);
let totalRows = 0;
const t0 = Date.now();

for (let i = 0; i < chunks; i++) {
  const slice = work.slice(i * batchSize, (i + 1) * batchSize);
  const ids = slice.map((g) => g.geo_id);
  const globalFrom = fromIndex + i * batchSize;
  const globalTo = globalFrom + slice.length - 1;
  try {
    const rows = await fetchTableChunk(ids, tables, release);
    await upsertObservations(sql, rows, release);
    totalRows += rows.length;
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `[${i + 1}/${chunks}] geos ${globalFrom}-${globalTo} (${slice[0].name} ...): ` +
        `${rows.length} rows upserted, ${totalRows} total, ${el}s elapsed`
    );
  } catch (e) {
    console.error(`\nFAILED at chunk ${i + 1}/${chunks} (geos ${globalFrom}-${globalTo}): ${e.message}`);
    console.error(`Resume with: node scripts/seed.mjs --release=${release} --from-index=${globalFrom}`);
    process.exit(1);
  }
  if (i < chunks - 1) await sleep(400);
}

await recordRefreshMeta(sql, release, geos.length);
console.log(`\nDone. release=${release} geos=${geos.length} observations_upserted=${totalRows}`);
console.log(`Elapsed: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
