"use client";

import { useCallback, useEffect, useState } from "react";
import { formatInt, formatMoney } from "@/lib/indicators";
import { METRIC_DEFS } from "@/lib/metricDefs";
import type { Fact, Highlight, InsightsResult, QuizRound, Standing, Twin } from "@/lib/insights";

/**
 * Story-telling layers on top of the raw indicators:
 *  - PlaceInsights: quick take, "where it stands" percentile tracks, lookalike places
 *  - Highlights: national county superlatives ("Did you know?")
 *  - HigherLower: a guessing game over real county data
 */

export interface GeoRef {
  geo_id: string;
  name: string;
  geo_type: string;
  state_fips: string;
  state_name: string;
}

function Shell({ title, sub, action, children, id }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="scroll-mt-32 rounded-2xl border border-stone-200/80 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold tracking-tight">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Pulse({ rows = 4, h = "h-10" }: { rows?: number; h?: string }) {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${h} animate-pulse rounded-xl bg-stone-100`} />
      ))}
    </div>
  );
}

/* ---------------- place insights ---------------- */

function ordinalWord(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function standingCaption(s: Standing): string {
  if (s.percentile == null) return "No data";
  const p = s.percentile;
  // Neutral wording: "top" would read as praise for e.g. poverty.
  if (p >= 50) return `Higher than ${Math.min(99, Math.round(p))}%`;
  return `Lower than ${Math.min(99, Math.round(100 - p))}%`;
}

/** One row: label, value, and a 0–100 percentile track with the peer median marked. */
function StandingRow({ s, peerLabel }: { s: Standing; peerLabel: string }) {
  const p = s.percentile;
  const tip =
    p == null
      ? `${s.label}: no data`
      : `${s.label}: ${s.display} — ${ordinalWord(Math.round(p))} percentile of ${peerLabel} (typical: ${s.peerMedianDisplay})` +
        (s.rank != null ? ` · #${s.rank.toLocaleString("en-US")} of ${s.of.toLocaleString("en-US")}` : "") +
        (s.stateRank ? ` · #${s.stateRank.rank} of ${s.stateRank.of} in state` : "");
  return (
    <div className="group grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-stone-50 sm:grid-cols-[9rem_1fr_7.5rem]" title={tip}>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-stone-600">{s.label}</div>
        <div className="text-sm font-bold tabular-nums text-stone-900">{s.display}</div>
      </div>
      <div className="relative h-6" role="img" aria-label={tip}>
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-stone-100" />
        {p != null && (
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-200"
            style={{ left: `${Math.min(p, 50)}%`, width: `${Math.abs(p - 50)}%` }}
          />
        )}
        {/* peer median */}
        <div className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-y-1/2 bg-stone-300" />
        {p != null && (
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow ring-1 ring-blue-600/30 transition-[left] duration-500 group-hover:scale-110"
            style={{ left: `${p}%` }}
          />
        )}
      </div>
      <div className="text-right">
        <div className="text-xs font-bold tabular-nums text-stone-700">{standingCaption(s)}</div>
        {s.stateRank ? (
          <div className="text-[11px] tabular-nums text-stone-400">
            #{s.stateRank.rank} of {s.stateRank.of} in state
          </div>
        ) : s.rank != null ? (
          <div className="text-[11px] tabular-nums text-stone-400">
            #{s.rank} of {s.of.toLocaleString("en-US")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FactList({ facts, diversity }: { facts: Fact[]; diversity: number | null }) {
  return (
    <ul className="space-y-2.5">
      {facts.map((f) => (
        <li key={f.metric} className="flex gap-3 rounded-xl bg-stone-50 px-3.5 py-3 text-sm leading-snug text-stone-700">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              f.direction === "high" ? "bg-blue-100 text-blue-700" : "bg-stone-200 text-stone-600"
            }`}
            aria-label={f.direction === "high" ? "Above typical" : "Below typical"}
          >
            {f.direction === "high" ? "↑" : "↓"}
          </span>
          <span>{f.text}</span>
        </li>
      ))}
      {diversity != null && (
        <li className="flex gap-3 rounded-xl bg-stone-50 px-3.5 py-3 text-sm leading-snug text-stone-700">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[11px] font-bold text-stone-600">
            ⇄
          </span>
          <span>
            Pick two residents at random: there&rsquo;s a <b className="tabular-nums">{Math.round(diversity)}%</b> chance they
            belong to different racial or ethnic groups.
          </span>
        </li>
      )}
      {facts.length === 0 && diversity == null && <li className="text-sm text-stone-500">Nothing unusual stands out here.</li>}
    </ul>
  );
}

function TwinCard({ t, onSelect, onCompare }: { t: Twin; onSelect: (g: GeoRef) => void; onCompare?: (g: GeoRef) => void }) {
  const geo: GeoRef = { geo_id: t.geo_id, name: t.name, geo_type: t.geo_type, state_fips: t.state_fips, state_name: t.state_name };
  return (
    <div className="group flex flex-col rounded-xl border border-stone-200/80 p-3.5 transition-colors hover:border-blue-300 hover:bg-blue-50/30">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onSelect(geo)} className="min-w-0 text-left">
          <div className="truncate text-sm font-bold group-hover:text-blue-700">{t.name}</div>
          <div className="text-[11px] text-stone-500">
            {formatInt(t.population)} people · {formatMoney(t.income)}
          </div>
        </button>
        <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white" title="Similarity score — 50% is as alike as a typical random peer">
          {t.match}%
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${t.match}%` }} />
      </div>
      {t.sharedTraits.length > 0 && (
        <div className="mt-2 text-[11px] text-stone-500">Closest on {t.sharedTraits.join(" & ")}</div>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <button onClick={() => onSelect(geo)} className="rounded-lg border border-stone-200 px-2.5 py-1 text-[11px] font-semibold text-stone-600 hover:border-blue-400 hover:text-blue-700">
          Open →
        </button>
        {onCompare && (
          <button onClick={() => onCompare(geo)} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100">
            + Compare
          </button>
        )}
      </div>
    </div>
  );
}

export function PlaceInsights({
  geo,
  onSelect,
  onCompare,
}: {
  geo: GeoRef;
  onSelect: (g: GeoRef) => void;
  onCompare?: (g: GeoRef) => void;
}) {
  const [data, setData] = useState<InsightsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/insights?geo_id=${encodeURIComponent(geo.geo_id)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j as InsightsResult;
      })
      .then((j) => !cancelled && setData(j))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Insights unavailable"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [geo.geo_id]);

  if (error) return null; // insights are a bonus layer — the core dashboard still works

  const peerSingular = data?.peerLabel === "U.S. states" ? "state" : "county";
  const isSubCounty = geo.geo_type !== "state" && geo.geo_type !== "county";

  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-5">
      <div id="sec-quicktake" className="lg:col-span-2">
        <Shell title="Quick take" sub={`What makes ${geo.name} stand out`}>
          {loading || !data ? <Pulse rows={4} h="h-14" /> : <FactList facts={data.facts} diversity={data.diversity} />}
        </Shell>
      </div>
      <div id="sec-standing" className="lg:col-span-3">
        <Shell
          title="Where it stands"
          sub={
            data
              ? `Percentile vs all ${data.peerCount.toLocaleString("en-US")} ${data.peerLabel}${isSubCounty ? " (rates only)" : ""} — the tick marks the typical ${peerSingular}`
              : "Percentile vs U.S. peers"
          }
        >
          {loading || !data ? (
            <Pulse rows={6} h="h-9" />
          ) : (
            <div>
              <div className="mb-1 hidden grid-cols-[9rem_1fr_7.5rem] gap-3 px-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400 sm:grid">
                <span />
                <span className="flex justify-between">
                  <span>Lowest</span>
                  <span>Typical</span>
                  <span>Highest</span>
                </span>
                <span />
              </div>
              {data.standings.map((s) => (
                <StandingRow key={s.metric} s={s} peerLabel={data.peerLabel} />
              ))}
            </div>
          )}
        </Shell>
      </div>
      <div id="sec-twins" className="lg:col-span-5">
        <Shell
          title={`Places like ${geo.name.split(",")[0]}`}
          sub={`The ${data?.peerLabel ?? "U.S. counties"} with the most similar mix of income, education, race & ethnicity, age and housing${isSubCounty ? "" : " and size"}`}
        >
          {loading || !data ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-xl bg-stone-100" />
              ))}
            </div>
          ) : data.twins.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.twins.map((t) => (
                <TwinCard key={t.geo_id} t={t} onSelect={onSelect} onCompare={onCompare} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-500">Not enough data to find lookalikes.</p>
          )}
        </Shell>
      </div>
    </div>
  );
}

/* ---------------- overview: did you know? ---------------- */

const HIGHLIGHT_TINTS = [
  "from-blue-50 to-white",
  "from-amber-50 to-white",
  "from-teal-50 to-white",
  "from-rose-50 to-white",
  "from-violet-50 to-white",
  "from-emerald-50 to-white",
];

export function Highlights({ onSelect }: { onSelect: (g: GeoRef) => void }) {
  const [items, setItems] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/highlights")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list: Highlight[] = j.highlights || [];
        setItems(list);
        setOffset(list.length ? Math.floor(Math.random() * list.length) : 0);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && items.length === 0) return null;
  const shown = items.length ? Array.from({ length: Math.min(6, items.length) }, (_, i) => items[(offset + i) % items.length]) : [];

  return (
    <Shell
      title="Did you know?"
      sub="National record-holders among counties with 10,000+ residents — tap one to explore"
      action={
        items.length > 6 ? (
          <button
            onClick={() => setOffset((o) => (o + 6) % items.length)}
            className="shrink-0 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 hover:border-stone-300 hover:text-stone-900"
          >
            Shuffle ↻
          </button>
        ) : undefined
      }
    >
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-stone-100" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((h, i) => (
            <button
              key={h.id}
              onClick={() => onSelect(h.geo)}
              className={`group rounded-xl border border-stone-200/80 bg-gradient-to-br p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${HIGHLIGHT_TINTS[i % HIGHLIGHT_TINTS.length]}`}
            >
              <div className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{h.title}</div>
              <div className="mt-1.5 text-base font-extrabold leading-tight tracking-tight group-hover:text-blue-700">{h.geo.name}</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-stone-900">{h.display}</div>
              <p className="mt-1 text-xs leading-snug text-stone-600">{h.blurb}</p>
            </button>
          ))}
        </div>
      )}
    </Shell>
  );
}

/* ---------------- Higher or Lower game ---------------- */

const BEST_KEY = "usde:higher-lower-best";

export function HigherLower({ onSelect }: { onSelect: (g: GeoRef) => void }) {
  const [rounds, setRounds] = useState<QuizRound[]>([]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<"a" | "b" | null>(null);
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState({ right: 0, played: 0 });
  const [best, setBest] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/quiz?rounds=10");
      const j = await r.json();
      if (!r.ok || !j.rounds?.length) throw new Error();
      setRounds(j.rounds);
      setI(0);
      setPicked(null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    try {
      setBest(Number(localStorage.getItem(BEST_KEY)) || 0);
    } catch { /* storage blocked */ }
  }, [load]);

  if (failed && !rounds.length) return null;
  const round = rounds[i];
  const winner = round ? (round.a.value >= round.b.value ? "a" : "b") : null;
  const correct = picked != null && picked === winner;

  const choose = (side: "a" | "b") => {
    if (picked || !round) return;
    setPicked(side);
    const ok = side === winner;
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), played: s.played + 1 }));
    setStreak((s) => {
      const next = ok ? s + 1 : 0;
      if (next > best) {
        setBest(next);
        try {
          localStorage.setItem(BEST_KEY, String(next));
        } catch { /* ignore */ }
      }
      return next;
    });
  };

  const next = () => {
    if (i + 1 >= rounds.length) load();
    else {
      setI(i + 1);
      setPicked(null);
    }
  };

  const Side = ({ k }: { k: "a" | "b" }) => {
    if (!round) return null;
    const s = round[k];
    const isWin = winner === k;
    const reveal = picked != null;
    const tone = !reveal
      ? "border-stone-200 bg-white hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md"
      : isWin
        ? "border-emerald-400 bg-emerald-50"
        : "border-stone-200 bg-stone-50 opacity-80";
    return (
      <button
        onClick={() => (reveal ? onSelect({ ...s, geo_type: "county" }) : choose(k))}
        className={`flex min-h-32 flex-1 flex-col justify-between rounded-2xl border-2 p-4 text-left transition-all ${tone}`}
        aria-label={reveal ? `Open ${s.name}` : `Pick ${s.name}`}
      >
        <div>
          <div className="text-base font-extrabold leading-tight tracking-tight">{s.name.split(",")[0]}</div>
          <div className="text-xs text-stone-500">{s.state_name}</div>
        </div>
        <div className="mt-3 h-8">
          {reveal ? (
            <div className="flex items-center gap-2">
              <span className="text-2xl font-extrabold tabular-nums">{s.display}</span>
              {isWin && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Higher</span>}
            </div>
          ) : (
            <span className="text-2xl font-extrabold text-stone-300">?</span>
          )}
        </div>
        {reveal && <span className="mt-1 text-[11px] font-semibold text-blue-700">Open →</span>}
      </button>
    );
  };

  return (
    <Shell
      id="game"
      title="Higher or lower?"
      sub="Guess which county wins using real ACS numbers — how long can your streak last?"
      action={
        <div className="flex shrink-0 gap-1.5 text-[11px] font-bold tabular-nums">
          <span className="rounded-full bg-stone-900 px-2.5 py-1 text-white" title="Current streak">🔥 {streak}</span>
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600" title="Best streak on this device">Best {best}</span>
        </div>
      }
    >
      {loading && !round ? (
        <Pulse rows={2} h="h-24" />
      ) : round ? (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-800">
              {METRIC_DEFS[round.metric].label}
            </span>
            <span className="text-sm font-semibold text-stone-800">{round.question}</span>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Side k="a" />
            <span className="self-center text-xs font-extrabold uppercase text-stone-300">vs</span>
            <Side k="b" />
          </div>
          <div className="mt-3 flex min-h-9 flex-wrap items-center gap-3">
            {picked ? (
              <>
                <span className={`text-sm font-bold ${correct ? "text-emerald-700" : "text-rose-700"}`}>
                  {correct ? "Correct!" : "Not quite."}
                </span>
                <span className="text-xs text-stone-500 tabular-nums">
                  {score.right} / {score.played} right
                </span>
                <button onClick={next} className="ml-auto rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-stone-700">
                  Next round →
                </button>
              </>
            ) : (
              <span className="text-xs text-stone-400">Tap a county to lock in your guess.</span>
            )}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
