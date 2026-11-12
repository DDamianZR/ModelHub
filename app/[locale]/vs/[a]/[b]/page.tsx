import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Price } from "@/components/CurrencyProvider";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { Surface } from "@/components/Surface";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { separation } from "@/lib/compare";
import { getRanking } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/site-url";
import { CATEGORIES, type Row } from "@/lib/types";
import { getScoreDateRange, getVsModels, getVsPairs, orderPair } from "@/lib/views";

// The top 30 are prerendered (435 pairs per locale). Any other pair of catalogue models is
// rendered on first request and then cached, refreshed daily with the ingest.
export const revalidate = 86400;
export const dynamicParams = true;

export function generateStaticParams() {
  const pairs = getVsPairs();
  return routing.locales.flatMap((locale) => pairs.map(([a, b]) => ({ locale, a, b })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; a: string; b: string }>;
}): Promise<Metadata> {
  const { locale, a, b } = await params;
  const [x, y] = orderPair(a, b);
  const pair = getVsModels(x, y);
  if (!pair) return {};
  const t = await getTranslations({ locale, namespace: "vs" });
  const names = { a: pair.a.display_name, b: pair.b.display_name };
  return pageMetadata({
    locale,
    path: `/vs/${x}/${y}`,
    title: `${t("metaTitle", names)} · ModelHub`,
    description: t("metaDescription", names),
    ownCard: true,
  });
}

function place(row: Row, total: number, provisionalLabel: string): string {
  if (row.rank === null) return provisionalLabel;
  return `${row.tied_with > 0 ? "=" : "#"}${row.rank}/${total}`;
}

export default async function VsPage({
  params,
}: {
  params: Promise<{ locale: string; a: string; b: string }>;
}) {
  const { locale, a, b } = await params;
  setRequestLocale(locale);

  // One page per pair: the second ordering redirects to the first. Alphabetical by id, a
  // rule that names neither model first by preference.
  const [x, y] = orderPair(a, b);
  if (x !== a) permanentRedirect(`/${locale}/vs/${x}/${y}`);

  const pair = getVsModels(x, y);
  if (!pair) notFound();
  const { a: left, b: right, rankedCount } = pair;

  const t = await getTranslations("vs");
  const tt = await getTranslations("table");
  const { meta } = getRanking();

  const compositeSep = separation(left.composite, left.composite_error, right.composite, right.composite_error);
  const gapText = Math.abs(compositeSep.gap).toFixed(2);
  const summary =
    compositeSep.combined === null
      ? t("summaryUnknown", { gap: gapText })
      : compositeSep.separated
        ? t("summarySeparated", { gap: gapText, combined: compositeSep.combined.toFixed(2) })
        : t("summaryWithin", { gap: gapText, combined: compositeSep.combined.toFixed(2) });

  const status = (s: { combined: number | null; separated: boolean }) =>
    s.combined === null ? t("unknown") : s.separated ? t("separated") : t("within");

  const fmt = (value: number | undefined) => (value === undefined ? "·" : value.toFixed(1));
  const signed = (gap: number) => `${gap > 0 ? "+" : gap < 0 ? "−" : ""}${Math.abs(gap).toFixed(1)}`;
  const provisional = [left, right].filter((row) => row.provisional);
  const ranges = [getScoreDateRange(left.id), getScoreDateRange(right.id)];

  type Line = { label: string; a: React.ReactNode; b: React.ReactNode; diff?: string; note?: string };
  const lines: Line[] = [
    {
      label: t("rank"),
      a: place(left, rankedCount, t("provisionalShort")),
      b: place(right, rankedCount, t("provisionalShort")),
    },
    {
      label: tt("composite"),
      a: `${left.composite.toFixed(1)} ${left.composite_error === null ? "±?" : `±${left.composite_error.toFixed(2)}`}`,
      b: `${right.composite.toFixed(1)} ${right.composite_error === null ? "±?" : `±${right.composite_error.toFixed(2)}`}`,
      diff: signed(compositeSep.gap),
      note: status(compositeSep),
    },
    ...CATEGORIES.map((category) => {
      const va = left.category_scores[category];
      const vb = right.category_scores[category];
      if (va === undefined || vb === undefined) {
        return { label: tt(category), a: fmt(va), b: fmt(vb), note: t("notMeasured") };
      }
      const s = separation(va, left.category_errors[category], vb, right.category_errors[category]);
      return { label: tt(category), a: fmt(va), b: fmt(vb), diff: signed(s.gap), note: status(s) };
    }),
    {
      label: t("coverage"),
      a: t("coverageValue", { covered: left.coverage.covered, total: left.coverage.total }),
      b: t("coverageValue", { covered: right.coverage.covered, total: right.coverage.total }),
    },
    {
      label: t("price"),
      a: <Price usd={left.blended_price_usd_per_m ?? null} />,
      b: <Price usd={right.blended_price_usd_per_m ?? null} />,
    },
    {
      label: t("context"),
      a: left.context_window == null ? "·" : left.context_window.toLocaleString("en-US"),
      b: right.context_window == null ? "·" : right.context_window.toLocaleString("en-US"),
    },
    { label: t("release"), a: left.release_date ?? "·", b: right.release_date ?? "·" },
    {
      label: t("access"),
      a: left.is_open_weights ? tt("openWeights") : tt("apiOnly"),
      b: right.is_open_weights ? tt("openWeights") : tt("apiOnly"),
    },
    {
      label: t("measured"),
      a: ranges[0] ? t("measuredRange", ranges[0]) : "·",
      b: ranges[1] ? t("measuredRange", ranges[1]) : "·",
    },
  ];

  const title = t("title", { a: left.display_name, b: right.display_name });
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: t("metaTitle", { a: left.display_name, b: right.display_name }),
    url: `${siteUrl()}/${locale}/vs/${x}/${y}`,
    inLanguage: locale,
    dateModified: meta.generated_at,
    mainEntity: {
      "@type": "ItemList",
      itemListOrder: "https://schema.org/ItemListUnordered",
      itemListElement: [left, right].map((row, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: row.display_name,
        url: `${siteUrl()}/${locale}/model/${row.id}`,
      })),
    },
  };

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="compare" />
      <JsonLd data={jsonLd} />

      <section className="mt-8">
        <p className="eyebrow">
          <Link href="/compare" className="hover:text-primary">
            {t("breadcrumb")}
          </Link>
        </p>
        <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 max-w-[46rem] text-sm leading-[1.6] text-tertiary">{t("intro")}</p>
        <p className="mt-3 max-w-[46rem] text-base leading-[1.6]">{summary}</p>
        {provisional.map((row) => (
          <p key={row.id} className="note note-attention mt-2 max-w-[46rem] text-xs leading-[1.6]">
            {t("provisionalNote", {
              name: row.display_name,
              min: meta.min_coverage_for_ranking,
              total: CATEGORIES.length,
            })}
          </p>
        ))}
      </section>

      <Surface className="mt-5">
        <div className="relative overflow-x-auto p-2" role="region" aria-label={title} tabIndex={0}>
          <table className="table-sticky table-dense w-full min-w-[44rem] text-left">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-subtle pr-3 align-bottom">
                  <span className="eyebrow">{t("metric")}</span>
                </th>
                {[left, right].map((row) => (
                  <th key={row.id} scope="col" className="border-b border-subtle pr-3 align-bottom">
                    <Link
                      href={`/model/${row.id}`}
                      className="text-base font-semibold underline-offset-2 hover:underline"
                    >
                      {row.display_name}
                    </Link>
                    <span className="num block text-2xs font-normal text-tertiary">{row.provider_name}</span>
                  </th>
                ))}
                <th scope="col" className="border-b border-subtle align-bottom">
                  <span className="eyebrow">{t("difference")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.label} className="row-hover">
                  <th scope="row" className="eyebrow border-b border-subtle pr-3 text-left font-normal">
                    {line.label}
                  </th>
                  <td className="num border-b border-subtle pr-3 text-sm">{line.a}</td>
                  <td className="num border-b border-subtle pr-3 text-sm">{line.b}</td>
                  <td className="num border-b border-subtle text-xs text-tertiary">
                    {line.diff && <span className="mr-2 text-primary">{line.diff}</span>}
                    {line.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>

      <p className="num mt-3 text-2xs text-tertiary">{t("asOf", { date: meta.generated_at })}</p>

      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Link href={`/model/${left.id}`} className="py-1.5 text-accent underline underline-offset-2">
          {t("openModel", { name: left.display_name })}
        </Link>
        <Link href={`/model/${right.id}`} className="py-1.5 text-accent underline underline-offset-2">
          {t("openModel", { name: right.display_name })}
        </Link>
        <Link
          href={`/compare?m=${left.id},${right.id}`}
          className="py-1.5 text-accent underline underline-offset-2"
        >
          {t("compareMore")}
        </Link>
      </p>
    </main>
  );
}
