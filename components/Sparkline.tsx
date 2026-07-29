import type { Trend } from "@/lib/types";

/**
 * Arena rating trajectory. Drawn as inline SVG rather than a chart library: at 64x16 a
 * library is all overhead.
 *
 * The trend arrives already scaled against a range SHARED with every other row, so two
 * lines in the same table are comparable — and already carrying whether its movement clears
 * the source's own confidence interval. When it does not, this draws a flat line instead of
 * a shape. A 0.5-point wobble rendered at full height beside a genuine 64-point climb tells
 * the reader the two are the same event, which is the specific lie this component used to
 * tell for 23 of the 49 models that had a series.
 */
export function Sparkline({ trend, label }: { trend: Trend; label: string }) {
  if (trend.points.length < 2) {
    return (
      <span className="num text-[11px]" style={{ color: "var(--muted)" }} title={label}>
        —
      </span>
    );
  }

  const width = 64;
  const height = 16;
  const pad = 1.5;
  const usable = height - pad * 2;
  const step = width / (trend.points.length - 1);

  // Not significant: one flat line at the series' own level. It still says where the model
  // sits relative to the others, which is true, without claiming it moved.
  const values = trend.significant
    ? trend.points
    : trend.points.map(
        () => trend.points.reduce((sum, v) => sum + v, 0) / trend.points.length,
      );

  const path = values
    .map((value, index) => {
      const x = index * step;
      const y = height - pad - value * usable;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = values[values.length - 1];
  const rising = trend.significant && (trend.last ?? 0) >= (trend.first ?? 0);
  const stroke = trend.significant
    ? rising
      ? "var(--amber)"
      : "var(--muted)"
    : "var(--rule)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      style={{ overflow: "visible" }}
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {trend.significant && (
        <circle
          cx={width}
          cy={height - pad - last * usable}
          r="1.75"
          fill={rising ? "var(--amber)" : "var(--muted)"}
        />
      )}
    </svg>
  );
}
