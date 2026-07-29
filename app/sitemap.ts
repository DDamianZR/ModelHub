import type { MetadataRoute } from "next";
import { getModelIds, getRanking, getSnapshotDates } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { resolveSiteOrigin } from "@/lib/site-url";

/**
 * Every page, in both locales, with each entry declaring its own alternates.
 *
 * The hreflang set here has to agree with the one the pages emit, or the two contradict each
 * other and a search engine believes neither. Both are built from the same routing.locales
 * and the same origin resolver for that reason.
 *
 * Empty when no origin resolves: a sitemap of relative URLs is meaningless, and a sitemap
 * pointing at a host this project does not own is the D6 defect in a different file.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = resolveSiteOrigin();
  if (!origin) return [];

  const { meta } = getRanking();
  const lastModified = new Date(meta.generated_at);

  const paths = [
    "",
    "/compare",
    "/local",
    "/gaps",
    "/methodology",
    ...getModelIds().map((id) => `/model/${id}`),
    // Snapshots are frozen by design, so they are listed but never re-dated.
    ...getSnapshotDates().map((date) => `/snapshot/${date}`),
  ];

  return paths.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${origin}/${locale}${path}`,
      lastModified,
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((other) => [other, `${origin}/${other}${path}`]),
        ),
      },
    })),
  );
}
