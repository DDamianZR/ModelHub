"use client";

import clsx from "clsx";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ImportedVerdict } from "@/lib/llmfit-import";
import { runsHere, speedTier, type Result } from "@/lib/local-view";
import { billions, fmt } from "./form";

/** The outbound link to the repo: always the same wording, always opens a new tab safely. */
export function HuggingFaceLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] hover:opacity-90 sm:min-h-8",
        className,
      )}
    >
      {label}
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 2h6v6M10 2 3 9" />
      </svg>
    </a>
  );
}

/**
 * One model on this machine. A model that runs shows how, how fast and how much memory it
 * takes; one that does not shows how much it would need instead, because that is the part
 * worth knowing. Models ModelHub measures carry their composite and rank; the rest say they
 * are not measured and show no figure in its place.
 */
export function ModelCard({
  result,
  rankedCount,
  selected,
  llmfit,
  hasImport,
  onDetail,
}: {
  result: Result;
  rankedCount: number;
  selected: boolean;
  llmfit: ImportedVerdict | null;
  hasImport: boolean;
  onDetail: (id: string) => void;
}) {
  const t = useTranslations("local");
  const locale = useLocale();
  const { entry, fit } = result;
  const { spec } = entry;
  const runs = runsHere(result);
  const tier = speedTier(fit.tokensPerSecond);
  const rank =
    entry.rank === null ? null : `${entry.tied_with > 0 ? "=" : ""}${entry.rank}/${rankedCount}`;
  const short = Math.max(fit.memoryRequiredGb - fit.memoryAvailableGb, 0);

  return (
    <li
      className={clsx(
        "surface flex min-w-0 flex-col gap-3 p-4",
        selected && "outline-2 outline-offset-0 outline-[var(--mark)]",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-md leading-tight font-semibold break-words">
            {entry.measured ? (
              <Link href={`/model/${spec.model_id}`} className="underline-offset-2 hover:underline">
                {entry.display_name}
              </Link>
            ) : (
              entry.display_name
            )}
          </h3>
          <span className="num shrink-0 text-xs text-tertiary">{billions(spec.parameters_raw, locale)}</span>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-tertiary">
          {spec.is_moe && (
            <span>
              {spec.active_parameters
                ? t("card.moeActive", { active: billions(spec.active_parameters, locale) })
                : t("card.moe")}
            </span>
          )}
          {entry.modality === "vision" && <span>{t("card.vision")}</span>}
          {spec.license && <span>{spec.license}</span>}
        </p>
      </div>

      <div className="text-xs">
        {entry.measured && entry.composite !== null ? (
          <p className="num text-primary">
            {t("row.composite")} {fmt(entry.composite, locale)}
            {entry.composite_error !== null && <> ± {fmt(entry.composite_error, locale)}</>}
            <span className="text-tertiary">
              {" · "}
              {rank ? `${t("row.rank")} ${rank}` : t("card.provisional")}
              {entry.coverage &&
                ` · ${t("row.coverage", { covered: entry.coverage.covered, total: entry.coverage.total })}`}
            </span>
          </p>
        ) : (
          <p className="text-tertiary">{t("card.unmeasured")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm">
          <span className="font-semibold">{t(`verdict.${fit.level}`)}</span>
          {runs && (
            <span className="text-tertiary">
              {" · "}
              {t(`mode.${fit.mode}`)} · <span className="num">{fit.quant}</span>
            </span>
          )}
        </p>
        <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="block h-1 w-full" aria-hidden="true">
          <rect width="100" height="4" rx="2" fill="var(--surface-sunk)" />
          {runs && <rect width={Math.min(fit.utilization, 1) * 100} height="4" rx="2" fill="var(--mark)" />}
        </svg>
        <p className="num text-xs text-tertiary">
          {runs ? (
            <>
              {fmt(fit.memoryRequiredGb, locale)} / {fmt(fit.memoryAvailableGb, locale)} GB
              {Number.isFinite(fit.utilization) && <> ({fmt(fit.utilization * 100, locale, 0)}%)</>}
            </>
          ) : (
            <>
              {t("results.needs", { gb: fmt(fit.memoryRequiredGb, locale) })} · {t("card.short", { gb: fmt(short, locale) })}
            </>
          )}
        </p>
        {runs && (
          <p className="num text-sm">
            {fit.tokensPerSecond === null ? (
              <span className="text-xs text-tertiary">
                {t("row.speed")}: {t("row.speedUnknown")}
              </span>
            ) : (
              <>
                <span className="font-semibold">
                  ≈ {fmt(fit.tokensPerSecond, locale, fit.tokensPerSecond < 10 ? 1 : 0)} {t("row.speedUnit")}
                </span>
                <span className="text-xs text-tertiary"> · {t(`tier.${tier}`)}</span>
              </>
            )}
          </p>
        )}
        {fit.halvedContext && runs && (
          <p className="text-2xs text-tertiary">{t("row.halved", { tokens: fmt(fit.contextTokens, locale, 0) })}</p>
        )}
        {hasImport && (
          <p className="text-2xs text-tertiary">
            {t("row.llmfit")}:{" "}
            {llmfit?.level ? t(`verdict.${llmfit.level}`) : "·"}
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

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <HuggingFaceLink href={entry.hf_url} label={t("card.hf")} />
        <button
          type="button"
          onClick={() => onDetail(spec.model_id)}
          className="control min-h-11 sm:min-h-8"
          aria-label={t("card.detailFor", { name: entry.display_name })}
        >
          {t("card.detail")}
        </button>
      </div>
    </li>
  );
}
