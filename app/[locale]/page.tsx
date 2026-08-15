import { getTranslations, setRequestLocale } from "next-intl/server";
import { RankingTable } from "@/components/RankingTable";
import { SiteHeader } from "@/components/SiteHeader";
import { IconGitHub, IconGlobe, IconInstagram } from "@/components/icons";
import {
  getAgedSources,
  getCategoryAges,
  getDegradedSources,
  getRanking,
  getRankingRows,
} from "@/lib/data";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
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

  const { rows, meta, sourceCount } = getRanking();
  // The table gets the narrowed projection, not the full Row: fields the ranking never
  // reads were being serialised into every browser, including two that are 0/65 populated.
  const tableRows = getRankingRows();
  const degraded = getDegradedSources();
  const aged = getAgedSources();
  const categoryAges = getCategoryAges();
  const openWeights = rows.filter((r) => r.is_open_weights).length;

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
        <p className="mt-6 hidden max-w-[46rem] text-md leading-[1.6] text-tertiary sm:block">
          {t("blurb")}
        </p>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-y border-subtle py-2 sm:mt-7 sm:gap-x-10 sm:gap-y-3 sm:py-3">
          {readings.map(([label, value], i) => (
            <div key={label} className={i > 1 ? "hidden sm:block" : undefined}>
              <dt className="eyebrow">{label}</dt>
              <dd className="num text-sm sm:text-md">{value}</dd>
            </div>
          ))}
          <div className="ml-auto hidden sm:block">
            <dt className="eyebrow">{tp("snapshots")}</dt>
            <dd className="num text-2xs text-tertiary">
              {Object.entries(meta.snapshots)
                .filter(([, value]) => value)
                .map(([key, value]) => `${key} ${value}`)
                .join("  ·  ")}
            </dd>
          </div>
        </dl>

        {degraded.length > 0 && (
          <p className="note note-accent mt-4 text-xs leading-[1.6]">
            <span className="eyebrow text-accent">{tp("degraded")}</span>{" "}
            {degraded
              .map((entry) =>
                tp("degradedSource", {
                  source: entry.name,
                  date: entry.status.last_success ?? "—",
                }),
              )
              .join(" · ")}
          </p>
        )}

        {aged.length > 0 && (
          <p className="note note-accent mt-4 text-xs leading-[1.6]">
            <span className="eyebrow text-accent">{tp("aging")}</span>{" "}
            {aged
              .map((entry) =>
                tp("agingSource", {
                  source: entry.name,
                  days: entry.age_days ?? 0,
                  date: entry.date ?? "—",
                }),
              )
              .join(" · ")}
          </p>
        )}
      </section>

      <section id="ranking" className="mt-3 scroll-mt-6 sm:mt-8" aria-labelledby="ranking-heading">
        <h2 id="ranking-heading" className="sr-only">
          {tn("ranking")}
        </h2>
        <RankingTable
          rows={tableRows}
          minCoverage={meta.min_coverage_for_ranking}
          categoryAges={categoryAges}
        />
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
        <div className="eyebrow mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href="https://github.com/DDamianZR/ModelHub"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 underline underline-offset-2 transition-opacity hover:opacity-80"
          >
            <IconGitHub className="h-3.5 w-3.5" />
            {tf("repo")}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://ddzendreros.github.io/dzendreros"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 underline underline-offset-2 transition-opacity hover:opacity-80"
          >
            <IconGlobe className="h-3.5 w-3.5" />
            {tf("portfolio")}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://www.instagram.com/diego_zr.p/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 underline underline-offset-2 transition-opacity hover:opacity-80"
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
