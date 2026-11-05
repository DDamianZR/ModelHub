import type { ScatterPoint } from "@/lib/types";

/**
 * Blended price (log scale) against composite, ranked and priced models only.
 *
 * Identity is carried by position, label and shape, never by hue: models on the cost
 * frontier are filled marks joined by a step line and named; everything else is a hollow
 * mark with no label (the name is in the tooltip and the mark links to the model). One
 * accent, the validated `--mark`, is the only colour in the figure.
 *
 * The frontier test compares point values and ignores intervals (see /methodology), so no
 * interval is drawn here: drawing one would imply the frontier respects it.
 */

const WIDE = { w: 900, h: 380 };
const COMPACT = { w: 640, h: 440 };
const M = { top: 14, right: 20, bottom: 38, left: 46 };
const LABEL_H = 12;
const CHAR_W = 5.9;

type Placed = { x: number; y: number; anchor: "start" | "end"; text: string };

function niceTicks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

function formatPrice(value: number): string {
  if (value >= 10) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(value % 1 === 0 ? 0 : 1)}`;
  return `$${value}`;
}

export function ScatterChart({
  points,
  locale,
  labels,
  compact = false,
}: {
  points: ScatterPoint[];
  locale: string;
  /** Taller and narrower, for a half-width column. */
  compact?: boolean;
  labels: {
    figure: string;
    xAxis: string;
    yAxis: string;
    frontier: string;
    others: string;
    tooltip: (p: ScatterPoint) => string;
  };
}) {
  if (points.length === 0) return null;
  const W = compact ? COMPACT.w : WIDE.w;
  const H = compact ? COMPACT.h : WIDE.h;

  const prices = points.map((p) => p.price);
  const xMin = Math.log10(Math.min(...prices) * 0.8);
  const xMax = Math.log10(Math.max(...prices) * 1.25);
  const scores = points.map((p) => p.composite);
  const yMin = Math.floor((Math.min(...scores) - 2) / 5) * 5;
  const yMax = Math.ceil((Math.max(...scores) + 1) / 5) * 5;

  const x = (price: number) =>
    M.left + ((Math.log10(price) - xMin) / (xMax - xMin)) * (W - M.left - M.right);
  const y = (score: number) =>
    H - M.bottom - ((score - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);

  const frontier = points
    .filter((p) => p.frontier)
    .sort((a, b) => a.price - b.price || b.composite - a.composite);
  const others = points.filter((p) => !p.frontier);

  // Step line: up at each frontier price, then along. Reads as "what each price buys".
  const step = frontier
    .map((p, i) => {
      const px = x(p.price).toFixed(1);
      const py = y(p.composite).toFixed(1);
      return i === 0 ? `M${px},${py}` : `L${px},${y(frontier[i - 1].composite).toFixed(1)} L${px},${py}`;
    })
    .join(" ");

  // Greedy label placement: try right, then right-above, right-below, then the left side,
  // keeping the first position that clears every label already placed.
  const placed: Placed[] = [];
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const p of frontier) {
    const px = x(p.price);
    const py = y(p.composite);
    const width = p.name.length * CHAR_W;
    const candidates: Placed[] = [
      { x: px + 7, y: py + 3.5, anchor: "start", text: p.name },
      { x: px + 7, y: py - 9, anchor: "start", text: p.name },
      { x: px + 7, y: py + 16, anchor: "start", text: p.name },
      { x: px - 7, y: py - 9, anchor: "end", text: p.name },
      { x: px - 7, y: py + 16, anchor: "end", text: p.name },
      { x: px - 7, y: py + 3.5, anchor: "end", text: p.name },
      // Second tier, for a crowded corner: one label height further out.
      { x: px + 7, y: py - 22, anchor: "start", text: p.name },
      { x: px - 7, y: py - 22, anchor: "end", text: p.name },
      { x: px + 7, y: py + 29, anchor: "start", text: p.name },
      { x: px - 7, y: py + 29, anchor: "end", text: p.name },
    ];
    const fits = (c: Placed, strict = true) => {
      const x0 = c.anchor === "start" ? c.x : c.x - width;
      const x1 = x0 + width;
      const y0 = c.y - LABEL_H + 2;
      const y1 = c.y + 2;
      if (x0 < 2 || x1 > W - 2) return false;
      if (!strict) return true;
      if (boxes.some((b) => x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0)) return false;
      // A label must also clear every frontier mark, its own neighbours included.
      return !frontier.some((q) => {
        const qx = x(q.price);
        const qy = y(q.composite);
        return x0 < qx + 6 && x1 > qx - 6 && y0 < qy + 6 && y1 > qy - 6;
      });
    };
    // Last resort keeps the label inside the figure even if it has to touch a neighbour.
    const choice =
      candidates.find((c) => fits(c)) ?? candidates.find((c) => fits(c, false)) ?? candidates[1];
    const x0 = choice.anchor === "start" ? choice.x : choice.x - width;
    boxes.push({ x0, x1: x0 + width, y0: choice.y - LABEL_H + 2, y1: choice.y + 2 });
    placed.push(choice);
  }

  const xTicks = [0.1, 0.3, 1, 3, 10].filter((t) => Math.log10(t) > xMin && Math.log10(t) < xMax);
  const yTicks = niceTicks(yMin, yMax, 5);

  return (
    <figure className="m-0">
      <div className="relative overflow-x-auto" role="region" aria-label={labels.figure} tabIndex={0}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full min-w-[34rem] lg:min-w-0 text-tertiary"
        >
          {/* Gridlines are one path; tick labels share their text attributes on the group. */}
          <path
            d={[
              ...yTicks.map((t) => `M${M.left},${y(t).toFixed(1)}H${W - M.right}`),
              ...xTicks.map((t) => `M${x(t).toFixed(1)},${M.top}V${H - M.bottom}`),
            ].join("")}
            stroke="var(--line-subtle)"
            fill="none"
          />
          <g fontSize="10" fill="currentColor" className="num">
            {yTicks.map((t) => (
              <text key={`y${t}`} x={M.left - 8} y={y(t) + 3.5} textAnchor="end">
                {t}
              </text>
            ))}
            {xTicks.map((t) => (
              <text key={`x${t}`} x={x(t)} y={H - M.bottom + 16} textAnchor="middle">
                {formatPrice(t)}
              </text>
            ))}
          </g>
          <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor">
            {labels.xAxis}
          </text>
          <text
            transform={`translate(11 ${(M.top + H - M.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="10"
            fill="currentColor"
          >
            {labels.yAxis}
          </text>

          {step && <path d={step} fill="none" stroke="var(--mark)" strokeWidth="1.25" strokeDasharray="3 3" />}

          {/* The other priced models: one path of hollow circles, because 50-odd linked marks
              with tooltips were 26 KB of the home page for points that are not labelled. Each
              is in the ranking table with its price. */}
          <path
            d={others
              .map((p) => `M${(x(p.price) - 3).toFixed(1)},${y(p.composite).toFixed(1)}a3,3 0 1,0 6,0a3,3 0 1,0 -6,0`)
              .join("")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          />
          {frontier.map((p, i) => (
            <a key={p.id} href={`/${locale}/model/${p.id}`}>
              <title>{labels.tooltip(p)}</title>
              <circle cx={x(p.price)} cy={y(p.composite)} r="4.25" fill="var(--mark)" />
              <circle cx={x(p.price)} cy={y(p.composite)} r="9" fill="transparent" />
              <text
                x={placed[i].x}
                y={placed[i].y}
                textAnchor={placed[i].anchor}
                fontSize="11"
                fill="var(--text-primary)"
                stroke="var(--surface-default)"
                strokeWidth="3"
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {placed[i].text}
              </text>
            </a>
          ))}
        </svg>
      </div>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-tertiary">
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill="var(--mark)" />
          </svg>
          {labels.frontier}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.25" />
          </svg>
          {labels.others}
        </span>
      </figcaption>
    </figure>
  );
}
