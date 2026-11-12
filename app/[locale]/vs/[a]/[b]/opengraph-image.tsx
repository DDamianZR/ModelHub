import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRanking } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { SHARE_IMAGE_SIZE, shareImage } from "@/lib/share-image";
import { getVsModels, getVsPairs, orderPair } from "@/lib/views";

export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

// Same set the pages prerender; a card for any other pair is drawn on first request.
export function generateStaticParams() {
  const pairs = getVsPairs();
  return routing.locales.flatMap((locale) => pairs.map(([a, b]) => ({ locale, a, b })));
}

/**
 * The card for a comparison: the two names, in the order the page uses (alphabetical by
 * id, which puts neither first by preference), and the day the data was current. It does
 * not say which of the two is ahead; that takes the intervals, and they are on the page.
 */
export default async function VsOpengraphImage({
  params,
}: {
  params: Promise<{ locale: string; a: string; b: string }>;
}) {
  const { locale, a, b } = await params;
  const [x, y] = orderPair(a, b);
  const pair = getVsModels(x, y);
  if (!pair) notFound();
  const t = await getTranslations({ locale, namespace: "masthead" });
  const tv = await getTranslations({ locale, namespace: "vs" });
  const tp = await getTranslations({ locale, namespace: "panel" });
  const { meta } = getRanking();

  return shareImage({
    kicker: t("wordmark"),
    title: tv("title", { a: pair.a.display_name, b: pair.b.display_name }),
    subtitle: tv("shareSubtitle"),
    footer: t("tagline"),
    dated: `${tp("updated")} ${meta.generated_at}`,
  });
}
