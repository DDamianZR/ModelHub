import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getAgedSources,
  getCadence,
  getMethodologyStats,
  getRanking,
  getRejectedSnapshots,
} from "@/lib/data";
import { routing } from "@/i18n/routing";
import { CATEGORIES } from "@/lib/types";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const WEIGHTS: Record<string, number> = {
  reasoning: 25,
  coding: 25,
  math: 20,
  human_preference: 15,
  instruction_following: 15,
};

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-6">
      <h2
        className="font-display border-b pb-2 text-lg leading-tight border-subtle"
      >
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-base leading-[1.65] text-tertiary">
        {children}
      </div>
    </section>
  );
}

export default async function MethodologyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("methodology");
  const tt = await getTranslations("table");
  const { meta } = getRanking();
  const rejected = getRejectedSnapshots();
  const aged = getAgedSources();
  const stats = getMethodologyStats();
  const livebench = getCadence("livebench");

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="methodology" />

      <div className="mt-8 max-w-[46rem]">
        <h2 className="font-display text-2xl leading-tight">
          {t("title")}
        </h2>
        <p className="mt-3 text-md leading-[1.65] text-tertiary">
          {t("intro")}
        </p>
      </div>

      <div className="max-w-[46rem]">
        <Section id="formula" title={t("formula.title")}>
          <p>{t("formula.body")}</p>

          <table className="mt-1 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-subtle">
                <th scope="col" className="py-2">
                  <span className="eyebrow">{t("formula.category")}</span>
                </th>
                <th scope="col" className="py-2 text-right">
                  <span className="eyebrow">{t("formula.weight")}</span>
                </th>
                <th scope="col" className="py-2 pl-4">
                  <span className="eyebrow">{t("formula.inputs")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((category) => (
                <tr
                  key={category}
                  className="border-b border-subtle"
                >
                  <th scope="row" className="py-2 text-sm font-normal">
                    {tt(category)}
                  </th>
                  <td className="num py-2 text-right text-sm">{WEIGHTS[category]}%</td>
                  <td className="num py-2 pl-4 text-2xs">
                    {t(`formula.inputs_${category}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p
            className="num mt-1 border-l-2 py-2 pl-3 text-xs leading-[1.6] border-accent"
          >
            {t("formula.equation")}
          </p>

          <p>
            {t("formula.normalisation", {
              min: meta.arena_normalization.min,
              max: meta.arena_normalization.max,
            })}
          </p>

          <p>{t("formula.multimodal")}</p>
        </Section>

        <Section id="uncertainty" title={t("uncertainty.title")}>
          <p>{t("uncertainty.body")}</p>
          <p
            className="border-l-2 py-2 pl-3 text-md border-accent"
          >
            {t("uncertainty.why", {
              medianGap: stats.medianGap,
              stderrLow: stats.stderrLow,
              stderrHigh: stats.stderrHigh,
              identicalPairs: stats.identicalPairs,
            })}
          </p>
          <p>{t("uncertainty.formula")}</p>
          <p>
            {t("uncertainty.floor", {
              measuredInputs: stats.measuredInputs,
              totalInputs: stats.totalInputs,
            })}
          </p>
          <p>{t("uncertainty.sound")}</p>
          <p>
            {t("uncertainty.rank", {
              ranked: stats.ranked,
              distinctRanks: stats.distinctRanks,
              overlappingPairs: stats.overlappingPairs,
              adjacentPairs: stats.adjacentPairs,
            })}
          </p>
          <p>{t("uncertainty.unknown", { withoutInterval: stats.withoutInterval })}</p>
        </Section>

        <Section id="cohort" title={t("cohort.title")}>
          <p>{t("cohort.body")}</p>
          <p
            className="border-l-2 py-2 pl-3 text-md border-accent"
          >
            {t("cohort.measured", { medianGap: stats.medianGap })}
          </p>
          <p>{t("cohort.disclosure")}</p>
          {stats.stillPoints !== null && (
            <p>
              {t("cohort.threshold", {
                medianGap: stats.medianGap,
                stillPoints: stats.stillPoints,
                transitions: stats.transitions,
                moveMedian: stats.moveMedian,
                moveP75: stats.moveP75,
              })}
            </p>
          )}
          <p>{t("cohort.notchanged")}</p>
        </Section>

        <Section id="coverage" title={t("coverage.title")}>
          <p>{t("coverage.body")}</p>
          <p>{t("coverage.example")}</p>
          <p>{t("coverage.newModels")}</p>
          <p className="num text-xs">
            {t("coverage.current", {
              ranked: meta.ranked_count,
              provisional: meta.provisional_count,
              min: meta.min_coverage_for_ranking,
            })}
          </p>
        </Section>

        <Section id="variants" title={t("variants.title")}>
          <p
            className="border-l-2 py-2 pl-3 text-md border-accent"
          >
            {t("variants.tradeoff")}
          </p>
          <p>{t("variants.body")}</p>
          <p>{t("variants.bug")}</p>
          <p>{t("variants.principle")}</p>
          <p>{t("variants.disclosure")}</p>
          <ul className="flex flex-col gap-2 pl-4">
            {(["model", "default", "best", "average", "separate"] as const).map((option) => (
              <li key={option} className="list-disc">
                <span className="num text-xs">{option}</span> —{" "}
                {t(`variants.option_${option}`)}
              </li>
            ))}
          </ul>
          <p>{t("variants.current")}</p>
          <p>{t("variants.arena")}</p>
          <p>{t("variants.mismatch")}</p>
          <p>{t("variants.mismatchBest")}</p>
        </Section>

        <Section id="rejections" title={t("rejections.title")}>
          <p>{t("rejections.body")}</p>
          {rejected.length === 0 ? (
            <p>{t("rejections.none")}</p>
          ) : (
            <div className="overflow-x-auto" role="region" aria-label={t("rejections.title")} tabIndex={0}>
              <table
                className="w-full border-collapse text-left min-w-[34rem]"
              >
                <thead>
                  <tr className="border-b border-subtle">
                    <th scope="col" className="py-2 pr-3">
                      <span className="eyebrow">{t("rejections.date")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      <span className="eyebrow">{t("rejections.source")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      <span className="eyebrow">{t("rejections.ratio")}</span>
                    </th>
                    <th scope="col" className="py-2">
                      <span className="eyebrow">{t("rejections.reason")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rejected.map((row) => (
                    <tr
                      key={`${row.config}-${row.date}`}
                      className="border-b border-subtle"
                    >
                      <td className="num py-2 pr-3 text-xs">{row.date}</td>
                      <td className="num py-2 pr-3 text-xs">
                        lmarena/{row.config}
                      </td>
                      <td className="num py-2 pr-3 text-right text-xs">
                        {row.ratio}×
                      </td>
                      <td className="py-2 text-xs">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-2">
            {livebench?.observed && livebench.cadence_days && livebench.degraded_days
              ? t("rejections.cadence", {
                  declared: livebench.cadence_days,
                  snapshots: livebench.observed.snapshots,
                  median: livebench.observed.median_gap_days,
                  longest: livebench.observed.longest_gap_days,
                  degraded: livebench.degraded_days,
                })
              : t("rejections.cadenceUnknown")}
          </p>
          <ul className="flex flex-col gap-2 pl-4">
            {aged.map((source) => (
              <li key={source.name} className="list-disc">
                <span className="num text-xs">{source.name}</span> —{" "}
                {t("rejections.agedItem", {
                  days: source.age_days ?? 0,
                  state: source.freshness,
                })}
              </li>
            ))}
            {aged.length === 0 && (
              <li className="list-disc">{t("rejections.agedNone")}</li>
            )}
          </ul>
        </Section>

        <Section id="dedup" title={t("dedup.title")}>
          <p>{t("dedup.body")}</p>
          <p>{t("dedup.example")}</p>
          <p>{t("dedup.rule")}</p>
        </Section>

        <Section id="sourceTypes" title={t("sourceTypes.title")}>
          <p>{t("sourceTypes.body")}</p>
          <ul className="flex flex-col gap-2 pl-4">
            {(["human_eval", "third_party_benchmark", "vendor_claim"] as const).map((kind) => (
              <li key={kind} className="list-disc">
                <span className="num text-xs">{kind}</span> —{" "}
                {t(`sourceTypes.${kind}`)}
              </li>
            ))}
          </ul>
          <p>{t("sourceTypes.why")}</p>
        </Section>

        <Section id="breaks" title={t("breaks.title")}>
          <p>{t("breaks.body")}</p>
          <ul className="flex flex-col gap-1 pl-4">
            <li className="list-disc">{t("breaks.b1")}</li>
            <li className="list-disc">{t("breaks.b2")}</li>
            <li className="list-disc">{t("breaks.b3")}</li>
          </ul>
          <p>{t("breaks.window")}</p>
        </Section>

        <Section id="exclusions" title={t("exclusions.title")}>
          <p>{t("exclusions.swebench")}</p>
          <p>{t("exclusions.others")}</p>
        </Section>

        <Section id="reproduce" title={t("reproduce.title")}>
          <p>{t("reproduce.body")}</p>
          <ul className="flex flex-col gap-1 pl-4">
            <li className="list-disc num text-xs">data/models.json</li>
            <li className="list-disc num text-xs">data/scores.json</li>
            <li className="list-disc num text-xs">data/history.jsonl</li>
            <li className="list-disc num text-xs">config/weights.json</li>
            <li className="list-disc num text-xs">data/status.json</li>
          </ul>
          <p>{t("reproduce.git")}</p>
          <p className="mt-1">
            <a
              href="https://github.com/DDamianZR/ModelHub"
              className="eyebrow underline underline-offset-2 text-accent"
            >
              {t("reproduce.link")}
            </a>
          </p>
        </Section>
      </div>
    </main>
  );
}
