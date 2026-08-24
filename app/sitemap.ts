import type { MetadataRoute } from "next";
import { getModelIds, getRanking } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/site-url";

const STATIC_PATHS = ["", "/compare", "/methodology", "/aliases"];

function alternates(url: string, path: string): Record<string, string> {
  return Object.fromEntries(
    routing.locales.map((locale) => [locale, `${url}/${locale}${path}`]),
  );
}

export default function sitemap(): MetadataRoute.Sitemap {
  const url = siteUrl();
  const { meta } = getRanking();
  const lastModified = new Date(meta.generated_at);
  const modelIds = getModelIds();

  const staticEntries = STATIC_PATHS.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${url}/${locale}${path}`,
      lastModified,
      alternates: { languages: alternates(url, path) },
    })),
  );

  const modelEntries = modelIds.flatMap((id) =>
    routing.locales.map((locale) => ({
      url: `${url}/${locale}/model/${id}`,
      lastModified,
      alternates: { languages: alternates(url, `/model/${id}`) },
    })),
  );

  return [...staticEntries, ...modelEntries];
}
