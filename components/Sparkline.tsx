/**
 * Arena rating trajectory. Values arrive pre-normalised to 0-1, oldest first.
 * Drawn as inline SVG rather than a chart library: at 64x16 a library is all overhead.
 */
export function Sparkline({
  points,
  label,
}: {
  points: number[];
  label: string;
}) {
  if (points.length < 2) {
    return (
      <span className="num text-[11px]" style={{ color: "var(--muted)" }}>
        —
      </span>
    );
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
        stroke={rising ? "var(--amber)" : "var(--muted)"}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={width}
        cy={height - pad - last * (height - pad * 2)}
        r="1.75"
        fill={rising ? "var(--amber)" : "var(--muted)"}
      />
    </svg>
  );
}
