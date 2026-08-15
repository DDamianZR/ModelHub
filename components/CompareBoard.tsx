"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { usePathname, useRouter } from "@/i18n/navigation";
import { CoverageMeter } from "./CoverageMeter";
import { CategoryBars } from "./CategoryBars";
import type { Row } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

const MAX_SELECTION = 4;

/**
 * Δ against the baseline, suppressed when the gap falls inside the two models'
 * combined 95% interval.
 *
 * This is the ranking's own rule applied to the compare page: an interval that can only
 * widen supports "these two overlap" but never "these two differ". Printing a bare
 * subtraction here would let a difference smaller than the error read as a win, which is
 * exactly the bias the composite is built to avoid. A model with no published error is
 * treated as unknown, not zero, so no separation is claimed against it either.
 */
function delta(
  model: Row,
  baseline: Row,
): { gap: number; combined: number | null; separated: boolean } {
  const gap = model.composite - baseline.composite;
  if (model.composite_error === null || baseline.composite_error === null) {
    return { gap, combined: null, separated: false };
  }
  const combined = model.composite_error + baseline.composite_error;
  return { gap, combined, separated: Math.abs(gap) > combined };
}

export function CompareBoard({ rows }: { rows: Row[] }) {
  const t = useTranslations("compare");
  const tt = useTranslations("table");
  const router = useRouter();
  const pathname = usePathname();

  const [selected, setSelected] = useState<string[]>(() =>
    rows.filter((row) => !row.provisional).slice(0, 3).map((row) => row.id),
  );
  const [query, setQuery] = useState("");
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("m");
    if (m) {
      const ids = m.split(",").filter((id) => rows.some((r) => r.id === id));
      if (ids.length) setSelected(ids.slice(0, MAX_SELECTION));
    }
    setRestored(true);
  }, [rows]);

  // Gated on `restored`: without it the first write races the read above and
  // clears the very selection the URL was carrying.
  useEffect(() => {
    if (!restored) return;
    const params = new URLSearchParams();
    if (selected.length) params.set("m", selected.join(","));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [restored, selected, pathname, router]);

  const chosen = useMemo(
    () => selected.map((id) => rows.find((row) => row.id === id)).filter(Boolean) as Row[],
    [selected, rows],
  );

  // No cap. Every model is reachable; search narrows rather than truncates.
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.display_name.toLowerCase().includes(needle) ||
        row.provider_name.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= MAX_SELECTION
          ? current
          : [...current, id],
    );
  };

  const full = selected.length >= MAX_SELECTION;
  const baseline = chosen[0];

  return (
    <div>
      <div className="border-y border-subtle py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label htmlFor="compare-search" className="eyebrow">
            {t("pick", { max: MAX_SELECTION })}
          </label>
          <input
            id="compare-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="num min-w-[14rem] rounded-(--radius-control) border border-line bg-transparent px-2 py-1 text-xs outline-none"
          />
          <span className="num text-2xs text-tertiary" role="status">
            {full ? t("full") : t("selected", { count: selected.length, max: MAX_SELECTION })}
          </span>
        </div>

        <div className="mt-3 flex max-h-[9rem] flex-wrap gap-1.5 overflow-y-auto">
          {candidates.map((row) => {
            const active = selected.includes(row.id);
            const disabled = !active && full;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => toggle(row.id)}
                disabled={disabled}
                aria-pressed={active}
                title={disabled ? t("full") : undefined}
                className={clsx("tactile tactile-sm text-2xs", active && "tactile-on")}
              >
                {row.display_name}
              </button>
            );
          })}
        </div>
      </div>

      {chosen.length === 0 ? (
        <p className="py-10 text-center text-sm text-tertiary">{t("empty")}</p>
      ) : (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {chosen.map((row, index) => {
              const partial = row.coverage.covered < row.coverage.total;
              const d = index === 0 ? null : delta(row, baseline);
              return (
                <div key={row.id} className="border-t border-subtle pt-2">
                  <div className="text-base">{row.display_name}</div>
                  <div className="num text-2xs text-tertiary">
                    {row.provider_name}
                    {row.release_date ? ` · ${row.release_date}` : ""}
                  </div>
                  {/* The interval belongs here more than anywhere: this is the page
                      where two numbers get read against each other, so a difference
                      smaller than the error is exactly what must not look like a win. */}
                  <div className="num mt-2 text-lg">
                    {row.composite.toFixed(1)}
                    <span className="ml-1 text-xs text-tertiary">
                      {row.composite_error === null
                        ? "±?"
                        : `±${row.composite_error.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="num mt-0.5 text-2xs text-tertiary">
                    {d === null ? (
                      t("baseline")
                    ) : d.separated ? (
                      <span className={d.gap > 0 ? "text-accent" : undefined}>
                        {d.gap > 0 ? "+" : ""}
                        {d.gap.toFixed(1)}
                      </span>
                    ) : (
                      <span
                        title={
                          d.combined === null
                            ? tt("errorUnknownTitle")
                            : t("notSeparatedTitle", {
                                gap: Math.abs(d.gap).toFixed(2),
                                combined: d.combined.toFixed(2),
                              })
                        }
                      >
                        {t("notSeparated")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <CoverageMeter
                      covered={row.coverage.covered}
                      total={row.coverage.total}
                      label={
                        partial
                          ? tt("partial", {
                              covered: row.coverage.covered,
                              total: row.coverage.total,
                            })
                          : tt("complete", { total: row.coverage.total })
                      }
                    />
                    <span className="num text-2xs text-tertiary">
                      {row.coverage.covered}/{row.coverage.total}
                    </span>
                  </div>
                  <div className="eyebrow mt-2">
                    {row.is_open_weights ? tt("openWeights") : tt("apiOnly")}
                  </div>
                  {row.provisional && (
                    <div className="eyebrow mt-1 text-accent">{tt("provisionalTitle")}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((category) => (
              <section key={category}>
                <h3 className="eyebrow mb-2">{tt(category)}</h3>
                <CategoryBars
                  emptyLabel={tt("noData")}
                  rows={chosen.map((row) => ({
                    label: row.display_name,
                    value: row.category_scores[category],
                  }))}
                />
              </section>
            ))}

            <section>
              <h3 className="eyebrow mb-2">{tt("vision")}</h3>
              <p className="mb-2 text-2xs text-tertiary">{t("visionNote")}</p>
              <CategoryBars
                emptyLabel={tt("noData")}
                rows={chosen.map((row) => ({
                  label: row.display_name,
                  value: undefined,
                  sublabel: row.vision
                    ? t("visionRating", { rating: row.vision.rating, rank: row.vision.rank })
                    : tt("noData"),
                }))}
              />
            </section>
          </div>

          <div className="mt-10">
            <h3 className="eyebrow mb-2">{t("tableView")}</h3>
            <div
              className="overflow-x-auto"
              role="region"
              aria-label={t("tableView")}
              tabIndex={0}
            >
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-subtle">
                    <th scope="col" className="py-2 pr-3">
                      <span className="eyebrow">{tt("model")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      <span className="eyebrow">{tt("composite")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      <span className="eyebrow">
                        {t("delta", { baseline: baseline.display_name })}
                      </span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      <span className="eyebrow">{tt("coverage")}</span>
                    </th>
                    {CATEGORIES.map((category) => (
                      <th key={category} scope="col" className="py-2 pr-3 text-right">
                        <span className="eyebrow">{tt(category)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chosen.map((row, index) => {
                    const d = index === 0 ? null : delta(row, baseline);
                    return (
                      <tr key={row.id} className="border-b border-subtle">
                        <th scope="row" className="py-2 pr-3 text-sm font-normal">
                          {row.display_name}
                        </th>
                        <td className="num py-2 pr-3 text-right text-sm">
                          {row.composite.toFixed(1)}
                          <span className="ml-1 text-2xs text-tertiary">
                            {row.composite_error === null
                              ? "±?"
                              : `±${row.composite_error.toFixed(2)}`}
                          </span>
                        </td>
                        <td
                          className={clsx(
                            "num py-2 pr-3 text-right text-xs",
                            (d === null || !d.separated) && "text-tertiary",
                          )}
                        >
                          {d === null
                            ? "—"
                            : d.separated
                              ? `${d.gap > 0 ? "+" : ""}${d.gap.toFixed(1)}`
                              : t("notSeparated")}
                        </td>
                        <td className="num py-2 pr-3 text-right text-xs">
                          {row.coverage.covered}/{row.coverage.total}
                        </td>
                        {CATEGORIES.map((category) => {
                          const value = row.category_scores[category];
                          return (
                            <td
                              key={category}
                              className={clsx(
                                "num py-2 pr-3 text-right text-xs",
                                value === undefined && "text-tertiary",
                              )}
                            >
                              {value === undefined ? tt("noData") : value.toFixed(1)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 max-w-[46rem] text-xs leading-[1.6] text-tertiary">
              {t("deltaNote")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
