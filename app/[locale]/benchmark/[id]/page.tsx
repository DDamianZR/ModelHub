import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import clsx from "clsx";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { Surface } from "@/components/Surface";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/site-url";
import { getBenchmarkIds, getBenchmarkPage } from "@/lib/views";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => getBenchmarkIds().map((id) => ({ locale, id })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const page = getBenchmarkPage(id);
  if (!page) return {};
  const t = await getTranslations({ locale, namespace: "benchmark" });
  return pageMetadata({
    locale,
    path: `/benchmark/${id}`,
    title: `${t("metaTitle", { name: page.benchmark.name })} · ModelHub`,
    description: t("metaDescription", {
      name: page.benchmark.name,
      source: page.benchmark.source,
      count: page.rows.length,
    }),
  });
}

export default async function BenchmarkPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const page = getBenchmarkPage(id);
  if (!page) notFound();

  const t = await getTranslations("benchmark");
  const tt = await getTranslations("table");
  const { benchmark, weight, rows } = page;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: benchmark.name,
    url: `${siteUrl()}/${locale}/benchmark/${id}`,
    inLanguage: locale,
    creator: { "@type": "Organization", name: benchmark.source },
    isBasedOn: benchmark.url,
    variableMeasured: benchmark.name,
  };

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="none" />
      <JsonLd data={jsonLd} />

      <section className="mt-8">
        <p className="eyebrow">
          <Link href="/methodology" className="hover:text-primary">
            {t("eyebrow")}
          </Link>
        </p>
        <h2 className="mt-1 text-2xl leading-tight font-semibold tracking-tight">{benchmark.name}</h2>
        <p className="num mt-1 text-xs text-tertiary">
          {benchmark.source} · {benchmark.source_type} · {t("rows", { count: rows.length })} ·{" "}
          <a
            href={benchmark.url}
            rel="noopener noreferrer"
            target="_blank"
            className="text-accent underline underline-offset-2"
          >
            {t("source")}
          </a>
        </p>
        <p className="mt-3 max-w-[46rem] text-sm leading-[1.6] text-tertiary">
          {t("intro", {
            category: tt(benchmark.category),
            weight: weight === null ? "?" : Math.round(weight * 100),
            source: benchmark.source,
          })}
        </p>
        <p className="mt-2 max-w-[46rem] text-sm leading-[1.6] text-tertiary">{t("orderNote")}</p>
      </section>

      <Surface className="mt-5">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-tertiary">{t("empty")}</p>
        ) : (
          <div className="relative overflow-x-auto p-2" role="region" aria-label={benchmark.name} tabIndex={0}>
            <table className="table-sticky table-dense w-full min-w-[52rem] text-left">
              <caption className="sr-only">{benchmark.name}</caption>
              <thead>
                <tr>
                  <th scope="col" className="border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow">{t("colModel")}</span>
                  </th>
                  <th scope="col" className="w-28 border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow block text-right">{t("colValue")}</span>
                  </th>
                  <th scope="col" className="w-24 border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow block text-right">{t("colInterval")}</span>
                  </th>
                  <th scope="col" className="w-28 border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow block text-right">{t("colMeasured")}</span>
                  </th>
                  <th scope="col" className="border-b border-subtle pr-3 align-bottom">
                    <span className="eyebrow">{t("colType")}</span>
                  </th>
                  <th scope="col" className="border-b border-subtle align-bottom">
                    <span className="eyebrow">{t("colNotes")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  // vendor_claim never feeds the composite; where one is shown it is grey
                  // and labelled, so it cannot be read as a measurement.
                  const unverified = row.source_type === "vendor_claim";
                  return (
                    <tr key={`${row.model_id}`} className={clsx("row-hover", unverified && "text-tertiary")}>
                      <td className="border-b border-subtle pr-3">
                        <Link
                          href={`/model/${row.model_id}`}
                          className="row-shift text-base underline-offset-2 hover:underline"
                        >
                          {row.display_name}
                        </Link>{" "}
                        <span className="num text-2xs text-tertiary">{row.provider_name}</span>
                      </td>
                      <td className="num border-b border-subtle pr-3 text-right text-md">
                        {row.value.toFixed(row.unit === "percent" ? 1 : 0)}
                        {row.unit === "percent" ? "%" : ""}
                      </td>
                      <td className="num border-b border-subtle pr-3 text-right text-xs text-tertiary">
                        {row.half_width_95 == null ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="sr-only">{t("noInterval")}</span>
                          </>
                        ) : (
                          `±${row.half_width_95.toFixed(2)}`
                        )}
                      </td>
                      <td className="num border-b border-subtle pr-3 text-right text-xs text-tertiary">
                        {row.measured_at ?? "·"}
                      </td>
                      <td className="num border-b border-subtle pr-3 text-xs text-tertiary">
                        {row.source_type}
                        {unverified && ` · ${t("unverified")}`}
                      </td>
                      <td className="border-b border-subtle text-2xs text-tertiary">
                        {row.contamination_flag && t("contaminated")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
    </main>
  );
}
