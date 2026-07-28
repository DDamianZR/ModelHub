import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { RankingTable } from "@/components/RankingTable";
import { getRanking } from "@/lib/data";

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
  const tl = await getTranslations("locale");

  const { rows, meta, sourceCount } = getRanking();
  const openWeights = rows.filter((r) => r.is_open_weights).length;
  const other = locale === "es" ? "en" : "es";

  const readings: [string, string][] = [
    [tp("updated"), meta.generated_at],
    [tp("models"), String(rows.length)],
    [tp("sources"), String(sourceCount)],
    [tp("openWeights"), `${openWeights}/${rows.length}`],
  ];

  return (
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <header className="pt-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1
              className="text-[42px] leading-[1.05] tracking-[-0.01em] sm:text-[56px]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("wordmark")}
            </h1>
            <p className="eyebrow mt-1">{t("tagline")}</p>
          </div>

          <Link
            href="/"
            locale={other}
            className="eyebrow row-shift shrink-0 border px-2 py-[3px]"
            style={{ borderColor: "var(--rule)" }}
            aria-label={tl("label")}
          >
            {tl("switch")}
          </Link>
        </div>

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
      </header>

      <section className="mt-8">
        <RankingTable rows={rows} minCoverage={meta.min_coverage_for_ranking} />
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
        <p className="eyebrow mt-5">
          <a
            href="https://github.com/DDamianZR/ModelHub"
            className="underline underline-offset-2"
          >
            {tf("repo")}
          </a>
          {"  ·  "}
          {tf("license")}
        </p>
      </footer>
    </main>
  );
}
