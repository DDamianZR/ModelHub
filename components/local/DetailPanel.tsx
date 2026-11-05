"use client";

import type { Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { RUNTIME_OVERHEAD_GB, kvCacheGb, quantBpp } from "@/lib/fit";
import type { ImportedVerdict } from "@/lib/llmfit-import";
import { runsHere, speedTier, type Result } from "@/lib/local-view";
import { billions, fmt } from "./form";
import { HuggingFaceLink } from "./ModelCard";

/**
 * One model, opened up: where its memory goes, how it would run, what ModelHub knows about it
 * and what it does not, and the way out to its page on Hugging Face. The memory breakdown is
 * shown only when the three parts add up to the figure the verdict used; where the catalogue's
 * own minimum was used instead (mixture-of-experts paths) it says so rather than invent parts.
 */
export function DetailPanel({
  result,
  rankedCount,
  llmfit,
  hasImport,
  headingRef,
}: {
  result: Result;
  rankedCount: number;
  llmfit: ImportedVerdict | null;
  hasImport: boolean;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const t = useTranslations("local");
  const locale = useLocale();
  const { entry, fit } = result;
  const { spec } = entry;
  const runs = runsHere(result);
  const tier = speedTier(fit.tokensPerSecond);
  const rank =
    entry.rank === null ? null : `${entry.tied_with > 0 ? "=" : ""}${entry.rank}/${rankedCount}`;

  const weights = (spec.parameters_raw / 1e9) * quantBpp(fit.quant);
  const kv = kvCacheGb(spec, fit.contextTokens);
  const total = weights + kv + RUNTIME_OVERHEAD_GB;
  const additive = Math.abs(total - fit.memoryRequiredGb) < 0.05;
  const parts = [
    { key: "weights", gb: weights, opacity: 1 },
    { key: "kv", gb: kv, opacity: 0.6 },
    { key: "overhead", gb: RUNTIME_OVERHEAD_GB, opacity: 0.3 },
  ] as const;
  // Where each segment starts, as a share of the whole bar.
  const starts = parts.map((_, i) => (parts.slice(0, i).reduce((sum, p) => sum + p.gb, 0) / total) * 100);

  const compact = (n: number) => new Intl.NumberFormat(locale, { notation: "compact" }).format(n);

  const fact = (label: string, value: string) => (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="num m-0 text-sm text-primary">{value}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 ref={headingRef} tabIndex={-1} className="text-xl leading-tight font-semibold break-words outline-none">
            {entry.display_name}
          </h3>
          <p className="num mt-1 text-xs text-tertiary">{spec.hf_repo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HuggingFaceLink href={entry.hf_url} label={t("card.hf")} />
          {entry.measured && (
            <Link href={`/model/${spec.model_id}`} className="control min-h-11 sm:min-h-8">
              {t("detail.modelhub")}
            </Link>
          )}
        </div>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {fact(
          t("detail.parameters"),
          spec.is_moe && spec.active_parameters
            ? t("detail.parametersMoe", {
                total: billions(spec.parameters_raw, locale),
                active: billions(spec.active_parameters, locale),
              })
            : billions(spec.parameters_raw, locale),
        )}
        {fact(t("detail.window"), fmt(spec.context_length, locale, 0))}
        {fact(t("detail.license"), spec.license ?? "·")}
        {fact(t("detail.hub"), entry.hf_downloads === null ? "·" : t("detail.downloads", { amount: compact(entry.hf_downloads) }))}
      </dl>

      <p className="text-sm leading-[1.6] text-tertiary">
        {entry.measured && entry.composite !== null ? (
          <>
            <span className="num text-primary">
              {t("row.composite")} {fmt(entry.composite, locale)}
              {entry.composite_error !== null && <> ± {fmt(entry.composite_error, locale)}</>}
            </span>
            {" · "}
            {rank ? `${t("row.rank")} ${rank}` : t("card.provisional")}
            {entry.coverage &&
              ` · ${t("row.coverage", { covered: entry.coverage.covered, total: entry.coverage.total })}`}
          </>
        ) : (
          t("detail.unmeasured")
        )}
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="eyebrow">{t("detail.how")}</p>
          <p className="mt-1 text-md font-semibold">{t(`verdict.${fit.level}`)}</p>
          {runs ? (
            <p className="mt-0.5 text-sm text-tertiary">
              {t(`mode.${fit.mode}`)} · <span className="num">{fit.quant}</span> ·{" "}
              {t("detail.atContext", { tokens: fmt(fit.contextTokens, locale, 0) })}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-tertiary">
              {t("results.needs", { gb: fmt(fit.memoryRequiredGb, locale) })} ·{" "}
              {t("card.short", { gb: fmt(Math.max(fit.memoryRequiredGb - fit.memoryAvailableGb, 0), locale) })}
            </p>
          )}
          {runs && (
            <p className="num mt-2 text-sm">
              {fit.tokensPerSecond === null ? (
                <span className="text-tertiary">
                  {t("row.speed")}: {t("row.speedUnknown")}
                </span>
              ) : (
                <>
                  <span className="text-xl font-semibold">
                    ≈ {fmt(fit.tokensPerSecond, locale, fit.tokensPerSecond < 10 ? 1 : 0)}
                  </span>{" "}
                  <span className="text-tertiary">
                    {t("row.speedUnit")} · {t(`tier.${tier}`)}
                  </span>
                </>
              )}
            </p>
          )}
          {fit.offloadedRamGb !== null && (
            <p className="num mt-1 text-xs text-tertiary">
              {t("detail.offloaded", { gb: fmt(fit.offloadedRamGb, locale) })}
            </p>
          )}
          {fit.halvedContext && runs && (
            <p className="mt-1 text-xs text-tertiary">{t("row.halved", { tokens: fmt(fit.contextTokens, locale, 0) })}</p>
          )}
          {hasImport && (
            <p className="mt-2 text-xs text-tertiary">
              {t("row.llmfit")}: {llmfit?.level ? t(`verdict.${llmfit.level}`) : "·"}
              {llmfit?.mode && <> · {t(`mode.${llmfit.mode}`)}</>}
              {llmfit?.quant && (
                <>
                  {" · "}
                  <span className="num">{llmfit.quant}</span>
                </>
              )}
            </p>
          )}
        </div>

        <div>
          <p className="eyebrow">{t("detail.breakdown")}</p>
          <p className="num mt-1 text-sm">
            <span className="text-md font-semibold">{fmt(fit.memoryRequiredGb, locale)}</span>{" "}
            <span className="text-tertiary">
              / {fmt(fit.memoryAvailableGb, locale)} GB
              {Number.isFinite(fit.utilization) && ` (${fmt(fit.utilization * 100, locale, 0)}%)`}
            </span>
          </p>
          {additive ? (
            <>
              <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-2 block h-1.5 w-full" aria-hidden="true">
                <rect width="100" height="6" rx="3" fill="var(--surface-sunk)" />
                {parts.map((part, i) => (
                  <rect
                    key={part.key}
                    x={starts[i]}
                    width={(part.gb / total) * 100}
                    height="6"
                    fill="var(--mark)"
                    opacity={part.opacity}
                  />
                ))}
              </svg>
              <dl className="num m-0 mt-2 flex flex-col gap-0.5 text-xs">
                {parts.map((part) => (
                  <div key={part.key} className="flex justify-between gap-4">
                    <dt className="text-tertiary">{t(`detail.${part.key}`)}</dt>
                    <dd className="m-0">{fmt(part.gb, locale, 2)} GB</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="mt-2 text-xs leading-[1.6] text-tertiary">{t("detail.catalogueMinimum")}</p>
          )}
        </div>
      </div>

      <p className="text-2xs text-tertiary">
        <Link href="/methodology#local" className="underline underline-offset-2">
          {t("notes.method")}
        </Link>
      </p>
    </div>
  );
}
