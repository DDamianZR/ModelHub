"use client";

/* eslint-disable react-hooks/set-state-in-effect -- state is read from storage after mount on purpose: the page is prerendered, so reading it during render would mismatch the server HTML. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Surface } from "@/components/Surface";
import { HARDWARE_PRESETS, analyze, estimateMemoryGb } from "@/lib/fit";
import type { LlmfitImport } from "@/lib/llmfit-import";
import {
  DEFAULT_FILTERS,
  GPU_STOPS,
  RAM_STOPS,
  UNIFIED_STOPS,
  applyFilters,
  nearestStop,
  nextJump,
  sortResults,
  summarise,
  unlocked,
  type Filters,
  type Result,
  type SortKey,
} from "@/lib/local-view";
import type { LocalEntry } from "@/lib/types";
import { AdvancedPanel } from "@/components/local/AdvancedPanel";
import { CapacityMap } from "@/components/local/CapacityMap";
import { DetailPanel } from "@/components/local/DetailPanel";
import { ModelExplorer } from "@/components/local/ModelExplorer";
import { Readout } from "@/components/local/Readout";
import { RigPanel } from "@/components/local/RigPanel";
import { UpgradeLadder } from "@/components/local/UpgradeLadder";
import {
  DEFAULT_FORM,
  STORAGE_KEY,
  fmt,
  parseNumber,
  readStored,
  toHardware,
  withMemory,
  type Form,
} from "@/components/local/form";

/** Memory at a fixed reference quantisation: the x position of a model on the capacity map. */
const REFERENCE_QUANT = "Q4_K_M";

export function LocalFit({
  entries,
  rankedCount,
  withLayout,
  unsized,
  unmeasuredCount,
  catalogueRules,
}: {
  entries: LocalEntry[];
  rankedCount: number;
  withLayout: number;
  unsized: number;
  unmeasuredCount: number;
  catalogueRules: { minDownloads: number | null; minLikes: number | null; maxRows: number | null };
}) {
  const t = useTranslations("local");
  const locale = useLocale();

  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [storage, setStorage] = useState<"unknown" | "ok" | "off">("unknown");
  const [hydrated, setHydrated] = useState(false);
  const [verdicts, setVerdicts] = useState<LlmfitImport["verdicts"] | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>("composite");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Restore what the user typed last time. Storage can be blocked (private mode, policy):
  // that is reported, never thrown, and the page works the same without it.
  useEffect(() => {
    const stored = readStored();
    if (stored) setForm(stored);
    try {
      window.localStorage.setItem(`${STORAGE_KEY}.probe`, "1");
      window.localStorage.removeItem(`${STORAGE_KEY}.probe`);
      setStorage("ok");
    } catch {
      setStorage("off");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || storage !== "ok") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      setStorage("off");
    }
  }, [form, hydrated, storage]);

  const hardware = useMemo(() => toHardware(form), [form]);
  const context = Number(form.context);

  const results = useMemo<Result[] | null>(() => {
    if (!hardware) return null;
    return entries.map((entry) => ({ entry, fit: analyze(entry.spec, hardware, context) }));
  }, [entries, hardware, context]);

  const summary = useMemo(() => (results ? summarise(results) : null), [results]);

  const refMemory = useMemo(
    () =>
      new Map(
        entries.map((e) => [
          e.spec.model_id,
          estimateMemoryGb(e.spec, REFERENCE_QUANT, Math.min(context, e.spec.context_length)),
        ]),
      ),
    [entries, context],
  );

  // The ladder: the same machine with each memory size that exists, everything else as typed.
  const stops = form.kind === "cpu" ? RAM_STOPS : form.kind === "unified" ? UNIFIED_STOPS : GPU_STOPS;
  const ladder = useMemo(() => {
    const perStop = stops.map((gb) => {
      const hw = withMemory(form, gb);
      return hw ? entries.map((entry) => ({ entry, fit: analyze(entry.spec, hw, context) })) : null;
    });
    return {
      perStop,
      counts: perStop.map((rows) => (rows ? rows.filter((r) => r.fit.level !== "too_tight").length : 0)),
    };
    // `form.memory` is deliberately absent: each stop replaces it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, stops, form.kind, form.ram, form.bandwidth, context]);

  const typedGb = parseNumber(form.kind === "cpu" ? form.ram : form.memory);
  const currentStop = nearestStop(stops, typedGb ?? stops[0]);
  const nextStop =
    typedGb !== null && summary ? nextJump(stops, ladder.counts, typedGb, summary.runs) : null;
  const unlockedModels = useMemo(() => {
    if (nextStop === null || !results) return [];
    return unlocked(results, ladder.perStop[nextStop] ?? []);
  }, [nextStop, results, ladder]);

  const visibleIds = useMemo(
    () =>
      results
        ? new Set(
            applyFilters(results, { ...filters, fit: "all" }).map((r) => r.entry.spec.model_id),
          )
        : new Set<string>(),
    [results, filters],
  );
  const rows = useMemo(
    () => (results ? sortResults(applyFilters(results, filters), sort) : []),
    [results, filters, sort],
  );

  const selected =
    results?.find((r) => r.entry.spec.model_id === selectedId) ??
    summary?.bestMeasured ??
    summary?.largest ??
    null;
  const selectedKey = selected?.entry.spec.model_id ?? null;

  function update(patch: Partial<Form>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function choosePreset(id: string) {
    const preset = HARDWARE_PRESETS.find((p) => p.id === id);
    if (!preset) {
      update({ preset: "custom" });
      return;
    }
    update({
      preset: id,
      kind: preset.kind,
      memory: String(preset.memoryGb),
      bandwidth: String(preset.bandwidthGbps),
    });
  }

  /** Select a model and bring its detail into view, for controls far from the panel. */
  function openDetail(id: string) {
    setSelectedId(id);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    headingRef.current?.focus({ preventScroll: true });
    panelRef.current?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  }

  const what =
    form.kind === "cpu"
      ? t("ladder.what_cpu")
      : form.kind === "unified"
        ? t("ladder.what_unified")
        : t("ladder.what_gpu");

  let fastGb = 0;
  let reachGb: number | null = null;
  if (hardware) {
    if (hardware.kind === "discrete") {
      fastGb = hardware.vramGb;
      reachGb = hardware.ramGb;
    } else if (hardware.kind === "unified") {
      fastGb = hardware.poolGb;
    } else {
      fastGb = hardware.ramGb;
    }
  }

  const heading = (id: string, text: string) => (
    <h2 id={id} className="text-lg leading-tight font-semibold">
      {text}
    </h2>
  );

  return (
    <div className="flex flex-col gap-10">
      <Surface as="section" aria-labelledby="local-rig" className="p-4 sm:p-6">
        {heading("local-rig", t("hardware.title"))}
        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <RigPanel form={form} update={update} choosePreset={choosePreset} />
          <div className="lg:border-l lg:border-subtle lg:pl-8">
            {summary ? (
              <Readout summary={summary} rankedCount={rankedCount} onSelect={openDetail} />
            ) : (
              <p className="text-base text-tertiary" role="status">
                {t("hardware.invalid")}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5">
          <AdvancedPanel
            storage={storage}
            onApply={(patch) => update(patch)}
            onVerdicts={setVerdicts}
          />
        </div>
      </Surface>

      {results && summary && (
        <>
          <section aria-labelledby="local-map">
            {heading("local-map", t("map.title"))}
            <p className="mt-1 max-w-[46rem] text-sm leading-[1.6] text-tertiary">{t("map.lead")}</p>
            <Surface className="mt-3 p-3 sm:p-4">
              <CapacityMap
                results={results}
                refMemory={refMemory}
                fastGb={fastGb}
                reachGb={reachGb}
                selectedId={selectedKey}
                visibleIds={visibleIds}
                onSelect={setSelectedId}
                locale={locale}
              />
            </Surface>
          </section>

          <section aria-labelledby="local-ladder">
            {heading("local-ladder", t("ladder.title"))}
            <p className="mt-1 max-w-[46rem] text-sm leading-[1.6] text-tertiary">
              {t("ladder.lead", { what })}
            </p>
            <Surface className="mt-3 p-3 sm:p-4">
              <UpgradeLadder
                stops={stops}
                counts={ladder.counts}
                currentIndex={currentStop}
                what={what}
                nextIndex={nextStop}
                unlockedModels={unlockedModels}
                onPick={(gb) =>
                  update(form.kind === "cpu" ? { ram: String(gb) } : { memory: String(gb), preset: "custom" })
                }
                onSelect={openDetail}
              />
            </Surface>
          </section>

          {selected && (
            <section aria-labelledby="local-detail" ref={panelRef} className="scroll-mt-4">
              {heading("local-detail", t("detail.title"))}
              <Surface className="mt-3 p-4 sm:p-6">
                <DetailPanel
                  result={selected}
                  rankedCount={rankedCount}
                  llmfit={verdicts?.get(selected.entry.spec.hf_repo) ?? null}
                  hasImport={verdicts !== null}
                  headingRef={headingRef}
                />
              </Surface>
            </section>
          )}

          <section aria-labelledby="local-explore">
            {heading("local-explore", t("filter.title"))}
            <div className="mt-3">
              <ModelExplorer
                filters={filters}
                onFilters={(patch) => setFilters((current) => ({ ...current, ...patch }))}
                sort={sort}
                onSort={setSort}
                rows={rows}
                runningTotal={summary.runs}
                rankedCount={rankedCount}
                selectedId={selectedKey}
                verdicts={verdicts}
                hasImport={verdicts !== null}
                onDetail={openDetail}
              />
            </div>
          </section>
        </>
      )}

      <section className="text-xs leading-[1.6] text-tertiary">
        <h2 className="eyebrow">{t("notes.title")}</h2>
        <ul className="mt-1 flex flex-col gap-1">
          <li>{t("notes.estimates")}</li>
          <li>{t("notes.moe")}</li>
          <li>{t("notes.bands")}</li>
          <li>{t("notes.layout", { withLayout, total: entries.length })}</li>
          <li>{t("notes.unsized", { count: unsized })}</li>
          <li>
            {t("notes.catalogue", {
              count: unmeasuredCount,
              downloads: fmt(catalogueRules.minDownloads ?? 0, locale, 0),
              likes: fmt(catalogueRules.minLikes ?? 0, locale, 0),
            })}
          </li>
          <li>{t("notes.order")}</li>
          <li>
            <Link href="/methodology#local" className="underline underline-offset-2">
              {t("notes.method")}
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
