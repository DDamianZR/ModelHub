import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChangeLine } from "@/components/ChangeLine";
import { SiteHeader } from "@/components/SiteHeader";
import { Surface } from "@/components/Surface";
import { routing } from "@/i18n/routing";
import { dayCounts, groupByDate } from "@/lib/changes";
import { getChangeLog } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";

/** How many dated days the page lists. The feed and the log itself keep more. */
const DAYS_SHOWN = 45;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changes" });
  return pageMetadata({ locale, path: "/changes", title: `${t("title")} · ModelHub`, description: t("metaDescription") });
}

export default async function ChangesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("changes");
  const { events, models, benchmarks } = getChangeLog();
  const days = groupByDate(events, DAYS_SHOWN);

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="changes" />

      <section className="mt-8">
        <h1 className="text-xl leading-tight font-semibold">{t("title")}</h1>
        <p className="mt-2 max-w-[46rem] text-base leading-[1.6] text-tertiary">{t("intro")}</p>
        <p className="mt-2 max-w-[46rem] text-sm leading-[1.6] text-tertiary">{t("method")}</p>
        <p className="mt-2 text-sm">
          <a href={`/${locale}/changes/feed.xml`} className="text-accent underline underline-offset-2">
            {t("feed")}
          </a>
        </p>
      </section>

      {days.length === 0 ? (
        <Surface className="mt-6 px-4 py-10 text-center text-sm text-tertiary">{t("empty")}</Surface>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {days.map((day) => {
            const counts = dayCounts(day);
            return (
              <section key={day.date} aria-labelledby={`day-${day.date}`}>
                <h2 id={`day-${day.date}`} className="num text-md font-semibold">
                  {day.date}
                </h2>
                <p className="mt-1 text-xs text-tertiary">
                  {counts.shifted
                    ? t("summaryShift")
                    : t("summary", { added: counts.added, removed: counts.removed, gate: counts.gate, moved: counts.moved })}
                </p>
                <Surface className="mt-2">
                  <ul className="divide-y divide-[var(--line-subtle)]">
                    {day.events.map((event, i) => (
                      <li key={i} className="px-3 py-2 text-sm leading-[1.55]">
                        <ChangeLine event={event} models={models} benchmarks={benchmarks} />
                      </li>
                    ))}
                  </ul>
                </Surface>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
