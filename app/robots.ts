import type { MetadataRoute } from "next";
import { resolveSiteOrigin } from "@/lib/site-url";

/**
 * The sitemap reference is omitted when no origin resolves, for the same reason the canonical
 * is: a robots.txt pointing at a sitemap on a host this project does not own is worse than
 * one that points nowhere. See lib/site-url.ts.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = resolveSiteOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  };
}
