"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SegmentedControl } from "@/components/SegmentedControl";
import type { ImportedVerdict } from "@/lib/llmfit-import";
import {
  DEFAULT_FILTERS,
  type Arch,
  type Filters,
  type FitScope,
  type Modality,
  type Result,
  type Scope,
  type SortKey,
  type TierFilter,
} from "@/lib/local-view";
import { fmt } from "./form";
import { ModelCard } from "./ModelCard";

const PAGE = 24;

const selectClass =
  "min-h-11 w-full rounded-control border border-line bg-transparent px-2 text-xs sm:min-h-8";

/**
 * The filter bar and the grid of cards. Ordering is the standing ModelHub measured unless the
 * reader picks another; showing only what fits is the default, and turning it off lists what
 * does not too, with the memory each would need, which is the "what would I have to get" view.
 */
export function ModelExplorer({
  filters,
  onFilters,
  sort,
  onSort,
  rows,
  runningTotal,
  rankedCount,
  selectedId,
  verdicts,
  hasImport,
  onDetail,
}: {
  filters: Filters;
  onFilters: (patch: Partial<Filters>) => void;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  /** Already filtered and ordered. */
  rows: Result[];
  /** How many models run on this machine, before any filter. */
  runningTotal: number;
  rankedCount: number;
  selectedId: string | null;
  verdicts: Map<string, ImportedVerdict> | null;
  hasImport: boolean;
  onDetail: (id: string) => void;
}) {
  const t = useTranslations("local");
  const locale = useLocale();

  // The page length resets whenever the filters or the order change, without an effect:
  // it is remembered together with the signature it was grown under.
  const signature = JSON.stringify([filters, sort]);
  const [grown, setGrown] = useState({ signature, pages: 1 });
  const pages = grown.signature === signature ? grown.pages : 1;
  const shown = rows.slice(0, pages * PAGE);

  const changed = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  const select = <T extends string>(
    id: string,
    label: string,
    value: T,
    options: { value: T; label: string }[],
    onChange: (value: T) => void,
  ) => (
    <div className="flex min-w-[9rem] flex-1 flex-col gap-1">
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)} className={selectClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  const scopeOptions: { value: Scope; label: string }[] = [
    { value: "all", label: t("filter.scope_all") },
    { value: "measured", label: t("filter.scope_measured") },
    { value: "unmeasured", label: t("filter.scope_unmeasured") },
  ];
  const fitOptions: { value: FitScope; label: string }[] = [
    { value: "runs", label: t("filter.fit_runs") },
    { value: "all", label: t("filter.fit_all") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex min-w-[12rem] flex-[2] flex-col gap-1">
          <label htmlFor="local-search" className="eyebrow">
            {t("filter.search")}
          </label>
          <input
            id="local-search"
            type="search"
            value={filters.query}
            onChange={(event) => onFilters({ query: event.target.value })}
            autoComplete="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-control bg-sunk px-3 text-sm outline-none sm:min-h-8"
          />
        </div>
        {select<SortKey>(
          "local-sort",
          t("filter.sort"),
          sort,
          (["composite", "speed", "size", "popularity", "name"] as const).map((k) => ({
            value: k,
            label: t(`sort.${k}`),
          })),
          onSort,
        )}
        {select<Modality>(
          "local-modality",
          t("filter.modality"),
          filters.modality,
          (["all", "text", "vision"] as const).map((k) => ({ value: k, label: t(`filter.modality_${k}`) })),
          (modality) => onFilters({ modality }),
        )}
        {select<Arch>(
          "local-arch",
          t("filter.arch"),
          filters.arch,
          (["all", "dense", "moe"] as const).map((k) => ({ value: k, label: t(`filter.arch_${k}`) })),
          (arch) => onFilters({ arch }),
        )}
        {select<TierFilter>(
          "local-speed",
          t("filter.speed"),
          filters.tier,
          [
            { value: "all", label: t("filter.speed_all") },
            { value: "fast", label: t("tier.fast") },
            { value: "comfortable", label: t("tier.comfortable") },
            { value: "slow", label: t("tier.slow") },
          ],
          (tier) => onFilters({ tier }),
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="no-scrollbar relative max-w-full overflow-x-auto">
          <SegmentedControl
            options={scopeOptions}
            value={filters.scope}
            onChange={(scope) => onFilters({ scope })}
            label={t("filter.scope")}
          />
        </div>
        <div className="no-scrollbar relative max-w-full overflow-x-auto">
          <SegmentedControl
            options={fitOptions}
            value={filters.fit}
            onChange={(fit) => onFilters({ fit })}
            label={t("filter.fit")}
          />
        </div>
        {changed && (
          <button
            type="button"
            onClick={() => {
              onFilters(DEFAULT_FILTERS);
              onSort("composite");
            }}
            className="control eyebrow min-h-11 sm:min-h-8"
          >
            {t("filter.reset")}
          </button>
        )}
        <p className="num text-xs text-tertiary" role="status">
          {t("filter.count", { shown: fmt(rows.length, locale, 0), running: fmt(runningTotal, locale, 0) })}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-base text-tertiary">{t("filter.empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((result) => (
            <ModelCard
              key={result.entry.spec.model_id}
              result={result}
              rankedCount={rankedCount}
              selected={result.entry.spec.model_id === selectedId}
              llmfit={verdicts?.get(result.entry.spec.hf_repo) ?? null}
              hasImport={hasImport}
              onDetail={onDetail}
            />
          ))}
        </ul>
      )}

      {shown.length < rows.length && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setGrown({ signature, pages: pages + 1 })}
            className="control min-h-11 px-4 sm:min-h-8"
          >
            {t("filter.more", { count: rows.length - shown.length })}
          </button>
        </div>
      )}
    </div>
  );
}
