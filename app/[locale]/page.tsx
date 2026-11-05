import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { BoardCards } from "@/components/BoardCards";
import { JsonLd } from "@/components/JsonLd";
import { RankingTable } from "@/components/RankingTable";
import { ScatterChart } from "@/components/ScatterChart";
import { SiteHeader } from "@/components/SiteHeader";
import { Surface } from "@/components/Surface";
import { TrendChart } from "@/components/TrendChart";
import { IconGitHub, IconGlobe, IconInstagram } from "@/components/icons";
import {
  getAgedSources,
  getCategoryAges,
  getCategoryRules,
  getDegradedSources,
  getRanking,
  getRankingRows,
} from "@/lib/data";
import {
  getAccessTrends,
  getBoardCards,
  getCountryTrends,
  getScatterPoints,
  getTopModels,
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

  const t = await getTranslations("masthead");
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
  const rules = getCategoryRules();
  const ttable = await getTranslations("table");
  const categoryAges = getCategoryAges();
  const openWeights = rows.filter((r) => r.is_open_weights).length;

  const th = await getTranslations("home");
  const { cards } = getBoardCards();
  const { top, rankedCount, tiedBeyond } = getTopModels(3);
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

  const readings: [string, string][] = [
    [tp("updated"), meta.generated_at],
    [tp("models"), String(rows.length)],
    [tp("sources"), String(sourceCount)],
    [tp("openWeights"), `${openWeights}/${rows.length}`],
  ];

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="ranking" />

      {/* Instrument panel: the state of the data, stated before any ranking is shown.
          On mobile the prose and the snapshot list step aside — the state is still
          declared, but in two readings rather than six lines. */}
      <section className="pt-3 sm:pt-6" aria-labelledby="state-heading">
        <h2 id="state-heading" className="sr-only">
          {tp("snapshots")}
        </h2>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 sm:mt-8">
          <p className="num text-2xl leading-none font-semibold tracking-tight">
            {th("dataDate", { date: meta.generated_at })}
          </p>
          <p className="text-sm text-tertiary">{th("dataDateSub")}</p>
        </div>
        <p className="mt-3 hidden max-w-[46rem] text-base leading-[1.6] text-tertiary sm:block">
          {t("blurb")}
        </p>

        <Surface
          as="dl"
          className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 p-4 sm:mt-5 sm:grid-cols-4 sm:gap-x-8 sm:p-4"
        >
          {readings.map(([label, value], i) => (
            <div key={label} className={i > 1 ? "hidden sm:block" : undefined}>
              <dt className="eyebrow">{label}</dt>
              <dd className="num text-sm sm:text-md">{value}</dd>
            </div>
          ))}
          <div className="col-span-2 hidden border-t border-subtle pt-3 sm:col-span-4 sm:block">
            <dt className="eyebrow">{tp("snapshots")}</dt>
            <dd className="num text-2xs text-tertiary">
              {Object.entries(meta.snapshots)
                .filter(([, value]) => value)
                .map(([key, value]) => `${key} ${value}`)
                .join("  ·  ")}
            </dd>
          </div>
        </Surface>

        {(degraded.length > 0 || staleDegraded.length > 0) && (
          <Surface className="surface-attention mt-4 p-3 text-xs leading-[1.6]">
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

        {rules.length > 0 && (
          <p className="mt-4 max-w-[60rem] text-xs leading-[1.6] text-tertiary">
            {rules.map((entry) => (
              <span key={entry.name} className="block">
                {tp("ruleHeading", { source: entry.name })}{" "}
                {entry.rules
                  .map(([category, rule]) =>
                    tp("ruleItem", {
                      category: ttable(category),
                      release: rule.release,
                      reason: rule.reason,
                      drift: rule.drift == null ? "—" : rule.drift.toFixed(1),
                    }),
                  )
                  .join("; ")}
                .
                {entry.skipped.length > 0 &&
                  ` ${tp("ruleSkipped", {
                    list: entry.skipped.map((s) => `${s.date} (${s.reason})`).join(", "),
                  })}`}
              </span>
            ))}
          </p>
        )}
      </section>

      <JsonLd data={siteJsonLd} />

      <section className="mt-8" aria-labelledby="boards-heading">
        <h2 id="boards-heading" className="text-lg font-semibold tracking-snug">
          {th("boardsTitle")}
        </h2>
        <p className="mt-1 max-w-[46rem] text-sm leading-[1.6] text-tertiary">{th("boardsNote")}</p>
        <div className="mt-3">
          <BoardCards cards={cards} rankedCount={rankedCount} />
        </div>
      </section>

      <section className="mt-8" aria-labelledby="top-heading">
        <h2 id="top-heading" className="text-lg font-semibold tracking-snug">
          {th("topTitle")}
        </h2>
        <p className="mt-1 max-w-[46rem] text-sm leading-[1.6] text-tertiary">{th("topNote")}</p>
        <ol className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {top.map((model) => (
            <li key={model.id}>
              <Surface className="flex h-full flex-col gap-2 p-4">
                <span className="num text-xl leading-none tracking-snug">
                  {model.rank === null ? "·" : `${model.tied_with > 0 ? "=" : "#"}${model.rank}/${rankedCount}`}
                </span>
                <Link
                  href={`/model/${model.id}`}
                  className="row-shift text-md underline-offset-2 hover:underline"
                >
                  {model.display_name}
                </Link>
                <span className="num text-2xs text-tertiary">{model.provider_name}</span>
                <span className="num mt-auto text-sm">
                  {model.composite.toFixed(1)}
                  <span className="ml-1 text-2xs text-tertiary">
                    {model.composite_error === null ? "±?" : `±${model.composite_error.toFixed(2)}`}
                  </span>
                </span>
              </Surface>
            </li>
          ))}
        </ol>
        {tiedBeyond > 0 && (
          <p className="num mt-2 text-2xs text-tertiary">{th("topTied", { count: tiedBeyond })}</p>
        )}
      </section>

      <section id="ranking" className="mt-8 scroll-mt-6" aria-labelledby="ranking-heading">
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
            rows={tableRows}
            minCoverage={meta.min_coverage_for_ranking}
            categoryAges={categoryAges}
          />
        </NextIntlClientProvider>
      </section>

      <section className="mt-8" aria-labelledby="scatter-heading">
        <h2 id="scatter-heading" className="text-lg font-semibold tracking-snug">
          {th("scatterTitle")}
        </h2>
        <p className="mt-1 max-w-[46rem] text-sm leading-[1.6] text-tertiary">
          {th("scatterNote", {
            models: bestBy.meta.pareto_evaluated,
            input: bestBy.meta.price_blend.input,
            output: bestBy.meta.price_blend.output,
          })}
        </p>
        <Surface className="mt-3 p-4">
          <ScatterChart
            points={scatter}
            locale={locale}
            labels={{
              figure: th("scatter.figure"),
              xAxis: th("scatter.xAxis"),
              yAxis: th("scatter.yAxis"),
              frontier: th("scatter.frontier"),
              others: th("scatter.others"),
              tooltip: (p) =>
                th("scatter.tooltip", {
                  name: p.name,
                  composite: p.composite.toFixed(1),
                  price: p.price.toFixed(p.price < 1 ? 3 : 2),
                }),
            }}
          />
          {/* The same frontier as text: the figure labels it, this list is what a screen
              reader (or anyone who cannot resolve the marks) reads. */}
          <h3 className="eyebrow mt-4">{th("scatter.frontierList")}</h3>
          <ul className="num mt-1 flex flex-col gap-0.5 text-xs">
            {frontierList.map((p) => (
              <li key={p.id}>
                <Link href={`/model/${p.id}`} className="underline-offset-2 hover:underline">
                  {p.name}
                </Link>{" "}
                <span className="text-tertiary">
                  {th("scatter.frontierItem", {
                    composite: p.composite.toFixed(1),
                    price: p.price.toFixed(p.price < 1 ? 3 : 2),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Surface>
      </section>

      <section className="mt-8" aria-labelledby="trends-heading">
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
            href="https://ddzendreros.github.io/dzendreros"
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
