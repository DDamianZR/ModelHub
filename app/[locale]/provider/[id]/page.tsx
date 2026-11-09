import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CoverageMeter } from "@/components/CoverageMeter";
import { CurrencySymbol, PriceDigits } from "@/components/CurrencyProvider";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { Surface } from "@/components/Surface";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { CATEGORIES } from "@/lib/types";
import { pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/site-url";
import { getProviderIds, getProviderPage } from "@/lib/views";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => getProviderIds().map((id) => ({ locale, id })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const page = getProviderPage(id);
  if (!page) return {};
  const t = await getTranslations({ locale, namespace: "provider" });
  const provisional = page.rows.length - page.rankedCount;
  return pageMetadata({
    locale,
    path: `/provider/${id}`,
    title: `${t("metaTitle", { name: page.provider.display_name })} · ModelHub`,
    description: t("metaDescription", {
      name: page.provider.display_name,
      count: page.rows.length,
      ranked: page.rankedCount,
      provisional,
    }),
  });
}

export default async function ProviderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const page = getProviderPage(id);
  if (!page) notFound();

  const t = await getTranslations("provider");
  const tt = await getTranslations("table");
  const { provider, rows, rankedCount, totalRanked } = page;
  const provisional = rows.length - rankedCount;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("metaTitle", { name: provider.display_name }),
    url: `${siteUrl()}/${locale}/provider/${id}`,
    inLanguage: locale,
    about: { "@type": "Organization", name: provider.display_name },
    mainEntity: {
      "@type": "ItemList",
      itemListOrder: "https://schema.org/ItemListUnordered",
      numberOfItems: rows.length,
      itemListElement: rows.map((row, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: row.display_name,
        url: `${siteUrl()}/${locale}/model/${row.id}`,
      })),
    },
  };

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="none" />
      <JsonLd data={jsonLd} />

      <section className="mt-8">
        <p className="eyebrow">
          <Link href="/" className="hover:text-primary">
            {t("breadcrumb")}
          </Link>{" "}
          / {t("eyebrow")}
        </p>
        <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight">
          {provider.display_name}
        </h1>
        <p className="num mt-1 text-xs text-tertiary">
          {provider.country} ·{" "}
          {t("summary", { count: rows.length, ranked: rankedCount, provisional })}
        </p>
        <p className="mt-3 max-w-[46rem] text-sm leading-[1.6] text-tertiary">
          {t("intro", { name: provider.display_name, total: totalRanked })}
        </p>
      </section>

      <Surface className="mt-5">
        <div className="relative overflow-x-auto p-2" role="region" aria-label={provider.display_name} tabIndex={0}>
          <table className="table-sticky table-dense w-full min-w-[56rem] text-left">
            <caption className="sr-only">{provider.display_name}</caption>
            <thead>
              <tr>
                <th scope="col" className="w-12 border-b border-subtle pr-2 align-bottom">
                  <span className="eyebrow">{tt("rank")}</span>
                </th>
                <th scope="col" className="border-b border-subtle pr-3 align-bottom">
                  <span className="eyebrow">{tt("model")}</span>
                </th>
                <th scope="col" className="w-28 border-b border-subtle pr-3 align-bottom">
                  <span className="eyebrow block text-right">{tt("composite")}</span>
                </th>
                <th scope="col" className="w-24 border-b border-subtle pr-3 align-bottom">
                  <span className="eyebrow block text-right">{tt("coverage")}</span>
                </th>
                <th scope="col" className="w-20 border-b border-subtle pr-3 align-bottom">
                  <span className="eyebrow block text-right">
                    {tt.rich("price", { symbol: () => <CurrencySymbol /> })}
                  </span>
                </th>
                <th scope="col" className="w-24 border-b border-subtle pr-3 align-bottom">
                  <span className="eyebrow block text-right">{t("release")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const partial = row.coverage.covered < CATEGORIES.length;
                return (
                  <tr key={row.id} className="row-hover">
                    <td className="num border-b border-subtle pr-2 text-xs text-tertiary">
                      {row.rank === null ? "·" : row.tied_with > 0 ? `=${row.rank}` : row.rank}
                    </td>
                    <td className="border-b border-subtle pr-3">
                      <span className="flex items-center gap-x-2">
                        <Link
                          href={`/model/${row.id}`}
                          className="row-shift text-base underline-offset-2 hover:underline"
                        >
                          {row.display_name}
                        </Link>
                        {row.is_open_weights ? (
                          <span className="eyebrow rounded-inner bg-sunk px-1.5 py-0.5 text-tertiary">
                            {tt("openWeights")}
                          </span>
                        ) : null}
                        {row.provisional && (
                          <span className="eyebrow text-attention">{tt("provisionalTitle")}</span>
                        )}
                      </span>
                    </td>
                    <td className="num border-b border-subtle pr-3 text-right text-md">
                      {row.composite.toFixed(1)}
                      <span className="ml-1 text-2xs text-tertiary">
                        {row.composite_error === null ? "±?" : `±${row.composite_error.toFixed(2)}`}
                      </span>
                    </td>
                    <td className="border-b border-subtle pr-3 text-right">
                      <CoverageMeter
                        covered={row.coverage.covered}
                        total={row.coverage.total}
                        label={
                          partial
                            ? tt("partial", { covered: row.coverage.covered, total: row.coverage.total })
                            : tt("complete", { total: row.coverage.total })
                        }
                      />
                    </td>
                    <td className="num border-b border-subtle pr-3 text-right text-xs text-tertiary">
                      <PriceDigits usd={row.blended_price_usd_per_m ?? null} />
                    </td>
                    <td className="num border-b border-subtle pr-3 text-right text-xs text-tertiary">
                      {row.release_date ?? "·"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Surface>
    </main>
  );
}
