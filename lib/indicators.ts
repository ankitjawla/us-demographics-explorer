/**
 * Pure aggregation helpers: turn raw ACS variable observations into the
 * indicators the UI displays. Imported by the client — no server deps.
 *
 * Table -> indicator mapping (ACS 5-year, verified against Census Reporter):
 *  B02001  Race                                  -> race breakdown
 *  B03002  Hispanic or Latino origin by race     -> ethnicity + non-Hispanic race detail
 *  B01001  Sex by age                            -> sex split + age bands
 *  B15003  Educational attainment (25+)          -> education buckets
 *  B19013  Median household income               -> median income (+MOE)
 *  B17001  Poverty status by sex by age          -> poverty rate
 *  B25002  Occupancy status                      -> occupancy / vacancy
 *  B25003  Tenure                                -> owner / renter
 * Gender identity is NOT collected by the ACS -> marked unavailable in UI.
 */

export type ObsMap = Record<string, Record<string, { value: number | null; error: number | null }>>;

export interface Slice {
  label: string;
  value: number;
  pct: number | null;
}

export interface PyramidBand {
  label: string;
  male: number;
  female: number;
  malePct: number | null;
  femalePct: number | null;
}

function v(obs: ObsMap, table: string, code: string): number {
  const x = obs?.[table]?.[code]?.value;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function sumVars(obs: ObsMap, table: string, codes: string[]): number {
  return codes.reduce((a, c) => a + v(obs, table, c), 0);
}

function pct(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null;
}

const M = (n: number) => `B01001${String(n).padStart(3, "0")}`;
const E = (n: number) => `B15003${String(n).padStart(3, "0")}`;

export interface Indicators {
  population: number;
  male: number;
  female: number;
  race: Slice[]; // B02001, universe = total pop
  hispanic: number;
  nonHispanic: number;
  raceNH: Slice[]; // B03002 non-Hispanic race detail
  ageBands: Slice[]; // B01001
  pyramidBands: PyramidBand[]; // B01001, male/female per band
  education: Slice[]; // B15003, universe = pop 25+
  educationBase: number;
  medianIncome: number | null;
  incomeMoe: number | null;
  povertyRate: number | null;
  povertyBase: number;
  housingUnits: number;
  occupancyRate: number | null;
  vacancyRate: number | null;
  occupiedUnits: number;
  vacantUnits: number;
  ownerUnits: number;
  renterUnits: number;
  ownerRate: number | null;
  renterRate: number | null;
}

export function computeIndicators(obs: ObsMap): Indicators {
  const population = v(obs, "B02001", "B02001001");

  // Race (B02001)
  const raceDefs: Array<[string, string]> = [
    ["White alone", "B02001002"],
    ["Black or African American alone", "B02001003"],
    ["American Indian and Alaska Native alone", "B02001004"],
    ["Asian alone", "B02001005"],
    ["Native Hawaiian and Other Pacific Islander alone", "B02001006"],
    ["Some other race alone", "B02001007"],
    ["Two or more races", "B02001008"],
  ];
  const race = raceDefs.map(([label, code]) => {
    const value = v(obs, "B02001", code);
    return { label, value, pct: pct(value, population) };
  });

  // Ethnicity (B03002)
  const hispanic = v(obs, "B03002", "B03002012");
  const nonHispanic = v(obs, "B03002", "B03002002");
  const nhDefs: Array<[string, string]> = [
    ["White alone", "B03002003"],
    ["Black alone", "B03002004"],
    ["AIAN alone", "B03002005"],
    ["Asian alone", "B03002006"],
    ["NHPI alone", "B03002007"],
    ["Some other race alone", "B03002008"],
    ["Two or more races", "B03002009"],
  ];
  const raceNH = nhDefs.map(([label, code]) => {
    const value = v(obs, "B03002", code);
    return { label, value, pct: pct(value, population) };
  });

  // Sex + age bands (B01001)
  const male = v(obs, "B01001", "B01001002");
  const female = v(obs, "B01001", "B01001026");
  const F = (n: number) => `B01001${String(n).padStart(3, "0")}`;
  const bandDefs: Array<[string, number[], number[]]> = [
    ["0–17", [3, 4, 5, 6], [27, 28, 29, 30]],
    ["18–34", [7, 8, 9, 10, 11, 12], [31, 32, 33, 34, 35, 36]],
    ["35–54", [13, 14, 15, 16], [37, 38, 39, 40]],
    ["55–64", [17, 18, 19], [41, 42, 43]],
    ["65+", [20, 21, 22, 23, 24, 25], [44, 45, 46, 47, 48, 49]],
  ];
  const pyramidBands: PyramidBand[] = bandDefs.map(([label, mCodes, fCodes]) => {
    const m = sumVars(obs, "B01001", mCodes.map(M));
    const f = sumVars(obs, "B01001", fCodes.map(F));
    return { label, male: m, female: f, malePct: pct(m, population), femalePct: pct(f, population) };
  });
  const ageBands: Slice[] = pyramidBands.map((b) => ({
    label: b.label,
    value: b.male + b.female,
    pct: pct(b.male + b.female, population),
  }));

  // Education (B15003), universe = population 25+
  const educationBase = v(obs, "B15003", "B15003001");
  const eduDefs: Array<[string, string[]]> = [
    ["Less than high school", Array.from({ length: 15 }, (_, i) => E(i + 2))],
    ["High school / GED", [E(17), E(18)]],
    ["Some college / Associate's", [E(19), E(20), E(21)]],
    ["Bachelor's degree", [E(22)]],
    ["Graduate / professional degree", [E(23), E(24), E(25)]],
  ];
  const education = eduDefs.map(([label, codes]) => {
    const value = sumVars(obs, "B15003", codes);
    return { label, value, pct: pct(value, educationBase) };
  });

  // Income
  const medianIncomeRaw = obs?.["B19013"]?.["B19013001"]?.value;
  const incomeMoeRaw = obs?.["B19013"]?.["B19013001"]?.error;
  const medianIncome = typeof medianIncomeRaw === "number" && medianIncomeRaw > 0 ? medianIncomeRaw : null;
  const incomeMoe = typeof incomeMoeRaw === "number" ? incomeMoeRaw : null;

  // Poverty (B17001)
  const povertyBase = v(obs, "B17001", "B17001001");
  const povertyRate = pct(v(obs, "B17001", "B17001002"), povertyBase);

  // Housing
  const housingUnits = v(obs, "B25002", "B25002001");
  const occupied = v(obs, "B25002", "B25002002");
  const occupiedUnits = occupied;
  const vacantUnits = v(obs, "B25002", "B25002003");
  const occupancyRate = pct(occupied, housingUnits);
  const vacancyRate = pct(vacantUnits, housingUnits);
  const occupiedTenure = v(obs, "B25003", "B25003001");
  const ownerUnits = v(obs, "B25003", "B25003002");
  const renterUnits = v(obs, "B25003", "B25003003");
  const ownerRate = pct(ownerUnits, occupiedTenure);
  const renterRate = pct(renterUnits, occupiedTenure);

  return {
    population, male, female, race, hispanic, nonHispanic, raceNH,
    ageBands, pyramidBands, education, educationBase, medianIncome, incomeMoe,
    povertyRate, povertyBase, housingUnits, occupancyRate, vacancyRate,
    occupiedUnits, vacantUnits, ownerUnits, renterUnits, ownerRate, renterRate,
  };
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatPct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${p.toFixed(digits)}%`;
}

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}
