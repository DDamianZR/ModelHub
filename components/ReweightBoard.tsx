"use client";

/* eslint-disable react-hooks/set-state-in-effect -- state is read from the URL after mount on purpose: the page is prerendered, so reading it during render would mismatch the server HTML. */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { Surface } from "./Surface";
import { useCurrency } from "./CurrencyProvider";
import { CONTEXT_FLOORS, PRICE_CEILINGS, formatContext } from "@/lib/filters";
import {
  parsePoints,
  pointsToWeights,
  reweight,
  weightsToPoints,
  type ReweightRow,
} from "@/lib/reweight";
import { CATEGORIES } from "@/lib/types";

/** "=3" is the notation for a shared place, as on the home; "·" for no place at all. */
function place(rank: number | null, tied: number): string {
  return rank === null ? "·" : tied > 0 ? `=${rank}` : String(rank);
}

/**
 * The published scores under weights the reader sets. Nothing here is a new measurement:
 * lib/reweight.ts recombines what data/models.json already states, and with the site's
 * weights the table below is the site's ranking.
 *
 * The sliders start at the site's weights and there are no named presets. A preset called
 * "for coding" would be this site telling a reader what a model is for, which /data does
 * not contain; the reader states their own priorities and the page only does the sum.
 */
export function ReweightBoard({
  rows,
  siteWeights,
  bar,
}: {
  rows: ReweightRow[];
  /** config/weights.json, the point the sliders start from and return to. */
  siteWeights: Record<string, number>;
  /** Share of weight a model must be measured on to be placed; see minCoveredShare. */
  bar: number;
}) {
  const t = useTranslations("reweight");
  const tt = useTranslations("table");
  const tf = useTranslations("filters");
  const router = useRouter();
  const pathname = usePathname();
  const { digits: formatMoney, axis: formatCeiling, symbol } = useCurrency();

  const sitePoints = useMemo(() => weightsToPoints(CATEGORIES, siteWeights), [siteWeights]);
  const [points, setPoints] = useState<number[]>(sitePoints);
  const [openOnly, setOpenOnly] = useState(false);
  const [minContext, setMinContext] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);
  const [restored, setRestored] = useState(false);

  // Restore from the URL on mount. Not useSearchParams: that opts the route out of static
  // rendering, and every page here is prerendered.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = parsePoints(params.get("w"), CATEGORIES.length);
    const context = Number(params.get("ctx"));
    const price = Number(params.get("price"));
    if (fromUrl) setPoints(fromUrl);
    if (params.get("open") === "1") setOpenOnly(true);
    if ((CONTEXT_FLOORS as readonly number[]).includes(context)) setMinContext(context);
    if ((PRICE_CEILINGS as readonly number[]).includes(price)) setMaxPrice(price);
    setRestored(true);
  }, []);

  const atSiteWeights = points.every((value, i) => value === sitePoints[i]);

  // Write state back, so the address is the ranking: a link reproduces what was on screen.
  // Gated on `restored` so the first pass cannot wipe the parameters still being read.
  useEffect(() => {
    if (!restored) return;
    const params = new URLSearchParams();
    if (!atSiteWeights) params.set("w", points.join(","));
    if (openOnly) params.set("open", "1");
    if (minContext) params.set("ctx", String(minContext));
    if (maxPrice) params.set("price", String(maxPrice));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [restored, atSiteWeights, points, openOnly, minContext, maxPrice, pathname, router]);

  const total = points.reduce((sum, value) => sum + value, 0);
  const result = useMemo(
    () => reweight(rows, pointsToWeights(CATEGORIES, points), bar),
    [rows, points, bar],
  );

  // Filters hide rows and leave every place as it is: a model's place is among all
  // comparable models, so narrowing the list cannot promote anyone.
  const visible = result.placed.filter(
    ({ row }) =>
      (!openOnly || row.is_open_weights) &&
      (!minContext || (row.context_window !== null && row.context_window >= minContext)) &&
      (!maxPrice ||
        (row.blended_price_usd_per_m !== null && row.blended_price_usd_per_m <= maxPrice)),
  );
  const filtered = openOnly || minContext !== 0 || maxPrice !== 0;

  return (
    <div>
      <Surface className="p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="eyebrow">{t("weights")}</h2>
          <button
            type="button"
            onClick={() => setPoints(sitePoints)}
            disabled={atSiteWeights}
            className="control control-sm eyebrow"
          >
            {t("reset")}
          </button>
        </div>

        <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
          {CATEGORIES.map((category, i) => {
            const share = total ? Math.round((points[i] / total) * 100) : 0;
            return (
              <div key={category} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor={`weight-${category}`} className="text-sm">
                    {tt(category)}
                  </label>
                  <span className="num text-md font-semibold">{share}%</span>
                </div>
                <input
                  id={`weight-${category}`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={points[i]}
                  onChange={(event) =>
                    setPoints(points.map((value, j) => (j === i ? Number(event.target.value) : value)))
                  }
                  aria-valuetext={t("shareOf", { share })}
                  className="rig-range"
                />
                <span className="num text-2xs text-tertiary">
                  {t("siteShare", { share: Math.round((siteWeights[category] ?? 0) * 100) })}
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-4 max-w-[52rem] text-sm leading-[1.6]" role="status">
          {total === 0
            ? t("noWeight")
            : atSiteWeights
              ? t("same", { placed: result.placed.length })
              : t("readout", {
                  moved: result.moved,
                  compared: result.compared,
                  apart: result.apart.length,
                })}
        </p>
      </Surface>

      <div className="no-scrollbar mt-4 flex items-center gap-x-5 gap-y-3 overflow-x-auto border-y border-subtle py-2 sm:flex-wrap sm:overflow-x-visible sm:py-3">
        <button
          type="button"
          onClick={() => setOpenOnly(!openOnly)}
          aria-pressed={openOnly}
          className={clsx("control control-sm eyebrow shrink-0", openOnly && "control-on")}
        >
          {tf("open")}
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <label htmlFor="reweight-context" className="eyebrow hidden sm:inline">
            {tf("context")}
          </label>
          <select
            id="reweight-context"
            value={minContext}
            onChange={(event) => setMinContext(Number(event.target.value))}
            aria-label={tf("context")}
            className="eyebrow min-h-7 rounded-control border border-line bg-transparent px-1"
          >
            <option value={0}>{tf("all")}</option>
            {CONTEXT_FLOORS.map((floor) => (
              <option key={floor} value={floor}>
                {tf("contextAtLeast", { size: formatContext(floor) })}
              </option>
            ))}
          </select>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <label htmlFor="reweight-price" className="eyebrow hidden sm:inline">
            {tf("price")}
          </label>
          <select
            id="reweight-price"
            value={maxPrice}
            onChange={(event) => setMaxPrice(Number(event.target.value))}
            aria-label={tf("price")}
            className="eyebrow min-h-7 rounded-control border border-line bg-transparent px-1"
          >
            <option value={0}>{tf("all")}</option>
            {PRICE_CEILINGS.map((ceiling) => (
              <option key={ceiling} value={ceiling}>
                {tf("priceAtMost", { price: formatCeiling(ceiling) })}
              </option>
            ))}
          </select>
        </div>

        <span className="num ml-auto shrink-0 text-2xs text-tertiary">
          {tf("showing", { count: visible.length, total: result.placed.length })}
        </span>
      </div>
      {filtered && <p className="mt-2 text-2xs text-tertiary">{t("filtersNote")}</p>}

      <Surface className="mt-3">
        {/* Always stated, in the same place as the table it qualifies: this is a reader's
            arrangement of the published scores, and the published ranking is one link away. */}
        <p className="border-b border-subtle px-3 py-2 text-xs text-tertiary">
          <span className="font-semibold text-attention">{t("personal")}</span>{" "}
          <Link href="/" className="underline underline-offset-2 hover:text-primary">
            {t("published")}
          </Link>
        </p>
        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-tertiary">{t("empty")}</p>
        ) : (
          <div className="relative overflow-x-auto" role="region" aria-label={t("tableLabel")} tabIndex={0}>
            <table className="ranking table-sticky table-dense w-full min-w-[52rem] text-left">
              <caption className="sr-only">{t("tableLabel")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-9 border-b border-subtle pr-1.5 align-bottom">
                    <span className="eyebrow">{tt("rank")}</span>
                  </th>
                  <th scope="col" className="border-b border-subtle pr-1.5 align-bottom">
                    <span className="eyebrow">{tt("model")}</span>
                  </th>
                  <th scope="col" className="w-28 border-b border-subtle pr-1.5 align-bottom">
                    <span className="eyebrow block text-right">{t("colComposite")}</span>
                  </th>
                  <th scope="col" className="w-20 border-b border-subtle pr-1.5 align-bottom">
                    <span className="eyebrow block text-right">{t("colSite")}</span>
                  </th>
                  {CATEGORIES.map((category, i) => (
                    <th key={category} scope="col" className="w-20 border-b border-subtle pr-1.5 align-bottom">
                      <span className={clsx("eyebrow block text-right", points[i] === 0 && "line-through")}>
                        {tt(category)}
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="w-16 border-b border-subtle align-bottom">
                    <span className="eyebrow block text-right">
                      {tt.rich("price", { symbol: () => symbol })}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row, composite, error, rank, tied_with }) => (
                  <tr key={row.id} className="row-hover">
                    <td className="num w-9 text-left text-tertiary">{place(rank, tied_with)}</td>
                    <td className="min-w-56">
                      <Link href={`/model/${row.id}`} className="row-shift row-name">
                        {row.display_name}
                      </Link>
                      <span className="block text-xs leading-tight text-tertiary">{row.provider_name}</span>
                    </td>
                    <td className="num text-md leading-normal">
                      {composite.toFixed(1)}
                      <span className="ml-1 text-2xs text-tertiary">
                        {error === null ? "±?" : `±${error.toFixed(2)}`}
                      </span>
                    </td>
                    <td className="num text-tertiary">{place(row.rank, row.tied_with)}</td>
                    {CATEGORIES.map((category, i) => {
                      const value = row.category_scores[category];
                      return (
                        <td key={category} className={clsx("num", (value === undefined || points[i] === 0) && "text-tertiary")}>
                          {value === undefined ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="sr-only">{tt("noData")}</span>
                            </>
                          ) : (
                            value.toFixed(1)
                          )}
                        </td>
                      );
                    })}
                    <td className="num text-tertiary">{formatMoney(row.blended_price_usd_per_m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {result.apart.length > 0 && total > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow text-attention">{t("apartTitle", { count: result.apart.length })}</h2>
          <p className="mt-1 max-w-[46rem] text-xs leading-[1.55] text-tertiary">
            {t("apartNote", { share: Math.round(bar * 100) })}
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {result.apart.map((row) => (
              <li key={row.id}>
                <Link href={`/model/${row.id}`} className="underline-offset-2 hover:underline">
                  {row.display_name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
