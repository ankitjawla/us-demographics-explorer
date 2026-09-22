"use client";

import { formatInt, formatPct, type PyramidBand } from "@/lib/indicators";

/**
 * Hand-rolled, dependency-free charts for the dashboard.
 * Styling matches the app: white cards, stone text, tabular-nums, blue accents.
 */

export const CHART_COLORS = [
  "#2563eb", // blue-600
  "#f97316", // orange-500
  "#0d9488", // teal-600
  "#a855f7", // purple-500
  "#e11d48", // rose-600
  "#f59e0b", // amber-500
  "#64748b", // slate-500
];

export const COMPARE_COLORS = ["#2563eb", "#ea580c", "#0d9488"];

export function ChartEmpty({ label = "No data available" }: { label?: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl bg-stone-50 px-4 text-center text-sm text-stone-400">
      {label}
    </div>
  );
}

/* ---------------- Donut ---------------- */

export interface DonutSlice {
  label: string;
  value: number;
  pct: number | null;
  color: string;
}

export function Donut({
  slices,
  centerTop,
  centerBottom,
  ariaLabel,
}: {
  slices: DonutSlice[];
  centerTop: string;
  centerBottom: string;
  ariaLabel: string;
}) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((a, s) => a + s.value, 0);
  if (data.length === 0 || total <= 0) return <ChartEmpty />;

  const R = 64;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = data.map((s) => {
    const frac = s.value / total;
    const seg = { ...s, len: frac * C, off: acc };
    acc += frac * C;
    return seg;
  });

  return (
    <div className="flex justify-center">
      <svg viewBox="0 0 160 160" className="h-auto w-full max-w-[210px]" role="img" aria-label={ariaLabel}>
        {segs.map((s) => (
          <circle
            key={s.label}
            cx={80}
            cy={80}
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={26}
            strokeDasharray={`${Math.max(0, s.len - 1.5)} ${C - Math.max(0, s.len - 1.5)}`}
            strokeDashoffset={-s.off}
            transform="rotate(-90 80 80)"
          >
            <title>{`${s.label}: ${formatPct(s.pct)} (${formatInt(s.value)})`}</title>
          </circle>
        ))}
        <text x={80} y={76} textAnchor="middle" className="fill-stone-900" fontSize={17} fontWeight={800}>
          {centerTop}
        </text>
        <text x={80} y={94} textAnchor="middle" className="fill-stone-500" fontSize={10.5}>
          {centerBottom}
        </text>
      </svg>
    </div>
  );
}

/* ---------------- Horizontal bar list ---------------- */

export interface HBarItem {
  label: string;
  value: number;
  display: string;
  color: string;
  title?: string;
  onClick?: () => void;
}

export function HBar({
  items,
  ariaLabel,
  barHeight = "h-2.5",
}: {
  items: HBarItem[];
  ariaLabel: string;
  barHeight?: string;
}) {
  const data = items.filter((i) => Number.isFinite(i.value));
  if (data.length === 0) return <ChartEmpty />;
  const max = Math.max(1, ...data.map((i) => i.value));
  return (
    <div className="space-y-3" role="img" aria-label={ariaLabel}>
      {data.map((it) => {
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-stone-600" title={it.title || it.label}>
                {it.label}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-stone-900">{it.display}</span>
            </div>
            <div className={`mt-1.5 ${barHeight} overflow-hidden rounded-full bg-stone-200/70`}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, (it.value / max) * 100))}%`, background: it.color }}
              />
            </div>
          </>
        );
        return it.onClick ? (
          <button
            key={it.label}
            onClick={it.onClick}
            title={it.title || it.label}
            className="block w-full rounded-lg text-left transition-colors hover:bg-stone-50"
          >
            {row}
          </button>
        ) : (
          <div key={it.label} title={it.title}>
            {row}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Population pyramid ---------------- */

const PYR_MALE = "#0284c7";
const PYR_FEMALE = "#e11d48";

export function Pyramid({ bands }: { bands: PyramidBand[] }) {
  const data = bands.filter((b) => b.male + b.female > 0);
  if (data.length === 0) return <ChartEmpty label="No age data available" />;

  const maxPct = Math.max(0.001, ...data.flatMap((b) => [b.malePct ?? 0, b.femalePct ?? 0]));
  const W = 440;
  const rowH = 48;
  const padT = 26;
  const padB = 10;
  const H = data.length * rowH + padT + padB;
  const cx = W / 2;
  const half = W / 2 - 66; // room for value labels on both sides
  const barH = 20;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Population pyramid by age band">
      <text x={8} y={16} fontSize={11} fontWeight={700} className="fill-sky-700" letterSpacing={1}>
        MALE
      </text>
      <text x={W - 8} y={16} fontSize={11} fontWeight={700} textAnchor="end" className="fill-rose-700" letterSpacing={1}>
        FEMALE
      </text>
      {data.map((b, i) => {
        const y = padT + i * rowH;
        const mw = ((b.malePct ?? 0) / maxPct) * half;
        const fw = ((b.femalePct ?? 0) / maxPct) * half;
        const barY = y + 20;
        return (
          <g key={b.label}>
            <text x={cx} y={y + 12} textAnchor="middle" fontSize={11.5} fontWeight={600} className="fill-stone-500">
              {b.label}
            </text>
            <rect x={cx - mw} y={barY} width={Math.max(0, mw)} height={barH} rx={4} fill={PYR_MALE} opacity={0.88}>
              <title>{`Age ${b.label} · Male ${formatInt(b.male)} (${formatPct(b.malePct)})`}</title>
            </rect>
            <rect x={cx} y={barY} width={Math.max(0, fw)} height={barH} rx={4} fill={PYR_FEMALE} opacity={0.88}>
              <title>{`Age ${b.label} · Female ${formatInt(b.female)} (${formatPct(b.femalePct)})`}</title>
            </rect>
            <text
              x={cx - mw - 7}
              y={barY + barH / 2 + 4}
              textAnchor="end"
              fontSize={11}
              fontWeight={600}
              className="fill-stone-600 tabular-nums"
            >
              {formatInt(b.male)}
            </text>
            <text
              x={cx + fw + 7}
              y={barY + barH / 2 + 4}
              textAnchor="start"
              fontSize={11}
              fontWeight={600}
              className="fill-stone-600 tabular-nums"
            >
              {formatInt(b.female)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
