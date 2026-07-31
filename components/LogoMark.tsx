/**
 * The ModelHub mark: a hexagonal node graph with a filled core.
 *
 * Redrawn as vector geometry from the source artwork in `public/logo.png`, which is white
 * strokes on black and so is invisible on the paper background. The strokes here inherit
 * `currentColor`, which is what lets one file serve both the light and dark palettes; only
 * the core keeps a fixed brand colour.
 */

const BRAND = "#8157fd";

// Node centres and the hexagon vertices share the same six angles, so the spokes stay radial.
const SPOKES = [
  "M 32 17.8 L 32 8.5",
  "M 44.3 24.9 L 52.35 20.25",
  "M 44.3 39.1 L 52.35 43.75",
  "M 32 46.2 L 32 55.5",
  "M 19.7 39.1 L 11.65 43.75",
  "M 19.7 24.9 L 11.65 20.25",
];

const NODES = [
  [32, 4.5],
  [55.82, 18.25],
  [55.82, 45.75],
  [32, 59.5],
  [8.18, 45.75],
  [8.18, 18.25],
] as const;

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 32 17.8 L 44.3 24.9 L 44.3 39.1 L 32 46.2 L 19.7 39.1 L 19.7 24.9 Z" />
        {SPOKES.map((d) => (
          <path key={d} d={d} />
        ))}
        {NODES.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.4" strokeWidth="2.2" />
        ))}
      </g>
      <path
        d="M 32 25.9 L 37.28 28.95 L 37.28 35.05 L 32 38.1 L 26.72 35.05 L 26.72 28.95 Z"
        fill={BRAND}
      />
    </svg>
  );
}
