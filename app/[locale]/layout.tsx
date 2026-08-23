import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { routing } from "@/i18n/routing";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// "optional" rather than "swap" for the display face. Its metrics differ enough from the
// serif fallback that swapping it in reflows the masthead, which was most of a 0.115
// cumulative layout shift. With "optional" the browser keeps the fallback when the font
// misses its window, so nothing moves after paint.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "optional",
});

// Deployment origin, used for canonical and hreflang URLs.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://modelhub.vercel.app";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    title: t("title"),
    description: t("description"),
    // Absolute URLs: a relative hreflang is ignored by search engines, and Lighthouse
    // fails the document for it.
    metadataBase: new URL(SITE_URL),
    alternates: {
      canonical: `/${locale}`,
      languages: {
        es: `${SITE_URL}/es`,
        en: `${SITE_URL}/en`,
        "x-default": `${SITE_URL}/es`,
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "nav" });

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/* First focusable element in the document, invisible until a keyboard user
            tabs to it - the escape hatch past SiteHeader's logo/links/nav, which
            otherwise repeats in full before every page's actual content. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:border focus:px-3 focus:py-2 focus:text-[13px]"
          style={{
            background: "var(--paper)",
            borderColor: "var(--amber)",
            color: "var(--ink)",
          }}
        >
          {t("skipToContent")}
        </a>
        {/* No `messages` prop: without one, next-intl's Next.js integration falls back
            to forwarding the FULL locale catalogue to the client, which is most of what
            Block 6 exists to undo. Only two components use useTranslations on the client
            (RankingTable, CompareBoard, both verified via `grep -rn useTranslations
            components app`) and each wraps itself in its own scoped provider where it's
            rendered - see app/[locale]/page.tsx and app/[locale]/compare/page.tsx. This
            outer provider exists only so useLocale()/the next-intl Link component still
            resolve for any client component that needs the current locale but not any
            message text. */}
        <NextIntlClientProvider messages={{}}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
