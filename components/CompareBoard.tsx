"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { CoverageMeter } from "./CoverageMeter";
import { CategoryBars } from "./CategoryBars";
import type { Row } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

const MAX_SELECTION = 4;

export function CompareBoard({ rows }: { rows: Row[] }) {
  const t = useTranslations("compare");
  const tt = useTranslations("table");
  const router = useRouter();
  const pathname = usePathname();

  const [selected, setSelected] = useState<string[]>(() =>
    rows.filter((row) => !row.provisional).slice(0, 3).map((row) => row.id),
  );
  const [query, setQuery] = useState("");

  // Restore selection from URL on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("m");
    if (m) {
      const ids = m.split(",").filter((id) => rows.some((r) => r.id === id));
      if (ids.length) setSelected(ids.slice(0, MAX_SELECTION));
    }
  }, [rows]);

  // Keep URL in sync with selection.
  useEffect(() => {
    const params = new URLSearchParams();
    if (selected.length) params.set("m", selected.join(","));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [selected, pathname, router]);

  const chosen = useMemo(
    () => selected.map((id) => rows.find((row) => row.id === id)).filter(Boolean) as Row[],
    [selected, rows],
  );

  // No slice here — all models are reachable via search.
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

  return (
    <div>
      {/* ── Picker ── */}
      <div className="border-y py-3" style={{ borderColor: "var(--line-subtle)" }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
            {t("pick", { max: MAX_SELECTION })}
          </span>
          <label className="sr-only" htmlFor="compare-search">
            {t("search")}
          </label>
          <input
            id="compare-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            className="num border-b bg-transparent px-1 py-1 text-[12px] outline-none"
            style={{ borderColor: "var(--line-default)", minWidth: "14rem" }}
          />
          <span className="num text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {full
              ? t("full")
              : t("selected", { count: selected.length, max: MAX_SELECTION })}
          </span>
        </div>

        {/* Candidate chips — all models reachable, filtered by search query. */}
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
                className="row-shift border px-2 py-[3px] text-[11px]"
                style={{
                  background: active ? "var(--accent)" : "transparent",
                  borderColor: active ? "var(--accent)" : "var(--line-default)",
                  color: active ? "var(--text-on-accent)" : "var(--text-tertiary)",
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

      {/* ── Results ── */}
      {chosen.length === 0 ? (
        <p
          className="py-10 text-center text-[13px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          {t("empty")}
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {chosen.map((row) => {
              const partial = row.coverage.covered < row.coverage.total;
              return (
                <div
                  key={row.id}
                  className="border-t pt-2"
                  style={{ borderColor: "var(--line-subtle)" }}
                >
                  <div className="text-[14px]">{row.display_name}</div>
                  <div className="num text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {row.provider_name}
                    {row.release_date ? ` · ${row.release_date}` : ""}
                  </div>
                  <div className="num mt-2 text-[24px]">
                    {row.composite.toFixed(1)}
                    <span className="ml-1 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
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
                    <span className="num text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      {row.coverage.covered}/{row.coverage.total}
                    </span>
                  </div>
                  <div className="eyebrow mt-2" style={{ color: "var(--text-tertiary)" }}>
                    {row.is_open_weights ? tt("openWeights") : tt("apiOnly")}
                  </div>
                  {row.provisional && (
                    <div className="eyebrow mt-1" style={{ color: "var(--accent)" }}>
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
                <h3 className="eyebrow mb-2" style={{ color: "var(--text-tertiary)" }}>
                  {tt(category)}
                </h3>
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
              <h3 className="eyebrow mb-2" style={{ color: "var(--text-tertiary)" }}>
                {tt("vision")}
              </h3>
              <p className="mb-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
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
            <h3 className="eyebrow mb-2" style={{ color: "var(--text-tertiary)" }}>
              {t("tableView")}
            </h3>
            <table
              className="w-full border-collapse text-left"
              style={{ minWidth: "40rem" }}
            >
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--line-subtle)" }}>
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
                  <tr
                    key={row.id}
                    className="border-b"
                    style={{ borderColor: "var(--line-subtle)" }}
                  >
                    <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                      {row.display_name}
                    </th>
                    <td className="num py-2 pr-3 text-right text-[13px]">
                      {row.composite.toFixed(1)}
                      <span
                        className="ml-1 text-[10px]"
                        style={{ color: "var(--text-tertiary)" }}
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
                          style={{
                            color: value === undefined ? "var(--text-tertiary)" : "inherit",
                          }}
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
