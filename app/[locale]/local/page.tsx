import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { LocalFit } from "@/components/LocalFit";
import { SiteHeader } from "@/components/SiteHeader";
import { getLocalEntries } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/site-url";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "local" });
  const url = siteUrl();
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: `/${locale}/local`,
      languages: {
        es: `${url}/es/local`,
        en: `${url}/en/local`,
        "x-default": `${url}/es/local`,
      },
    },
  };
}

export default async function LocalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("local");
  const messages = await getMessages();
  const { entries, rankedCount, withoutLayout, unsized, unmeasuredCount, catalogueRules } =
    getLocalEntries();

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="local" />

      <section className="mt-8">
        <h1 className="text-xl leading-tight font-semibold">{t("title")}</h1>
        <p className="mt-2 max-w-[46rem] text-base leading-[1.6] text-tertiary">{t("intro")}</p>
      </section>

      <section className="mt-6">
        <NextIntlClientProvider messages={{ local: messages.local }}>
          <LocalFit
            entries={entries}
            rankedCount={rankedCount}
            withLayout={entries.length - withoutLayout}
            unsized={unsized}
            unmeasuredCount={unmeasuredCount}
            catalogueRules={catalogueRules}
          />
        </NextIntlClientProvider>
      </section>
    </main>
  );
}
