import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "./site-url";

/** Pixel size of every share card; lib/share-image.tsx draws to it. */
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };

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
  ownCard = false,
}: {
  locale: string;
  path: string;
  title: string;
  description?: string;
  /** True for a route that has its own opengraph-image file beside its page. */
  ownCard?: boolean;
}): Metadata {
  // The card is named here, explicitly, because neither default works. A page that sets
  // its own Open Graph block does not inherit the layout's card: measured on production on
  // 2026-11-12, the home carried og:image and compare, methodology and every model page
  // carried none. And an image named here wins over a route's own opengraph-image file:
  // with the site card as a blanket default, every model page pointed at the site card.
  const card = ownCard ? `${path}/opengraph-image` : "/opengraph-image";
  const images = [{ url: `${siteUrl()}/${locale}${card}`, ...SHARE_IMAGE_SIZE }];
  return {
    title,
    description,
    alternates: pageAlternates(locale, path),
    openGraph: { title, description, url: `${siteUrl()}/${locale}${path}`, locale, images },
    // Without this the card is "summary", which shows the image as a thumbnail or not at all.
    twitter: { card: "summary_large_image", title, description, images },
  };
}
