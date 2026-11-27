import { ImageResponse } from "next/og";
import { SHARE_IMAGE_SIZE } from "./seo";

export { SHARE_IMAGE_SIZE };

/**
 * The 1200x630 card other sites show when a page of this one is linked. One layout for
 * every page, so a model's card differs from another's only in the words on it.
 *
 * A card never carries a score, a rank or any figure about a model. Whoever shows the card
 * caches the image, sometimes for months, and a number baked into it would go on being
 * displayed long after the composite moved, with nothing to say it was old. The card says
 * what the page is about and the day the data was current; the numbers stay on the page,
 * where they are always beside their date.
 */

// Light-palette values from app/globals.css, copied rather than referenced: the renderer
// behind ImageResponse does not resolve CSS custom properties, and a card is read inside
// someone else's interface, not this site's theme.
const PAPER = "#fbfbfa"; // --surface-canvas
const INK = "#16181d"; // --text-primary
const MUTED = "#5b616e"; // --text-tertiary
const RULE = "#e6e6e3"; // --line-subtle
const ACCENT = "#4a55d4"; // --accent

export function shareImage({
  kicker,
  title,
  subtitle,
  footer,
  dated,
}: {
  /** Small line above the title; omitted on the home card, where the title is the name. */
  kicker?: string;
  title: string;
  subtitle: string;
  /** Bottom left. */
  footer: string;
  /** Bottom right: the phrase that carries the data date. */
  dated: string;
}): ImageResponse {
  // A long model name or a pair of them takes a smaller size rather than a third line.
  const titleSize = title.length > 44 ? 56 : title.length > 26 ? 68 : 88;
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
          {kicker ? (
            <div style={{ display: "flex", marginBottom: 18, fontSize: 30, color: ACCENT }}>
              {kicker}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontSize: titleSize,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.1,
              maxWidth: 1040,
            }}
          >
            {title}
          </div>
          <div style={{ display: "flex", marginTop: 20, fontSize: 34, color: MUTED, maxWidth: 920 }}>
            {subtitle}
          </div>
        </div>
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
          <div style={{ display: "flex" }}>{footer}</div>
          <div style={{ display: "flex", color: ACCENT }}>{dated}</div>
        </div>
      </div>
    ),
    SHARE_IMAGE_SIZE,
  );
}
