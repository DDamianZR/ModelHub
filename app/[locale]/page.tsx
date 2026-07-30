import { getTranslations, setRequestLocale } from "next-intl/server";
import { RankingTable } from "@/components/RankingTable";
import { SiteHeader } from "@/components/SiteHeader";
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
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="ranking" />

      <div className="pt-6">
        <p
          className="mt-6 max-w-[46rem] text-[15px] leading-[1.6]"
          style={{ color: "var(--muted)" }}
        >
          {t("blurb")}
        </p>

        {/* Instrument panel: the state of the data, stated before any ranking is shown. */}
        <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-3 border-y rule py-3">
          {readings.map(([label, value]) => (
            <div key={label}>
              <dt className="eyebrow">{label}</dt>
              <dd className="num text-[15px]">{value}</dd>
            </div>
          ))}
          <div className="ml-auto">
            <dt className="eyebrow">{tp("snapshots")}</dt>
            <dd className="num text-[11px]" style={{ color: "var(--muted)" }}>
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
          style={{ borderColor: "var(--amber)", color: "var(--muted)" }}
        >
          <span className="eyebrow" style={{ color: "var(--amber)" }}>
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
          style={{ borderColor: "var(--amber)", color: "var(--muted)" }}
        >
          <span className="eyebrow" style={{ color: "var(--amber)" }}>
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

      <section className="mt-8">
        <RankingTable
          rows={rows}
          minCoverage={meta.min_coverage_for_ranking}
          categoryAges={categoryAges}
        />
      </section>

      <footer className="mt-12 border-t rule pt-6">
        <p
          className="max-w-[46rem] text-[13px] leading-[1.65]"
          style={{ color: "var(--muted)" }}
        >
          {tf("methodNote")}
        </p>
        <p
          className="mt-3 max-w-[46rem] text-[13px] leading-[1.65]"
          style={{ color: "var(--muted)" }}
        >
          {tf("sourceNote")}
        </p>
        <p
          className="mt-3 max-w-[46rem] text-[13px] leading-[1.65]"
          style={{ color: "var(--muted)" }}
        >
          {tf("swebenchNote")}{" "}
          <a
            href="https://www.swebench.com/"
            rel="noopener noreferrer"
            target="_blank"
            className="underline underline-offset-2"
            style={{ color: "var(--amber)" }}
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
            className="flex items-center gap-1.5 underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            {tf("repo")}
          </a>
          <span>·</span>
          <a
            href="https://ddzendreros.github.io/dzendreros"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            <svg className="w-3.5 h-3.5 stroke-current fill-none" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            {tf("portfolio")}
          </a>
          <span>·</span>
          <a
            href="https://www.instagram.com/diego_zr.p/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
            {tf("instagram")}
          </a>
          <span>·</span>
          <span>{tf("license")}</span>
        </div>
      </footer>
    </main>
  );
}
