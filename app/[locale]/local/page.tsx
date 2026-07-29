import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocalExplorer } from "@/components/LocalExplorer";
import { SiteHeader } from "@/components/SiteHeader";
import { getLocalModels, getVramConfig } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { localeMetadata } from "@/lib/metadata";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return localeMetadata(locale, "/local");
}

export default async function LocalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("local");
  const catalogue = getLocalModels();
  const config = getVramConfig();

  return (
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="local" />

      <div className="mt-8 max-w-[46rem]">
        <h2
          className="text-[30px] leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title")}
        </h2>
        <p className="mt-3 text-[15px] leading-[1.65]" style={{ color: "var(--muted)" }}>
          {t("intro")}
        </p>
      </div>

      {/* R16: the build survives this file being absent. It is populated run by run, so an
          empty catalogue is an ordinary state rather than a failure. */}
      {catalogue && config && catalogue.models.length > 0 ? (
        <LocalExplorer
          models={catalogue.models}
          config={config}
          // Already on the chart's axis: the best Arena rating that exists at all, closed
          // models included. Computed in the ingest so the client never has to reconcile
          // two scales.
          ceiling={catalogue.ceiling ?? null}
        />
      ) : (
        <p
          className="mt-6 border-l-2 py-2 pl-3 text-[13px]"
          style={{ borderColor: "var(--rule)", color: "var(--muted)" }}
        >
          {t("unavailable")}
        </p>
      )}
    </main>
  );
}
