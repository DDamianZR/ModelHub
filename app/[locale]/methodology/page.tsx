import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getAgedSources,
  getCadence,
  getCategorySources,
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
        className="border-b rule pb-2 text-[22px] leading-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[14px] leading-[1.65]">{children}</div>
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
  // Recomputed every build. These figures used to be typed into the copy by hand, which
  // made them claims with no source and no date the moment the cohort moved.
  const stats = getMethodologyStats();
  const livebench = getCadence("livebench");
  const categorySources = getCategorySources();

  const muted = { color: "var(--muted)" } as const;

  return (
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="methodology" />

      <div id="main-content" className="mt-8 max-w-[46rem]">
        <h2
          className="text-[30px] leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title")}
        </h2>
        <p className="mt-3 text-[15px] leading-[1.65]" style={muted}>
          {t("intro")}
        </p>
      </div>

      <div className="max-w-[46rem]">
        <Section id="formula" title={t("formula.title")}>
          <p style={muted}>{t("formula.body")}</p>

          <table className="mt-1 w-full border-collapse text-left">
            <thead>
              <tr className="border-b rule">
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
                  <tr key={category} className="border-b rule">
                    <th scope="row" className="py-2 text-[13px] font-normal">
                      {tt(category)}
                    </th>
                    <td className="num py-2 text-right text-[13px]">
                      {WEIGHTS[category]}%
                    </td>
                    <td className="num py-2 pl-4 text-[11px]" style={muted}>
                      {t(`formula.inputs_${category}`)}
                      {singleSource && (
                        <span
                          className="ml-2 inline-block"
                          style={{ color: "var(--amber)" }}
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

          <p className="num mt-1 border-l-2 py-2 pl-3 text-[12px] leading-[1.6]"
             style={{ borderColor: "var(--amber)" }}>
            {t("formula.equation")}
          </p>

          <p style={muted}>{t("formula.normalisation", {
            min: meta.arena_normalization.min,
            max: meta.arena_normalization.max,
          })}</p>

          <p style={muted}>{t("formula.multimodal")}</p>
        </Section>

        <Section id="uncertainty" title={t("uncertainty.title")}>
          <p style={muted}>{t("uncertainty.body")}</p>
          <p
            className="border-l-2 py-2 pl-3 text-[15px]"
            style={{ borderColor: "var(--amber)" }}
          >
            {t("uncertainty.why", {
              medianGap: stats.medianGap,
              stderrLow: stats.stderrLow,
              stderrHigh: stats.stderrHigh,
              identicalPairs: stats.identicalPairs,
            })}
          </p>
          <p style={muted}>{t("uncertainty.formula")}</p>
          <p style={muted}>
            {t("uncertainty.floor", {
              measuredInputs: stats.measuredInputs,
              totalInputs: stats.totalInputs,
            })}
          </p>
          <p style={muted}>{t("uncertainty.sound")}</p>
          <p style={muted}>
            {t("uncertainty.rank", {
              ranked: stats.ranked,
              distinctRanks: stats.distinctRanks,
              overlappingPairs: stats.overlappingPairs,
              adjacentPairs: stats.adjacentPairs,
            })}
          </p>
          <p style={muted}>
            {t("uncertainty.unknown", { withoutInterval: stats.withoutInterval })}
          </p>
        </Section>

        <Section id="cohort" title={t("cohort.title")}>
          <p style={muted}>{t("cohort.body")}</p>
          <p
            className="border-l-2 py-2 pl-3 text-[15px]"
            style={{ borderColor: "var(--amber)" }}
          >
            {t("cohort.measured", { medianGap: stats.medianGap })}
          </p>
          <p style={muted}>{t("cohort.disclosure")}</p>
          {stats.stillPoints !== null && (
            <p style={muted}>
              {t("cohort.threshold", {
                medianGap: stats.medianGap,
                stillPoints: stats.stillPoints,
                transitions: stats.transitions,
                moveMedian: stats.moveMedian,
                moveP75: stats.moveP75,
              })}
            </p>
          )}
          <p style={muted}>{t("cohort.notchanged")}</p>
        </Section>

        <Section id="coverage" title={t("coverage.title")}>
          <p style={muted}>{t("coverage.body")}</p>
          <p style={muted}>{t("coverage.example")}</p>
          <p style={muted}>{t("coverage.newModels")}</p>
          <p className="num text-[12px]" style={muted}>
            {t("coverage.current", {
              ranked: meta.ranked_count,
              provisional: meta.provisional_count,
              min: meta.min_coverage_for_ranking,
            })}
          </p>
          <p style={muted}>{t("coverage.scope", { date: meta.min_release_date })}</p>
        </Section>

        <Section id="variants" title={t("variants.title")}>
          <p
            className="border-l-2 py-2 pl-3 text-[15px]"
            style={{ borderColor: "var(--amber)" }}
          >
            {t("variants.tradeoff")}
          </p>
          <p style={muted}>{t("variants.body")}</p>
          <p style={muted}>{t("variants.bug")}</p>
          <p style={muted}>{t("variants.principle")}</p>
          <p style={muted}>{t("variants.disclosure")}</p>
          <ul className="flex flex-col gap-2 pl-4" style={muted}>
            {(["model", "default", "best", "average", "separate"] as const).map((option) => (
              <li key={option} className="list-disc">
                <span className="num text-[12px]">{option}</span> —{" "}
                {t(`variants.option_${option}`)}
              </li>
            ))}
          </ul>
          <p style={muted}>{t("variants.current")}</p>
          <p style={muted}>{t("variants.arena")}</p>
          <p style={muted}>{t("variants.mismatch")}</p>
          <p style={muted}>{t("variants.mismatchBest")}</p>
        </Section>

        {/* The guards are stated all over this page. This is where they show their work:
            a policy nobody can see fire is indistinguishable from one that never runs. */}
        <Section id="rejections" title={t("rejections.title")}>
          <p style={muted}>{t("rejections.body")}</p>
          {rejected.length === 0 ? (
            <p style={muted}>{t("rejections.none")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left" style={{ minWidth: "34rem" }}>
                <thead>
                  <tr className="border-b rule">
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
                    <tr key={`${row.config}-${row.date}`} className="border-b rule">
                      <td className="num py-2 pr-3 text-[12px]">{row.date}</td>
                      <td className="num py-2 pr-3 text-[12px]" style={muted}>
                        lmarena/{row.config}
                      </td>
                      <td className="num py-2 pr-3 text-right text-[12px]">
                        {row.ratio}×
                      </td>
                      <td className="py-2 text-[12px]" style={muted}>
                        {row.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Declared versus observed, both read from the run that produced this build.
              The fallback exists because the snapshot list is the most fragile fetch in
              the pipeline: when it fails there is no observed rhythm, and saying so is
              better than quoting the last one we happened to remember. */}
          <p className="mt-2" style={muted}>
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
          <ul className="flex flex-col gap-2 pl-4" style={muted}>
            {aged.map((source) => (
              <li key={source.name} className="list-disc">
                <span className="num text-[12px]">{source.name}</span> —{" "}
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
          <p style={muted}>{t("dedup.body")}</p>
          <p style={muted}>{t("dedup.example")}</p>
          <p style={muted}>{t("dedup.rule")}</p>
        </Section>

        <Section id="sourceTypes" title={t("sourceTypes.title")}>
          <p style={muted}>{t("sourceTypes.body")}</p>
          <ul className="flex flex-col gap-2 pl-4" style={muted}>
            {(["human_eval", "third_party_benchmark", "vendor_claim"] as const).map((kind) => (
              <li key={kind} className="list-disc">
                <span className="num text-[12px]">{kind}</span> — {t(`sourceTypes.${kind}`)}
              </li>
            ))}
          </ul>
          <p style={muted}>{t("sourceTypes.why")}</p>
        </Section>

        <Section id="contamination" title={t("contamination.title")}>
          <p style={muted}>{t("contamination.body")}</p>
          <p className="num text-[12px]" style={muted}>
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
          <p style={muted}>{t("breaks.body")}</p>
          <ul className="flex flex-col gap-1 pl-4" style={muted}>
            <li className="list-disc">{t("breaks.b1")}</li>
            <li className="list-disc">{t("breaks.b2")}</li>
            <li className="list-disc">{t("breaks.b3")}</li>
          </ul>
          <p style={muted}>{t("breaks.window")}</p>
        </Section>

        <Section id="exclusions" title={t("exclusions.title")}>
          <p style={muted}>{t("exclusions.swebench")}</p>
          <p style={muted}>{t("exclusions.others")}</p>
        </Section>

        <Section id="reproduce" title={t("reproduce.title")}>
          <p style={muted}>{t("reproduce.body")}</p>
          <ul className="flex flex-col gap-1 pl-4" style={muted}>
            <li className="list-disc num text-[12px]">data/models.json</li>
            <li className="list-disc num text-[12px]">data/scores.json</li>
            <li className="list-disc num text-[12px]">data/history.jsonl</li>
            <li className="list-disc num text-[12px]">config/weights.json</li>
            <li className="list-disc num text-[12px]">data/status.json</li>
          </ul>
          <p style={muted}>{t("reproduce.git")}</p>
          <p className="mt-1">
            <a
              href="https://github.com/DDamianZR/ModelHub"
              className="eyebrow inline-block py-[6px] underline underline-offset-2"
              style={{ color: "var(--amber)" }}
            >
              {t("reproduce.link")}
            </a>
          </p>
        </Section>
      </div>
    </main>
  );
}
