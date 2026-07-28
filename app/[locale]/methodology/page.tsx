import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { getRanking } from "@/lib/data";
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

          <p style={muted}>{t("formula.normalisation", {
            min: meta.arena_normalization.min,
            max: meta.arena_normalization.max,
          })}</p>

          <p style={muted}>{t("formula.multimodal")}</p>
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
          <p style={muted}>{t("variants.body")}</p>
          <p style={muted}>{t("variants.bug")}</p>
          <p
            className="border-l-2 py-2 pl-3"
            style={{ borderColor: "var(--amber)", color: "var(--muted)" }}
          >
            {t("variants.disclosure")}
          </p>
          <ul className="flex flex-col gap-2 pl-4" style={muted}>
            {(["default", "best", "average", "separate"] as const).map((option) => (
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
