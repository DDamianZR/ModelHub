"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Summary } from "@/lib/local-view";
import { billions, fmt } from "./form";

/**
 * The headline: how much of the catalogue this machine reaches, and three doors into it, the
 * largest model, the best measured one and the fastest. Each is a button that opens that
 * model's detail, so the summary is where the exploring starts and not a sentence to read.
 */
export function Readout({
  summary,
  rankedCount,
  onSelect,
}: {
  summary: Summary;
  rankedCount: number;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("local.readout");
  const locale = useLocale();
  const { runs, total, largest, bestMeasured, fastest } = summary;
  const share = total > 0 ? runs / total : 0;

  const stat = (
    key: "largest" | "best" | "fastest",
    result: Summary["largest"],
    meta: string | null,
    empty: string,
  ) => (
    <li>
      {result ? (
        <button
          type="button"
          onClick={() => onSelect(result.entry.spec.model_id)}
          className="group flex min-h-11 w-full flex-col items-start rounded-control bg-sunk px-3 py-2 text-left hover:bg-raised"
        >
          <span className="eyebrow">{t(key)}</span>
          <span className="mt-0.5 text-base font-semibold text-primary group-hover:underline">
            {result.entry.display_name}
          </span>
          <span className="num text-xs text-tertiary">{meta}</span>
        </button>
      ) : (
        <div className="flex min-h-11 w-full flex-col items-start rounded-control bg-sunk px-3 py-2">
          <span className="eyebrow">{t(key)}</span>
          <span className="mt-0.5 text-xs text-tertiary">{empty}</span>
        </div>
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div>
        <p className="eyebrow">{t("title")}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="num font-serif text-3xl leading-none font-medium tracking-tight">
            {fmt(runs, locale, 0)}
          </span>
          <span className="text-base text-tertiary">
            {t("of", { count: runs, total: fmt(total, locale, 0) })}
          </span>
        </p>
        <svg
          viewBox="0 0 100 3"
          preserveAspectRatio="none"
          className="mt-3 block h-1 w-full"
          aria-hidden="true"
        >
          <rect width="100" height="3" rx="1.5" fill="var(--surface-sunk)" />
          <rect width={share * 100} height="3" rx="1.5" fill="var(--mark)" />
        </svg>
      </div>

      {runs === 0 ? (
        <p className="text-sm leading-[1.6] text-tertiary">{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stat(
            "largest",
            largest,
            largest ? t("largestMeta", { params: billions(largest.entry.spec.parameters_raw, locale) }) : null,
            "",
          )}
          {stat(
            "best",
            bestMeasured,
            bestMeasured && bestMeasured.entry.composite !== null
              ? t("bestMeta", {
                  composite: fmt(bestMeasured.entry.composite, locale),
                  rank: `${bestMeasured.entry.tied_with > 0 ? "=" : ""}${bestMeasured.entry.rank}/${rankedCount}`,
                })
              : null,
            t("bestNone"),
          )}
          {stat(
            "fastest",
            fastest,
            fastest && fastest.fit.tokensPerSecond !== null
              ? t("fastestMeta", {
                  tps: fmt(fastest.fit.tokensPerSecond, locale, fastest.fit.tokensPerSecond < 10 ? 1 : 0),
                })
              : null,
            t("fastestNone"),
          )}
        </ul>
      )}
    </div>
  );
}
