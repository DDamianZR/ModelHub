import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CategoryBars } from "@/components/CategoryBars";
import { CoverageMeter } from "@/components/CoverageMeter";
import { SiteHeader } from "@/components/SiteHeader";
import { Sparkline } from "@/components/Sparkline";
import { getAcquisition, getModelDetail, getModelIds } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { CATEGORIES } from "@/lib/types";

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
  const t = await getTranslations("model");
  const tt = await getTranslations("table");

  const muted = { color: "var(--muted)" } as const;
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
          <CategoryBars
            emptyLabel={tt("noData")}
            rows={CATEGORIES.map((category) => ({
              label: tt(category),
              value: model.category_scores[category],
            }))}
          />
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
          {normalised.length >= 2 ? (
            <>
              <div className="flex items-center gap-3">
                <Sparkline
                  points={normalised}
                  label={`${model.display_name} — ${tt("trend")}`}
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
                    <td className="num py-2 pr-3 text-[11px]" style={muted}>
                      {score.source_type}
                    </td>
                    <td className="num py-2 pr-3 text-[11px]" style={muted}>
                      {score.measured_at ?? "—"}
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
