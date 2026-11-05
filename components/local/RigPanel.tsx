"use client";

import { useLocale, useTranslations } from "next-intl";
import { SegmentedControl } from "@/components/SegmentedControl";
import { HARDWARE_PRESETS } from "@/lib/fit";
import { GPU_STOPS, RAM_STOPS, UNIFIED_STOPS } from "@/lib/local-view";
import { CONTEXTS, fmt, type Form, type Kind } from "./form";
import { StopSlider } from "./StopSlider";

/**
 * The machine, as controls: layout of memory, GPU memory and RAM on sliders that rest on
 * real sizes, and the context window. Presets only fill numbers in; none is marked as a
 * default or a recommendation, and they stay in alphabetical order.
 */
export function RigPanel({
  form,
  update,
  choosePreset,
}: {
  form: Form;
  update: (patch: Partial<Form>) => void;
  choosePreset: (id: string) => void;
}) {
  const t = useTranslations("local");
  const locale = useLocale();

  const kindOptions: { value: Kind; label: string }[] = [
    { value: "discrete", label: t("hardware.kind_discrete") },
    { value: "unified", label: t("hardware.kind_unified") },
    { value: "cpu", label: t("hardware.kind_cpu") },
  ];
  const contextOptions = CONTEXTS.map((c) => ({
    value: c,
    label: `${fmt(Number(c) / 1024, locale, 0)}K`,
  }));

  const wantsBandwidth = form.kind !== "cpu" && form.bandwidth.trim() === "";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">{t("hardware.kind")}</span>
          <div className="no-scrollbar relative max-w-full overflow-x-auto">
            <SegmentedControl
              options={kindOptions}
              value={form.kind}
              onChange={(kind) => {
                // Opening a layout with nothing in it would show an error before a result;
                // a neutral starting size keeps the page answering while it is adjusted.
                const memory =
                  kind === "cpu" || form.memory.trim() !== ""
                    ? form.memory
                    : kind === "unified"
                      ? "16"
                      : "8";
                update({ kind, preset: "custom", memory });
              }}
              label={t("hardware.kind")}
            />
          </div>
        </div>

        {form.kind !== "cpu" && (
          <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <label htmlFor="local-preset" className="eyebrow">
              {t("hardware.preset")}
            </label>
            <select
              id="local-preset"
              value={form.preset}
              onChange={(event) => choosePreset(event.target.value)}
              className="min-h-11 w-full rounded-control border border-line bg-transparent px-2 text-xs sm:min-h-8"
            >
              <option value="custom">{t("hardware.presetCustom")}</option>
              {HARDWARE_PRESETS.filter((p) => p.kind === form.kind).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-5">
        {form.kind !== "cpu" && (
          <StopSlider
            id="local-memory"
            label={form.kind === "unified" ? t("hardware.pool") : t("hardware.vram")}
            stops={form.kind === "unified" ? UNIFIED_STOPS : GPU_STOPS}
            value={form.memory}
            onChange={(memory) => update({ memory, preset: "custom" })}
          />
        )}
        {form.kind !== "unified" && (
          <StopSlider
            id="local-ram"
            label={t("hardware.ram")}
            stops={RAM_STOPS}
            value={form.ram}
            onChange={(ram) => update({ ram })}
            hint={t("hardware.ramHint")}
          />
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        {form.kind !== "cpu" && (
          <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <label htmlFor="local-bandwidth" className="eyebrow">
              {t("hardware.bandwidth")}
            </label>
            <input
              id="local-bandwidth"
              inputMode="decimal"
              value={form.bandwidth}
              onChange={(event) => update({ bandwidth: event.target.value, preset: "custom" })}
              className="num min-h-11 w-full rounded-control bg-sunk px-2 py-1 text-xs outline-none sm:min-h-8"
            />
            <p className="text-2xs text-tertiary">
              {wantsBandwidth ? t("hardware.bandwidthMissing") : t("hardware.bandwidthHint")}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="eyebrow">{t("hardware.context")}</span>
          <div className="no-scrollbar relative max-w-full overflow-x-auto">
            <SegmentedControl
              options={contextOptions}
              value={form.context}
              onChange={(context) => update({ context })}
              label={t("hardware.context")}
            />
          </div>
        </div>
      </div>

      {form.kind !== "cpu" && <p className="text-2xs text-tertiary">{t("hardware.presetNote")}</p>}
    </div>
  );
}
