import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { getSnapshot, getSnapshotDates } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { localeMetadata } from "@/lib/metadata";
import { resolveSiteOrigin } from "@/lib/site-url";

/**
 * A citable ranking: the numbers as they stood on one date, read from the stored series and
 * never recomputed.
 *
 * The whole point is that this page does not move. A leaderboard whose numbers change under
 * a citation cannot be cited, so a past date is rendered from what was written that day and
 * carries the methodology version that produced it. A date whose rows do not agree on one
 * version is refused rather than rendered — see getSnapshot().
 */
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getSnapshotDates().map((date) => ({ locale, date })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; date: string }>;
}): Promise<Metadata> {
  const { locale, date } = await params;
  return localeMetadata(locale, `/snapshot/${date}`);
}

export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ locale: string; date: string }>;
}) {
  const { locale, date } = await params;
  setRequestLocale(locale);

  const snapshot = getSnapshot(date);
  if (!snapshot) notFound();

  const t = await getTranslations("snapshot");
  const muted = { color: "var(--muted)" } as const;

  const origin = resolveSiteOrigin();
  const permalink = origin
    ? `${origin}/${locale}/snapshot/${snapshot.date}`
    : `/${locale}/snapshot/${snapshot.date}`;
  const others = getSnapshotDates().filter((other) => other !== snapshot.date);

  return (
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="ranking" />

      <div className="mt-8 max-w-[46rem]">
        <h2
          className="text-[30px] leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title", { date: snapshot.date })}
        </h2>
        <p className="mt-3 text-[15px] leading-[1.65]" style={muted}>
          {t("intro", {
            date: snapshot.date,
            version: snapshot.methodology_version,
          })}
        </p>
        <p className="mt-2 text-[13px]" style={muted}>
          {t("frozen")}
        </p>
      </div>

      <section
        className="mt-6 max-w-[46rem] border-l-2 py-3 pl-4"
        style={{ borderColor: "var(--amber)" }}
      >
        <h3 className="eyebrow mb-2">{t("citeTitle")}</h3>
        <p className="num text-[13px] leading-[1.6]">
          {t("citeText", {
            date: snapshot.date,
            version: snapshot.methodology_version,
            url: permalink,
          })}
        </p>
        <p className="mt-2 text-[12px]" style={muted}>
          {t("notComparable")}
        </p>
        <p className="mt-2 text-[12px]">
          <a
            href="https://github.com/DDamianZR/ModelHub/blob/main/CHANGELOG-methodology.md"
            className="eyebrow underline underline-offset-2"
            style={{ color: "var(--amber)" }}
          >
            {t("changelog")}
          </a>
        </p>
      </section>

      <section className="mt-10">
        <p className="num mb-2 text-[12px]" style={muted}>
          {t("models", { count: snapshot.rows.length })}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left" style={{ minWidth: "34rem" }}>
            <thead>
              <tr className="border-b rule">
                <th scope="col" className="py-2 pr-3 text-right">
                  <span className="eyebrow">{t("rank")}</span>
                </th>
                <th scope="col" className="py-2 pr-3">
                  <span className="eyebrow">{t("model")}</span>
                </th>
                <th scope="col" className="py-2 pr-3">
                  <span className="eyebrow">{t("provider")}</span>
                </th>
                <th scope="col" className="py-2 text-right">
                  <span className="eyebrow">{t("composite")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row) => (
                <tr key={row.model_id} className="border-b rule">
                  <td className="num py-2 pr-3 text-right text-[13px]" style={muted}>
                    {row.rank ?? "—"}
                  </td>
                  <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                    {row.display_name}
                    {row.provisional && (
                      <span className="eyebrow ml-2" style={{ color: "var(--amber)" }}>
                        {t("provisionalNote")}
                      </span>
                    )}
                  </th>
                  <td className="py-2 pr-3 text-[12px]" style={muted}>
                    {row.provider_name}
                  </td>
                  <td className="num py-2 text-right text-[13px]">
                    {row.composite.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {others.length > 0 && (
        <section className="mt-10 max-w-[46rem]">
          <h3 className="eyebrow mb-2">{t("availableTitle")}</h3>
          <p className="mb-2 text-[12px]" style={muted}>
            {t("availableIntro")}
          </p>
          <ul className="num flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {others.map((other) => (
              <li key={other}>
                <a
                  href={`/${locale}/snapshot/${other}`}
                  className="underline underline-offset-2"
                  style={{ color: "var(--amber)" }}
                >
                  {other}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px]">
            <a
              href={`/${locale}`}
              className="eyebrow underline underline-offset-2"
              style={{ color: "var(--amber)" }}
            >
              {t("currentRanking")}
            </a>
          </p>
        </section>
      )}
    </main>
  );
}
