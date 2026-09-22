import { getSql } from "@/lib/db";
import { FIPS_TO_NAME } from "./census.js";

/**
 * Shared place-search engine (used by /api/places and the chat assistant).
 *
 * Smart place search: resolves a free-text place (town, township, borough,
 * city, ZIP, neighborhood…) to every sub-state geography it touches —
 * county, county subdivision (township), incorporated place, and census
 * tract — returning the app's geo_id for each so callers can load
 * demographics on demand.
 *
 * Pipeline per Nominatim result:
 *   1. lat/lon -> US Census Geocoder (coordinates) -> GEOIDs for
 *      Counties, County Subdivisions, Incorporated Places, Census Tracts.
 *   2. County name comes from the same response; sub-county names too.
 *      (Counties are additionally matched against the DB when available.)
 *
 * Results are cached in-memory (LRU, 24h TTL). Nominatim is paced to
 * 1 request/second per its usage policy. Failures degrade gracefully:
 * callers should fall back to /api/geographies direct matches.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const UA = "us-demographics-explorer/1.0 (https://us-demographics-explorer.vercel.app)";

export interface Suggestion {
  place: string;
  placeType: string;
  county: string;
  state: string;
  geo_id: string;
  geo_type: "county" | "county_subdivision" | "place" | "tract";
  state_fips: string;
}

export interface PlaceSearchResult {
  suggestions: Suggestion[];
  cached: boolean;
  /** true when the upstream place lookup itself failed (caller -> 502). */
  lookupUnavailable: boolean;
}

/* ---------- in-memory LRU cache ---------- */
const MAX_CACHE = 200;
const TTL_MS = 24 * 3600 * 1000;
const cache = new Map<string, { ts: number; data: Suggestion[] }>();

function cacheGet(key: string): Suggestion[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit); // refresh LRU order
  return hit.data;
}

function cacheSet(key: string, data: Suggestion[]) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { ts: Date.now(), data });
}

/* ---------- 1 req/sec pacing for Nominatim ---------- */
let nextAllowedAt = 0;
let paceChain: Promise<void> = Promise.resolve();

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = paceChain.then(async () => {
    const wait = Math.max(0, nextAllowedAt - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      nextAllowedAt = Date.now() + 1100;
    }
  });
  paceChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/* ---------- helpers ---------- */

async function fetchJson(url: string, timeoutMs = 9000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "72": "PR",
};

const PLACE_TYPE_LABELS: Record<string, string> = {
  city: "city", town: "town", village: "village", borough: "borough",
  hamlet: "hamlet", suburb: "neighborhood", neighbourhood: "neighborhood",
  postcode: "ZIP code", county: "county", state: "state", island: "island",
  township: "township", municipality: "municipality",
};

/** "Teaneck township" -> "township"; "Census Tract 424" -> "census tract". */
function suffixLabel(name: string, fallback: string): string {
  const m = name.match(/\b(borough|township|town|city|village|hamlet|municipality|CDP)$/i);
  if (m) return m[1].toLowerCase() === "cdp" ? "census-designated place" : m[1].toLowerCase();
  return fallback;
}

function withAbbr(name: string, stateFips: string): string {
  const abbr = FIPS_TO_ABBR[stateFips];
  return abbr ? `${name}, ${abbr}` : name;
}

interface GeoLayers {
  county?: { geoid: string; name: string };
  cousub?: { geoid: string; name: string };
  place?: { geoid: string; name: string };
  tract?: { geoid: string; name: string };
  stateFips: string;
  stateName: string;
}

/** Census Geocoder: lat/lon -> county / county-subdivision / place / tract GEOIDs. */
async function geocoderLayers(lat: string, lon: string): Promise<GeoLayers | null> {
  const attempts: Array<[string, string]> = [
    ["Public_AR_Current", "Current_Current"],
    ["Public_AR_ACS2024", "ACS2024_Current"],
  ];
  for (const [benchmark, vintage] of attempts) {
    try {
      const url =
        `${GEOCODER}?x=${encodeURIComponent(lon)}&y=${encodeURIComponent(lat)}` +
        `&benchmark=${benchmark}&vintage=${vintage}&format=json`;
      const j = await fetchJson(url);
      const g = j?.result?.geographies;
      if (!g) continue;
      const pick = (layer: string) => {
        const hit = g?.[layer]?.[0];
        return hit?.GEOID && hit?.NAME ? { geoid: String(hit.GEOID), name: String(hit.NAME) } : undefined;
      };
      const county = pick("Counties");
      if (!county || !/^\d{5}$/.test(county.geoid)) continue;
      const stateFips = county.geoid.slice(0, 2);
      return {
        county,
        cousub: pick("County Subdivisions"),
        place: pick("Incorporated Places"),
        tract: pick("Census Tracts"),
        stateFips,
        stateName: FIPS_TO_NAME[stateFips] || "",
      };
    } catch {
      /* try next vintage */
    }
  }
  return null;
}

/** Resolve free text to sub-state geography suggestions. Never throws for lookup outages (sets lookupUnavailable). */
export async function searchPlaces(rawQuery: string, limit = 5): Promise<PlaceSearchResult> {
  const q = rawQuery.trim();
  if (q.length < 2) return { suggestions: [], cached: false, lookupUnavailable: false };
  const lim = Math.min(Math.max(limit, 1), 8);

  const key = q.toLowerCase().replace(/\s+/g, " ");
  const cached = cacheGet(key);
  if (cached) return { suggestions: cached.slice(0, lim), cached: true, lookupUnavailable: false };

  let sql: ReturnType<typeof getSql> | null = null;
  try {
    sql = getSql();
  } catch {
    sql = null; // degrade: geocoder names still work without the DB
  }

  let nominatim: any[];
  try {
    nominatim = await paced(() =>
      fetchJson(
        `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&countrycodes=us&limit=${lim}`
      )
    );
  } catch {
    return { suggestions: [], cached: false, lookupUnavailable: true };
  }
  if (!Array.isArray(nominatim)) nominatim = [];

  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (s: Suggestion) => {
    if (seen.has(s.geo_id)) return;
    seen.add(s.geo_id);
    suggestions.push(s);
  };

  for (const n of nominatim.slice(0, lim)) {
    try {
      const lat = n.lat;
      const lon = n.lon;
      if (!lat || !lon) continue;

      let layers: GeoLayers | null = null;
      try {
        layers = await geocoderLayers(String(lat), String(lon));
      } catch {
        layers = null;
      }

      if (layers) {
        const { county, cousub, place, tract, stateFips, stateName } = layers;
        const countyLabel = withAbbr(county!.name, stateFips);

        // 1) County (canonical name from DB when available)
        const countyGeoId = `05000US${county!.geoid}`;
        let countyName = countyLabel;
        if (sql) {
          try {
            const rows = await sql`
              SELECT name FROM geographies WHERE geo_id = ${countyGeoId} LIMIT 1`;
            if (rows[0]?.name) countyName = String(rows[0].name);
          } catch { /* keep geocoder name */ }
        }
        push({
          place: countyName,
          placeType: "county",
          county: countyName,
          state: stateName,
          geo_id: countyGeoId,
          geo_type: "county",
          state_fips: stateFips,
        });

        // 2) County subdivision (township / town)
        if (cousub && /^\d{10}$/.test(cousub.geoid)) {
          push({
            place: withAbbr(cousub.name, stateFips),
            placeType: suffixLabel(cousub.name, "township"),
            county: countyName,
            state: stateName,
            geo_id: `06000US${cousub.geoid}`,
            geo_type: "county_subdivision",
            state_fips: stateFips,
          });
        }

        // 3) Incorporated place (borough / city / village / CDP)
        if (place && /^\d{7}$/.test(place.geoid)) {
          push({
            place: withAbbr(place.name, stateFips),
            placeType: suffixLabel(place.name, "place"),
            county: countyName,
            state: stateName,
            geo_id: `16000US${place.geoid}`,
            geo_type: "place",
            state_fips: stateFips,
          });
        }

        // 4) Census tract
        if (tract && /^\d{11}$/.test(tract.geoid)) {
          push({
            place: withAbbr(tract.name, stateFips),
            placeType: "census tract",
            county: countyName,
            state: stateName,
            geo_id: `14000US${tract.geoid}`,
            geo_type: "tract",
            state_fips: stateFips,
          });
        }
      } else if (sql) {
        // Fallback: match Nominatim's county + state names against the DB.
        const countyName = n.address?.county;
        const stateName = n.address?.state;
        if (countyName && stateName) {
          try {
            const rows = await sql`
              SELECT geo_id, name, geo_type, state_fips, state_name FROM geographies
              WHERE geo_type = 'county' AND name ILIKE ${countyName} AND state_name ILIKE ${stateName}
              LIMIT 1`;
            const row = rows[0];
            if (row) {
              push({
                place: String(row.name),
                placeType: PLACE_TYPE_LABELS[n.addresstype] || n.addresstype || "place",
                county: String(row.name),
                state: String(row.state_name),
                geo_id: String(row.geo_id),
                geo_type: "county",
                state_fips: String(row.state_fips),
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      /* skip this candidate, keep the rest */
    }
  }

  cacheSet(key, suggestions);
  return { suggestions, cached: false, lookupUnavailable: false };
}
