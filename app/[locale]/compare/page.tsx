import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CompareBoard } from "@/components/CompareBoard";
import { SiteHeader } from "@/components/SiteHeader";
import { getRanking } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { localeMetadata } from "@/lib/metadata";

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
  return localeMetadata(locale, "/compare");
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
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="compare" />

      <section className="mt-8">
        <h2
          className="text-[26px] leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title")}
        </h2>
        <p
          className="mt-2 max-w-[46rem] text-[14px] leading-[1.6]"
          style={{ color: "var(--muted)" }}
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
