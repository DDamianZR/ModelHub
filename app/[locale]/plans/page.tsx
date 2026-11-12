import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PlanFee } from "@/components/CurrencyProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { Surface } from "@/components/Surface";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatRate } from "@/lib/currency";
import { getFx, getPlans, getRanking } from "@/lib/data";
import { sortPlans } from "@/lib/plans";
import { pageMetadata } from "@/lib/seo";

const REPORT_URL =
  "https://github.com/DDamianZR/ModelHub/issues/new?template=report-a-plan.yml";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "plans" });
  return pageMetadata({
    locale,
    path: "/plans",
    title: `${t("title")} · ModelHub`,
    description: t("metaDescription"),
  });
}

export default async function PlansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("plans");
  const { plans, expired, maxAgeDays } = getPlans();
  const fx = getFx();
  // Cheapest first; who offers a plan plays no part in the order (lib/plans.ts).
  const sorted = sortPlans(plans, fx);
  const models = new Map(getRanking().rows.map((row) => [row.id, row]));

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="plans" />

      <section className="mt-8">
        <h1 className="text-xl leading-tight font-semibold">{t("title")}</h1>
        <p className="mt-2 max-w-[46rem] text-base leading-[1.6] text-tertiary">{t("intro")}</p>
        <p className="mt-2 max-w-[46rem] text-sm leading-[1.6] text-tertiary">{t("notAPrice")}</p>
        {maxAgeDays !== null && (
          <p className="mt-2 max-w-[46rem] text-sm leading-[1.6] text-tertiary">
            {t("expiry", { days: maxAgeDays })}
          </p>
        )}
      </section>

      <Surface className="mt-5">
        {sorted.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-tertiary">{t("empty")}</p>
        ) : (
          <div className="relative overflow-x-auto p-2" role="region" aria-label={t("title")} tabIndex={0}>
            <table className="table-sticky table-dense w-full min-w-[52rem] text-left">
              <caption className="sr-only">{t("title")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow">{t("colPlan")}</span>
                  </th>
                  <th scope="col" className="w-44 border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow block text-right">{t("colFee")}</span>
                  </th>
                  <th scope="col" className="w-16 border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow">{t("colRegion")}</span>
                  </th>
                  <th scope="col" className="w-28 border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow">{t("colRead")}</span>
                  </th>
                  <th scope="col" className="border-b border-subtle align-bottom">
                    <span className="eyebrow">{t("colModels")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((plan) => (
                  <tr key={plan.id} className="row-hover">
                    <td className="pr-3">
                      <a
                        href={plan.source_url}
                        rel="noopener noreferrer"
                        target="_blank"
                        className="text-base underline underline-offset-2 hover:text-accent"
                      >
                        {plan.name}
                      </a>
                    </td>
                    <td className="num pr-3 text-right text-sm">
                      {plan.price_per_month === null || plan.currency === null ? (
                        <span className="text-tertiary">{t("noFee")}</span>
                      ) : (
                        <>
                          <PlanFee amount={plan.price_per_month} charged={plan.currency} />{" "}
                          <span className="text-2xs text-tertiary">{t("perMonth")}</span>
                        </>
                      )}
                    </td>
                    <td className="num pr-3 text-xs text-tertiary">{plan.region}</td>
                    <td className="num pr-3 text-xs text-tertiary">{plan.verified_at}</td>
                    <td className="text-sm">
                      {plan.model_ids.map((id, index) => {
                        const model = models.get(id);
                        return (
                          <span key={id}>
                            {index > 0 && ", "}
                            <Link href={`/model/${id}`} className="underline-offset-2 hover:underline">
                              {model?.display_name ?? id}
                            </Link>
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {fx && sorted.length > 0 && (
        <p className="num mt-3 max-w-[60rem] text-2xs leading-[1.6] text-tertiary">
          {t("fxNote", { rate: formatRate(fx.mxn), date: fx.date })}
        </p>
      )}

      {expired.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow text-attention">{t("expiredTitle", { count: expired.length })}</h2>
          <p className="mt-1 max-w-[46rem] text-xs leading-[1.55] text-tertiary">{t("expiredNote")}</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {expired.map((plan) => (
              <li key={plan.id}>
                <a
                  href={plan.source_url}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="underline underline-offset-2 hover:text-accent"
                >
                  {plan.name}
                </a>
                <span className="num ml-2 text-xs text-tertiary">
                  {plan.region} · {t("expiredSince", { date: plan.verified_at })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 max-w-[46rem] text-sm leading-[1.6] text-tertiary">
        {t("contribute")}{" "}
        <a
          href={REPORT_URL}
          rel="noopener noreferrer"
          target="_blank"
          className="text-accent underline underline-offset-2"
        >
          {t("contributeLink")}
        </a>
      </p>
    </main>
  );
}
