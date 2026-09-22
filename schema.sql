-- US Demographics Explorer — Neon Postgres schema.
-- Applied by `scripts/seed.mjs` (and by POST /api/refresh) via CREATE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS geographies (
  geo_id     TEXT PRIMARY KEY,  -- Census Reporter id, e.g. 04000US06 (state), 05000US06001 (county)
  name       TEXT NOT NULL,     -- "Los Angeles County, CA"
  geo_type   TEXT NOT NULL,     -- 'state' | 'county'
  state_fips TEXT NOT NULL,     -- 2-digit FIPS, e.g. '06'
  state_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  geo_id        TEXT NOT NULL REFERENCES geographies (geo_id),
  table_id      TEXT NOT NULL,            -- ACS table, e.g. B02001
  variable_code TEXT NOT NULL,            -- e.g. B02001001
  value         DOUBLE PRECISION,         -- estimate (NULL when suppressed)
  error         DOUBLE PRECISION,         -- margin of error (NULL when n/a)
  release       TEXT NOT NULL,            -- e.g. acs2024_5yr
  PRIMARY KEY (geo_id, table_id, variable_code)
);

CREATE INDEX IF NOT EXISTS idx_observations_geo_id ON observations (geo_id);
CREATE INDEX IF NOT EXISTS idx_geographies_name ON geographies (name);
CREATE INDEX IF NOT EXISTS idx_geographies_state ON geographies (state_fips, geo_type);

CREATE TABLE IF NOT EXISTS refresh_meta (
  id           INT PRIMARY KEY DEFAULT 1,
  release      TEXT,
  refreshed_at TIMESTAMPTZ,
  geo_count    INT,
  CONSTRAINT single_row CHECK (id = 1)
);

-- 2019–2023 ACS 5-year headline values, one row per geography, used by
-- /api/trends as the comparison baseline. Populated one-time by
-- `scripts/load-baseline.mjs` (Census Reporter hosts only the current
-- release, so there is no API for previous-release values). Mandatory for a
-- fresh deployment — trends are hidden until this table is loaded.
CREATE TABLE IF NOT EXISTS trend_baseline (
  geo_id       TEXT PRIMARY KEY,  -- e.g. 04000US34 (state), 05000US34003 (county)
  pop_2023     DOUBLE PRECISION,  -- B02001 total population
  income_2023  DOUBLE PRECISION,  -- B19013 median household income
  pov_num_2023 DOUBLE PRECISION,  -- B17001 below-poverty count
  pov_den_2023 DOUBLE PRECISION,  -- B17001 poverty universe
  housing_2023 DOUBLE PRECISION,  -- B25002 housing units
  loaded_at    TIMESTAMPTZ DEFAULT NOW()
);
