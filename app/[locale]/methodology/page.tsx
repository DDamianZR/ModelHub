import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getBenchmarkReference,
  getRanking,
  getSnapshotDates,
  getWeightAudit,
} from "@/lib/data";
import { routing } from "@/i18n/routing";
import { localeMetadata } from "@/lib/metadata";
import { CATEGORIES } from "@/lib/types";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Without this the page inherits the layout's canonical and declares itself a duplicate
// of the home page.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return localeMetadata(locale, "/methodology");
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
  // Both are files the build has to survive the absence of, so both can be null.
  const reference = getBenchmarkReference();
  const audit = getWeightAudit();
  const snapshots = getSnapshotDates();

  const muted = { color: "var(--muted)" } as const;

  return (
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="methodology" />

      <div className="mt-8 max-w-[46rem]">
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
              {CATEGORIES.map((category) => (
                <tr key={category} className="border-b rule">
                  <th scope="row" className="py-2 text-[13px] font-normal">
                    {tt(category)}
                  </th>
                  <td className="num py-2 text-right text-[13px]">{WEIGHTS[category]}%</td>
                  <td className="num py-2 pl-4 text-[11px]" style={muted}>
                    {t(`formula.inputs_${category}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="num mt-1 border-l-2 py-2 pl-3 text-[12px] leading-[1.6]"
             style={{ borderColor: "var(--amber)" }}>
            {t("formula.equation")}
          </p>

          <p style={muted}>{t("formula.normalisation")}</p>

          <p style={muted}>{t("formula.multimodal")}</p>
        </Section>

        {reference && (
          <Section id="normalisation" title={t("normalisation.title")}>
            <p style={muted}>
              {t("normalisation.problem", {
                hardMedian: reference.benchmarks.frontiermath
                  ? reference.benchmarks.frontiermath.mean.toFixed(1)
                  : "—",
                easyMedian: reference.benchmarks.livebench_math
                  ? reference.benchmarks.livebench_math.mean.toFixed(1)
                  : "—",
              })}
            </p>
            <p style={muted}>{t("normalisation.solution")}</p>

            <p
              className="num mt-1 border-l-2 py-2 pl-3 text-[12px] leading-[1.6]"
              style={{ borderColor: "var(--amber)" }}
            >
              {t("normalisation.formula", { scale: reference.scale_factor })}
            </p>

            <p style={muted}>{t("normalisation.scale", { scale: reference.scale_factor })}</p>
            <p style={muted}>{t("normalisation.cohort")}</p>
            <p style={muted}>{t("normalisation.frozen")}</p>
            <p style={muted}>{t("normalisation.minN", { minN: reference.min_n })}</p>

            <h3 className="eyebrow mt-3">{t("normalisation.referenceTitle")}</h3>
            <div className="overflow-x-auto">
              <table
                className="w-full border-collapse text-left"
                style={{ minWidth: "34rem" }}
              >
                <thead>
                  <tr className="border-b rule">
                    <th scope="col" className="py-2 pr-3">
                      <span className="eyebrow">{t("normalisation.benchmark")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      <span className="eyebrow">{t("normalisation.category")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      <span className="eyebrow">{t("normalisation.n")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      <span className="eyebrow">{t("normalisation.mean")}</span>
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      <span className="eyebrow">{t("normalisation.sd")}</span>
                    </th>
                    <th scope="col" className="py-2 text-right">
                      <span className="eyebrow">{t("normalisation.range")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(reference.benchmarks).map(([id, entry]) => (
                    <tr key={id} className="border-b rule">
                      <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                        {id}
                      </th>
                      <td className="py-2 pr-3 text-[11px]" style={muted}>
                        {entry.category ? tt(entry.category as (typeof CATEGORIES)[number]) : "—"}
                      </td>
                      <td className="num py-2 pr-3 text-right text-[13px]">{entry.n}</td>
                      <td className="num py-2 pr-3 text-right text-[13px]">
                        {entry.mean.toFixed(1)}
                      </td>
                      <td className="num py-2 pr-3 text-right text-[13px]">
                        {entry.sd.toFixed(1)}
                      </td>
                      <td className="num py-2 text-right text-[11px]" style={muted}>
                        {entry.observed_min.toFixed(1)} – {entry.observed_max.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {Object.keys(reference.excluded).length > 0 && (
              <>
                <h3 className="eyebrow mt-3">{t("normalisation.excludedTitle")}</h3>
                <ul className="flex flex-col gap-1 pl-4" style={muted}>
                  {Object.entries(reference.excluded).map(([id, entry]) => (
                    <li key={id} className="list-disc text-[13px]">
                      <span className="num text-[12px]">{id}</span> — n={entry.n} ·{" "}
                      {entry.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="num text-[12px]" style={muted}>
              {t("normalisation.clipped", { count: meta.normalization.clipped_scores })}
            </p>
            <p className="num text-[12px]" style={muted}>
              {t("normalisation.computedAt", {
                date: reference.computed_at,
                version: reference.methodology_version,
              })}
            </p>
          </Section>
        )}

        <Section id="weights" title={t("weights.title")}>
          <p style={muted}>{t("weights.body")}</p>
          {audit ? (
            <>
              <p style={muted}>
                {t("weights.measured", { n: audit.n_models_full_coverage })}
              </p>
              <div className="overflow-x-auto">
                <table
                  className="w-full border-collapse text-left"
                  style={{ minWidth: "30rem" }}
                >
                  <thead>
                    <tr className="border-b rule">
                      <th scope="col" className="py-2 pr-3">
                        <span className="eyebrow">{t("weights.category")}</span>
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right">
                        <span className="eyebrow">{t("weights.nominal")}</span>
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right">
                        <span className="eyebrow">{t("weights.effective")}</span>
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right">
                        <span className="eyebrow">{t("weights.spread")}</span>
                      </th>
                      <th scope="col" className="py-2 text-right">
                        <span className="eyebrow">{t("weights.benchmarks")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map((category) => {
                      const entry = audit.categories[category];
                      if (!entry) return null;
                      return (
                        <tr key={category} className="border-b rule">
                          <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                            {tt(category)}
                          </th>
                          <td className="num py-2 pr-3 text-right text-[13px]">
                            {Math.round(entry.nominal * 100)}%
                          </td>
                          <td className="num py-2 pr-3 text-right text-[13px]">
                            {entry.effective === null
                              ? "—"
                              : `${Math.round(entry.effective * 100)}%`}
                          </td>
                          <td className="num py-2 pr-3 text-right text-[13px]" style={muted}>
                            {entry.category_sd ?? "—"}
                          </td>
                          <td className="num py-2 text-right text-[11px]" style={muted}>
                            {entry.benchmarks_per_model
                              ? Object.entries(entry.benchmarks_per_model)
                                  .map(([count, models]) => `${models}×${count}`)
                                  .join(" · ")
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={muted}>{t("weights.residual")}</p>
              <p
                className="border-l-2 py-2 pl-3 text-[15px]"
                style={{ borderColor: "var(--amber)" }}
              >
                {t("weights.honest")}
              </p>
            </>
          ) : (
            <p style={muted}>{t("weights.unavailable")}</p>
          )}
        </Section>

        <Section id="version" title={t("version.title")}>
          <p className="num text-[13px]">
            {t("version.current", { version: meta.methodology_version ?? "—" })}
          </p>
          <p style={muted}>{t("version.body")}</p>
          <ul className="flex flex-col gap-2 pl-4" style={muted}>
            <li className="list-disc">{t("version.v11")}</li>
            <li className="list-disc">{t("version.v10")}</li>
          </ul>
          <p className="mt-1">
            <a
              href="https://github.com/DDamianZR/ModelHub/blob/main/CHANGELOG-methodology.md"
              className="eyebrow underline underline-offset-2"
              style={{ color: "var(--amber)" }}
            >
              {t("version.changelogLink")}
            </a>
          </p>
          <p style={muted}>{t("version.snapshots")}</p>
          {snapshots.length > 0 && (
            <ul className="num flex flex-wrap gap-x-4 gap-y-1 pl-4 text-[13px]">
              {snapshots.map((date) => (
                <li key={date}>
                  <a
                    href={`/${locale}/snapshot/${date}`}
                    className="underline underline-offset-2"
                    style={{ color: "var(--amber)" }}
                  >
                    {date}
                  </a>
                </li>
              ))}
            </ul>
          )}
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
              className="eyebrow underline underline-offset-2"
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
