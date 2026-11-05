"use client";

/* eslint-disable react-hooks/set-state-in-effect -- state is read from the URL or storage after mount on purpose: the page is prerendered, so reading either during render would mismatch the server HTML. */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { CoverageMeter } from "./CoverageMeter";
import { SegmentedControl } from "./SegmentedControl";
import { Sparkline } from "./Sparkline";
import { Surface } from "./Surface";
import type { RankingRow } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

type SortKey = "rank" | "composite" | (typeof CATEGORIES)[number];
type Access = "all" | "open" | "api";

/** Context floors in tokens and price ceilings in USD per million, for the two filters.
    Round numbers a reader would pick, not tuned to the current catalogue. */
const CONTEXT_FLOORS = [131_072, 262_144, 1_000_000] as const;
const PRICE_CEILINGS = [0.5, 1, 3, 10] as const;

function formatContext(tokens: number | null): string {
  if (tokens === null) return "·";
  return tokens >= 1_000_000
    ? `${Math.round((tokens / 1_000_000) * 10) / 10}M`
    : `${Math.round(tokens / 1024)}K`;
}

function formatPrice(price: number | null): string {
  if (price === null) return "·";
  return price < 1 ? price.toFixed(3) : price.toFixed(2);
}

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
      className={clsx("control eyebrow", small && "control-sm", active && "control-on")}
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
  categoryAges?: Record<string, { age_days: number | null; freshness: string; date?: string | null }>;
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
  const [minContext, setMinContext] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);
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
    const c = Number(params.get("ctx"));
    const pr = Number(params.get("price"));
    if ((CONTEXT_FLOORS as readonly number[]).includes(c)) setMinContext(c);
    if ((PRICE_CEILINGS as readonly number[]).includes(pr)) setMaxPrice(pr);
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
    if (minContext) params.set("ctx", String(minContext));
    if (maxPrice) params.set("price", String(maxPrice));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [restored, query, access, origin, provider, sort, minContext, maxPrice, pathname, router]);

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
      // A model with no listed context or price is hidden while the matching filter is on:
      // "unknown" cannot be shown to satisfy a bound.
      if (minContext && (row.context_window ?? 0) < minContext) return false;
      if (maxPrice && (row.blended_price_usd_per_m ?? Infinity) > maxPrice) return false;
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
  }, [rows, query, access, origin, provider, sort, minContext, maxPrice]);

  const ranked = visible.filter((row) => !row.provisional);
  const provisional = visible.filter((row) => row.provisional);
  const columnCount = 6 + CATEGORIES.length + 1;
  const hasFilters =
    query !== "" ||
    access !== "all" ||
    origin !== "all" ||
    provider !== "all" ||
    minContext !== 0 ||
    maxPrice !== 0;
  // The tab strip and the sort are one state: "rank" is the composite tab.
  const metric: "rank" | (typeof CATEGORIES)[number] =
    sort === "rank" || sort === "composite" ? "rank" : sort;
  const mobileMetric = metric === "rank" ? "composite" : metric;

  const renderRow = (row: RankingRow) => {
    const partial = row.coverage.covered < row.coverage.total;
    const coverageLabel = partial
      ? t("partial", { covered: row.coverage.covered, total: row.coverage.total })
      : t("complete", { total: row.coverage.total });

    return (
      <tr key={row.id} className="row-hover">
        {/* "=4" is the conventional notation for a joint placing, and a repeated number
            is the honest outcome here rather than a rendering glitch. The explanation
            lives once in the column header's description, referenced per row. */}
        <td className="num w-9 text-xs text-tertiary" aria-describedby="rank-desc">
          {row.rank === null ? "·" : row.tied_with > 0 ? `=${row.rank}` : row.rank}
        </td>

        <td className="min-w-56">
          <div className="flex items-center gap-x-2">
            <Link
              href={`/model/${row.id}`}
              className="row-shift text-sm font-medium underline-offset-2 hover:underline"
            >
              {row.display_name}
            </Link>
            {row.is_open_weights ? (
              // A neutral fact, not a virtue: a filled badge marks it as metadata
              // rather than reusing the accent, which would read as an endorsement.
              <span className="rounded-inner bg-sunk px-1.5 py-0.5 text-2xs text-tertiary">
                {t("openWeights")}
              </span>
            ) : null}
          </div>
          <Link
            href={`/provider/${row.provider_id}`}
            className="row-shift block text-xs leading-tight text-tertiary underline-offset-2 hover:text-primary hover:underline"
          >
            {row.provider_name}
          </Link>
        </td>

        <td className="num text-right text-md" aria-describedby="composite-desc">
          {row.composite.toFixed(1)}
          <span className="ml-1 text-2xs text-tertiary">
            {row.composite_error === null ? "±?" : `±${row.composite_error.toFixed(2)}`}
          </span>
        </td>

        <td className="text-right" aria-describedby="coverage-desc">
          {/* The benchmark count stands beside coverage in the accessible name and tooltip:
              coverage is how much of the composite was measured, the count is how much
              evidence stands behind what was. */}
          <CoverageMeter
            covered={row.coverage.covered}
            total={row.coverage.total}
            label={`${coverageLabel} · ${t("evidenceShort", { benchmarks: row.benchmarks })}`}
          />
        </td>

        {CATEGORIES.map((category) => {
          const value = row.category_scores[category];
          return (
            <td
              key={category}
              aria-describedby={
                value === undefined && category === "human_preference" && row.awaiting_human_votes
                  ? "awaiting-desc"
                  : undefined
              }
              className={clsx(
                "num text-right text-xs",
                value === undefined && "text-tertiary",
                category === metric && "bg-sunk",
              )}
            >
              {value === undefined ? (
                <>
                  {/* The dot means "not measured", so it needs a text equivalent
                      rather than being a faint visual cue on its own. */}
                  <span
                    aria-hidden="true"
                    title={
                      category === "human_preference" && row.awaiting_human_votes
                        ? t("awaitingVotesTitle")
                        : undefined
                    }
                  >
                    ·
                  </span>
                  <span className="sr-only">{t("noData")}</span>
                </>
              ) : (
                value.toFixed(1)
              )}
            </td>
          );
        })}

        <td
          className="num text-right text-xs text-tertiary"
          aria-describedby={row.pareto_frontier === true ? "frontier-desc" : undefined}
        >
          {row.pareto_frontier === true && (
            <>
              <span aria-hidden="true" className="mr-1 text-mark" title={t("frontierTitle")}>
                ●
              </span>
              <span className="sr-only">{t("frontier")}</span>
            </>
          )}
          {formatPrice(row.blended_price_usd_per_m ?? null)}
        </td>

        <td className="num text-right text-xs text-tertiary">
          {formatContext(row.context_window ?? null)}
        </td>

        <td className="text-right">
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
          className="row-hover flex min-h-11 items-center gap-3 border-b border-subtle px-3 py-3"
        >
          <span className="num w-7 shrink-0 text-right text-xs text-tertiary">
            {row.rank === null ? "·" : row.tied_with > 0 ? `=${row.rank}` : row.rank}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base">{row.display_name}</div>
            <div className="truncate text-xs text-tertiary">{row.provider_name}</div>
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
          <span aria-hidden="true" className="shrink-0 text-tertiary">
            ›
          </span>
        </Link>
      </li>
    );
  };

  const mobileMetrics: Array<{ key: "composite" | (typeof CATEGORIES)[number]; label: string }> = [
    { key: "composite", label: t("composite") },
    ...CATEGORIES.map((cat) => ({ key: cat, label: t(cat) })),
  ];

  return (
    <div>
      {/* Column explanations, stated once. Rows reference them with aria-describedby
          instead of repeating a 60-word paragraph 65 times. */}
      <div className="sr-only">
        <span id="rank-desc">{t("rankDesc")}</span>
        <span id="composite-desc">{t("compositeDesc")}</span>
        <span id="coverage-desc">{t("coverageDesc")}</span>
        <span id="frontier-desc">{t("frontierTitle")}</span>
        <span id="awaiting-desc">{t("awaitingVotesTitle")}</span>
      </div>

      {/* Category tabs, desktop. The same state as the column sort and the mobile strip:
          choosing a tab orders the table by that category. */}
      <div className="no-scrollbar mb-3 hidden overflow-x-auto md:block">
        <SegmentedControl
          label={t("tabs")}
          value={mobileMetric}
          onChange={(next) => setSort(next === "composite" ? "rank" : next)}
          options={mobileMetrics.map(({ key, label }) => ({ value: key, label }))}
        />
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
            className="num min-h-11 w-[9rem] rounded-control bg-sunk px-2 py-1 text-xs outline-none sm:min-h-8 sm:w-auto sm:min-w-[13rem]"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="eyebrow hidden sm:inline">{tf("access")}</span>
          <SegmentedControl
            label={tf("access")}
            value={access}
            onChange={setAccess}
            options={(["all", "open", "api"] as const).map((value) => ({
              value,
              label: tf(value),
            }))}
          />
        </div>

        {origins.length > 1 && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="eyebrow hidden sm:inline">{tf("origin")}</span>
            {origins.length <= 4 ? (
              <SegmentedControl
                label={tf("origin")}
                value={origin}
                onChange={setOrigin}
                options={[
                  { value: "all", label: tf("all") },
                  ...origins.map((country) => ({
                    value: country,
                    label: country === "United States of America" ? "USA" : country,
                  })),
                ]}
              />
            ) : (
              <div
                role="group"
                aria-label={tf("origin")}
                className="flex shrink-0 items-center gap-1.5"
              >
                <Chip active={origin === "all"} onClick={() => setOrigin("all")}>
                  {tf("all")}
                </Chip>
                {origins.map((country) => (
                  <Chip
                    key={country}
                    active={origin === country}
                    onClick={() => setOrigin(country)}
                  >
                    {country === "United States of America" ? "USA" : country}
                  </Chip>
                ))}
              </div>
            )}
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
            className="eyebrow min-h-7 rounded-control border border-line bg-transparent px-1"
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

        <div className="flex shrink-0 items-center gap-1.5">
          <label htmlFor="context-filter" className="eyebrow hidden sm:inline">
            {tf("context")}
          </label>
          <select
            id="context-filter"
            value={minContext}
            onChange={(e) => setMinContext(Number(e.target.value))}
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
          <label htmlFor="price-filter" className="eyebrow hidden sm:inline">
            {tf("price")}
          </label>
          <select
            id="price-filter"
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            aria-label={tf("price")}
            className="eyebrow min-h-7 rounded-control border border-line bg-transparent px-1"
          >
            <option value={0}>{tf("all")}</option>
            {PRICE_CEILINGS.map((ceiling) => (
              <option key={ceiling} value={ceiling}>
                {tf("priceAtMost", { price: ceiling })}
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
              setMinContext(0);
              setMaxPrice(0);
              setSort("rank");
            }}
            className="control control-sm eyebrow shrink-0"
          >
            {tf("clear")}
          </button>
        )}

        <span className="num ml-auto shrink-0 text-2xs text-tertiary" role="status">
          {tf("showing", { count: visible.length, total: rows.length })}
        </span>
      </div>
      <p className="mt-2 hidden text-2xs text-tertiary md:block">
        <span className="text-mark" aria-hidden="true">
          ●
        </span>{" "}
        {t("legendFrontier")} · <span aria-hidden="true">·</span> {t("legendNone")}
      </p>
      {(minContext !== 0 || maxPrice !== 0) && (
        <p className="mt-2 text-2xs text-tertiary">{tf("unknownHidden")}</p>
      )}

      {/* Desktop: the real table, unchanged in semantics. */}
      <Surface className="mt-3 hidden md:block">
        <div
          className="relative overflow-x-auto"
          role="region"
          aria-label={t("composite")}
          tabIndex={0}
        >
          <table className="table-sticky table-dense w-full min-w-[64rem] text-left">
            <caption className="sr-only">{t("composite")}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="w-9 border-b border-subtle pr-1.5 align-bottom"
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
                {/* Labels, not controls. The header that sorts by rank is "#". */}
                <th scope="col" className="border-b border-subtle pr-1.5 align-bottom">
                  <span className="eyebrow">{t("model")}</span>
                </th>
                <th
                  scope="col"
                  className="w-28 border-b border-subtle pr-1.5 align-bottom"
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
                <th scope="col" className="w-32 border-b border-subtle pr-1.5 align-bottom">
                  <span className="eyebrow block text-right">{t("coverage")}</span>
                </th>
                {CATEGORIES.map((category) => {
                  const aged = categoryAges[category];
                  return (
                    <th
                      key={category}
                      scope="col"
                      className="w-20 border-b border-subtle pr-1.5 align-bottom"
                      aria-sort={sort === category ? "descending" : "none"}
                    >
                      {aged?.age_days != null && (
                        <span
                          className={clsx(
                            "eyebrow block text-right",
                            aged.freshness === "degraded" && "text-attention",
                          )}
                          title={t("agedCategoryTitle", { days: aged.age_days, date: aged.date ?? "—" })}
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
                <th scope="col" className="w-16 border-b border-subtle pr-1.5 align-bottom">
                  <span className="eyebrow block text-right" title={t("priceTitle")}>
                    {t("price")}
                  </span>
                </th>
                <th scope="col" className="w-16 border-b border-subtle pr-1.5 align-bottom">
                  <span className="eyebrow block text-right">{t("context")}</span>
                </th>
                <th scope="col" className="w-20 border-b border-subtle align-bottom">
                  <span className="eyebrow block text-right">{t("trend")}</span>
                </th>
              </tr>
            </thead>

            <tbody>{ranked.map(renderRow)}</tbody>

            {provisional.length > 0 && (
              <tbody>
                <tr>
                  <th colSpan={columnCount} scope="colgroup" className="h-auto whitespace-normal pt-8">
                    <div className="border-t border-subtle pt-3 text-left">
                      <span className="eyebrow text-attention">{t("provisionalTitle")}</span>
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
      </Surface>

      {/* Mobile: one metric at a time. At 335px there is room for rank, name and one
          number; a table showing 3 of 10 columns is a worse list than a list. */}
      <div className="md:hidden">
        <div className="no-scrollbar overflow-x-auto border-b border-subtle py-2">
          <SegmentedControl
            label={t("composite")}
            value={mobileMetric}
            onChange={(next) => setSort(next === "composite" ? "rank" : next)}
            options={mobileMetrics.map(({ key, label }) => ({ value: key, label }))}
          />
        </div>

        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-tertiary">{t("empty")}</p>
        ) : (
          <Surface as="ol" inset={false} className="mt-3 px-1" aria-label={t("composite")}>
            {ranked.map(renderMobileRow)}
            {provisional.length > 0 && (
              <>
                <li className="px-3 pb-2 pt-6">
                  <span className="eyebrow text-attention">{t("provisionalTitle")}</span>
                </li>
                {provisional.map(renderMobileRow)}
              </>
            )}
          </Surface>
        )}
      </div>
    </div>
  );
}
