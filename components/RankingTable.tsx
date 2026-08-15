"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { CoverageMeter } from "./CoverageMeter";
import { Sparkline } from "./Sparkline";
import type { RankingRow } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

type SortKey = "rank" | "composite" | (typeof CATEGORIES)[number];
type Access = "all" | "open" | "api";
type MobileMetric = "composite" | (typeof CATEGORIES)[number];

function Chip({
  active,
  onClick,
  children,
  small = true,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx("tactile eyebrow", small && "tactile-sm", active && "tactile-on")}
    >
      {children}
    </button>
  );
}

function SortBtn({
  sortKey,
  currentSort,
  onSort,
  label,
  sortByLabel,
  align = "right",
}: {
  sortKey: SortKey;
  currentSort: SortKey;
  onSort: (key: SortKey) => void;
  label: string;
  /** "Sort by {column}" — the visible text is the column name, which on its own
      does not tell a screen-reader user the control sorts. */
  sortByLabel: string;
  align?: "left" | "right";
}) {
  const active = currentSort === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={sortByLabel}
      className={clsx(
        "eyebrow row-shift flex w-full items-center gap-0.5 hover:text-primary",
        align === "right" ? "justify-end" : "justify-start",
        active && "text-accent",
      )}
    >
      {label}
      {/* Glyph, not hue: sort state must survive greyscale. */}
      {active && <span aria-hidden="true">↓</span>}
    </button>
  );
}

export function RankingTable({
  rows,
  minCoverage,
  categoryAges = {},
}: {
  rows: RankingRow[];
  minCoverage: number;
  /** Categories whose upstream snapshot has aged, keyed by category. */
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
  const [restored, setRestored] = useState(false);

  // Restore from the URL on mount. Deliberately not useSearchParams: that opts the
  // route out of static rendering, and every page here is prerendered.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const a = params.get("access");
    const o = params.get("origin");
    const p = params.get("provider");
    const s = params.get("sort");
    if (q) setQuery(q);
    if (a && (["all", "open", "api"] as const).includes(a as Access)) setAccess(a as Access);
    if (o) setOrigin(o);
    if (p) setProvider(p);
    if (s && (s === "rank" || s === "composite" || (CATEGORIES as readonly string[]).includes(s))) {
      setSort(s as SortKey);
    }
    setRestored(true);
  }, []);

  // Write state back to the URL. Gated on `restored` so the first pass cannot wipe
  // the very parameters the effect above is in the middle of reading.
  useEffect(() => {
    if (!restored) return;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (access !== "all") params.set("access", access);
    if (origin !== "all") params.set("origin", origin);
    if (provider !== "all") params.set("provider", provider);
    if (sort !== "rank") params.set("sort", sort);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [restored, query, access, origin, provider, sort, pathname, router]);

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
      // Rank and composite are no longer the same order. A significance rank is not
      // monotonic in the score, so sorting by score would print a rank column that runs
      // 13, 17, 16 downward; sorting by rank keeps the column readable and puts the
      // score in charge only inside a tied group.
      if (sort === "rank") {
        return (
          (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
          b.composite - a.composite
        );
      }
      if (sort === "composite") return b.composite - a.composite;
      const av = a.category_scores[sort];
      const bv = b.category_scores[sort];
      // Models without a measurement sink to the bottom instead of scoring zero.
      if (av === undefined && bv === undefined) return b.composite - a.composite;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return bv - av;
    });
  }, [rows, query, access, origin, provider, sort]);

  const ranked = visible.filter((row) => !row.provisional);
  const provisional = visible.filter((row) => row.provisional);
  const columnCount = 4 + CATEGORIES.length + 1;
  const hasFilters = query !== "" || access !== "all" || origin !== "all" || provider !== "all";

  const renderRow = (row: RankingRow) => {
    const partial = row.coverage.covered < row.coverage.total;
    const coverageLabel = partial
      ? t("partial", { covered: row.coverage.covered, total: row.coverage.total })
      : t("complete", { total: row.coverage.total });

    return (
      <tr key={row.id} className="row-hover border-b border-subtle">
        {/* "=4" is the conventional notation for a joint placing, and a repeated number
            is the honest outcome here rather than a rendering glitch. The explanation
            lives once in the column header's description, referenced per row. */}
        <td className="num py-2 pr-2 text-xs text-tertiary" aria-describedby="rank-desc">
          {row.rank === null ? "·" : row.tied_with > 0 ? `=${row.rank}` : row.rank}
        </td>

        <td className="py-2 pr-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Link
              href={`/model/${row.id}`}
              className="row-shift text-base underline-offset-2 hover:underline"
            >
              {row.display_name}
            </Link>
            <span className={clsx("eyebrow", row.is_open_weights && "text-accent")}>
              {row.is_open_weights ? t("openWeights") : t("apiOnly")}
            </span>
            {row.awaiting_human_votes && !row.provisional && (
              <span className="eyebrow border border-subtle px-1" title={t("awaitingVotesTitle")}>
                {t("awaitingVotes")}
              </span>
            )}
          </div>
          <div className="num text-2xs text-tertiary">
            {row.provider_name}
            {row.release_date ? ` · ${row.release_date}` : ""}
          </div>
        </td>

        <td className="num py-2 pr-3 text-right text-md" aria-describedby="composite-desc">
          {row.composite.toFixed(1)}
          <span className="ml-1 text-2xs text-tertiary">
            {row.composite_error === null ? "±?" : `±${row.composite_error.toFixed(2)}`}
          </span>
        </td>

        <td className="py-2 pr-4 text-right" aria-describedby="coverage-desc">
          <CoverageMeter
            covered={row.coverage.covered}
            total={row.coverage.total}
            label={coverageLabel}
          />
          {/* Beside coverage, not inside it: coverage is how much of the composite was
              measured, this is how much evidence stands behind what was. */}
          <span className="num mt-0.5 block text-2xs text-tertiary">
            {t("evidenceShort", { benchmarks: row.evidence.benchmarks })}
          </span>
        </td>

        {CATEGORIES.map((category) => {
          const value = row.category_scores[category];
          return (
            <td
              key={category}
              className={clsx("num py-2 pr-3 text-right text-xs", value === undefined && "text-tertiary")}
            >
              {value === undefined ? (
                <>
                  {/* The dot means "not measured", so it needs a text equivalent
                      rather than being a faint visual cue on its own. */}
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
              label={row.trend.length < 2 ? t("noHistory") : `${row.display_name} — ${t("trend")}`}
              directionLabel={{ up: t("trendUp"), down: t("trendDown") }}
            />
          </div>
        </td>
      </tr>
    );
  };

  const renderMobileRow = (row: RankingRow) => {
    const metricValue =
      mobileMetric === "composite" ? row.composite : row.category_scores[mobileMetric];
    const partial = row.coverage.covered < row.coverage.total;

    return (
      <li key={row.id}>
        <Link
          href={`/model/${row.id}`}
          className="row-hover flex items-center gap-3 border-b border-subtle py-3"
        >
          <span className="num w-7 shrink-0 text-right text-xs text-tertiary">
            {row.rank === null ? "·" : row.tied_with > 0 ? `=${row.rank}` : row.rank}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base">{row.display_name}</div>
            <div className="num truncate text-2xs text-tertiary">{row.provider_name}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className={clsx("num text-md", metricValue === undefined && "text-tertiary")}>
              {metricValue === undefined ? "—" : metricValue.toFixed(1)}
            </div>
            <CoverageMeter
              covered={row.coverage.covered}
              total={row.coverage.total}
              label={
                partial
                  ? t("partial", { covered: row.coverage.covered, total: row.coverage.total })
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
      {/* Column explanations, stated once. Rows reference them with aria-describedby
          instead of repeating a 60-word paragraph 65 times. */}
      <div className="sr-only">
        <span id="rank-desc">{t("rankDesc")}</span>
        <span id="composite-desc">{t("compositeDesc")}</span>
        <span id="coverage-desc">{t("coverageDesc")}</span>
      </div>

      {/* One scrolling row on mobile, a wrapping bar from sm up. Four stacked filter
          groups cost ~200px of vertical space on a phone, above the ranking itself. */}
      <div className="no-scrollbar flex items-center gap-x-4 gap-y-3 overflow-x-auto border-y border-subtle py-2 sm:flex-wrap sm:gap-x-5 sm:overflow-x-visible sm:py-3">
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor="ranking-search" className="eyebrow hidden sm:inline">
            {tf("label")}
          </label>
          <input
            id="ranking-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tf("search")}
            aria-label={tf("search")}
            className="num w-[9rem] rounded-(--radius-control) border border-line bg-transparent px-2 py-1 text-xs outline-none sm:w-auto sm:min-w-[13rem]"
          />
        </div>

        <div
          role="group"
          aria-label={tf("access")}
          className="flex shrink-0 items-center gap-1.5"
        >
          <span className="eyebrow hidden sm:inline">{tf("access")}</span>
          {(["all", "open", "api"] as const).map((value) => (
            <Chip key={value} active={access === value} onClick={() => setAccess(value)}>
              {tf(value)}
            </Chip>
          ))}
        </div>

        {origins.length > 1 && (
          <div
            role="group"
            aria-label={tf("origin")}
            className="flex shrink-0 items-center gap-1.5"
          >
            <span className="eyebrow hidden sm:inline">{tf("origin")}</span>
            <Chip active={origin === "all"} onClick={() => setOrigin("all")}>
              {tf("all")}
            </Chip>
            {origins.map((country) => (
              <Chip key={country} active={origin === country} onClick={() => setOrigin(country)}>
                {country === "United States of America" ? "USA" : country}
              </Chip>
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          <label htmlFor="provider-filter" className="eyebrow hidden sm:inline">
            {tf("provider")}
          </label>
          <select
            id="provider-filter"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label={tf("provider")}
            className="eyebrow min-h-[28px] rounded-(--radius-control) border border-line bg-transparent px-1"
          >
            {/* "All", not "Provider": the visible label already says Provider at sm+,
                and the select's aria-label carries it where that label is hidden. */}
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
            className="tactile tactile-sm eyebrow shrink-0"
          >
            {tf("clear")}
          </button>
        )}

        <span className="num ml-auto shrink-0 text-2xs text-tertiary" role="status">
          {tf("showing", { count: visible.length, total: rows.length })}
        </span>
      </div>

      {/* Desktop: the real table, unchanged in semantics. */}
      <div
        className="hidden overflow-x-auto md:block"
        role="region"
        aria-label={t("composite")}
        tabIndex={0}
      >
        <table className="table-sticky w-full min-w-[62rem] text-left">
          <caption className="sr-only">{t("composite")}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-10 border-b border-subtle py-2 pr-2 align-bottom"
                aria-sort={sort === "rank" ? "descending" : "none"}
              >
                <SortBtn
                  sortKey="rank"
                  currentSort={sort}
                  onSort={setSort}
                  label={t("rank")}
                  sortByLabel={t("sortBy", { column: t("rank") })}
                  align="left"
                />
              </th>
              {/* A label, not a control. The header that sorts by rank is "#". */}
              <th scope="col" className="border-b border-subtle py-2 pr-4 align-bottom">
                <span className="eyebrow">{t("model")}</span>
              </th>
              <th
                scope="col"
                className="w-24 border-b border-subtle py-2 pr-3 align-bottom"
                aria-sort={sort === "composite" ? "descending" : "none"}
              >
                <SortBtn
                  sortKey="composite"
                  currentSort={sort}
                  onSort={setSort}
                  label={t("composite")}
                  sortByLabel={t("sortBy", { column: t("composite") })}
                />
              </th>
              <th scope="col" className="w-20 border-b border-subtle py-2 pr-4 align-bottom">
                <span className="eyebrow block text-right">{t("coverage")}</span>
              </th>
              </th>
              {CATEGORIES.map((category) => {
                const aged = categoryAges[category];
                return (
                  <th
                    key={category}
                    scope="col"
                    className="w-20 border-b border-subtle py-2 pr-3 align-bottom"
                    aria-sort={sort === category ? "descending" : "none"}
                  >
                    {aged?.age_days != null && (
                      <span
                        className={clsx(
                          "eyebrow block text-right",
                          aged.freshness === "degraded" && "text-accent",
                        )}
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
                      sortByLabel={t("sortBy", { column: t(category) })}
                    />
                  </th>
                );
              })}
              <th scope="col" className="w-20 border-b border-subtle py-2 align-bottom">
                <span className="eyebrow block text-right">{t("trend")}</span>
              </th>
            </tr>
          </thead>

          <tbody>{ranked.map(renderRow)}</tbody>

          {provisional.length > 0 && (
            <tbody>
              <tr>
                <th colSpan={columnCount} scope="colgroup" className="pt-8">
                  <div className="border-t border-subtle pt-3 text-left">
                    <span className="eyebrow text-accent">{t("provisionalTitle")}</span>
                    <p className="mt-1 max-w-[46rem] text-xs font-normal leading-[1.55] text-tertiary">
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
          <p className="py-10 text-center text-sm text-tertiary">{t("empty")}</p>
        )}
      </div>

      {/* Mobile: one metric at a time. At 335px there is room for rank, name and one
          number; a table showing 3 of 10 columns is a worse list than a list. */}
      <div className="md:hidden">
        <div className="no-scrollbar overflow-x-auto border-b border-subtle">
          <div className="flex gap-1 py-2" role="group" aria-label={t("composite")}>
            {mobileMetrics.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobileMetric(key)}
                aria-pressed={mobileMetric === key}
                className={clsx(
                  "tactile tactile-sm eyebrow shrink-0",
                  mobileMetric === key && "tactile-on",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-tertiary">{t("empty")}</p>
        ) : (
          <ol aria-label={t("composite")}>
            {ranked.map(renderMobileRow)}
            {provisional.length > 0 && (
              <>
                <li className="pb-2 pt-6">
                  <span className="eyebrow text-accent">{t("provisionalTitle")}</span>
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
