import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CategoryBars } from "@/components/CategoryBars";
import { CoverageMeter } from "@/components/CoverageMeter";
import { SiteHeader } from "@/components/SiteHeader";
import { Sparkline } from "@/components/Sparkline";
import { getAcquisition, getAdjacentModels, getModelDetail, getModelIds } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { CATEGORIES } from "@/lib/types";
import { Link } from "@/i18n/navigation";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getModelIds().map((id) => ({ locale, id })),
  );
}

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
  const t = await getTranslations("model");
  const tt = await getTranslations("table");

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

      {/* Prev / Next navigation */}
      <nav
        className="mt-6 flex items-center justify-between text-[12px]"
        aria-label="model navigation"
      >
        {adjacent.prev ? (
          <Link
            href={`/model/${adjacent.prev.id}`}
            className="eyebrow row-shift flex items-center gap-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            ← {adjacent.prev.display_name}
          </Link>
        ) : (
          <span />
        )}
        {adjacent.next ? (
          <Link
            href={`/model/${adjacent.next.id}`}
            className="eyebrow row-shift flex items-center gap-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            {adjacent.next.display_name} →
          </Link>
        ) : (
          <span />
        )}
      </nav>

      {/* Two-column layout at lg: main content left, sticky stats rail right */}
      <div className="mt-4 lg:grid lg:grid-cols-[1fr_18rem] lg:gap-12 lg:items-start">

        {/* ── Main column ── */}
        <article>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2
              className="font-display text-[32px] leading-tight"
            >
              {model.display_name}
            </h2>
            <span
              className="eyebrow"
              style={{ color: model.is_open_weights ? "var(--accent)" : "var(--text-tertiary)" }}
            >
              {model.is_open_weights ? tt("openWeights") : tt("apiOnly")}
            </span>
            {model.provisional && (
              <span className="eyebrow" style={{ color: "var(--accent)" }}>
                {tt("provisionalTitle")}
              </span>
            )}
          </div>

          <p className="num mt-1 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {model.provider_name}
            {model.country ? ` · ${model.country}` : ""}
            {model.release_date ? ` · ${model.release_date}` : ""}
          </p>

          {/* Published configuration. 24 of 57 models carry a human preference rating
              measured on a different variant than their benchmarks. */}
          {model.variant && (
            <p
              className="mt-4 border-l-2 py-1 pl-3 text-[12px] leading-[1.6]"
              style={{ borderColor: "var(--line-subtle)", color: "var(--text-tertiary)" }}
            >
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

          {/* Description */}
          <section className="mt-8">
            <h3 className="eyebrow mb-2" style={{ color: "var(--text-tertiary)" }}>
              {t("description")}
            </h3>
            {text ? (
              <p className="text-[15px] leading-[1.65]">{text}</p>
            ) : (
              <p
                className="border-l-2 py-1 pl-3 text-[13px]"
                style={{ borderColor: "var(--line-subtle)", color: "var(--text-tertiary)" }}
              >
                {t("descriptionPending")}
              </p>
            )}
          </section>

          {/* Category scores */}
          <section className="mt-8">
            <h3 className="eyebrow mb-3" style={{ color: "var(--text-tertiary)" }}>
              {t("categories")}
            </h3>
            <CategoryBars
              emptyLabel={tt("noData")}
              rows={CATEGORIES.map((category) => ({
                label: tt(category),
                value: model.category_scores[category],
              }))}
            />
            {partial && (
              <p className="mt-3 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                {t("partialNote", {
                  missing: model.coverage.missing
                    .map((key) => tt(key as (typeof CATEGORIES)[number]))
                    .join(", "),
                })}
              </p>
            )}
          </section>

          {/* Uncertainty */}
          <p className="mt-4 text-[12px] leading-[1.6]" style={{ color: "var(--text-tertiary)" }}>
            {model.composite_error === null
              ? t("uncertaintyNone")
              : t("uncertaintyNote", {
                  error: model.composite_error.toFixed(2),
                  measured: model.uncertainty.measured_inputs,
                  total: model.uncertainty.total_inputs,
                })}
            {model.tied_with > 0 && ` ${t("uncertaintyTied", { count: model.tied_with })}`}
          </p>

          {/* Cohort recalibration notice */}
          {model.cohort_recalibration && (
            <p
              className="mt-4 border-l-2 py-1 pl-3 text-[12px] leading-[1.6]"
              style={{ borderColor: "var(--accent)", color: "var(--text-tertiary)" }}
            >
              {t("recalibration", {
                normalized: model.cohort_recalibration.normalized_delta.toFixed(2),
                raw: model.cohort_recalibration.raw_delta.toFixed(2),
                composite: model.cohort_recalibration.composite_effect.toFixed(2),
                threshold: model.cohort_recalibration.threshold.toFixed(2),
              })}
            </p>
          )}

          {/* History */}
          <section className="mt-8">
            <h3 className="eyebrow mb-2" style={{ color: "var(--text-tertiary)" }}>
              {t("history")}
            </h3>
            {normalised.length >= 2 ? (
              <>
                <div className="flex items-center gap-3">
                  <Sparkline
                    points={normalised}
                    label={`${model.display_name} — ${tt("trend")}`}
                  />
                  <span className="num text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                    {trendMin.toFixed(0)} → {trendMax.toFixed(0)}
                  </span>
                </div>
                <p className="num mt-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {t("historyRange", {
                    from: history[0].date,
                    to: history[history.length - 1].date,
                    points: history.length,
                  })}
                </p>
              </>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                {tt("noHistory")}
              </p>
            )}
            <p className="mt-3 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              {t("historyScope")}
            </p>
            <p className="mt-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              {t("historyBreaks")}
            </p>
          </section>

          {/* Sources table */}
          <section className="mt-8">
            <h3 className="eyebrow mb-2" style={{ color: "var(--text-tertiary)" }}>
              {t("sources")}
            </h3>
            <div className="overflow-x-auto">
              <table
                className="w-full border-collapse text-left"
                style={{ minWidth: "38rem" }}
              >
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--line-subtle)" }}>
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
                    <tr
                      key={`${score.benchmark_id}`}
                      className="border-b"
                      style={{ borderColor: "var(--line-subtle)" }}
                    >
                      <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                        {score.benchmark?.name ?? score.benchmark_id}
                        {score.notes && (
                          <span
                            className="num block text-[10px]"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {score.notes}
                          </span>
                        )}
                        {score.variant_mismatch && (
                          <span
                            className="block text-[10px]"
                            style={{ color: "var(--accent)" }}
                          >
                            {t("scoreVariantMismatch", {
                              measured: score.variant_mismatch,
                              name: score.measured_name ?? "",
                              variant: model.variant ?? "",
                            })}
                          </span>
                        )}
                      </th>
                      <td className="num py-2 pr-3 text-right text-[13px]">
                        {score.value.toFixed(score.unit === "percent" ? 1 : 0)}
                        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                          {score.unit === "percent" ? "%" : ""}
                        </span>
                        <span
                          className="block text-[10px]"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {score.half_width_95 !== null && score.half_width_95 !== undefined
                            ? `± ${score.half_width_95.toFixed(2)}`
                            : t("errorNotPublished")}
                        </span>
                      </td>
                      <td
                        className="num py-2 pr-3 text-[11px]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {score.source_type}
                      </td>
                      <td
                        className="num py-2 pr-3 text-[11px]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {score.measured_at ?? "—"}
                      </td>
                      <td className="py-2 text-[11px]">
                        <a
                          href={score.source_url}
                          rel="noopener noreferrer"
                          target="_blank"
                          className="underline underline-offset-2"
                          style={{ color: "var(--accent)" }}
                        >
                          {score.benchmark?.source ?? t("link")}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Acquisition links */}
          <section className="mt-8">
            <h3 className="eyebrow mb-2" style={{ color: "var(--text-tertiary)" }}>
              {t("acquisition")}
            </h3>
            {links.length > 0 ? (
              <>
                <ul className="flex flex-col gap-1">
                  {links.map((link) => (
                    <li key={link.field} className="text-[13px]">
                      <span className="eyebrow mr-2">{t(`link_${link.field}`)}</span>
                      <a
                        href={link.url}
                        rel="noopener noreferrer"
                        target="_blank"
                        className="underline underline-offset-2"
                        style={{ color: "var(--accent)" }}
                      >
                        {link.url.replace(/^https?:\/\//, "")}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="num mt-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {t("acquisitionChecked", { date: checkedAt ?? "—" })}
                  {withheld > 0
                    ? ` · ${t("acquisitionWithheld", { count: withheld })}`
                    : ""}
                </p>
              </>
            ) : (
              <p
                className="border-l-2 py-1 pl-3 text-[13px]"
                style={{ borderColor: "var(--line-subtle)", color: "var(--text-tertiary)" }}
              >
                {t("acquisitionPending")}
              </p>
            )}
          </section>
        </article>

        {/* ── Right rail (stats) — sticky at lg ── */}
        <aside className="mt-8 lg:mt-2 lg:sticky lg:top-8">
          <dl className="flex flex-col gap-4 border-t pt-4"
            style={{ borderColor: "var(--line-subtle)" }}>
            <div>
              <dt className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
                {tt("composite")}
              </dt>
              <dd className="num text-[26px]">
                {model.composite.toFixed(1)}
                <span className="ml-1 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                  {model.composite_error === null
                    ? "±?"
                    : `±${model.composite_error.toFixed(2)}`}
                </span>
              </dd>
            </div>
            <div>
              <dt className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
                {tt("rank")}
              </dt>
              <dd className="num text-[26px]">
                {model.rank ?? "—"}
                {model.tied_with > 0 && (
                  <span className="ml-1 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                    {t("tiedShort", { count: model.tied_with })}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
                {tt("coverage")}
              </dt>
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
                <span className="num text-[13px]">
                  {model.coverage.covered}/{model.coverage.total}
                </span>
              </dd>
            </div>
            {model.vision && (
              <div>
                <dt className="eyebrow" style={{ color: "var(--text-tertiary)" }}>
                  {tt("vision")}
                </dt>
                <dd className="num text-[26px]">{model.vision.rating.toFixed(0)}</dd>
              </div>
            )}
          </dl>

          {/* Section nav at lg */}
          <nav
            className="mt-6 hidden lg:block"
            aria-label="page sections"
          >
            <p className="eyebrow mb-2" style={{ color: "var(--text-tertiary)" }}>
              Sections
            </p>
            <ul className="flex flex-col gap-1.5">
              {[
                ["description", t("description")],
                ["categories", t("categories")],
                ["history", t("history")],
                ["sources", t("sources")],
                ["acquisition", t("acquisition")],
              ].map(([anchor, label]) => (
                <li key={anchor}>
                  <a
                    href={`#${anchor}`}
                    className="eyebrow row-shift"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </main>
  );
}
