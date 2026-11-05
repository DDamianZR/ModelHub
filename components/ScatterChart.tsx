"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/components/SegmentedControl";
import { dominanceMap } from "@/lib/dominance";
import type { ScatterPoint } from "@/lib/types";

/**
 * Blended price (log scale) against composite, ranked and priced models only.
 *
 * Identity is carried by position, label and shape, never by hue: models on the cost
 * frontier are filled marks joined by a step line and named; everything else is a hollow
 * mark. One accent, the validated `--mark`, is the only colour in the figure.
 *
 * Reading it is the interaction. The pointer snaps to the nearest model, so nobody has to
 * land on a 6px circle, and the figure answers the question the frontier poses: for a model
 * on it, the quadrant of models it beats on both axes; for any other, the quadrant where
 * the models that beat it live, plus a line to the nearest of them. Both come from the same
 * dominance rule the ingest uses for the published flag (lib/dominance.ts, held to the data
 * by tests/dominance.test.ts), so the chart never says what the table does not.
 *
 * The frontier test compares point values and ignores intervals (see /methodology), so no
 * interval is drawn here: drawing one would imply the frontier respects it.
 *
 * Everything is reachable without a pointer: arrow keys step through the models by price,
 * Enter opens the model, Escape lets go, and the selection is announced in a live region.
 */

const WIDE = { w: 900, h: 380 };
const COMPACT = { w: 640, h: 440 };
const M = { top: 14, right: 20, bottom: 38, left: 50 };
const LABEL_H = 12;
const CHAR_W = 5.9;
/** Pointer reach, in viewBox units. Beyond it the pointer is over empty plot, not a model. */
const HIT = 30;

type Placed = { x: number; y: number; anchor: "start" | "end"; text: string };
type Filter = "all" | "open";

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

const exactPrice = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;

const circles = (list: { cx: number; cy: number }[], r: number) =>
  list
    .map((p) => `M${(p.cx - r).toFixed(1)},${p.cy.toFixed(1)}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`)
    .join("");

function layout(points: ScatterPoint[], W: number, H: number) {
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

  return {
    x,
    y,
    frontier,
    step,
    placed,
    xTicks: [0.1, 0.3, 1, 3, 10].filter((t) => Math.log10(t) > xMin && Math.log10(t) < xMax),
    yTicks: niceTicks(yMin, yMax, 5),
  };
}

export function ScatterChart({
  points,
  locale,
  compact = false,
}: {
  points: ScatterPoint[];
  locale: string;
  /** Taller and narrower, for a half-width column. */
  compact?: boolean;
}) {
  const t = useTranslations("home.scatter");
  const router = useRouter();
  const W = compact ? COMPACT.w : WIDE.w;
  const H = compact ? COMPACT.h : WIDE.h;

  const [filter, setFilter] = useState<Filter>("all");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const geo = useMemo(() => (points.length ? layout(points, W, H) : null), [points, W, H]);
  const dominance = useMemo(() => dominanceMap(points), [points]);
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const ordered = useMemo(
    () => [...points].sort((a, b) => a.price - b.price || b.composite - a.composite),
    [points],
  );
  const openCount = useMemo(() => points.filter((p) => p.open === true).length, [points]);

  if (!geo) return null;
  const { x, y, frontier, step, placed, xTicks, yTicks } = geo;

  const muted = (p: ScatterPoint) => filter === "open" && p.open !== true;
  const others = points.filter((p) => !p.frontier);
  const at = (p: ScatterPoint) => ({ cx: x(p.price), cy: y(p.composite) });

  const activeId = hoverId ?? pinnedId;
  const active = activeId ? (byId.get(activeId) ?? null) : null;
  const relation = active ? dominance.get(active.id)! : null;
  const related = active && relation ? (active.frontier ? relation.beats : relation.beatenBy) : [];
  const nearestBeater =
    active && !active.frontier && relation
      ? relation.beatenBy
          .map((id) => byId.get(id)!)
          .sort(
            (a, b) =>
              Math.hypot(x(a.price) - x(active.price), y(a.composite) - y(active.composite)) -
              Math.hypot(x(b.price) - x(active.price), y(b.composite) - y(active.composite)),
          )[0]
      : null;

  function pick(clientX: number, clientY: number): ScatterPoint | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * W;
    const sy = ((clientY - box.top) / box.height) * H;
    let best: ScatterPoint | null = null;
    let bestD = HIT;
    for (const p of points) {
      const d = Math.hypot(x(p.price) - sx, y(p.composite) - sy);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  const insideCard = (target: EventTarget | null) =>
    target instanceof Node && !!cardRef.current?.contains(target);

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === "touch" || insideCard(e.target)) return;
    const hit = pick(e.clientX, e.clientY);
    setHoverId((current) => (current === (hit?.id ?? null) ? current : (hit?.id ?? null)));
  }

  function onClick(e: MouseEvent) {
    if (insideCard(e.target)) return;
    const hit = pick(e.clientX, e.clientY);
    setHoverId(null);
    setPinnedId((current) => (hit && hit.id !== current ? hit.id : null));
  }

  function onKeyDown(e: KeyboardEvent) {
    const i = pinnedId ? ordered.findIndex((p) => p.id === pinnedId) : -1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = i < 0 ? 0 : Math.min(i + 1, ordered.length - 1);
    else if (e.key === "ArrowLeft") next = i < 0 ? ordered.length - 1 : Math.max(i - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ordered.length - 1;
    else if (e.key === "Escape") {
      setPinnedId(null);
      setHoverId(null);
      return;
    } else if (e.key === "Enter" && pinnedId) {
      e.preventDefault();
      router.push(`/${locale}/model/${pinnedId}`);
      return;
    } else return;
    e.preventDefault();
    setHoverId(null);
    setPinnedId(ordered[next as number].id);
  }

  const statusOf = (p: ScatterPoint) => {
    const rel = dominance.get(p.id)!;
    if (p.frontier) return t("beats", { count: rel.beats.length });
    const near = rel.beatenBy
      .map((id) => byId.get(id)!)
      .sort(
        (a, b) =>
          Math.hypot(x(a.price) - x(p.price), y(a.composite) - y(p.composite)) -
          Math.hypot(x(b.price) - x(p.price), y(b.composite) - y(p.composite)),
      )[0];
    return t("beatenBy", { count: rel.beatenBy.length, name: near?.name ?? "" });
  };

  const liveText = active
    ? `${active.name}. ${t("composite")} ${active.composite.toFixed(1)}, ${exactPrice(active.price)}/M. ${
        active.frontier ? t("onFrontier") : t("notOnFrontier")
      }. ${statusOf(active)}`
    : "";

  // The readout sits beside its point, flipped away from the nearer edge.
  const card = active
    ? (() => {
        const ax = x(active.price);
        const ay = y(active.composite);
        const left = ax > W * 0.56;
        const vy = ay / H;
        return {
          left: `${(ax / W) * 100}%`,
          top: `${(vy * 100).toFixed(2)}%`,
          transform: `translate(${left ? "calc(-100% - 14px)" : "14px"}, ${vy < 0.28 ? "-12%" : vy > 0.72 ? "-88%" : "-50%"})`,
        };
      })()
    : null;

  const pinnedCard = active !== null && active.id === pinnedId && hoverId === null;
  const pill = (text: string) => ({ text, w: text.length * 6.4 + 12 });
  const xPill = active ? pill(exactPrice(active.price)) : null;
  const yPill = active ? pill(active.composite.toFixed(1)) : null;

  const cardBody = active ? (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="m-0 font-medium leading-[1.35] text-primary">{active.name}</p>
        {active.rank !== null && (
          <span className="num shrink-0 text-2xs text-tertiary">{t("rank", { rank: active.rank })}</span>
        )}
      </div>
      <dl className="num m-0 mt-2 grid grid-cols-2 gap-x-3">
        <div>
          <dd className="m-0 text-lg font-semibold leading-none text-primary">{active.composite.toFixed(1)}</dd>
          <dt className="mt-1 text-2xs text-tertiary">{t("composite")}</dt>
        </div>
        <div>
          <dd className="m-0 text-lg font-semibold leading-none text-primary">{exactPrice(active.price)}</dd>
          <dt className="mt-1 text-2xs text-tertiary">{t("price")}</dt>
        </div>
      </dl>
      <div className="mt-3 flex flex-col gap-1 border-t border-subtle pt-2 leading-[1.45]">
        <p className="m-0 flex items-center gap-1.5 text-primary">
          <svg width="10" height="10" aria-hidden="true" className="shrink-0">
            {active.frontier ? (
              <circle cx="5" cy="5" r="4" fill="var(--mark)" />
            ) : (
              <circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.25" />
            )}
          </svg>
          {active.frontier ? t("onFrontier") : t("notOnFrontier")}
        </p>
        <p className="m-0 text-tertiary">{statusOf(active)}</p>
        {active.open !== null && (
          <p className="m-0 text-tertiary">{active.open ? t("open") : t("proprietary")}</p>
        )}
      </div>
      {pinnedCard && (
        <a
          href={`/${locale}/model/${active.id}`}
          className="mt-3 inline-flex min-h-9 w-full items-center justify-center rounded-control border border-subtle px-3 hover:bg-sunk"
        >
          {t("openModel")}
        </a>
      )}
    </>
  ) : null;

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedControl<Filter>
          label={t("filterLabel")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("filterAll") },
            { value: "open", label: t("filterOpen") },
          ]}
        />
        {filter === "open" && (
          <p className="m-0 max-w-[26rem] text-2xs leading-[1.5] text-tertiary">
            {t("filterOpenNote", { count: openCount })}
          </p>
        )}
      </div>

      <div className="relative overflow-x-auto" role="region" aria-label={t("figure")} tabIndex={0} onKeyDown={onKeyDown}>
        <div
          className={clsx("relative min-w-[34rem] lg:min-w-0", hoverId && "cursor-pointer")}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverId(null)}
          onClick={onClick}
        >
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full text-tertiary" aria-hidden="true">
            {/* Gridlines are one path; tick labels share their text attributes on the group. */}
            <path
              d={[
                ...yTicks.map((v) => `M${M.left},${y(v).toFixed(1)}H${W - M.right}`),
                ...xTicks.map((v) => `M${x(v).toFixed(1)},${M.top}V${H - M.bottom}`),
              ].join("")}
              stroke="var(--line-subtle)"
              fill="none"
            />
            <g fontSize="10" fill="currentColor" className="num">
              {yTicks.map((v) => (
                <text key={`y${v}`} x={M.left - 8} y={y(v) + 3.5} textAnchor="end">
                  {v}
                </text>
              ))}
              {xTicks.map((v) => (
                <text key={`x${v}`} x={x(v)} y={H - M.bottom + 16} textAnchor="middle">
                  {formatPrice(v)}
                </text>
              ))}
            </g>
            <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor">
              {t("xAxis")}
            </text>
            <text
              transform={`translate(11 ${(M.top + H - M.bottom) / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {t("yAxis")}
            </text>

            {/* Where the models that matter to the selection live: for a frontier model, the
                ones it beats (cost the same or more, score the same or less); for any other,
                the ones that beat it. */}
            {active && (
              <rect
                x={active.frontier ? x(active.price) : M.left}
                y={active.frontier ? y(active.composite) : M.top}
                width={active.frontier ? W - M.right - x(active.price) : x(active.price) - M.left}
                height={active.frontier ? H - M.bottom - y(active.composite) : y(active.composite) - M.top}
                fill="var(--mark)"
                fillOpacity="0.07"
              />
            )}

            {step && <path d={step} fill="none" stroke="var(--mark)" strokeWidth="1.25" strokeDasharray="3 3" />}

            {/* The other priced models: hollow circles in two paths, so 50-odd marks stay a
                couple of nodes. The selection is drawn over them, not by re-rendering them. */}
            <g className={clsx("transition-opacity duration-150 motion-reduce:transition-none", active && "opacity-60")}>
              <path
                d={circles(others.filter((p) => !muted(p)).map(at), 3)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
              />
              <path
                d={circles(others.filter(muted).map(at), 3)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                opacity="0.3"
              />
            </g>

            {related.length > 0 &&
              [false, true].map((dim) => (
                <path
                  key={String(dim)}
                  d={circles(
                    related
                      .map((id) => byId.get(id)!)
                      .filter((p) => muted(p) === dim)
                      .map(at),
                    3.5,
                  )}
                  fill="var(--surface-default)"
                  stroke="var(--mark)"
                  strokeWidth="1.5"
                  opacity={dim ? 0.3 : 1}
                />
              ))}
            {active && nearestBeater && (
              <line
                x1={x(active.price)}
                y1={y(active.composite)}
                x2={x(nearestBeater.price)}
                y2={y(nearestBeater.composite)}
                stroke="var(--mark)"
                strokeWidth="1.25"
              />
            )}
            {active && (
              <path
                d={`M${x(active.price).toFixed(1)},${y(active.composite).toFixed(1)}V${H - M.bottom}M${x(active.price).toFixed(1)},${y(active.composite).toFixed(1)}H${M.left}`}
                fill="none"
                stroke="var(--mark)"
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.7"
              />
            )}

            {frontier.map((p, i) => (
              <g key={p.id} className="transition-opacity duration-150 motion-reduce:transition-none" opacity={muted(p) ? 0.3 : 1}>
                <circle cx={x(p.price)} cy={y(p.composite)} r="4.25" fill="var(--mark)" />
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
              </g>
            ))}

            {active && (
              <>
                <circle
                  cx={x(active.price)}
                  cy={y(active.composite)}
                  r={active.frontier ? 8.5 : 5}
                  fill={active.frontier ? "none" : "var(--surface-default)"}
                  stroke="var(--mark)"
                  strokeWidth={active.frontier ? 1.5 : 2.25}
                />
                {xPill && yPill && (
                  <g fontSize="10" className="num" textAnchor="middle">
                    <rect
                      x={Math.min(Math.max(x(active.price) - xPill.w / 2, M.left), W - M.right - xPill.w)}
                      y={H - M.bottom + 4}
                      width={xPill.w}
                      height="17"
                      rx="3"
                      fill="var(--mark)"
                    />
                    <text
                      x={Math.min(Math.max(x(active.price), M.left + xPill.w / 2), W - M.right - xPill.w / 2)}
                      y={H - M.bottom + 16}
                      fill="var(--text-on-accent)"
                    >
                      {xPill.text}
                    </text>
                    <rect x={M.left - 4 - yPill.w} y={y(active.composite) - 8.5} width={yPill.w} height="17" rx="3" fill="var(--mark)" />
                    <text x={M.left - 4 - yPill.w / 2} y={y(active.composite) + 3.5} fill="var(--text-on-accent)">
                      {yPill.text}
                    </text>
                  </g>
                )}
              </>
            )}
          </svg>

          {active && card && (
            <div
              ref={cardRef}
              aria-hidden={!pinnedCard}
              className={clsx(
                "absolute z-10 w-[13rem] rounded-control border border-subtle bg-[var(--surface-default)] p-3 text-xs shadow-[0_8px_28px_-10px_rgba(0,0,0,0.35)] max-[37rem]:hidden",
                pinnedCard ? "pointer-events-auto" : "pointer-events-none",
              )}
              style={card}
            >
              {cardBody}
            </div>
          )}
        </div>
      </div>

      {/* Where the plot scrolls sideways (narrow screens) a floating readout would be cut off
          by the scroll edge, so the pinned model's readout sits under the plot instead. Only
          when pinned: hovering must not move the page. */}
      {pinnedCard && (
        <div className="mt-2 hidden rounded-control border border-subtle bg-[var(--surface-default)] p-3 text-xs max-[37rem]:block">
          {cardBody}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {liveText}
      </p>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-tertiary">
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill="var(--mark)" />
          </svg>
          {t("frontier")}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.25" />
          </svg>
          {t("others")}
        </span>
        <span>{t("hint")}</span>
      </figcaption>
    </figure>
  );
}
