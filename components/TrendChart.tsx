import type { TrendSeries } from "@/lib/types";

/**
 * Best measured Arena rating per group on each snapshot date.
 *
 * Series are told apart by line style and by the legend above the plot, not by hue: the
 * first is a solid accent line, the second a dashed neutral one, a third would be dotted.
 * The legend carries each series' label, model count and latest value, so the figure
 * reads without colour.
 */

const W = 420;
const H = 190;
const M = { top: 10, right: 12, bottom: 24, left: 40 };
const DASH = [undefined, "5 4", "1.5 3.5"] as const;
const STROKE = ["var(--mark)", "var(--text-tertiary)", "var(--text-tertiary)"] as const;

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export function TrendChart({
  series,
  labelOf,
  title,
  caption,
  modelsLabel,
}: {
  series: TrendSeries[];
  labelOf: (key: string) => string;
  title: string;
  caption: string;
  modelsLabel: (count: number) => string;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const t0 = Math.min(...all.map((p) => day(p.date)));
  const t1 = Math.max(...all.map((p) => day(p.date)));
  const lo = Math.min(...all.map((p) => p.value));
  const hi = Math.max(...all.map((p) => p.value));
  const span = hi - lo;
  const tickStep = span <= 40 ? 10 : span <= 100 ? 20 : 50;
  const yMin = Math.floor(lo / tickStep) * tickStep;
  const yMax = Math.ceil(hi / tickStep) * tickStep;

  const x = (date: string) => M.left + ((day(date) - t0) / (t1 - t0 || 1)) * (W - M.left - M.right);
  const y = (value: number) =>
    H - M.bottom - ((value - yMin) / (yMax - yMin || 1)) * (H - M.top - M.bottom);

  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += tickStep) yTicks.push(v);

  // A short window is labelled at its own snapshot dates; a long one at month starts.
  const ticks: { date: string; label: string }[] = [];
  if (t1 - t0 < 62) {
    for (const date of [...new Set(all.map((p) => p.date))].sort()) {
      ticks.push({ date, label: date.slice(5) });
    }
  } else {
    const start = new Date(t0 * 86_400_000);
    let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    while (d.getTime() / 86_400_000 <= t1) {
      const iso = d.toISOString().slice(0, 10);
      ticks.push({ date: iso, label: iso.slice(5, 7) });
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
  }

  return (
    <figure className="m-0">
      <h3 className="eyebrow">{title}</h3>
      <ul className="mt-2 flex flex-col gap-1 text-xs">
        {series.map((s, i) => {
          const last = s.points[s.points.length - 1];
          return (
            <li key={s.key} className="flex items-center gap-2">
              <svg width="26" height="8" aria-hidden="true" className="shrink-0">
                <line x1="0" x2="26" y1="4" y2="4" stroke={STROKE[i] ?? STROKE[1]} strokeWidth="1.75" strokeDasharray={DASH[i] ?? DASH[2]} />
              </svg>
              <span>{labelOf(s.key)}</span>
              <span className="num text-tertiary">
                {last.value.toFixed(0)} · {modelsLabel(s.models)}
              </span>
            </li>
          );
        })}
      </ul>

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${caption}`} className="mt-2 block h-auto w-full text-tertiary">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line-subtle)" />
            <text x={M.left - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="currentColor" className="num">
              {v}
            </text>
          </g>
        ))}
        {ticks.map((m) => (
          <text key={m.date} x={x(m.date)} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor" className="num">
            {m.label}
          </text>
        ))}
        {series.map((s, i) => (
          <polyline
            key={s.key}
            points={s.points.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={STROKE[i] ?? STROKE[1]}
            strokeWidth="1.75"
            strokeDasharray={DASH[i] ?? DASH[2]}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* Each snapshot is a mark, so three points read as three points rather than as a
            continuous curve that was never measured between them. */}
        {series.map((s, i) =>
          s.points.map((p) => (
            <circle
              key={`${s.key}${p.date}`}
              cx={x(p.date)}
              cy={y(p.value)}
              r="2.5"
              fill={i === 0 ? "var(--mark)" : "var(--surface-default)"}
              stroke={STROKE[i] ?? STROKE[1]}
              strokeWidth="1.25"
            />
          )),
        )}
      </svg>
      <figcaption className="mt-1 text-2xs leading-[1.5] text-tertiary">{caption}</figcaption>
    </figure>
  );
}
