"use client";

import clsx from "clsx";
import { useLocale, useTranslations } from "next-intl";
import type { Result } from "@/lib/local-view";
import { fmt } from "./form";

/**
 * "And if I had more?": one bar per memory size that exists, each as tall as the number of
 * catalogue models that would run with it, everything else about the machine held as typed.
 * Pressing a bar sets the sliders to that size, so the whole page answers for it. Below,
 * the first step that opens something new, and which models it would open: the ones ModelHub
 * measured first, by composite, then the largest.
 */
export function UpgradeLadder({
  stops,
  counts,
  currentIndex,
  what,
  nextIndex,
  unlockedModels,
  onPick,
  onSelect,
}: {
  stops: readonly number[];
  /** Models that run at each stop. */
  counts: readonly number[];
  /** The stop closest to what is typed now. */
  currentIndex: number;
  what: string;
  /** First stop above the current one that runs more, if any. */
  nextIndex: number | null;
  unlockedModels: Result[];
  onPick: (gb: number) => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("local.ladder");
  const locale = useLocale();
  const top = Math.max(...counts, 1);
  const BAR = 56;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={t("figure", { what })}
        className="no-scrollbar relative flex max-w-full items-end gap-1 overflow-x-auto pb-1"
      >
        {stops.map((gb, i) => {
          const current = i === currentIndex;
          const height = counts[i] > 0 ? Math.max((counts[i] / top) * BAR, 3) : 1;
          return (
            <button
              key={gb}
              type="button"
              aria-pressed={current}
              aria-label={t("bar", { gb: fmt(gb, locale, 0), count: counts[i] })}
              onClick={() => onPick(gb)}
              className={clsx(
                "group flex min-h-11 min-w-[2.75rem] flex-1 flex-col items-center justify-end gap-1 rounded-control px-1 pt-1 pb-1.5 hover:bg-sunk",
                current && "bg-sunk",
              )}
            >
              <span className={clsx("num text-2xs", current ? "font-semibold text-primary" : "text-tertiary")}>
                {counts[i]}
              </span>
              <svg
                viewBox={`0 0 20 ${BAR}`}
                className="block h-14 w-5"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect
                  x="0"
                  y={BAR - height}
                  width="20"
                  height={height}
                  rx="2"
                  fill={i <= currentIndex ? "var(--mark)" : "none"}
                  stroke="var(--mark)"
                  strokeWidth={i <= currentIndex ? 0 : 1.25}
                  vectorEffect="non-scaling-stroke"
                  opacity={current || i > currentIndex ? 1 : 0.45}
                />
              </svg>
              <span className={clsx("num text-2xs", current ? "font-semibold text-primary" : "text-tertiary")}>
                {fmt(gb, locale, 0)}
              </span>
            </button>
          );
        })}
      </div>

      {nextIndex !== null ? (
        <div className="text-sm">
          <p className="text-primary">
            {t("next", { gb: fmt(stops[nextIndex], locale, 0), count: unlockedModels.length })}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unlockedModels.slice(0, 5).map((r) => (
              <li key={r.entry.spec.model_id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.entry.spec.model_id)}
                  className="control min-h-11 sm:min-h-8"
                >
                  {r.entry.display_name}
                  {r.entry.measured && r.entry.composite !== null && (
                    <span className="num ml-1.5 text-2xs">{fmt(r.entry.composite, locale)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-tertiary">{t("nextNote")}</p>
        </div>
      ) : (
        <p className="text-sm text-tertiary">{t("top")}</p>
      )}
    </div>
  );
}
