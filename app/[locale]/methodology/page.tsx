import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { Surface } from "@/components/Surface";
import {
  getAgedSources,
  getBestBy,
  getCadence,
  getCategoryRules,
  getCategorySources,
  getFx,
  getMethodologyStats,
  getPlanMaxAgeDays,
  getRanking,
  getRejectedSnapshots,
  getSiteWeights,
} from "@/lib/data";
import { minCoveredShare } from "@/lib/composite";
import { routing } from "@/i18n/routing";
import { formatRate } from "@/lib/currency";
import { analyticsScriptSrc } from "@/lib/measurement";
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
      <h2 className="border-b border-subtle pb-2 text-lg leading-tight font-semibold">
        {title}
      </h2>
      <Surface className="mt-3 flex flex-col gap-3 p-4 text-base leading-[1.65] text-tertiary">
        {children}
      </Surface>
    </section>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "methodology" });
  return pageMetadata({
    locale,
    path: "/methodology",
    title: `${t("title")} · ModelHub`,
    description: t("intro"),
  });
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
  const tp = await getTranslations("panel");
  const { meta } = getRanking();
  const rejected = getRejectedSnapshots();
  const aged = getAgedSources();
  const stats = getMethodologyStats();
  const livebench = getCadence("livebench");
  const categorySources = getCategorySources();
  const categoryRules = getCategoryRules();
  const bestBy = getBestBy();
  const blend = bestBy.meta.price_blend;
  const fx = getFx();
  const countingVisits = analyticsScriptSrc() !== null;
  const site = getSiteWeights();
  const coverageBar = minCoveredShare(site.weights, site.minCoverage);
  const planMaxAgeDays = getPlanMaxAgeDays();

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="methodology" />

      <div className="mt-8 max-w-[46rem]">
        <h1 className="text-4xl leading-tight font-semibold tracking-tight">
          {t("title")}
        </h1>
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
              {CATEGORIES.map((category) => {
                const singleSource = (categorySources[category]?.length ?? 0) === 1;
                return (
                  <tr key={category} className="border-b border-subtle">
                    <th scope="row" className="py-2 text-sm font-normal">
                      {tt(category)}
                    </th>
                    <td className="num py-2 text-right text-sm">{WEIGHTS[category]}%</td>
                    <td className="num py-2 pl-4 text-2xs text-tertiary">
                      {t(`formula.inputs_${category}`)}
                      {singleSource && (
                        <span
                          className="ml-2 inline-block text-accent"
                          title={t("formula.singleSourceNote")}
                        >
                          · {t("formula.singleSource")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="num mt-1 border-l-[3px] border-accent py-2 pl-3 text-xs leading-[1.6]">
            {t("formula.equation")}
          </p>

          <p>
            {t("formula.normalisation", {
              min: meta.arena_normalization.min,
              max: meta.arena_normalization.max,
            })}
          </p>

          <p>{t("formula.multimodal")}</p>

          <p>{t("formula.knowledge")}</p>
        </Section>

        {categoryRules.map((entry) => (
          <Section key={entry.name} id="fuentes" title={t("releases.title", { source: entry.name })}>
            <p className="num text-xs">
              {t("releases.cutoffs", {
                snapshots: Object.entries(meta.snapshots)
                  .filter(([, value]) => value)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(" · "),
              })}
            </p>
            <p>{t("releases.body", { source: entry.name })}</p>
            {entry.skipped.length > 0 && (
              <p>
                {tp("ruleSkipped", {
                  list: entry.skipped.map((s) => `${s.date} (${s.reason})`).join(", "),
                })}
              </p>
            )}
            <p>
              {t("releases.comparable", {
                maxDrift: entry.rules[0]?.[1].max_drift ?? 0,
                minCommon: entry.rules[0]?.[1].min_common_models ?? 0,
              })}
            </p>
            <p>{t("releases.notComparable")}</p>
            <p>{t("releases.single")}</p>
            <table className="mt-1 w-full border-collapse text-left">
              <caption className="pb-2 text-left text-xs">{t("releases.measured")}</caption>
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="py-2">
                    <span className="eyebrow">{t("formula.category")}</span>
                  </th>
                  <th scope="col" className="py-2">
                    <span className="eyebrow">{t("releases.release")}</span>
                  </th>
                  <th scope="col" className="py-2 text-right">
                    <span className="eyebrow">{t("releases.drift")}</span>
                  </th>
                  <th scope="col" className="py-2 text-right">
                    <span className="eyebrow">{t("releases.shared")}</span>
                  </th>
                  <th scope="col" className="py-2 pl-4">
                    <span className="eyebrow">{t("releases.decision")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry.rules.map(([category, rule]) => (
                  <tr key={category} className="border-b border-subtle">
                    <th scope="row" className="py-2 pr-4 text-sm font-normal">
                      {tt(category)}
                    </th>
                    <td className="num py-2 text-xs">{rule.release}</td>
                    <td className="num py-2 text-right text-xs">
                      {rule.drift == null ? "—" : rule.drift.toFixed(2)}
                    </td>
                    <td className="num py-2 text-right text-xs">{rule.common_models}</td>
                    <td className="py-2 pl-4 text-2xs text-tertiary">
                      {t(`releases.reason.${rule.reason}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>{t("releases.limits")}</p>
          </Section>
        ))}

        <Section id="uncertainty" title={t("uncertainty.title")}>
          <p>{t("uncertainty.body")}</p>
          <p className="border-l-[3px] border-accent py-2 pl-3 text-md">
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
          <p className="border-l-[3px] border-accent py-2 pl-3 text-md">
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
          <p>{t("coverage.reweight", { share: Math.round(coverageBar * 100) })}</p>
          <p>{t("coverage.scope", { date: meta.min_release_date })}</p>
        </Section>

        <Section id="variants" title={t("variants.title")}>
          <p className="border-l-[3px] border-accent py-2 pl-3 text-md">
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
            <div className="relative overflow-x-auto" role="region" aria-label={t("rejections.title")} tabIndex={0}>
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

        <Section id="derived" title={t("derived.title")}>
          <p>{t("derived.body")}</p>
          <p>
            {t("derived.blend", {
              input: blend.input,
              output: blend.output,
              total: blend.input + blend.output,
            })}
          </p>
          <p>
            {fx
              ? t("derived.currency", { rate: formatRate(fx.mxn), date: fx.date })
              : t("derived.currencyNone")}
          </p>
          <p>{t("derived.plans")}</p>
          {planMaxAgeDays !== null && (
            <p>{t("derived.plansExpiry", { days: planMaxAgeDays })}</p>
          )}
          <p>{t("derived.ratio", { evaluated: bestBy.meta.pareto_evaluated })}</p>
          <p>
            {t("derived.pareto", {
              members: bestBy.meta.pareto_members,
              evaluated: bestBy.meta.pareto_evaluated,
            })}
          </p>
          <p>
            {t("derived.unevaluated", {
              unpriced: meta.ranked_count - bestBy.meta.pareto_evaluated,
            })}
          </p>
          <p>{t("derived.rules")}</p>
          <ul className="flex flex-col gap-1 pl-4">
            {bestBy.boards.map((board) => (
              <li key={board.id} className="list-disc">
                {t(`derived.rule_${board.id}`)} ·{" "}
                <span className="num text-xs">
                  {t("derived.candidates", { count: board.candidates })}
                </span>
              </li>
            ))}
          </ul>
          <p>{t("derived.ties")}</p>
          <p>{t("derived.cheapest")}</p>
        </Section>

        <Section id="local" title={t("local.title")}>
          <p>{t("local.body")}</p>
          <p>{t("local.catalogue")}</p>
          <p>{t("local.memory")}</p>
          <p>{t("local.bands")}</p>
          <p>{t("local.modes")}</p>
          <p>{t("local.speed")}</p>
          <p>{t("local.limits")}</p>
          <p>{t("local.attribution")}</p>
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

        <Section id="contamination" title={t("contamination.title")}>
          <p>{t("contamination.body")}</p>
          <p className="num text-xs">
            {meta.contamination_reviewed_at
              ? stats.contaminatedBenchmarks > 0
                ? t("contamination.count", {
                    date: meta.contamination_reviewed_at,
                    count: stats.contaminatedBenchmarks,
                  })
                : t("contamination.empty", { date: meta.contamination_reviewed_at })
              : null}
          </p>
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
              className="eyebrow inline-block py-[6px] underline underline-offset-2 text-accent"
            >
              {t("reproduce.link")}
            </a>
          </p>
        </Section>

        {/* Says what the layout actually does: both read the same switch, so this cannot
            claim a counter that is not loaded or hide one that is. */}
        <Section id="visits" title={t("visits.title")}>
          {countingVisits ? (
            <>
              <p>{t("visits.on")}</p>
              <p>{t("visits.stored")}</p>
              <p className="mt-1">
                <a
                  href="https://vercel.com/docs/analytics/privacy-policy"
                  className="eyebrow inline-block py-[6px] underline underline-offset-2 text-accent"
                >
                  {t("visits.link")}
                </a>
              </p>
            </>
          ) : (
            <p>{t("visits.off")}</p>
          )}
        </Section>
      </div>
    </main>
  );
}
