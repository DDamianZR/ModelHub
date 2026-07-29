import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CategoryBars } from "@/components/CategoryBars";
import { CoverageMeter } from "@/components/CoverageMeter";
import { SiteHeader } from "@/components/SiteHeader";
import { Sparkline } from "@/components/Sparkline";
import { summariseTrend } from "@/lib/history";
import {
  getAcquisition,
  getModelDetail,
  getModelIds,
  getStalenessConfig,
  measurementAge,
} from "@/lib/data";
import { routing } from "@/i18n/routing";
import { localeMetadata } from "@/lib/metadata";
import { CATEGORIES } from "@/lib/types";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getModelIds().map((id) => ({ locale, id })),
  );
}

// Without this every model page inherits the layout's canonical and declares itself a
// duplicate of the home page, which asks for none of them to be indexed on their own.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  return localeMetadata(locale, `/model/${id}`);
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
  const t = await getTranslations("model");
  const tt = await getTranslations("table");

  /** The scored normalisation for a row, or null when the benchmark does not score. */
  const normalisationOf = (score: (typeof scores)[number]) =>
    score.normalization?.scored ? score.normalization : null;

  /** The conversion spelled out with this cell's own numbers, per R9. */
  const explain = (score: (typeof scores)[number]) => {
    const n = normalisationOf(score);
    if (!n || score.value_normalized == null) return undefined;
    return t("normalizedExplain", {
      raw: score.value.toFixed(score.unit === "percent" ? 1 : 0),
      mean: n.mean.toFixed(1),
      sd: n.sd.toFixed(1),
      z: n.z.toFixed(2),
      scale: n.scale_factor,
      normalized: score.value_normalized.toFixed(0),
    });
  };

  const muted = { color: "var(--muted)" } as const;
  const partial = model.coverage.covered < model.coverage.total;
  const text = locale === "es" ? description?.es : description?.en;

  // Scaled against this series' own range here, because a detail page shows one line and
  // there is nothing to be comparable with. The significance test still applies.
  const trend = summariseTrend(history, null);

  // Per-cell measurement age, plus the single worst one stated above the table. A score is
  // an average of readings, and the average is only as current as its oldest input.
  const staleness = getStalenessConfig();
  const ages = scores.map((score) => ({
    score,
    age: measurementAge(score.measured_at, score.benchmark_id, staleness),
  }));
  const oldest = ages
    .filter((entry) => entry.age.days !== null)
    .sort((a, b) => (b.age.days ?? 0) - (a.age.days ?? 0))[0];
  const trendMin = history.length ? Math.min(...history.map((p) => p.value)) : 0;
  const trendMax = history.length ? Math.max(...history.map((p) => p.value)) : 0;

  return (
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="ranking" />

      <article className="mt-8 max-w-[52rem]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2
            className="text-[32px] leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {model.display_name}
          </h2>
          <span
            className="eyebrow"
            style={{ color: model.is_open_weights ? "var(--amber)" : "var(--muted)" }}
          >
            {model.is_open_weights ? tt("openWeights") : tt("apiOnly")}
          </span>
          {model.provisional && (
            <span className="eyebrow" style={{ color: "var(--amber)" }}>
              {tt("provisionalTitle")}
            </span>
          )}
        </div>

        <p className="num mt-1 text-[12px]" style={muted}>
          {model.provider_name}
          {model.country ? ` · ${model.country}` : ""}
          {model.release_date ? ` · ${model.release_date}` : ""}
        </p>

        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-y rule py-3">
          <div>
            <dt className="eyebrow">{tt("composite")}</dt>
            <dd className="num text-[26px]">{model.composite.toFixed(1)}</dd>
          </div>
          <div>
            <dt className="eyebrow">{tt("rank")}</dt>
            <dd className="num text-[26px]">{model.rank ?? "—"}</dd>
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
              <span className="num text-[13px]">
                {model.coverage.covered}/{model.coverage.total}
              </span>
            </dd>
          </div>
          {model.vision && (
            <div>
              <dt className="eyebrow">{tt("vision")}</dt>
              <dd className="num text-[26px]">{model.vision.rating.toFixed(0)}</dd>
            </div>
          )}
        </dl>

        {/* Layer B (Phase 4) fills this in. Until then the empty state says so plainly
            rather than showing invented prose that would read as real. */}
        <section className="mt-8">
          <h3 className="eyebrow mb-2">{t("description")}</h3>
          {text ? (
            <p className="text-[15px] leading-[1.65]">{text}</p>
          ) : (
            <p
              className="border-l-2 py-1 pl-3 text-[13px]"
              style={{ borderColor: "var(--rule)", color: "var(--muted)" }}
            >
              {t("descriptionPending")}
            </p>
          )}
        </section>

        <section className="mt-8">
          <h3 className="eyebrow mb-3">{t("categories")}</h3>
          {/* The coverage meter counts categories, so it cannot show that one category
              rests on a single benchmark while another averages three. With normalisation
              that difference matters more, because the mean of one is noisier than the
              mean of three. */}
          <CategoryBars
            emptyLabel={tt("noData")}
            rows={CATEGORIES.map((category) => {
              const raw = model.category_scores_raw?.[category];
              const count = model.benchmark_counts?.[category];
              const parts = [
                count != null ? t("benchmarkCount", { count }) : null,
                raw != null ? t("categoryRaw", { value: raw.toFixed(1) }) : null,
              ].filter(Boolean);
              return {
                label: tt(category),
                value: model.category_scores[category],
                sublabel: parts.length ? parts.join(" · ") : undefined,
              };
            })}
          />
          <p className="mt-2 text-[12px]" style={muted}>
            {t("categoriesNote")}
          </p>
          {partial && (
            <p className="mt-3 text-[12px]" style={muted}>
              {t("partialNote", {
                missing: model.coverage.missing
                  .map((key) => tt(key as (typeof CATEGORIES)[number]))
                  .join(", "),
              })}
            </p>
          )}
        </section>

        <section className="mt-8">
          <h3 className="eyebrow mb-2">{t("history")}</h3>
          {trend.points.length >= 2 ? (
            <>
              <div className="flex items-center gap-3">
                <Sparkline
                  trend={trend}
                  label={
                    trend.significant
                      ? tt("trendLabel", {
                          model: model.display_name,
                          from: trend.first?.toFixed(0) ?? "",
                          to: trend.last?.toFixed(0) ?? "",
                        })
                      : tt("trendFlat", {
                          model: model.display_name,
                          span: trend.span,
                          ci: trend.ciWidth ?? 0,
                        })
                  }
                />
                <span className="num text-[12px]" style={muted}>
                  {trendMin.toFixed(0)} → {trendMax.toFixed(0)}
                </span>
              </div>
              <p className="num mt-2 text-[11px]" style={muted}>
                {t("historyRange", {
                  from: history[0].date,
                  to: history[history.length - 1].date,
                  points: history.length,
                })}
              </p>
            </>
          ) : (
            <p className="text-[13px]" style={muted}>
              {tt("noHistory")}
            </p>
          )}
          <p className="mt-3 text-[12px]" style={muted}>
            {t("historyScope")}
          </p>
          <p className="mt-2 text-[12px]" style={muted}>
            {t("historyBreaks")}
          </p>
        </section>

        <section className="mt-8">
          <h3 className="eyebrow mb-2">{t("sources")}</h3>
          {oldest?.age.days !== undefined && oldest?.age.days !== null && (
            <p className="num mb-2 text-[12px]" style={muted}>
              {t("oldestNote", {
                days: oldest.age.days,
                benchmark: oldest.score.benchmark?.name ?? oldest.score.benchmark_id,
                date: oldest.score.measured_at ?? "—",
              })}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left" style={{ minWidth: "38rem" }}>
              <thead>
                <tr className="border-b rule">
                  <th scope="col" className="py-2 pr-3">
                    <span className="eyebrow">{t("benchmark")}</span>
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    <span className="eyebrow">{t("value")}</span>
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right">
                    <span className="eyebrow">{t("normalized")}</span>
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
                {ages.map(({ score, age }) => (
                  <tr key={`${score.benchmark_id}`} className="border-b rule">
                    <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                      {score.benchmark?.name ?? score.benchmark_id}
                      {score.notes && (
                        <span className="num block text-[10px]" style={muted}>
                          {score.notes}
                        </span>
                      )}
                    </th>
                    <td className="num py-2 pr-3 text-right text-[13px]">
                      {score.value.toFixed(score.unit === "percent" ? 1 : 0)}
                      <span className="text-[10px]" style={muted}>
                        {score.unit === "percent" ? "%" : ""}
                      </span>
                    </td>
                    {/* The derived number sits beside the measured one, and its own
                        arithmetic is on the cell, so nothing here has to be taken on
                        trust. */}
                    <td className="num py-2 pr-3 text-right text-[13px]">
                      {normalisationOf(score) ? (
                        <span title={explain(score)}>
                          {score.value_normalized?.toFixed(0)}
                          {normalisationOf(score)?.clipped && (
                            <span
                              className="ml-1 text-[10px]"
                              style={{ color: "var(--amber)" }}
                              title={t("clippedCell")}
                            >
                              ▲
                            </span>
                          )}
                        </span>
                      ) : (
                        <span
                          style={muted}
                          title={
                            score.normalization && !score.normalization.scored
                              ? t("notScored", {
                                  reason: score.normalization.reason ?? "—",
                                })
                              : undefined
                          }
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="num py-2 pr-3 text-[11px]" style={muted}>
                      {score.source_type}
                    </td>
                    <td className="num py-2 pr-3 text-[11px]" style={muted}>
                      {score.measured_at ?? "—"}
                      {/* Marked in words as well as colour, and only past the configured
                          threshold, so the flag still means something when it appears. */}
                      {age.freshness !== "fresh" && age.days !== null && (
                        <span
                          className="ml-1"
                          style={{
                            color:
                              age.freshness === "stale" ? "var(--amber)" : "var(--muted)",
                          }}
                          title={t("staleTitle", { days: age.days })}
                        >
                          · {age.days}d
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-[11px]">
                      <a
                        href={score.source_url}
                        rel="noopener noreferrer"
                        target="_blank"
                        className="underline underline-offset-2"
                        style={{ color: "var(--amber)" }}
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

        <section className="mt-8">
          <h3 className="eyebrow mb-2">{t("acquisition")}</h3>
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
                      style={{ color: "var(--amber)" }}
                    >
                      {link.url.replace(/^https?:\/\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="num mt-2 text-[11px]" style={muted}>
                {t("acquisitionChecked", { date: checkedAt ?? "—" })}
                {withheld > 0 ? ` · ${t("acquisitionWithheld", { count: withheld })}` : ""}
              </p>
            </>
          ) : (
            <p
              className="border-l-2 py-1 pl-3 text-[13px]"
              style={{ borderColor: "var(--rule)", color: "var(--muted)" }}
            >
              {t("acquisitionPending")}
            </p>
          )}
        </section>
      </article>
    </main>
  );
}
