import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { siteOriginForMetadata } from "./site-url";

/**
 * Title, canonical, hreflang and og:url for one page.
 *
 * `path` is the route below the locale segment: "" for the home page, "/compare",
 * "/model/openai-gpt-5". Every page passes its own, and that is the whole point of this
 * helper existing. App Router metadata inherits down the tree, so a canonical declared
 * once in the layout is re-served by every descendant — which told search engines that
 * all 106 model pages, Compare and Methodology were the same document as the home page,
 * and asked for none of them to be indexed on their own.
 *
 * When no deployment origin resolves, the URL fields are dropped whole rather than
 * guessed. See lib/site-url.ts.
 */
export async function localeMetadata(locale: string, path = ""): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "meta" });
  const base: Metadata = { title: t("title"), description: t("description") };

  const origin = siteOriginForMetadata();
  if (!origin) return base;

  return {
    ...base,
    // Absolute URLs: a relative hreflang is ignored by search engines, and Lighthouse
    // fails the document for it.
    metadataBase: new URL(origin),
    alternates: {
      canonical: `${origin}/${locale}${path}`,
      languages: {
        es: `${origin}/es${path}`,
        en: `${origin}/en${path}`,
        "x-default": `${origin}/es${path}`,
      },
    },
    openGraph: {
      type: "website",
      url: `${origin}/${locale}${path}`,
      title: t("title"),
      description: t("description"),
      locale,
    },
  };
}
