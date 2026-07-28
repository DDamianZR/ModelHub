"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CoverageMeter } from "./CoverageMeter";
import { Sparkline } from "./Sparkline";
import type { Row } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

type SortKey = "rank" | "composite" | (typeof CATEGORIES)[number];
type Access = "all" | "open" | "api";

const CONSOLE_BUTTON = "px-2 py-[3px] text-[11px] tracking-wide row-shift border";

function chipStyle(active: boolean) {
  return active
    ? { background: "var(--amber)", borderColor: "var(--amber)", color: "var(--paper)" }
    : { background: "transparent", borderColor: "var(--rule)", color: "var(--muted)" };
}

export function RankingTable({
  rows,
  minCoverage,
}: {
  rows: Row[];
  minCoverage: number;
}) {
  const t = useTranslations("table");
  const tf = useTranslations("filters");

  const [query, setQuery] = useState("");
  const [access, setAccess] = useState<Access>("all");
  const [origin, setOrigin] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("rank");

  const origins = useMemo(
    () => Array.from(new Set(rows.map((r) => r.country).filter(Boolean))).sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (access === "open" && !row.is_open_weights) return false;
      if (access === "api" && row.is_open_weights) return false;
      if (origin !== "all" && row.country !== origin) return false;
      if (!needle) return true;
      return (
        row.display_name.toLowerCase().includes(needle) ||
        row.provider_name.toLowerCase().includes(needle)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort === "rank" || sort === "composite") return b.composite - a.composite;
      const av = a.category_scores[sort];
      const bv = b.category_scores[sort];
      // Models without a measurement sink to the bottom instead of scoring zero.
      if (av === undefined && bv === undefined) return b.composite - a.composite;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return bv - av;
    });
  }, [rows, query, access, origin, sort]);

  const ranked = visible.filter((row) => !row.provisional);
  const provisional = visible.filter((row) => row.provisional);
  const columnCount = 4 + CATEGORIES.length + 1;

  const headerButton = (key: SortKey, label: string, align: "left" | "right") => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className="eyebrow row-shift w-full"
      style={{
        textAlign: align,
        color: sort === key ? "var(--amber)" : "var(--muted)",
      }}
      aria-label={t("sortBy", { column: label })}
      aria-pressed={sort === key}
    >
      {label}
    </button>
  );

  const renderRow = (row: Row) => {
    const partial = row.coverage.covered < row.coverage.total;
    const coverageLabel = partial
      ? t("partial", { covered: row.coverage.covered, total: row.coverage.total })
      : t("complete", { total: row.coverage.total });

    return (
      <tr key={row.id} className="row-shift border-b rule hover:bg-[var(--paper-sunk)]">
        <td className="num py-2 pr-2 text-[12px]" style={{ color: "var(--muted)" }}>
          {row.rank ?? "·"}
        </td>
        <td className="py-2 pr-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Link
              href={`/model/${row.id}`}
              className="row-shift text-[14px] underline-offset-2 hover:underline"
            >
              {row.display_name}
            </Link>
            <span
              className="eyebrow"
              style={{ color: row.is_open_weights ? "var(--amber)" : "var(--muted)" }}
            >
              {row.is_open_weights ? t("openWeights") : t("apiOnly")}
            </span>
            {row.awaiting_human_votes && !row.provisional && (
              <span
                className="eyebrow border px-1"
                style={{ borderColor: "var(--rule)", color: "var(--muted)" }}
                title={t("awaitingVotesTitle")}
              >
                {t("awaitingVotes")}
              </span>
            )}
          </div>
          <div className="num text-[11px]" style={{ color: "var(--muted)" }}>
            {row.provider_name}
            {row.release_date ? ` · ${row.release_date}` : ""}
          </div>
        </td>
        <td className="num py-2 pr-3 text-right text-[15px]">
          {row.composite.toFixed(1)}
        </td>
        <td className="py-2 pr-4 text-right">
          <CoverageMeter
            covered={row.coverage.covered}
            total={row.coverage.total}
            label={coverageLabel}
          />
        </td>
        {CATEGORIES.map((category) => {
          const value = row.category_scores[category];
          return (
            <td
              key={category}
              className="num py-2 pr-3 text-right text-[12px]"
              style={{ color: value === undefined ? "var(--rule)" : "inherit" }}
            >
              {value === undefined ? "·" : value.toFixed(1)}
            </td>
          );
        })}
        <td className="py-2 text-right">
          <div className="flex justify-end">
            <Sparkline
              points={row.trend}
              label={
                row.trend.length < 2
                  ? t("noHistory")
                  : `${row.display_name} — ${t("trend")}`
              }
            />
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-y rule py-3">
        <label className="flex items-center gap-2">
          <span className="eyebrow">{tf("label")}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tf("search")}
            className="num border-b bg-transparent px-1 py-[2px] text-[12px] outline-none"
            style={{ borderColor: "var(--rule)", minWidth: "13rem" }}
          />
        </label>

        <div className="flex items-center gap-1.5">
          <span className="eyebrow">{tf("access")}</span>
          {(["all", "open", "api"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAccess(value)}
              className={CONSOLE_BUTTON}
              style={chipStyle(access === value)}
              aria-pressed={access === value}
            >
              {tf(value)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="eyebrow">{tf("origin")}</span>
          <button
            type="button"
            onClick={() => setOrigin("all")}
            className={CONSOLE_BUTTON}
            style={chipStyle(origin === "all")}
            aria-pressed={origin === "all"}
          >
            {tf("all")}
          </button>
          {origins.map((country) => (
            <button
              key={country}
              type="button"
              onClick={() => setOrigin(country)}
              className={CONSOLE_BUTTON}
              style={chipStyle(origin === country)}
              aria-pressed={origin === country}
            >
              {country === "United States of America" ? "USA" : country}
            </button>
          ))}
        </div>

        <span className="num ml-auto text-[11px]" style={{ color: "var(--muted)" }}>
          {tf("showing", { count: visible.length, total: rows.length })}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left" style={{ minWidth: "62rem" }}>
          <caption className="sr-only">{t("composite")}</caption>
          <thead>
            <tr className="border-b rule">
              <th scope="col" className="w-10 py-2 pr-2 align-bottom">
                <span className="eyebrow">{t("rank")}</span>
              </th>
              <th scope="col" className="py-2 pr-4 align-bottom">
                {headerButton("rank", t("model"), "left")}
              </th>
              <th scope="col" className="w-24 py-2 pr-3 align-bottom">
                {headerButton("composite", t("composite"), "right")}
              </th>
              <th scope="col" className="w-20 py-2 pr-4 align-bottom">
                <span className="eyebrow block text-right">{t("coverage")}</span>
              </th>
              {CATEGORIES.map((category) => (
                <th key={category} scope="col" className="w-20 py-2 pr-3 align-bottom">
                  {headerButton(category, t(category), "right")}
                </th>
              ))}
              <th scope="col" className="w-20 py-2 align-bottom">
                <span className="eyebrow block text-right">{t("trend")}</span>
              </th>
            </tr>
          </thead>

          <tbody>{ranked.map(renderRow)}</tbody>

          {provisional.length > 0 && (
            <tbody>
              <tr>
                <th colSpan={columnCount} scope="colgroup" className="pt-8">
                  <div className="border-t rule pt-3 text-left">
                    <span className="eyebrow" style={{ color: "var(--amber)" }}>
                      {t("provisionalTitle")}
                    </span>
                    <p
                      className="mt-1 max-w-[46rem] text-[12px] font-normal leading-[1.55]"
                      style={{ color: "var(--muted)" }}
                    >
                      {t("provisionalNote", { min: minCoverage, total: CATEGORIES.length })}
                    </p>
                  </div>
                </th>
              </tr>
              {provisional.map(renderRow)}
            </tbody>
          )}
        </table>

        {visible.length === 0 && (
          <p className="py-10 text-center text-[13px]" style={{ color: "var(--muted)" }}>
            {t("empty")}
          </p>
        )}
      </div>
    </div>
  );
}
