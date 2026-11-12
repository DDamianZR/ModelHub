import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { BoardCards } from "@/components/BoardCards";
import { Price } from "@/components/CurrencyProvider";
import { JsonLd } from "@/components/JsonLd";
import { RankingTable } from "@/components/RankingTable";
import { ScatterChart } from "@/components/ScatterChart";
import { SearchTrigger } from "@/components/SearchTrigger";
import { SiteHeader } from "@/components/SiteHeader";
import { Surface } from "@/components/Surface";
import { TrendChart } from "@/components/TrendChart";
import { IconGitHub, IconGlobe, IconInstagram } from "@/components/icons";
import {
  getAgedSources,
  getCategoryAges,
  getDegradedSources,
  getRanking,
  getRankingRows,
} from "@/lib/data";
import { packRankingRows } from "@/lib/ranking-wire";
import {
  getAccessTrends,
  getBoardCards,
  getCountryTrends,
  getScatterPoints,
  getTrendWindow,
} from "@/lib/views";
import { getBestBy } from "@/lib/data";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageAlternates } from "@/lib/seo";
import { siteUrl } from "@/lib/site-url";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: pageAlternates(locale, ""),
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tp = await getTranslations("panel");
  const tf = await getTranslations("footer");
  const tn = await getTranslations("nav");
  const messages = await getMessages();

  const { rows, meta, sourceCount } = getRanking();
  // The table gets the narrowed projection, not the full Row: fields the ranking never
  // reads were being serialised into every browser, including two that are 0/65 populated.
  const tableRows = getRankingRows();
  const degraded = getDegradedSources();
  // Only a degraded source (14+ days past its own rhythm) earns the page-level banner;
  // a source that is merely ageing is marked on its own column instead.
  const staleDegraded = getAgedSources().filter(
    (entry) => entry.freshness === "degraded" && !degraded.some((d) => d.name === entry.name),
  );
  const categoryAges = getCategoryAges();

  const th = await getTranslations("home");
  const { cards } = getBoardCards();
  const scatter = getScatterPoints();
  const bestBy = getBestBy();
  const accessTrends = getAccessTrends();
  const countryTrends = getCountryTrends();
  const trendWindow = getTrendWindow();
  const trendCaption = th("trendCaption", {
    from: trendWindow.dates[0] ?? "—",
    to: trendWindow.dates[trendWindow.dates.length - 1] ?? "—",
    shown: trendWindow.dates.length,
    total: trendWindow.total,
    excluded: trendWindow.excluded,
  });
  const trendValues = [...accessTrends, ...countryTrends].flatMap((series) =>
    series.points.map((point) => point.value),
  );
  const trendDomain: [number, number] | undefined = trendValues.length
    ? [Math.min(...trendValues), Math.max(...trendValues)]
    : undefined;
  const trendLabel = (key: string) =>
    key === "open" || key === "proprietary" ? th(`trend.${key}`) : key;
  const frontierList = scatter.filter((p) => p.frontier).sort((a, b) => a.price - b.price);
  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ModelHub",
    url: `${siteUrl()}/${locale}`,
    inLanguage: locale,
    description: (await getTranslations({ locale, namespace: "meta" }))("description"),
  };

  const ranked = rows.filter((r) => !r.provisional);
  const firsts = ranked.filter((r) => r.rank === 1).length;
  const period = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(meta.generated_at));
  const cheapest = cards.find((card) => card.id === "cheapest_covered");
  const cheapestHref =
    cheapest && cheapest.winners.length === 1 ? `/model/${cheapest.winners[0].id}` : "/#ranking";
  const snapshotLine = Object.entries(meta.snapshots)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key} ${value}`)
    .join(" · ");
  const agingCount = getAgedSources().filter((entry) => entry.freshness === "aging").length;
  const hasBanner = degraded.length > 0 || staleDegraded.length > 0;

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="ranking" />
      <JsonLd data={siteJsonLd} />

      <section
        className="grid items-start gap-x-12 gap-y-8 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
        aria-labelledby="hero-heading"
      >
        <div>
          <h1
            id="hero-heading"
            className="text-4xl leading-[1.1] font-semibold tracking-tight lg:text-[2.75rem]"
          >
            {th("heroTitle", { period })}
          </h1>
          <p className="mt-5 max-w-[34rem] text-md leading-[1.6] text-tertiary">
            {th("heroSummary", {
              models: rows.length,
              ranked: ranked.length,
              sources: sourceCount,
              firsts,
              date: meta.generated_at,
            })}
          </p>
          <div className="mt-6">
            <SearchTrigger label={th("searchLabel")} hint="⌘K" />
          </div>
          {/* Four ways in by what the reader wants to do, each a page that already exists. */}
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["/reweight", "reweight"],
                ["/changes", "changes"],
                ["/local", "local"],
                ["/plans", "plans"],
              ] as const
            ).map(([href, key]) => (
              <li key={key}>
                <Link
                  href={href}
                  className="row-hover flex h-full flex-col rounded-control border border-subtle px-3 py-2"
                >
                  <span className="text-sm font-medium">{th(`entrance.${key}.title`)}</span>
                  <span className="mt-0.5 text-xs leading-[1.5] text-tertiary">
                    {th(`entrance.${key}.body`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link href={cheapestHref} className="text-accent underline underline-offset-2">
              {th("chipCheapest", { min: cheapest?.filter.min_coverage ?? 0 })}
            </Link>
          </p>
        </div>

        <figure className="m-0 min-w-0" aria-labelledby="scatter-heading">
          <h2 id="scatter-heading" className="text-xl font-semibold tracking-snug">
            {th("scatterTitle")}
          </h2>
          <p className="mt-1 mb-3 max-w-[40rem] text-xs leading-[1.55] text-tertiary">
            {th("scatterNote", {
              models: bestBy.meta.pareto_evaluated,
              input: bestBy.meta.price_blend.input,
              output: bestBy.meta.price_blend.output,
            })}
          </p>
          <NextIntlClientProvider messages={{ home: { scatter: messages.home.scatter } }}>
            <ScatterChart compact points={scatter} locale={locale} />
          </NextIntlClientProvider>
          {/* The same frontier as text, for whoever cannot resolve the marks. */}
          <h3 className="sr-only">{th("scatter.frontierList")}</h3>
          <ul className="num sr-only">
            {frontierList.map((p) => (
              <li key={p.id}>
                <Link href={`/model/${p.id}`}>{p.name}</Link>{" "}
                {th.rich("scatter.frontierItem", {
                  composite: p.composite.toFixed(1),
                  price: () => <Price usd={p.price} />,
                })}
              </li>
            ))}
          </ul>
        </figure>
      </section>

      {hasBanner && (
        <Surface className="surface-attention mt-8 p-3 text-xs leading-[1.6]">
          <span className="eyebrow text-attention">{tp("degraded")}</span>{" "}
          {[
            ...degraded.map((entry) =>
              tp("degradedSource", {
                source: entry.name,
                since: entry.status.last_success ?? "—",
                snapshot: entry.snapshotDate ?? "—",
              }),
            ),
            ...staleDegraded.map((entry) =>
              tp("agingSource", {
                source: entry.name,
                days: entry.age_days ?? 0,
                date: entry.date ?? "—",
              }),
            ),
          ].join(" · ")}
        </Surface>
      )}

      <nav className="mt-12" aria-labelledby="boards-heading">
        <p id="boards-heading" className="eyebrow mb-1">
          {th("boardsTitle")}
        </p>
        <BoardCards cards={cards} />
        <p className="mt-1 max-w-[46rem] text-xs leading-[1.55] text-tertiary">{th("boardsNote")}</p>
      </nav>

      <section id="ranking" className="mt-6 scroll-mt-6" aria-labelledby="ranking-heading">
        <h2 id="ranking-heading" className="sr-only">
          {tn("ranking")}
        </h2>
        {/* Scoped to just what the client component uses (verified via `grep -rn
            useTranslations components`), instead of the whole locale catalogue the root
            provider used to forward - methodology alone is 61% of es.json and this page
            has no use for it. */}
        <NextIntlClientProvider
          messages={{ table: messages.table, filters: messages.filters }}
        >
          <RankingTable
            rows={packRankingRows(tableRows)}
            minCoverage={meta.min_coverage_for_ranking}
            categoryAges={categoryAges}
          />
        </NextIntlClientProvider>
        <p className="num mt-3 max-w-[60rem] text-2xs leading-[1.6] text-tertiary">
          {th("sourcesLine", {
            snapshots: snapshotLine,
            aging: agingCount,
            degraded: degraded.length + staleDegraded.length,
          })}{" "}
          <Link href="/methodology#fuentes" className="text-accent underline underline-offset-2">
            {th("sourcesLink")}
          </Link>
        </p>
      </section>

      <section className="mt-16" aria-labelledby="trends-heading">
        <h2 id="trends-heading" className="text-lg font-semibold tracking-snug">
          {th("trendsTitle")}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Surface className="p-4">
            <TrendChart
              series={accessTrends}
              domain={trendDomain}
              labelOf={trendLabel}
              title={th("trendAccess")}
              modelsLabel={(count) => th("trendModels", { count })}
            />
          </Surface>
          <Surface className="p-4">
            <TrendChart
              series={countryTrends}
              domain={trendDomain}
              labelOf={trendLabel}
              title={th("trendCountry")}
              modelsLabel={(count) => th("trendModels", { count })}
            />
          </Surface>
        </div>
        <p className="mt-2 max-w-[46rem] text-2xs leading-[1.5] text-tertiary">{trendCaption}</p>
      </section>

      <footer className="mt-12 border-t border-subtle pt-6" aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="sr-only">
          {tf("sources")}
        </h2>
        <p className="max-w-[46rem] text-sm leading-[1.65] text-tertiary">{tf("methodNote")}</p>
        <p className="mt-3 max-w-[46rem] text-sm leading-[1.65] text-tertiary">
          {tf("sourceNote")}
        </p>
        <p className="mt-3 max-w-[46rem] text-sm leading-[1.65] text-tertiary">
          {tf("swebenchNote")}{" "}
          {/* No touch-target padding here on purpose: WCAG 2.5.8 exempts a target
              "in a sentence... constrained by the line-height of non-target text",
              which is exactly this - a link inline in running prose, not a standalone
              control. Padding would make it look like a misplaced chip mid-sentence. */}
          <a
            href="https://www.swebench.com/"
            rel="noopener noreferrer"
            target="_blank"
            className="text-accent underline underline-offset-2"
          >
            {tf("swebenchLink")}
          </a>
          .
        </p>
        <h3 className="eyebrow mt-5">{th("outTitle")}</h3>
        <p className="mt-1 max-w-[46rem] text-sm leading-[1.65] text-tertiary">{th("outNote")}</p>
        {/* Alphabetical by host: an order no one chose. */}
        <ul className="mt-1 flex flex-wrap gap-x-4 text-sm">
          {(
            [
              ["https://artificialanalysis.ai/", th("outAnalysis")],
              ["https://www.designarena.ai/", th("outDesign")],
              ["https://www.swebench.com/", th("outSwebench")],
            ] as const
          ).map(([href, label]) => (
            <li key={href}>
              <a
                href={href}
                rel="noopener noreferrer"
                target="_blank"
                className="inline-block py-1.5 text-accent underline underline-offset-2"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="eyebrow mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href="https://github.com/DDamianZR/ModelHub"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 py-1.5 underline underline-offset-2 transition-opacity hover:opacity-80"
          >
            <IconGitHub className="h-3.5 w-3.5" />
            {tf("repo")}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://dzendreros.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 py-1.5 underline underline-offset-2 transition-opacity hover:opacity-80"
          >
            <IconGlobe className="h-3.5 w-3.5" />
            {tf("portfolio")}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://www.instagram.com/diego_zr.p/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 py-1.5 underline underline-offset-2 transition-opacity hover:opacity-80"
          >
            <IconInstagram className="h-3.5 w-3.5" />
            {tf("instagram")}
          </a>
          <span aria-hidden="true">·</span>
          <span>{tf("license")}</span>
        </div>
      </footer>
    </main>
  );
}
