import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getModelDetail, getModelIds, getRanking } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { SHARE_IMAGE_SIZE, shareImage } from "@/lib/share-image";

export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => getModelIds().map((id) => ({ locale, id })));
}

/**
 * The card for one model's page: its name, who published it and the day the data was
 * current. The same template and the same fields for every model, ranked or provisional,
 * and no figure about it, for the reason given in lib/share-image.tsx.
 */
export default async function ModelOpengraphImage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const detail = getModelDetail(id);
  if (!detail) notFound();
  const t = await getTranslations({ locale, namespace: "masthead" });
  const tm = await getTranslations({ locale, namespace: "model" });
  const tp = await getTranslations({ locale, namespace: "panel" });
  const { meta } = getRanking();

  return shareImage({
    kicker: t("wordmark"),
    title: detail.model.display_name,
    subtitle: tm("shareSubtitle", { provider: detail.model.provider_name }),
    footer: t("tagline"),
    dated: `${tp("updated")} ${meta.generated_at}`,
  });
}
