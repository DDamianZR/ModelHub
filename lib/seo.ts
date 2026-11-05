import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "./site-url";

/**
 * canonical + hreflang for one page. `path` is the locale-less path ("" for the home,
 * "/model/x" otherwise). Absolute URLs: a relative hreflang is ignored by search engines.
 * x-default points at the default locale.
 */
export function pageAlternates(locale: string, path: string): NonNullable<Metadata["alternates"]> {
  const url = siteUrl();
  return {
    canonical: `${url}/${locale}${path}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, `${url}/${l}${path}`])),
      "x-default": `${url}/${routing.defaultLocale}${path}`,
    },
  };
}

/** Title, description and alternates for a page, from messages already resolved. */
export function pageMetadata({
  locale,
  path,
  title,
  description,
}: {
  locale: string;
  path: string;
  title: string;
  description?: string;
}): Metadata {
  return {
    title,
    description,
    alternates: pageAlternates(locale, path),
    openGraph: { title, description, url: `${siteUrl()}/${locale}${path}`, locale },
  };
}
