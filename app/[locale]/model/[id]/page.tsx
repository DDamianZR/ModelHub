import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CategoryBars } from "@/components/CategoryBars";
import { CoverageMeter } from "@/components/CoverageMeter";
import { Fee, Price } from "@/components/CurrencyProvider";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { Sparkline } from "@/components/Sparkline";
import { Surface } from "@/components/Surface";
import {
  getAcquisition,
  getAdjacentModels,
  getBestBy,
  getFx,
  getModelDetail,
  getModelIds,
  getPlansFor,
  getRanking,
} from "@/lib/data";
import { formatRate } from "@/lib/currency";
import { routing } from "@/i18n/routing";
import { CATEGORIES } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/site-url";
import { orderPair } from "@/lib/views";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getModelIds().map((id) => ({ locale, id })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const detail = getModelDetail(id);
  if (!detail) return {};
  const t = await getTranslations({ locale, namespace: "model" });
  const name = detail.model.display_name;
  return pageMetadata({
    locale,
    path: `/model/${id}`,
    title: `${t("metaTitle", { name })} · ModelHub`,
    description: t("metaDescription", { name, provider: detail.model.provider_name }),
    ownCard: true,
  });
}

/** Section ids are also the anchor targets used by the rail in the right column. */
const SECTIONS = ["description", "categories", "cost", "history", "sources", "acquisition"] as const;

export default async function ModelPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const detail = getModelDetail(id);
  if (!detail) notFound();

  const { model, scores, history, description } = detail;
  const { links, checkedAt, withheld } = getAcquisition(id);
  const adjacent = getAdjacentModels(id);
  const fx = getFx();
  const plans = getPlansFor(id);
  const blend = getBestBy().meta.price_blend;
  const pricing = model.pricing ?? null;
  const t = await getTranslations("model");
  const tt = await getTranslations("table");

  // What this page is, for crawlers: which benchmarks it reports for the model and where
  // they came from. No score is repeated here; a figure copied into structured data is one
  // more place for it to be read without its date.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: t("metaTitle", { name: model.display_name }),
    description: t("metaDescription", { name: model.display_name, provider: model.provider_name }),
    url: `${siteUrl()}/${locale}/model/${id}`,
    inLanguage: locale,
    dateModified: getRanking().meta.generated_at,
    creator: { "@type": "Organization", name: "ModelHub", url: siteUrl() },
    isBasedOn: [...new Set(scores.map((score) => score.source_url))],
    variableMeasured: [...new Set(scores.map((score) => score.benchmark?.name ?? score.benchmark_id))],
  };
  const tui = await getTranslations("ui");

  const partial = model.coverage.covered < model.coverage.total;
  const text = locale === "es" ? description?.es : description?.en;

  const trend = history.map((point) => point.value);
  const trendMin = trend.length ? Math.min(...trend) : 0;
  const trendMax = trend.length ? Math.max(...trend) : 0;
  const normalised =
    trend.length < 2
      ? []
      : trend.map((value) =>
          trendMax === trendMin ? 0.5 : (value - trendMin) / (trendMax - trendMin),
        );

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="ranking" />
      <JsonLd data={jsonLd} />

      <nav
        className="mt-6 flex items-center justify-between gap-4"
        aria-label={tui("modelNav")}
      >
        {adjacent.prev ? (
          <Link
            href={`/model/${adjacent.prev.id}`}
            className="eyebrow row-shift hover:text-primary"
          >
            ← {adjacent.prev.display_name}
          </Link>
        ) : (
          <span />
        )}
        {adjacent.next ? (
          <Link
            href={`/model/${adjacent.next.id}`}
            className="eyebrow row-shift hover:text-primary"
          >
            {adjacent.next.display_name} →
          </Link>
        ) : (
          <span />
        )}
      </nav>

      {/* Static head-to-head pages with the models either side in the ranking. Neighbours
          by rank, never chosen by who the model is. */}
      {(adjacent.prev || adjacent.next) && (
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {[adjacent.prev, adjacent.next].map((other) =>
            other ? (
              <Link
                key={other.id}
                href={`/vs/${orderPair(id, other.id)[0]}/${orderPair(id, other.id)[1]}`}
                className="py-1 text-accent underline underline-offset-2"
              >
                {t("compareWith", { name: other.display_name })}
              </Link>
            ) : null,
          )}
        </p>
      )}

      {/* Two columns at lg. The single 52rem column left 60% of a desktop viewport
          empty; the rail fills it with the figures a reader scrolls back up for. */}
      <div className="mt-4 lg:grid lg:grid-cols-[1fr_18rem] lg:items-start lg:gap-12">
        <article>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">
              {model.display_name}
            </h1>
            {model.is_open_weights ? (
              <span className="eyebrow rounded-inner bg-sunk px-1.5 py-0.5 text-tertiary">
                {tt("openWeights")}
              </span>
            ) : (
              <span className="eyebrow text-tertiary">{tt("apiOnly")}</span>
            )}
            {model.provisional && (
              <span className="eyebrow text-attention">{tt("provisionalTitle")}</span>
            )}
          </div>

          <p className="num mt-1 text-xs text-tertiary">
            <Link
              href={`/provider/${model.provider_id}`}
              className="underline-offset-2 hover:text-primary hover:underline"
            >
              {model.provider_name}
            </Link>
            {model.country ? ` · ${model.country}` : ""}
            {model.release_date ? ` · ${model.release_date}` : ""}
          </p>

          {/* Which published configuration every number below describes. Stated because
              the sources disagree about it more often than not: 24 of 57 models carry a
              human preference rating measured on a variant their benchmarks don't use. */}
          {model.variant && (
            <p className="note mt-4 text-xs leading-[1.6]">
              <span className="eyebrow">{t("configuration")}</span>{" "}
              {model.variant === "plain"
                ? t("configurationPlain")
                : t("configurationNote", { variant: model.variant })}
              {model.human_preference_variant && (
                <>
                  {" "}
                  {t("configurationMismatch", {
                    variant: model.variant,
                    measured: model.human_preference_variant,
                  })}
                </>
              )}
            </p>
          )}

          {/* Layer B fills this in. Until then the empty state says so plainly rather
              than showing invented prose that would read as real. */}
          <section id="description" className="mt-8 scroll-mt-6">
            <h2 className="eyebrow mb-2">{t("description")}</h2>
            <Surface className="p-4">
              {text ? (
                <>
                  <p className="text-md leading-[1.65]">{text}</p>
                  {description?.manual ? (
                    <p className="num mt-2 text-2xs text-tertiary">
                      {t("descriptionManual")}
                    </p>
                  ) : description?.generated_at ? (
                    <p className="num mt-2 text-2xs text-tertiary">
                      {t("descriptionGenerated", {
                        date: description.generated_at,
                        model: description.generated_by ?? "?",
                      })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-tertiary">{t("descriptionPending")}</p>
              )}
            </Surface>
          </section>

          <section id="categories" className="mt-8 scroll-mt-6">
            <h2 className="eyebrow mb-3">{t("categories")}</h2>
            <Surface className="p-4">
              <CategoryBars
                emptyLabel={tt("noData")}
                rows={CATEGORIES.map((category) => ({
                  label: tt(category),
                  value: model.category_scores[category],
                }))}
              />
              {partial && (
                <p className="mt-3 text-xs text-tertiary">
                  {t("partialNote", {
                    missing: model.coverage.missing
                      .map((key) => tt(key as (typeof CATEGORIES)[number]))
                      .join(", "),
                  })}
                </p>
              )}
            </Surface>
          </section>

          {/* What the interval is and what it is not. It is a floor: sources that publish
              no error contribute nothing to it, so the true interval can only be wider. */}
          <p className="mt-4 text-xs leading-[1.6] text-tertiary">
            {model.composite_error === null
              ? t("uncertaintyNone")
              : t("uncertaintyNote", {
                  error: model.composite_error.toFixed(2),
                  measured: model.uncertainty.measured_inputs,
                  total: model.uncertainty.total_inputs,
                })}
            {model.tied_with > 0 && ` ${t("uncertaintyTied", { count: model.tied_with })}`}
          </p>

          {/* Moved without being voted on differently. Said out loud so the reader does
              not read a scale change as a change in the model. */}
          {model.cohort_recalibration && (
            <p className="note note-accent mt-4 text-xs leading-[1.6]">
              {t("recalibration", {
                normalized: model.cohort_recalibration.normalized_delta.toFixed(2),
                raw: model.cohort_recalibration.raw_delta.toFixed(2),
                composite: model.cohort_recalibration.composite_effect.toFixed(2),
                threshold: model.cohort_recalibration.threshold.toFixed(2),
              })}
            </p>
          )}

          {/* What it costs to use through an API, from the router catalogue, and which subscription
              plans are on record. Neither can move a score; both say where they came from and
              when, and a missing price is stated as missing, never shown as free. */}
          <section id="cost" className="mt-8 scroll-mt-6">
            <h2 className="eyebrow mb-2">{t("cost")}</h2>
            <Surface className="p-4">
              {pricing ? (
                <>
                  <dl className="num grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                    <div>
                      <dd className="m-0 text-lg font-semibold leading-none text-primary">
                        <Price usd={pricing.input_usd_per_m} />
                      </dd>
                      <dt className="mt-1 text-2xs text-tertiary">{t("costInput")}</dt>
                    </div>
                    <div>
                      <dd className="m-0 text-lg font-semibold leading-none text-primary">
                        <Price usd={pricing.output_usd_per_m} />
                      </dd>
                      <dt className="mt-1 text-2xs text-tertiary">{t("costOutput")}</dt>
                    </div>
                    <div>
                      <dd className="m-0 text-lg font-semibold leading-none text-primary">
                        <Price usd={model.blended_price_usd_per_m ?? null} />
                      </dd>
                      <dt className="mt-1 text-2xs text-tertiary">
                        {t("costBlended", { input: blend.input, output: blend.output })}
                      </dt>
                    </div>
                    <div>
                      <dd className="m-0 text-lg font-semibold leading-none text-primary">
                        {model.context_window === null
                          ? "·"
                          : model.context_window.toLocaleString("en-US")}
                      </dd>
                      <dt className="mt-1 text-2xs text-tertiary">{t("costContext")}</dt>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-[1.6] text-tertiary">
                    {t("costNote", { date: pricing.measured_at })}{" "}
                    <a
                      href={pricing.source_url}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="text-accent underline underline-offset-2"
                    >
                      {t("costSource")}
                    </a>
                  </p>
                  {model.is_open_weights && (
                    <p className="mt-2 text-xs leading-[1.6] text-tertiary">{t("costOpenWeights")}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-tertiary">{t("costUnpriced")}</p>
              )}
              {fx && (
                <p className="mt-2 text-xs leading-[1.6] text-tertiary">
                  {t("costFx", { rate: formatRate(fx.mxn), date: fx.date })}
                </p>
              )}

              <h3 className="eyebrow mt-5 mb-2">{t("plans")}</h3>
              {plans.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {plans.map((plan) => (
                    <li key={plan.id} className="text-sm">
                      <span className="font-medium text-primary">{plan.name}</span>
                      <span className="num ml-2 text-xs text-tertiary">
                        {plan.price_usd_per_month === null ? (
                          t("planNoFee")
                        ) : (
                          <>
                            <Fee usd={plan.price_usd_per_month} /> {t("planPerMonth")}
                          </>
                        )}
                        {" · "}
                        {t("planVerified", { date: plan.verified_at })}
                        {" · "}
                        <a
                          href={plan.source_url}
                          rel="noopener noreferrer"
                          target="_blank"
                          className="text-accent underline underline-offset-2"
                        >
                          {t("planSource")}
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-tertiary">{t("plansNone")}</p>
              )}
              <p className="mt-2 text-xs leading-[1.6] text-tertiary">{t("plansNote")}</p>
            </Surface>
          </section>

          <section id="history" className="mt-8 scroll-mt-6">
            <h2 className="eyebrow mb-2">{t("history")}</h2>
            <Surface className="p-4">
              {normalised.length >= 2 ? (
                <>
                  <div className="flex items-center gap-3">
                    <Sparkline
                      points={normalised}
                      label={`${model.display_name} — ${tt("trend")}`}
                      directionLabel={{ up: tt("trendUp"), down: tt("trendDown") }}
                    />
                    <span className="num text-xs text-tertiary">
                      {trendMin.toFixed(0)} → {trendMax.toFixed(0)}
                    </span>
                  </div>
                  <p className="num mt-2 text-2xs text-tertiary">
                    {t("historyRange", {
                      from: history[0].date,
                      to: history[history.length - 1].date,
                      points: history.length,
                    })}
                  </p>
                </>
              ) : (
                <p className="text-sm text-tertiary">{tt("noHistory")}</p>
              )}
              <p className="mt-3 text-xs text-tertiary">{t("historyScope")}</p>
              <p className="mt-2 text-xs text-tertiary">{t("historyBreaks")}</p>
            </Surface>
          </section>

          <section id="sources" className="mt-8 scroll-mt-6">
            <h2 className="eyebrow mb-2">{t("sources")}</h2>
            <Surface
              className="relative overflow-x-auto p-2"
              role="region"
              aria-label={t("sources")}
              tabIndex={0}
            >
              <table className="w-full min-w-[38rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-subtle">
                    <th scope="col" className="py-2 pr-3">
                      <span className="eyebrow">{t("benchmark")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      <span className="eyebrow">{t("value")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      <span className="eyebrow">{t("sourceType")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      <span className="eyebrow">{t("measuredAt")}</span>
                    </th>
                    <th scope="col" className="py-2">
                      <span className="eyebrow">{t("link")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((score) => (
                    <tr key={score.benchmark_id} className="border-b border-subtle">
                      <th scope="row" className="py-2 pr-3 text-sm font-normal">
                        {score.benchmark?.name ?? score.benchmark_id}
                        {score.notes && (
                          <span className="num block text-2xs text-tertiary">
                            {score.notes}
                          </span>
                        )}
                        {score.variant_mismatch && (
                          <span className="block text-2xs text-attention">
                            {t("scoreVariantMismatch", {
                              measured: score.variant_mismatch,
                              name: score.measured_name ?? "",
                              variant: model.variant ?? "",
                            })}
                          </span>
                        )}
                        {score.contamination_flag &&
                          score.contamination_evidence?.map((entry) => (
                            <span key={entry.evidence_url} className="block text-2xs text-attention">
                              {t("contaminationFlag", {
                                date: entry.noted_at,
                                note: entry.note,
                              })}{" "}
                              <a
                                href={entry.evidence_url}
                                rel="noopener noreferrer"
                                target="_blank"
                                className="underline underline-offset-2"
                              >
                                {t("contaminationLink")}
                              </a>
                            </span>
                          ))}
                      </th>
                      <td className="num py-2 pr-3 text-right text-sm">
                        {score.value.toFixed(score.unit === "percent" ? 1 : 0)}
                        <span className="text-2xs text-tertiary">
                          {score.unit === "percent" ? "%" : ""}
                        </span>
                        {/* Empty where the source publishes no error, never rendered as
                            zero: LiveBench ships none, and a blank says so honestly. */}
                        <span className="block text-2xs text-tertiary">
                          {score.half_width_95 !== null && score.half_width_95 !== undefined
                            ? `± ${score.half_width_95.toFixed(2)}`
                            : t("errorNotPublished")}
                        </span>
                      </td>
                      <td className="num py-2 pr-3 text-2xs text-tertiary">
                        {score.source_type}
                      </td>
                      <td className="num py-2 pr-3 text-2xs text-tertiary">
                        {score.measured_at ?? "—"}
                      </td>
                      <td className="py-2 text-2xs">
                        <a
                          href={score.source_url}
                          rel="noopener noreferrer"
                          target="_blank"
                          className="inline-block py-[6px] text-accent underline underline-offset-2"
                        >
                          {score.benchmark?.source ?? t("link")}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Surface>
          </section>

          <section id="acquisition" className="mt-8 scroll-mt-6">
            <h2 className="eyebrow mb-2">{t("acquisition")}</h2>
            <Surface className="p-4">
              {links.length > 0 ? (
                <>
                  <ul className="flex flex-col gap-1">
                    {links.map((link) => (
                      <li key={link.field} className="text-sm">
                        <span className="eyebrow mr-2">{t(`link_${link.field}`)}</span>
                        <a
                          href={link.url}
                          rel="noopener noreferrer"
                          target="_blank"
                          className="inline-block py-[5px] text-accent underline underline-offset-2"
                        >
                          {link.url.replace(/^https?:\/\//, "")}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="num mt-2 text-2xs text-tertiary">
                    {t("acquisitionChecked", { date: checkedAt ?? "—" })}
                    {withheld > 0 ? ` · ${t("acquisitionWithheld", { count: withheld })}` : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm text-tertiary">{t("acquisitionPending")}</p>
              )}
            </Surface>
          </section>
        </article>

        <aside className="mt-8 lg:sticky lg:top-8 lg:mt-2">
          <Surface className="flex flex-col gap-4 p-4">
            <dl className="flex flex-col gap-4">
              <div>
                <dt className="eyebrow">{tt("composite")}</dt>
                <dd className="num text-xl">
                  {model.composite.toFixed(1)}
                  <span className="ml-1 text-sm text-tertiary">
                    {model.composite_error === null
                      ? "±?"
                      : `±${model.composite_error.toFixed(2)}`}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="eyebrow">{tt("rank")}</dt>
                <dd className="num text-xl">
                  {model.rank ?? "—"}
                  {model.tied_with > 0 && (
                    <span className="ml-1 text-sm text-tertiary">
                      {t("tiedShort", { count: model.tied_with })}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">{tt("coverage")}</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <CoverageMeter
                    covered={model.coverage.covered}
                    total={model.coverage.total}
                    label={
                      partial
                        ? tt("partial", {
                            covered: model.coverage.covered,
                            total: model.coverage.total,
                          })
                        : tt("complete", { total: model.coverage.total })
                    }
                  />
                  <span className="num text-sm">
                    {model.coverage.covered}/{model.coverage.total}
                  </span>
                </dd>
              </div>
              {model.vision && (
                <div>
                  <dt className="eyebrow">{tt("vision")}</dt>
                  <dd className="num text-xl">{model.vision.rating.toFixed(0)}</dd>
                </div>
              )}
            </dl>

            <nav className="hidden border-t border-subtle pt-4 lg:block" aria-label={tui("pageSections")}>
              <p className="eyebrow mb-2">{tui("sections")}</p>
              <ul className="flex flex-col gap-1.5">
                {SECTIONS.map((anchor) => (
                  <li key={anchor}>
                    <a href={`#${anchor}`} className="eyebrow row-shift hover:text-primary">
                      {t(anchor)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </Surface>
        </aside>
      </div>
    </main>
  );
}
