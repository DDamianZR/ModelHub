import { getTranslations } from "next-intl/server";
import { getRanking } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { SHARE_IMAGE_SIZE, shareImage } from "@/lib/share-image";

export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "masthead" });
  const tp = await getTranslations({ locale, namespace: "panel" });
  const { meta } = getRanking();

  return shareImage({
    title: t("wordmark"),
    subtitle: t("tagline"),
    footer: "modelhub",
    dated: `${tp("updated")} ${meta.generated_at}`,
  });
}
