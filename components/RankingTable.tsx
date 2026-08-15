"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { CoverageMeter } from "./CoverageMeter";
import { Sparkline } from "./Sparkline";
import type { RankingRow } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import clsx from "clsx";

type SortKey = "rank" | "composite" | (typeof CATEGORIES)[number];
type Access = "all" | "open" | "api";
type MobileMetric = "composite" | (typeof CATEGORIES)[number];

// ── Filter chip ────────────────────────────────────────────────────────────────
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="eyebrow row-shift border px-2 py-[3px]"
      style={
        active
          ? {
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "var(--text-on-accent)",
            }
          : {
              borderColor: "var(--line-default)",
              color: "var(--text-tertiary)",
            }
      }
    >
      {children}
    </button>
  );
}

// ── Sort button ────────────────────────────────────────────────────────────────
function SortBtn({
  sortKey,
  currentSort,
  onSort,
  label,
  align = "right",
}: {
  sortKey: SortKey;
  currentSort: SortKey;
  onSort: (key: SortKey) => void;
  label: string;
  align?: "left" | "right";
}) {
  const active = currentSort === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={clsx(
        "eyebrow row-shift w-full flex items-center gap-0.5",
        align === "right" ? "justify-end" : "justify-start",
      )}
      style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }}
    >
      {label}
      {active && (
        <span aria-hidden="true" className="ml-0.5">
          ↓
        </span>
      )}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function RankingTable({
  rows,
  minCoverage,
  categoryAges = {},
}: {
  rows: RankingRow[];
  minCoverage: number;
  categoryAges?: Record<string, { age_days: number | null; freshness: string }>;
}) {
  const t = useTranslations("table");
  const tf = useTranslations("filters");
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState("");
  const [access, setAccess] = useState<Access>("all");
  const [origin, setOrigin] = useState<string>("all");
  const [provider, setProvider] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("rank");
  const [mobileMetric, setMobileMetric] = useState<MobileMetric>("composite");

  // Restore filters from URL on mount — avoids useSearchParams + Suspense.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const a = params.get("access");
    const o = params.get("origin");
    const p = params.get("provider");
    const s = params.get("sort");
    if (q) setQuery(q);
    if (a && (["all", "open", "api"] as const).includes(a as Access))
      setAccess(a as Access);
    if (o) setOrigin(o);
    if (p) setProvider(p);
    if (s && (s === "rank" || s === "composite" || (CATEGORIES as readonly string[]).includes(s)))
      setSort(s as SortKey);
  }, []);

  // Keep URL in sync with filter state.
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (access !== "all") params.set("access", access);
    if (origin !== "all") params.set("origin", origin);
    if (provider !== "all") params.set("provider", provider);
    if (sort !== "rank") params.set("sort", sort);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [query, access, origin, provider, sort, pathname, router]);

  const origins = useMemo(
    () => Array.from(new Set(rows.map((r) => r.country).filter(Boolean))).sort(),
    [rows],
  );

  const providers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.provider_name).filter(Boolean))).sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (access === "open" && !row.is_open_weights) return false;
      if (access === "api" && row.is_open_weights) return false;
      if (origin !== "all" && row.country !== origin) return false;
      if (provider !== "all" && row.provider_name !== provider) return false;
      if (!needle) return true;
      return (
        row.display_name.toLowerCase().includes(needle) ||
        row.provider_name.toLowerCase().includes(needle)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort === "rank") {
        return (
          (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
          b.composite - a.composite
        );
      }
      if (sort === "composite") return b.composite - a.composite;
      const av = a.category_scores[sort];
      const bv = b.category_scores[sort];
      if (av === undefined && bv === undefined) return b.composite - a.composite;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return bv - av;
    });
  }, [rows, query, access, origin, provider, sort]);

  const ranked = visible.filter((row) => !row.provisional);
  const provisional = visible.filter((row) => row.provisional);
  const columnCount = 4 + CATEGORIES.length + 1;
  const hasFilters =
    query !== "" || access !== "all" || origin !== "all" || provider !== "all";

  // ── Desktop table row ────────────────────────────────────────────────────────
  const renderRow = (row: RankingRow) => {
    const partial = row.coverage.covered < row.coverage.total;
    const coverageLabel = partial
      ? t("partial", { covered: row.coverage.covered, total: row.coverage.total })
      : t("complete", { total: row.coverage.total });

    return (
      <tr
        key={row.id}
        className="row-shift border-b"
        style={{ borderColor: "var(--line-subtle)" }}
      >
        <td
          className="num py-2 pr-2 text-[12px]"
          style={{ color: "var(--text-tertiary)" }}
          title={row.tied_with > 0 ? t("tiedTitle", { count: row.tied_with }) : undefined}
        >
          {row.rank === null ? "·" : row.tied_with > 0 ? `=${row.rank}` : row.rank}
          {row.tied_with > 0 && (
            <span className="sr-only"> {t("tiedTitle", { count: row.tied_with })}</span>
          )}
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
              style={{
                color: row.is_open_weights ? "var(--accent)" : "var(--text-tertiary)",
              }}
            >
              {row.is_open_weights ? t("openWeights") : t("apiOnly")}
            </span>
            {row.awaiting_human_votes && !row.provisional && (
              <span
                className="eyebrow border px-1"
                style={{ borderColor: "var(--line-subtle)", color: "var(--text-tertiary)" }}
                title={t("awaitingVotesTitle")}
              >
                {t("awaitingVotes")}
              </span>
            )}
          </div>
          <div className="num text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {row.provider_name}
            {row.release_date ? ` · ${row.release_date}` : ""}
          </div>
        </td>

        <td className="num py-2 pr-3 text-right text-[15px]">
          {row.composite.toFixed(1)}
          <span
            className="ml-1 text-[11px]"
            style={{ color: "var(--text-tertiary)" }}
            title={
              row.composite_error === null
                ? t("errorUnknownTitle")
                : t("errorTitle", {
                    measured: row.uncertainty.measured_inputs,
                    total: row.uncertainty.total_inputs,
                  })
            }
          >
            {row.composite_error === null
              ? "±?"
              : `±${row.composite_error.toFixed(2)}`}
          </span>
        </td>

        <td className="py-2 pr-4 text-right">
          <CoverageMeter
            covered={row.coverage.covered}
            total={row.coverage.total}
            label={coverageLabel}
          />
          <span
            className="num mt-0.5 block text-[10px]"
            style={{ color: "var(--text-tertiary)" }}
            title={t("evidenceTitle", {
              benchmarks: row.evidence.benchmarks,
              sources: row.evidence.sources,
              max: row.evidence.max_sources,
            })}
          >
            {t("evidenceShort", { benchmarks: row.evidence.benchmarks })}
          </span>
        </td>

        {CATEGORIES.map((category) => {
          const value = row.category_scores[category];
          return (
            <td
              key={category}
              className="num py-2 pr-3 text-right text-[12px]"
              style={{ color: value === undefined ? "var(--text-tertiary)" : "inherit" }}
            >
              {value === undefined ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="sr-only">{t("noData")}</span>
                </>
              ) : (
                value.toFixed(1)
              )}
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

  // ── Mobile list row ──────────────────────────────────────────────────────────
  const renderMobileRow = (row: RankingRow) => {
    const metricValue =
      mobileMetric === "composite" ? row.composite : row.category_scores[mobileMetric];
    const partial = row.coverage.covered < row.coverage.total;

    return (
      <li key={row.id}>
        <Link
          href={`/model/${row.id}`}
          className="flex items-center gap-3 border-b py-3 row-shift"
          style={{ borderColor: "var(--line-subtle)" }}
        >
          <span
            className="num w-7 shrink-0 text-right text-[12px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            {row.rank === null ? "·" : row.tied_with > 0 ? `=${row.rank}` : row.rank}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px]">{row.display_name}</div>
            <div className="num truncate text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {row.provider_name}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div
              className="num text-[16px]"
              style={{ color: metricValue === undefined ? "var(--text-tertiary)" : "inherit" }}
            >
              {metricValue === undefined ? "—" : metricValue.toFixed(1)}
            </div>
            <CoverageMeter
              covered={row.coverage.covered}
              total={row.coverage.total}
              label={
                partial
                  ? t("partial", {
                      covered: row.coverage.covered,
                      total: row.coverage.total,
                    })
                  : t("complete", { total: row.coverage.total })
              }
            />
          </div>
        </Link>
      </li>
    );
  };

  const mobileMetrics: Array<{ key: MobileMetric; label: string }> = [
    { key: "composite", label: t("composite") },
    ...CATEGORIES.map((cat) => ({ key: cat as MobileMetric, label: t(cat) })),
  ];

  return (
    <div>
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-y py-3"
        style={{ borderColor: "var(--line-subtle)" }}>

        <div className="flex items-center gap-2">
          <label htmlFor="ranking-search" className="eyebrow">
            {tf("label")}
          </label>
          <input
            id="ranking-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tf("search")}
            className="num border-b bg-transparent px-1 py-[2px] text-[12px] outline-none"
            style={{ borderColor: "var(--line-default)", minWidth: "13rem" }}
          />
        </div>

        <div role="group" aria-label={tf("access")} className="flex items-center gap-1.5">
          <span className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
            {tf("access")}
          </span>
          {(["all", "open", "api"] as const).map((value) => (
            <FilterChip
              key={value}
              active={access === value}
              onClick={() => setAccess(value)}
            >
              {tf(value)}
            </FilterChip>
          ))}
        </div>

        {origins.length > 1 && (
          <div role="group" aria-label={tf("origin")} className="flex items-center gap-1.5">
            <span className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
              {tf("origin")}
            </span>
            <FilterChip active={origin === "all"} onClick={() => setOrigin("all")}>
              {tf("all")}
            </FilterChip>
            {origins.map((country) => (
              <FilterChip
                key={country}
                active={origin === country}
                onClick={() => setOrigin(country)}
              >
                {country === "United States of America" ? "USA" : country}
              </FilterChip>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <label htmlFor="provider-filter" className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
            {tf("provider")}
          </label>
          <select
            id="provider-filter"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="eyebrow border bg-transparent px-1 py-[3px]"
            style={{ borderColor: "var(--line-default)", color: "var(--text-tertiary)" }}
          >
            <option value="all">{tf("all")}</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setAccess("all");
              setOrigin("all");
              setProvider("all");
              setSort("rank");
            }}
            className="eyebrow row-shift border px-2 py-[3px]"
            style={{ borderColor: "var(--line-default)", color: "var(--text-tertiary)" }}
          >
            {tf("clear")}
          </button>
        )}

        <span className="num ml-auto text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {tf("showing", { count: visible.length, total: rows.length })}
        </span>
      </div>

      {/* ── Desktop table (≥ md) ── */}
      <div
        className="hidden md:block overflow-x-auto"
        role="region"
        aria-label={t("composite")}
        tabIndex={0}
      >
        <table className="w-full border-collapse text-left" style={{ minWidth: "62rem" }}>
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--line-subtle)" }}>
              <th scope="col" className="w-10 py-2 pr-2 align-bottom"
                aria-sort={sort === "rank" ? "descending" : "none"}>
                {/* "#" sorts by rank — the actual ranking column. */}
                <SortBtn sortKey="rank" currentSort={sort} onSort={setSort} label={t("rank")} align="left" />
              </th>
              <th scope="col" className="py-2 pr-4 align-bottom">
                <span className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
                  {t("model")}
                </span>
              </th>
              <th scope="col" className="w-24 py-2 pr-3 align-bottom"
                aria-sort={sort === "composite" ? "descending" : "none"}>
                <SortBtn sortKey="composite" currentSort={sort} onSort={setSort} label={t("composite")} />
              </th>
              <th scope="col" className="w-20 py-2 pr-4 align-bottom">
                <span
                  className="eyebrow block text-right"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {t("coverage")}
                </span>
              </th>
              {CATEGORIES.map((category) => {
                const aged = categoryAges[category];
                return (
                  <th key={category} scope="col" className="w-20 py-2 pr-3 align-bottom"
                    aria-sort={sort === category ? "descending" : "none"}>
                    {aged?.age_days != null && (
                      <span
                        className="eyebrow block text-right"
                        style={{
                          color:
                            aged.freshness === "degraded"
                              ? "var(--accent)"
                              : "var(--text-tertiary)",
                        }}
                        title={t("agedCategoryTitle", { days: aged.age_days })}
                      >
                        {t("agedCategory", { days: aged.age_days })}
                      </span>
                    )}
                    <SortBtn
                      sortKey={category}
                      currentSort={sort}
                      onSort={setSort}
                      label={t(category)}
                    />
                  </th>
                );
              })}
              <th scope="col" className="w-20 py-2 align-bottom">
                <span
                  className="eyebrow block text-right"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {t("trend")}
                </span>
              </th>
            </tr>
          </thead>

          <tbody>{ranked.map(renderRow)}</tbody>

          {provisional.length > 0 && (
            <tbody>
              <tr>
                <th colSpan={columnCount} scope="colgroup" className="pt-8">
                  <div
                    className="border-t pt-3 text-left"
                    style={{ borderColor: "var(--line-subtle)" }}
                  >
                    <span className="eyebrow" style={{ color: "var(--accent)" }}>
                      {t("provisionalTitle")}
                    </span>
                    <p
                      className="mt-1 max-w-[46rem] text-[12px] font-normal leading-[1.55]"
                      style={{ color: "var(--text-tertiary)" }}
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
          <p
            className="py-10 text-center text-[13px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("empty")}
          </p>
        )}
      </div>

      {/* ── Mobile list (< md) ── */}
      <div className="md:hidden">
        {/* Metric selector */}
        <div
          className="overflow-x-auto no-scrollbar border-b"
          style={{ borderColor: "var(--line-subtle)" }}
        >
          <div
            className="flex gap-1 py-2"
            role="group"
            aria-label={t("composite")}
          >
            {mobileMetrics.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobileMetric(key)}
                aria-pressed={mobileMetric === key}
                className="eyebrow shrink-0 row-shift border px-2 py-[3px]"
                style={
                  mobileMetric === key
                    ? {
                        background: "var(--accent)",
                        borderColor: "var(--accent)",
                        color: "var(--text-on-accent)",
                      }
                    : {
                        borderColor: "var(--line-default)",
                        color: "var(--text-tertiary)",
                      }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p
            className="py-10 text-center text-[13px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("empty")}
          </p>
        ) : (
          <ol aria-label={t("composite")}>
            {ranked.map(renderMobileRow)}
            {provisional.length > 0 && (
              <>
                <li className="pb-2 pt-6">
                  <span className="eyebrow" style={{ color: "var(--accent)" }}>
                    {t("provisionalTitle")}
                  </span>
                </li>
                {provisional.map(renderMobileRow)}
              </>
            )}
          </ol>
        )}
      </div>
    </div>
  );
}
