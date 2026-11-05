"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Surface } from "@/components/Surface";
import {
  HARDWARE_PRESETS,
  analyze,
  type FitResult,
  type Hardware,
} from "@/lib/fit";
import {
  parseLlmfitImport,
  type ImportError,
  type LlmfitImport,
} from "@/lib/llmfit-import";
import type { LocalEntry } from "@/lib/types";

type Kind = "discrete" | "unified" | "cpu";

type Form = {
  kind: Kind;
  preset: string;
  /** GPU memory for a discrete card, or the shared pool on unified memory. */
  memory: string;
  ram: string;
  bandwidth: string;
  context: string;
};

/**
 * A CPU-only machine with 16 GB: computable on first paint and naming no GPU, so the page
 * opens on a result without nudging anyone toward a brand's hardware.
 */
const DEFAULT_FORM: Form = {
  kind: "cpu",
  preset: "custom",
  memory: "",
  ram: "16",
  bandwidth: "",
  context: "8192",
};

const CONTEXTS = ["4096", "8192", "16384", "32768", "131072"];
const STORAGE_KEY = "modelhub.local.hardware.v1";
/** llmfit holds back this share of installed RAM for the system when it is told the total. */
const RAM_USABLE = 0.9;

function parseNumber(value: string): number | null {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null;
}

function toHardware(form: Form): Hardware | null {
  const memory = parseNumber(form.memory);
  const ram = parseNumber(form.ram);
  const bandwidth = parseNumber(form.bandwidth);
  if (form.kind === "cpu") return ram ? { kind: "cpu", ramGb: ram * RAM_USABLE } : null;
  if (form.kind === "unified") {
    return memory ? { kind: "unified", poolGb: memory, bandwidthGbps: bandwidth } : null;
  }
  return memory && ram
    ? { kind: "discrete", vramGb: memory, ramGb: ram * RAM_USABLE, bandwidthGbps: bandwidth }
    : null;
}

function readStored(): Form | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const kinds: Kind[] = ["discrete", "unified", "cpu"];
    if (!kinds.includes(v.kind as Kind)) return null;
    for (const key of ["preset", "memory", "ram", "bandwidth", "context"]) {
      if (typeof v[key] !== "string" || (v[key] as string).length > 24) return null;
    }
    if (!CONTEXTS.includes(v.context as string)) return null;
    return v as unknown as Form;
  } catch {
    return null;
  }
}

function fmt(n: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
}

type Hints = {
  gpu: "checking" | "none" | { name: string };
  memoryGb: "checking" | null | number;
};

type Result = { entry: LocalEntry; fit: FitResult };

const byName = (a: Result, b: Result) => a.entry.display_name.localeCompare(b.entry.display_name);

export function LocalFit({
  entries,
  rankedCount,
  withLayout,
  unsized,
}: {
  entries: LocalEntry[];
  rankedCount: number;
  withLayout: number;
  unsized: number;
}) {
  const t = useTranslations("local");
  const locale = useLocale();

  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [storage, setStorage] = useState<"unknown" | "ok" | "off">("unknown");
  const [hydrated, setHydrated] = useState(false);
  const [hints, setHints] = useState<Hints>({ gpu: "checking", memoryGb: "checking" });
  const [importText, setImportText] = useState("");
  const [imported, setImported] = useState<LlmfitImport | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const [applied, setApplied] = useState(false);

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

  // Hints only. Nothing below reads `hints`; it is displayed and that is all.
  useEffect(() => {
    let cancelled = false;
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      gpu?: {
        requestAdapter(): Promise<{
          info?: { vendor?: string; architecture?: string; description?: string };
        } | null>;
      };
    };
    const memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
    const finish = (gpu: Hints["gpu"]) => {
      if (!cancelled) setHints({ gpu, memoryGb });
    };
    if (!nav.gpu) {
      queueMicrotask(() => finish("none"));
    } else {
      nav.gpu
        .requestAdapter()
        .then((adapter) => {
          const info = adapter?.info;
          const name = [info?.vendor, info?.architecture || info?.description]
            .filter(Boolean)
            .join(" ");
          finish(name ? { name } : "none");
        })
        .catch(() => finish("none"));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const hardware = useMemo(() => toHardware(form), [form]);

  const results = useMemo(() => {
    if (!hardware) return null;
    const context = Number(form.context);
    const all: Result[] = entries.map((entry) => ({
      entry,
      fit: analyze(entry.spec, hardware, context),
    }));
    // Order is the model's measured standing. How well it fits is shown, never sorted on.
    const fits = all.filter((r) => r.fit.level !== "too_tight");
    return {
      ranked: fits
        .filter((r) => !r.entry.provisional)
        .sort((a, b) => b.entry.composite - a.entry.composite || byName(a, b)),
      provisional: fits.filter((r) => r.entry.provisional).sort(byName),
      doesNot: all.filter((r) => r.fit.level === "too_tight").sort(byName),
    };
  }, [entries, hardware, form.context]);

  function update(patch: Partial<Form>) {
    setApplied(false);
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

  function readImport(text: string) {
    setImportText(text);
    setApplied(false);
    if (!text.trim()) {
      setImported(null);
      setImportError(null);
      return;
    }
    const parsed = parseLlmfitImport(text);
    if ("error" in parsed) {
      setImported(null);
      setImportError(parsed.error);
    } else {
      setImported(parsed);
      setImportError(null);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) {
      setImported(null);
      setImportError("too_large");
      return;
    }
    readImport(await file.text());
  }

  function applyImport() {
    if (!imported) return;
    const hw = imported.hardware;
    const round = (n: number | null) => (n === null ? "" : String(Math.round(n * 10) / 10));
    if (!hw.hasGpu) {
      update({ kind: "cpu", preset: "custom", ram: round(hw.totalRamGb), memory: "", bandwidth: "" });
    } else if (hw.unified) {
      update({
        kind: "unified",
        preset: "custom",
        memory: round(hw.gpuMemoryGb ?? hw.totalRamGb),
        ram: round(hw.totalRamGb),
        bandwidth: round(hw.gpuBandwidthGbps),
      });
    } else {
      update({
        kind: "discrete",
        preset: "custom",
        memory: round(hw.gpuMemoryGb),
        ram: round(hw.totalRamGb),
        bandwidth: round(hw.gpuBandwidthGbps),
      });
    }
    setApplied(true);
  }

  const inputClass =
    "num min-h-11 w-full rounded-control bg-sunk px-2 py-1 text-xs outline-none sm:min-h-8";

  const field = (id: string, label: string, hint: string | null, input: React.ReactNode) => (
    <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      {input}
      {hint && <p className="text-2xs text-tertiary">{hint}</p>}
    </div>
  );

  const kindOptions: { value: Kind; label: string }[] = [
    { value: "discrete", label: t("hardware.kind_discrete") },
    { value: "unified", label: t("hardware.kind_unified") },
    { value: "cpu", label: t("hardware.kind_cpu") },
  ];

  const renderRow = ({ entry, fit }: Result) => {
    const llmfit = imported?.verdicts.get(entry.spec.hf_repo) ?? null;
    const rank =
      entry.rank === null
        ? "·"
        : `${entry.tied_with > 0 ? "=" : ""}${entry.rank}/${rankedCount}`;
    return (
      <li
        key={entry.spec.model_id}
        className="grid gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="num text-xs text-tertiary" title={t("row.rank")}>
              {rank}
            </span>
            <Link
              href={`/model/${entry.spec.model_id}`}
              className="text-base underline-offset-2 hover:underline"
            >
              {entry.display_name}
            </Link>
          </div>
          <p className="num mt-1 text-xs text-tertiary">
            {t("row.composite")} {fmt(entry.composite, locale)}
            {entry.composite_error !== null && <> ± {fmt(entry.composite_error, locale)}</>}
            {" · "}
            {t("row.coverage", { covered: entry.coverage.covered, total: entry.coverage.total })}
          </p>
        </div>

        <div className="min-w-0 text-sm">
          <span className="eyebrow block">{t("row.fit")}</span>
          <span className="font-semibold">{t(`verdict.${fit.level}`)}</span>
          <p className="text-xs text-tertiary">
            {t(`mode.${fit.mode}`)} · <span className="num">{fit.quant}</span>
          </p>
          {llmfit && (
            <p className="text-2xs text-tertiary">
              {t("row.llmfit")}:{" "}
              {llmfit.level ? t(`verdict.${llmfit.level}`) : "·"}
              {llmfit.mode && <> · {t(`mode.${llmfit.mode}`)}</>}
              {llmfit.quant && <> · <span className="num">{llmfit.quant}</span></>}
            </p>
          )}
          {imported && !llmfit && (
            <p className="text-2xs text-tertiary">{t("row.llmfit")}: ·</p>
          )}
        </div>

        <div className="min-w-0 text-sm">
          <span className="eyebrow block">{t("row.memory")}</span>
          <span className="num">
            {fmt(fit.memoryRequiredGb, locale)} / {fmt(fit.memoryAvailableGb, locale)} GB
            {Number.isFinite(fit.utilization) && <> ({fmt(fit.utilization * 100, locale, 0)}%)</>}
          </span>
          {fit.level !== "too_tight" && (
            <div
              aria-hidden="true"
              className="mt-1 h-1 w-full rounded-inner bg-sunk"
            >
              <div
                className="h-1 rounded-inner bg-mark"
                style={{ width: `${Math.min(fit.utilization, 1) * 100}%` }}
              />
            </div>
          )}
          <p className="num mt-1 text-xs text-tertiary">
            {t("row.speed")}:{" "}
            {fit.tokensPerSecond === null
              ? t("row.speedUnknown")
              : `≈ ${fmt(fit.tokensPerSecond, locale, fit.tokensPerSecond < 10 ? 1 : 0)} ${t("row.speedUnit")}`}
          </p>
          {fit.halvedContext && (
            <p className="text-2xs text-tertiary">
              {t("row.halved", { tokens: fmt(fit.contextTokens, locale, 0) })}
            </p>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <Surface className="flex flex-col gap-4 p-4">
        <h2 className="text-lg leading-tight font-semibold">{t("hardware.title")}</h2>

        <div className="flex flex-col gap-1">
          <span className="eyebrow">{t("hardware.kind")}</span>
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl
              options={kindOptions}
              value={form.kind}
              onChange={(kind) => update({ kind, preset: "custom" })}
              label={t("hardware.kind")}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          {form.kind !== "cpu" &&
            field(
              "local-preset",
              t("hardware.preset"),
              t("hardware.presetNote"),
              <select
                id="local-preset"
                value={form.preset}
                onChange={(event) => choosePreset(event.target.value)}
                className="eyebrow min-h-11 w-full rounded-control border border-line bg-transparent px-1 sm:min-h-8"
              >
                <option value="custom">{t("hardware.presetCustom")}</option>
                {HARDWARE_PRESETS.filter((p) => p.kind === form.kind).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>,
            )}
          {form.kind !== "cpu" &&
            field(
              "local-memory",
              form.kind === "unified" ? t("hardware.pool") : t("hardware.vram"),
              null,
              <input
                id="local-memory"
                inputMode="decimal"
                value={form.memory}
                onChange={(event) => update({ memory: event.target.value, preset: "custom" })}
                className={inputClass}
              />,
            )}
          {form.kind !== "unified" &&
            field(
              "local-ram",
              t("hardware.ram"),
              t("hardware.ramHint"),
              <input
                id="local-ram"
                inputMode="decimal"
                value={form.ram}
                onChange={(event) => update({ ram: event.target.value })}
                className={inputClass}
              />,
            )}
          {form.kind !== "cpu" &&
            field(
              "local-bandwidth",
              t("hardware.bandwidth"),
              t("hardware.bandwidthHint"),
              <input
                id="local-bandwidth"
                inputMode="decimal"
                value={form.bandwidth}
                onChange={(event) => update({ bandwidth: event.target.value, preset: "custom" })}
                className={inputClass}
              />,
            )}
          {field(
            "local-context",
            t("hardware.context"),
            null,
            <select
              id="local-context"
              value={form.context}
              onChange={(event) => update({ context: event.target.value })}
              className="num min-h-11 w-full rounded-control border border-line bg-transparent px-1 text-xs sm:min-h-8"
            >
              {CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {fmt(Number(c), locale, 0)}
                </option>
              ))}
            </select>,
          )}
        </div>

        <div className="border-t border-subtle pt-3 text-xs text-tertiary" aria-live="polite">
          <p className="eyebrow">{t("hints.title")}</p>
          <p className="mt-1">{t("hints.body")}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            <li>
              {hints.gpu === "checking"
                ? t("hints.checking")
                : hints.gpu === "none"
                  ? t("hints.noGpu")
                  : t("hints.gpu", { name: hints.gpu.name })}
            </li>
            <li>
              {hints.memoryGb === "checking"
                ? t("hints.checking")
                : hints.memoryGb === null
                  ? t("hints.noMemory")
                  : t("hints.memory", { gb: hints.memoryGb })}
            </li>
          </ul>
        </div>

        <div className="border-t border-subtle pt-3">
          <p className="eyebrow">{t("import.title")}</p>
          <p className="mt-1 text-xs text-tertiary">{t("import.body")}</p>
          <label htmlFor="local-import" className="eyebrow mt-2 block">
            {t("import.paste")}
          </label>
          <textarea
            id="local-import"
            value={importText}
            onChange={(event) => readImport(event.target.value)}
            rows={4}
            spellCheck={false}
            className="num mt-1 w-full rounded-control bg-sunk px-2 py-1 text-xs outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label htmlFor="local-import-file" className="eyebrow">
              {t("import.file")}
            </label>
            <input
              id="local-import-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void readFile(event.target.files?.[0])}
              className="text-xs"
            />
            <button
              type="button"
              disabled={!imported}
              onClick={applyImport}
              className="control eyebrow min-h-11 sm:min-h-8"
            >
              {t("import.apply")}
            </button>
            <button
              type="button"
              disabled={!importText}
              onClick={() => readImport("")}
              className="control eyebrow min-h-11 sm:min-h-8"
            >
              {t("import.clear")}
            </button>
          </div>
          <p className="mt-2 text-xs text-tertiary" role="status">
            {importError && t(`import.error_${importError}`)}
            {imported && !importError && (applied
              ? t("import.applied")
              : t("import.ok", { models: imported.verdicts.size }))}
          </p>
          <p className="mt-1 text-2xs text-tertiary">
            {storage === "off" ? t("import.storageOff") : t("import.stored")}
          </p>
        </div>
      </Surface>

      {results === null ? (
        <p className="text-base text-tertiary" role="status">
          {t("hardware.invalid")}
        </p>
      ) : (
        <>
          <section aria-labelledby="local-fits">
            <h2 id="local-fits" className="text-lg leading-tight font-semibold">
              {t("results.fits")}
            </h2>
            {results.ranked.length === 0 ? (
              <p className="mt-2 text-base text-tertiary">{t("results.fitsEmpty")}</p>
            ) : (
              <Surface as="ul" inset className="mt-3">
                {results.ranked.map(renderRow)}
              </Surface>
            )}
          </section>

          {results.provisional.length > 0 && (
            <section aria-labelledby="local-provisional">
              <h2 id="local-provisional" className="text-lg leading-tight font-semibold">
                {t("results.provisional")}
              </h2>
              <p className="mt-1 text-xs text-tertiary">{t("results.provisionalNote")}</p>
              <Surface as="ul" inset className="mt-3">
                {results.provisional.map(renderRow)}
              </Surface>
            </section>
          )}

          {results.doesNot.length > 0 && (
            <details className="group">
              <summary className="eyebrow cursor-pointer py-2">
                {t("results.doesNot")} · {t("results.doesNotCount", { count: results.doesNot.length })}
              </summary>
              <Surface as="ul" inset className="mt-2">
                {results.doesNot.map(({ entry, fit }) => (
                  <li
                    key={entry.spec.model_id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2 text-sm"
                  >
                    <Link
                      href={`/model/${entry.spec.model_id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {entry.display_name}
                    </Link>
                    <span className="num text-xs text-tertiary">
                      {t("results.needs", { gb: fmt(fit.memoryRequiredGb, locale) })}
                    </span>
                  </li>
                ))}
              </Surface>
            </details>
          )}
        </>
      )}

      <section className="text-xs leading-[1.6] text-tertiary">
        <h2 className="eyebrow">{t("notes.title")}</h2>
        <ul className="mt-1 flex flex-col gap-1">
          <li>{t("notes.estimates")}</li>
          <li>{t("notes.moe")}</li>
          <li>{t("notes.layout", { withLayout, total: entries.length })}</li>
          <li>{t("notes.unsized", { count: unsized })}</li>
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
