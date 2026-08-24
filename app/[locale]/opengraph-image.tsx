import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { getRanking } from "@/lib/data";
import { routing } from "@/i18n/routing";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Light-palette values from app/globals.css, copied rather than referenced: Satori (the
// renderer behind ImageResponse) doesn't resolve CSS custom properties, and an OG card is
// read as a static preview in someone else's UI theme anyway, not this site's.
const PAPER = "#faf9f6";
const INK = "#1a1a1a";
const MUTED = "#6e6862";
const RULE = "#e2ded4";
const AMBER = "#6d28d9";

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "masthead" });
  const tp = await getTranslations({ locale, namespace: "panel" });
  const { meta } = getRanking();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700, color: INK }}>
            {t("wordmark")}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 20,
              fontSize: 34,
              color: MUTED,
              maxWidth: 920,
            }}
          >
            {t("tagline")}
          </div>
        </div>
        {/* Date only, deliberately no ranking figures: a cached image with a number baked
            in ages the moment the composite moves, which is exactly what this project's
            "no number without a date" rule exists to prevent. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${RULE}`,
            paddingTop: 28,
            fontSize: 24,
            color: MUTED,
          }}
        >
          <div style={{ display: "flex" }}>modelhub</div>
          <div style={{ display: "flex", color: AMBER }}>
            {tp("updated")} {meta.generated_at}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
