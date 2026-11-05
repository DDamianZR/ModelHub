/**
 * Structured data for crawlers. `<` is escaped so a model name containing "</script>"
 * cannot close the tag; everything else in the payload is plain JSON.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\u003c") }}
    />
  );
}
