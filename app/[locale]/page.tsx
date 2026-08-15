import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { RankingTable } from "@/components/RankingTable";
import { SiteHeader } from "@/components/SiteHeader";
import { IconGitHub, IconGlobe, IconInstagram } from "@/components/icons";
import { getAgedSources, getCategoryAges, getDegradedSources, getRanking } from "@/lib/data";
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
  const messages = await getMessages();

  const { rows, meta, sourceCount } = getRanking();
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

      <div className="pt-6">
        <p
          className="mt-6 max-w-[46rem] text-[15px] leading-[1.6]"
          style={{ color: "var(--text-tertiary)" }}
        >
          {t("blurb")}
        </p>

        {/* Instrument panel: the state of the data, stated before any ranking is shown.
            Heading is sr-only: it gives the section a landmark a screen reader can jump
            to without adding visible text the layout wasn't designed around. */}
        <h2 className="sr-only">{tp("statusHeading")}</h2>
        <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-3 border-y py-3"
          style={{ borderColor: "var(--line-subtle)" }}>
          {readings.map(([label, value]) => (
            <div key={label}>
              <dt className="eyebrow">{label}</dt>
              <dd className="num text-[15px]">{value}</dd>
            </div>
          ))}
          <div className="ml-auto">
            <dt className="eyebrow">{tp("snapshots")}</dt>
            <dd className="num text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {Object.entries(meta.snapshots)
                .filter(([, value]) => value)
                .map(([key, value]) => `${key} ${value}`)
                .join("  ·  ")}
            </dd>
          </div>
        </dl>
      </div>

      {degraded.length > 0 && (
        <p
          className="mt-4 border-l-2 py-1 pl-3 text-[12px] leading-[1.6]"
          style={{ borderColor: "var(--accent)", color: "var(--text-tertiary)" }}
        >
          <span className="eyebrow" style={{ color: "var(--accent)" }}>
            {tp("degraded")}
          </span>{" "}
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
        <p
          className="mt-4 border-l-2 py-1 pl-3 text-[12px] leading-[1.6]"
          style={{ borderColor: "var(--accent)", color: "var(--text-tertiary)" }}
        >
          <span className="eyebrow" style={{ color: "var(--accent)" }}>
            {tp("aging")}
          </span>{" "}
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

      <section className="mt-8" aria-labelledby="ranking-heading">
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
            rows={rows}
            minCoverage={meta.min_coverage_for_ranking}
            categoryAges={categoryAges}
          />
        </NextIntlClientProvider>
      </section>

      <footer
        className="mt-12 border-t pt-6"
        style={{ borderColor: "var(--line-subtle)" }}
      >
        <p
          className="max-w-[46rem] text-[13px] leading-[1.65]"
          style={{ color: "var(--text-tertiary)" }}
        >
          {tf("methodNote")}
        </p>
        <p
          className="mt-3 max-w-[46rem] text-[13px] leading-[1.65]"
          style={{ color: "var(--text-tertiary)" }}
        >
          {tf("sourceNote")}
        </p>
        <p
          className="mt-3 max-w-[46rem] text-[13px] leading-[1.65]"
          style={{ color: "var(--text-tertiary)" }}
        >
          {tf("swebenchNote")}{" "}
          {/* No touch-target padding here on purpose: WCAG 2.5.8 exempts a target
              "in a sentence... constrained by the line-height of non-target text",
              which is exactly this - a link inline in running prose, not a standalone
              control. Padding would make it look like a misplaced chip mid-sentence. */}
          <a
            href="https://www.swebench.com/"
            rel="noopener noreferrer"
            target="_blank"
            className="underline underline-offset-2"
            style={{ color: "var(--accent)" }}
          >
            {tf("swebenchLink")}
          </a>
          .
        </p>
        <div className="eyebrow mt-5 flex flex-wrap items-center gap-x-4 gap-y-2"
          style={{ color: "var(--text-tertiary)" }}>
          <a
            href="https://github.com/DDamianZR/ModelHub"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 py-1.5 underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            <IconGitHub className="w-3.5 h-3.5" />
            {tf("repo")}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://ddzendreros.github.io/dzendreros"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 py-1.5 underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            <IconGlobe className="w-3.5 h-3.5" />
            {tf("portfolio")}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://www.instagram.com/diego_zr.p/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 py-1.5 underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            <IconInstagram className="w-3.5 h-3.5" />
            {tf("instagram")}
          </a>
          <span aria-hidden="true">·</span>
          <span>{tf("license")}</span>
        </div>
      </footer>
    </main>
  );
}
