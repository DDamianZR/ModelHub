"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { FIT_MARGINAL_MAX_RATIO } from "@/lib/fit";
import { runsHere, type Result } from "@/lib/local-view";
import { fmt } from "./form";

/**
 * Every model in the catalogue against the memory it needs, with the machine drawn as a
 * line across it. Left of the line a model fits; the further up, the higher its composite.
 * Models ModelHub does not score sit in a lane of their own along the bottom, because they
 * have a size and no quality figure, and giving them a height would invent one.
 *
 * Identity is carried by position and fill, never by hue: a filled mark runs on this machine,
 * a hollow one does not. One accent, the validated `--mark`, is the only colour in the figure.
 * Moving the sliders moves the line, so the figure is what answers "and with more memory?".
 *
 * The x position is the memory at Q4_K_M, a fixed reference. A filled mark right of the line
 * therefore runs at a lower quantisation, or spills into RAM; the verdict on the card and in
 * the detail panel is the full calculation, this is the picture of it.
 *
 * Reachable without a pointer: arrow keys step through the models by memory, and the
 * selection and the hovered model are announced in a live region.
 */

const W = 900;
const H = 400;
const M = { top: 40, right: 20, bottom: 40, left: 50 };
const LANE = 40;
const LABEL_H = 12;
const CHAR_W = 5.9;
/** Pointer reach, in viewBox units. */
const HIT = 24;
const X_MIN = 0.5;
const X_MAX = 1024;
const X_TICKS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

const circles = (list: { cx: number; cy: number }[], r: number) =>
  list
    .map((p) => `M${(p.cx - r).toFixed(1)},${p.cy.toFixed(1)}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`)
    .join("");

type Point = { id: string; result: Result; mem: number; cx: number; cy: number };

export function CapacityMap({
  results,
  refMemory,
  fastGb,
  reachGb,
  selectedId,
  visibleIds,
  onSelect,
  locale,
}: {
  results: Result[];
  /** Memory at the Q4_K_M reference, GB, by model id. */
  refMemory: Map<string, number>;
  /** The pool a model runs in at full speed: GPU memory, shared pool, or RAM on a CPU. */
  fastGb: number;
  /** With a discrete GPU, how far RAM stretches it (slower); null otherwise. */
  reachGb: number | null;
  selectedId: string | null;
  visibleIds: Set<string>;
  onSelect: (id: string) => void;
  locale: string;
}) {
  const t = useTranslations("local.map");
  const tv = useTranslations("local.verdict");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const geo = useMemo(() => {
    const plotBottom = H - M.bottom - LANE - 6;
    const laneTop = H - M.bottom - LANE;
    const scores = results.flatMap((r) => (r.entry.composite !== null ? [r.entry.composite] : []));
    const lo = scores.length ? Math.floor((Math.min(...scores) - 2) / 5) * 5 : 0;
    const hi = scores.length ? Math.ceil((Math.max(...scores) + 1) / 5) * 5 : 100;
    const octaves = Math.log2(X_MAX / X_MIN);
    const x = (gb: number) =>
      M.left + (Math.log2(Math.min(Math.max(gb, X_MIN), X_MAX) / X_MIN) / octaves) * (W - M.left - M.right);
    const y = (score: number) => plotBottom - ((score - lo) / (hi - lo)) * (plotBottom - M.top);

    const known = results
      .filter((r) => refMemory.has(r.entry.spec.model_id))
      .sort((a, b) => refMemory.get(a.entry.spec.model_id)! - refMemory.get(b.entry.spec.model_id)!);
    let lane = 0;
    const points: Point[] = known.map((r) => {
      const id = r.entry.spec.model_id;
      const mem = refMemory.get(id)!;
      const composite = r.entry.composite;
      // Unscored models stagger over three rows so neighbours in memory stay legible.
      const cy = composite !== null ? y(composite) : laneTop + 9 + (lane++ % 3) * 11;
      return { id, result: r, mem, cx: x(mem), cy };
    });

    const yTicks: number[] = [];
    for (let v = Math.ceil(lo / 5) * 5; v <= hi + 1e-9; v += 5) yTicks.push(v);
    return { x, y, points, laneTop, plotBottom, yTicks };
  }, [results, refMemory]);

  const { x, points, laneTop, plotBottom, yTicks } = geo;
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);

  const active = byId.get(hoverId ?? selectedId ?? "") ?? null;
  const fastX = x(fastGb * FIT_MARGINAL_MAX_RATIO);
  const reachX = reachGb !== null ? x(reachGb * FIT_MARGINAL_MAX_RATIO) : null;

  function pick(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * W;
    const sy = ((clientY - box.top) / box.height) * H;
    let best: Point | null = null;
    let bestD = HIT;
    for (const p of points) {
      const d = Math.hypot(p.cx - sx, p.cy - sy);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    const hit = pick(e.clientX, e.clientY);
    setHoverId((current) => (current === (hit?.id ?? null) ? current : (hit?.id ?? null)));
  }

  function onClick(e: MouseEvent) {
    const hit = pick(e.clientX, e.clientY);
    setHoverId(null);
    if (hit) onSelect(hit.id);
  }

  function onKeyDown(e: KeyboardEvent) {
    const i = selectedId ? points.findIndex((p) => p.id === selectedId) : -1;
    let next: number;
    if (e.key === "ArrowRight") next = i < 0 ? 0 : Math.min(i + 1, points.length - 1);
    else if (e.key === "ArrowLeft") next = i < 0 ? points.length - 1 : Math.max(i - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = points.length - 1;
    else if (e.key === "Escape") {
      setHoverId(null);
      return;
    } else return;
    e.preventDefault();
    setHoverId(null);
    if (points[next]) onSelect(points[next].id);
  }

  const dim = (p: Point) => !visibleIds.has(p.id);
  const group = (runs: boolean, faded: boolean) =>
    points.filter((p) => runsHere(p.result) === runs && dim(p) === faded);

  const label = (p: Point) => {
    const text = p.result.entry.display_name;
    const width = text.length * CHAR_W;
    const right = p.cx + 9 + width < W - 4;
    return {
      x: right ? p.cx + 9 : p.cx - 9,
      y: Math.max(p.cy - 9, M.top + LABEL_H),
      anchor: right ? ("start" as const) : ("end" as const),
      text,
    };
  };

  const liveText = active
    ? t(active.result.entry.measured ? "readoutMeasured" : "readoutUnmeasured", {
        name: active.result.entry.display_name,
        gb: fmt(active.mem, locale),
        composite: active.result.entry.composite === null ? "" : fmt(active.result.entry.composite, locale),
        verdict: tv(active.result.fit.level),
      })
    : t("hint");

  const activeLabel = active ? label(active) : null;

  return (
    <figure className="m-0">
      <div className="relative overflow-x-auto" role="region" aria-label={t("figure")} tabIndex={0} onKeyDown={onKeyDown}>
        <div
          className={clsx("relative min-w-[40rem] lg:min-w-0", hoverId && "cursor-pointer")}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverId(null)}
          onClick={onClick}
        >
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full text-tertiary" aria-hidden="true">
            {/* Where the machine reaches: full speed up to the line, spilling into RAM up to the dashed one. */}
            <rect x={M.left} y={M.top} width={Math.max(fastX - M.left, 0)} height={H - M.bottom - M.top} fill="var(--mark)" fillOpacity="0.08" />
            {reachX !== null && reachX > fastX && (
              <rect x={fastX} y={M.top} width={reachX - fastX} height={H - M.bottom - M.top} fill="var(--mark)" fillOpacity="0.035" />
            )}

            <path
              d={[
                ...yTicks.map((v) => `M${M.left},${geo.y(v).toFixed(1)}H${W - M.right}`),
                ...X_TICKS.map((v) => `M${x(v).toFixed(1)},${M.top}V${plotBottom}`),
              ].join("")}
              stroke="var(--line-subtle)"
              fill="none"
            />
            <path d={`M${M.left},${laneTop}H${W - M.right}`} stroke="var(--line-subtle)" strokeDasharray="2 3" fill="none" />

            <g fontSize="10" fill="currentColor" className="num">
              {yTicks.map((v) => (
                <text key={`y${v}`} x={M.left - 8} y={geo.y(v) + 3.5} textAnchor="end">
                  {v}
                </text>
              ))}
              {X_TICKS.map((v) => (
                <text key={`x${v}`} x={x(v)} y={H - M.bottom + 16} textAnchor="middle">
                  {v}
                </text>
              ))}
            </g>
            <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor">
              {t("xAxis")}
            </text>
            <text
              transform={`translate(11 ${(M.top + plotBottom) / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {t("yAxis")}
            </text>
            <text x={W - M.right - 4} y={laneTop - 4} textAnchor="end" fontSize="10" fill="currentColor">
              {t("lane")}
            </text>

            {/* The machine. */}
            <path d={`M${fastX.toFixed(1)},${M.top}V${H - M.bottom}`} stroke="var(--mark)" strokeWidth="1.5" fill="none" />
            <text
              x={fastX + (fastX > W * 0.7 ? -6 : 6)}
              y={M.top - 24}
              fontSize="11"
              fill="var(--text-primary)"
              textAnchor={fastX > W * 0.7 ? "end" : "start"}
              className="num"
            >
              {t("fast", { gb: fmt(fastGb, locale) })}
            </text>
            {reachX !== null && reachX > fastX && (
              <>
                <path d={`M${reachX.toFixed(1)},${M.top}V${H - M.bottom}`} stroke="var(--mark)" strokeWidth="1.25" strokeDasharray="4 3" fill="none" />
                <text
                  x={reachX + (reachX > W * 0.8 ? -6 : 6)}
                  y={M.top - 8}
                  fontSize="11"
                  fill="var(--text-primary)"
                  textAnchor={reachX > W * 0.8 ? "end" : "start"}
                  className="num"
                >
                  {t("reach", { gb: fmt(reachGb ?? 0, locale) })}
                </text>
              </>
            )}

            <g className="transition-opacity duration-150 motion-reduce:transition-none">
              <path d={circles(group(false, true), 3.25)} fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.25" />
              <path d={circles(group(true, true), 3.25)} fill="currentColor" opacity="0.2" />
              <path d={circles(group(false, false), 3.25)} fill="none" stroke="currentColor" strokeWidth="1.25" />
              <path d={circles(group(true, false), 3.75)} fill="var(--mark)" />
            </g>

            {active && activeLabel && (
              <>
                <circle
                  cx={active.cx}
                  cy={active.cy}
                  r="8"
                  fill="none"
                  stroke="var(--mark)"
                  strokeWidth="1.5"
                />
                <text
                  x={activeLabel.x}
                  y={activeLabel.y}
                  textAnchor={activeLabel.anchor}
                  fontSize="11"
                  fill="var(--text-primary)"
                  stroke="var(--surface-default)"
                  strokeWidth="3"
                  paintOrder="stroke"
                  strokeLinejoin="round"
                >
                  {activeLabel.text}
                </text>
              </>
            )}
          </svg>
        </div>
      </div>

      <p className="mt-2 min-h-[1.5em] text-xs text-primary" aria-live="polite">
        {liveText}
      </p>

      <figcaption className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-tertiary">
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill="var(--mark)" />
          </svg>
          {t("runs")}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.25" />
          </svg>
          {t("noRun")}
        </span>
        <span>{t("note")}</span>
      </figcaption>
    </figure>
  );
}
