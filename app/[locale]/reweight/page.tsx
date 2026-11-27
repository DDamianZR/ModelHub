import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { ReweightBoard } from "@/components/ReweightBoard";
import { SiteHeader } from "@/components/SiteHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { minCoveredShare } from "@/lib/composite";
import { getReweightRows, getSiteWeights } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reweight" });
  return pageMetadata({
    locale,
    path: "/reweight",
    title: `${t("title")} · ModelHub`,
    description: t("metaDescription"),
  });
}

export default async function ReweightPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("reweight");
  const messages = await getMessages();
  const { weights, minCoverage } = getSiteWeights();

  return (
    <main id="main-content" className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="reweight" />

      <section className="mt-8">
        <h1 className="text-xl leading-tight font-semibold">{t("title")}</h1>
        <p className="mt-2 max-w-[46rem] text-base leading-[1.6] text-tertiary">{t("intro")}</p>
        <p className="mt-2 max-w-[46rem] text-sm leading-[1.6] text-tertiary">
          {t("rules")}{" "}
          <Link href="/methodology#coverage" className="underline underline-offset-2 hover:text-primary">
            {t("rulesLink")}
          </Link>
        </p>
      </section>

      <section className="mt-6">
        <NextIntlClientProvider
          messages={{ reweight: messages.reweight, table: messages.table, filters: messages.filters }}
        >
          <ReweightBoard
            rows={getReweightRows()}
            siteWeights={weights}
            bar={minCoveredShare(weights, minCoverage)}
          />
        </NextIntlClientProvider>
      </section>
    </main>
  );
}
