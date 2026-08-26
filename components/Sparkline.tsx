/**
 * Arena rating trajectory. Values arrive pre-normalised to 0-1, oldest first.
 * Drawn as inline SVG rather than a chart library: at 64x16 a library is all overhead.
 *
 * Direction is carried by the endpoint's SHAPE as well as its hue — a filled dot rising,
 * a hollow ring falling. Hue alone fails anyone who cannot see it, which is the rule the
 * aliases page already states in writing and this component used to break.
 */
export function Sparkline({
  points,
  label,
  directionLabel,
}: {
  points: number[];
  label: string;
  /** "rising" / "falling", already localised. Folded into the accessible name. */
  directionLabel?: { up: string; down: string };
}) {
  if (points.length < 2) {
    return <span className="num text-2xs text-tertiary">—</span>;
  }

  const width = 64;
  const height = 16;
  const pad = 1.5;
  const step = width / (points.length - 1);
  const path = points
    .map((value, i) => {
      const x = i * step;
      const y = height - pad - value * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = points[points.length - 1];
  const first = points[0];
  const rising = last >= first;
  const stroke = rising ? "var(--accent)" : "var(--text-tertiary)";
  const direction = directionLabel ? (rising ? directionLabel.up : directionLabel.down) : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={direction ? `${label} — ${direction}` : label}
      className="overflow-visible"
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={width}
        cy={height - pad - last * (height - pad * 2)}
        r={rising ? 1.75 : 2}
        fill={rising ? stroke : "var(--surface-canvas)"}
        stroke={stroke}
        strokeWidth={rising ? 0 : 1.1}
      />
    </svg>
  );
}
