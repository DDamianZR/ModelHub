import { getTranslations, setRequestLocale } from "next-intl/server";
import { CompareBoard } from "@/components/CompareBoard";
import { SiteHeader } from "@/components/SiteHeader";
import { getRanking } from "@/lib/data";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("compare");
  const { rows } = getRanking();

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="compare" />

      <section className="mt-8">
        <h2 className="font-display text-xl leading-tight">
          {t("title")}
        </h2>
        <p
          className="mt-2 max-w-[46rem] text-base leading-[1.6] text-tertiary"
        >
          {t("intro")}
        </p>
      </section>

      <section className="mt-6">
        <CompareBoard rows={rows} />
      </section>
    </main>
  );
}
