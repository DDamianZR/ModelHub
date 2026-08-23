"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CoverageMeter } from "./CoverageMeter";
import { CategoryBars } from "./CategoryBars";
import type { Row } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

const MAX_SELECTION = 4;

export function CompareBoard({ rows }: { rows: Row[] }) {
  const t = useTranslations("compare");
  const tt = useTranslations("table");

  const [selected, setSelected] = useState<string[]>(() =>
    rows.filter((row) => !row.provisional).slice(0, 3).map((row) => row.id),
  );
  const [query, setQuery] = useState("");

  const chosen = useMemo(
    () => selected.map((id) => rows.find((row) => row.id === id)).filter(Boolean) as Row[],
    [selected, rows],
  );

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter(
        (row) =>
          !needle ||
          row.display_name.toLowerCase().includes(needle) ||
          row.provider_name.toLowerCase().includes(needle),
      )
      .slice(0, 40);
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

  return (
    <div>
      <div className="border-y rule py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="eyebrow">{t("pick", { max: MAX_SELECTION })}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            className="num border-b bg-transparent px-1 py-1 text-[12px] outline-none"
            style={{ borderColor: "var(--rule)", minWidth: "14rem" }}
          />
          <span className="num text-[11px]" style={{ color: "var(--muted)" }}>
            {t("selected", { count: selected.length, max: MAX_SELECTION })}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
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
                className="row-shift border px-2 py-[3px] text-[11px]"
                style={{
                  background: active ? "var(--amber)" : "transparent",
                  borderColor: active ? "var(--amber)" : "var(--rule)",
                  color: active ? "var(--paper)" : "var(--muted)",
                  opacity: disabled ? 0.4 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                {row.display_name}
              </button>
            );
          })}
        </div>
      </div>

      {chosen.length === 0 ? (
        <p className="py-10 text-center text-[13px]" style={{ color: "var(--muted)" }}>
          {t("empty")}
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {chosen.map((row) => {
              const partial = row.coverage.covered < row.coverage.total;
              return (
                <div key={row.id} className="border-t rule pt-2">
                  <div className="text-[14px]">{row.display_name}</div>
                  <div className="num text-[11px]" style={{ color: "var(--muted)" }}>
                    {row.provider_name}
                    {row.release_date ? ` · ${row.release_date}` : ""}
                  </div>
                  {/* The interval belongs here more than anywhere: this is the page
                      where two numbers get read against each other, so a difference
                      smaller than the error is exactly what must not look like a win. */}
                  <div className="num mt-2 text-[24px]">
                    {row.composite.toFixed(1)}
                    <span className="ml-1 text-[12px]" style={{ color: "var(--muted)" }}>
                      {row.composite_error === null
                        ? "±?"
                        : `±${row.composite_error.toFixed(2)}`}
                    </span>
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
                    <span className="num text-[10px]" style={{ color: "var(--muted)" }}>
                      {row.coverage.covered}/{row.coverage.total}
                    </span>
                  </div>
                  <div className="eyebrow mt-2">
                    {row.is_open_weights ? tt("openWeights") : tt("apiOnly")}
                  </div>
                  {row.provisional && (
                    <div className="eyebrow mt-1" style={{ color: "var(--amber)" }}>
                      {tt("provisionalTitle")}
                    </div>
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
              <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
                {t("visionNote")}
              </p>
              <CategoryBars
                emptyLabel={tt("noData")}
                rows={chosen.map((row) => ({
                  label: row.display_name,
                  value: undefined,
                  sublabel: row.vision
                    ? t("visionRating", {
                        rating: row.vision.rating,
                        rank: row.vision.rank,
                      })
                    : tt("noData"),
                }))}
              />
            </section>
          </div>

          <div className="mt-10 overflow-x-auto">
            <h3 className="eyebrow mb-2">{t("tableView")}</h3>
            <table className="w-full border-collapse text-left" style={{ minWidth: "40rem" }}>
              <thead>
                <tr className="border-b rule">
                  <th scope="col" className="py-2 pr-3">
                    <span className="eyebrow">{tt("model")}</span>
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    <span className="eyebrow">{tt("composite")}</span>
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
                {chosen.map((row) => (
                  <tr key={row.id} className="border-b rule">
                    <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                      {row.display_name}
                    </th>
                    <td className="num py-2 pr-3 text-right text-[13px]">
                      {row.composite.toFixed(1)}
                      <span
                        className="ml-1 text-[10px]"
                        style={{ color: "var(--muted)" }}
                      >
                        {row.composite_error === null
                          ? "±?"
                          : `±${row.composite_error.toFixed(2)}`}
                      </span>
                    </td>
                    <td className="num py-2 pr-3 text-right text-[12px]">
                      {row.coverage.covered}/{row.coverage.total}
                    </td>
                    {CATEGORIES.map((category) => {
                      const value = row.category_scores[category];
                      return (
                        <td
                          key={category}
                          className="num py-2 pr-3 text-right text-[12px]"
                          style={{ color: value === undefined ? "var(--muted)" : "inherit" }}
                        >
                          {value === undefined ? tt("noData") : value.toFixed(1)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
