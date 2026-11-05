import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/site-url";
import "../globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/** Runs before first paint so the chosen theme never flashes. A stored choice wins; with
    none, the page is light (the system preference is deliberately not followed). Storage
    is guarded because it can throw. */
const THEME_SCRIPT = `try{var d=document.documentElement,t=null;try{t=localStorage.getItem("mh-theme")}catch(e){}d.dataset.theme=t==="dark"?"dark":"light"}catch(e){}`;

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
  const url = siteUrl();

  return {
    title: t("title"),
    description: t("description"),
    metadataBase: new URL(url),
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
  const tui = await getTranslations({ locale, namespace: "ui" });

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* First focusable element in the document, invisible until a keyboard user
            tabs to it - the escape hatch past SiteHeader's logo/links/nav, which
            otherwise repeats in full before every page's actual content. */}
        <a href="#main-content" className="skip-link">
          {tui("skipToContent")}
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
