# US Demographics Explorer (Next.js + Neon)

Race, ethnicity, sex, age, education, income, poverty and housing for all
50 US states + DC + Puerto Rico and 3,222 counties/county-equivalents,
backed by the latest ACS 5-year release.

**Stack:** Next.js 15 (App Router, TypeScript) · Tailwind CSS · Neon Postgres
(`@neondatabase/serverless`) · Census Reporter API (keyless).

## Data source

All figures come from the **U.S. Census Bureau American Community Survey
5-year estimates**, served keyless by **Census Reporter**
(`https://api.censusreporter.org/1.0`). We intentionally use
`api.censusreporter.org` and **not** `api.census.gov` (which now requires an
API key).

- **Release used:** `acs2024_5yr` — “ACS 2024 5-year” (2020–2024), the newest
  ACS 5-year release hosted by Census Reporter as of September 2026.
  The API's `latest` alias resolves to the **1-year** release, which lacks full
  county coverage, so the app/seed explicitly resolve the newest **5-year**
  release (`detectLatest5yrRelease()` in `lib/census.js`).
- **Geography list:** 2024 Census gazetteer — 52 states (50 + DC + PR),
  3,222 counties. (`/1.0/geo/search` is blocked from server environments, so
  the list is committed at `data/geographies.json` instead of fetched live.)
- **Bulk downloads:** no usable bulk bundle was reachable from this
  environment, so seeding uses chunked `/1.0/data/show/{release}` requests
  (~17 requests for all geos × 8 tables, ~560k values).

### Table → indicator mapping

| ACS table | Title | Used for |
|---|---|---|
| `B02001` | Race | Race shares (White/Black/AIAN/Asian/NHPI/Other/2+ races) |
| `B03002` | Hispanic or Latino origin by race | Ethnicity (Hispanic vs non-Hispanic) + non-Hispanic race detail |
| `B01001` | Sex by age | Male/female split; age bands 0–17, 18–34, 35–54, 55–64, 65+ |
| `B15003` | Educational attainment (25+) | <HS, HS/GED, some college/AA, bachelor's, graduate/professional |
| `B19013` | Median household income | Median income (+ margin of error) |
| `B17001` | Poverty status by sex by age | Poverty rate = below-poverty / poverty universe |
| `B25002` | Occupancy status | Occupied vs vacant share of housing units |
| `B25003` | Tenure | Owner- vs renter-occupied share |

**Gender identity** is explicitly marked *unavailable*: the ACS does not
collect it, at county level or any other level.

## Setup

```bash
npm install
cp .env.example .env   # then fill in values
```

### Environment variables

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | at **runtime** (not build) | Pooled Neon connection string (`?sslmode=require`). `next build` does **not** need it — the DB client is created lazily inside route handlers. |
| `REFRESH_TOKEN` | for forced refresh | Long random string; sent as `x-refresh-token` header or `?token=` with `POST /api/refresh?force=1`. |

## Database

Schema: [`schema.sql`](schema.sql)

- `geographies(geo_id PK, name, geo_type, state_fips, state_name)`
- `observations(geo_id, table_id, variable_code, value, error, release)` — PK on `(geo_id, table_id, variable_code)`, index on `geo_id`
- `refresh_meta(id, release, refreshed_at, geo_count)` — single row tracking the last refresh

Apply it manually if you like:

```bash
psql "$DATABASE_URL" -f schema.sql
```

(`scripts/seed.mjs` applies it automatically.)

## Seeding

```bash
DATABASE_URL="postgresql://..." node scripts/seed.mjs
# or: DATABASE_URL="..." npm run seed
```

- Fetches all 3,274 geographies × 8 tables from Census Reporter in chunks of
  200 geos/request, with retries + backoff, and upserts idempotently.
- Prints progress per chunk; takes roughly 5–15 minutes.
- Resumable: `node scripts/seed.mjs --from-index=1200 --release=acs2024_5yr`
- Options: `--release=`, `--from-index=N`, `--batch=N`, `--tables=B02001,B03002`

## API routes

| Route | Purpose |
|---|---|
| `GET /api/geographies?q=&state_fips=&type=&limit=` | Search states/counties; `state_fips=06` lists a state's counties (drill-down) |
| `GET /api/observations?geo_id=05000US06001` | All stored variables for one geography + release |
| `GET /api/meta` | `{ release, refreshed_at, geo_count, seeded }` for the header label |
| `GET /api/metric-values?metric=&state_fips=&geo_type=&mode=&limit=&min_pop=` | One value per county/state for the map & rankings. Metrics: `population`, `income`, `poverty`, `housing`, `diversity`, `college`, `hispanic`, `homeownership`, `seniors`, `youth`, `vacancy` |
| `GET /api/insights?geo_id=` | Percentile vs U.S. peers, in-state rank, lookalike places ("twins") and plain-language quick facts |
| `GET /api/highlights` | National county superlatives ("Did you know?") among counties with 10k+ residents |
| `GET /api/quiz?rounds=10` | Random county pairs for the Higher-or-Lower game |
| `GET /api/random` | A random county ("Surprise me") |
| `POST /api/refresh` | Pull newest 5-yr release → upsert → update `refresh_meta`. **429** if refreshed < 6h ago; `?force=1` + `REFRESH_TOKEN` bypasses. Returns `{ release, geos, observations, refreshed_at }`. |

## UI

Single-page explorer (`app/components/Explorer.tsx`): debounced search across
states/counties, state → county drill-down, side-by-side comparison (up to 3
geographies), indicator cards with CSS bar charts, a **Refresh data** button
(disabled while running, shows result/errors), and a persistent
`Data: {release} · updated {timestamp}` label. Gender identity is shown as an
explicit “unavailable” notice.

### Insights layer

`lib/profiles.ts` computes every headline metric for all states and counties
in **one aggregated SQL query** (one row per geography) and caches it in
memory for 30 minutes (cleared after a refresh). On top of it:

- **Map & rankings** can color/rank by 11 metrics, including a **diversity
  index** (Simpson index over the 8 B03002 race/ethnicity groups: the chance
  two random residents differ), college grads, age 65+, under 18,
  homeownership and vacancy. Rate rankings skip counties under 10,000 people.
- **Quick take** — the 3–4 metrics where a place is most unusual, phrased as
  sentences ("Highest median household income of 21 counties in New Jersey").
- **Where it stands** — percentile tracks vs all U.S. counties (or states),
  with national and in-state ranks.
- **Places like this** — nearest neighbours on z-scored income, poverty,
  education, race/ethnicity, age, housing (and size for counties/states).
  The match score is calibrated so a typical random county scores 50%.
- **Did you know?**, a **Higher-or-Lower** game, **Surprise me**, and
  shareable **`?geo=<geo_id>`** links (with working browser back/forward).

## Deploy to Vercel

```bash
vercel --prod
```

Then in the Vercel dashboard → Project → Settings → Environment Variables add:

- `DATABASE_URL` — pooled Neon string (all environments)
- `REFRESH_TOKEN` — long random string

Seed once after deploy:

```bash
DATABASE_URL="<pooled string>" npm run seed
```

Notes:

- `POST /api/refresh` sets `maxDuration = 300`. On Vercel **Hobby** (60s cap)
  a full refresh may time out — use `npm run seed` from your machine for the
  initial/backfill; the in-app button is best for incremental re-pulls.
- The app never touches the DB at build time, so preview/production builds
  succeed before secrets are configured; API routes return a clear
  `DATABASE_URL is not set` error until then.
