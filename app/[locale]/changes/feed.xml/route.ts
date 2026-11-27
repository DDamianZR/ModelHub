import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { dayCounts, groupByDate } from "@/lib/changes";
import { getChangeLog } from "@/lib/data";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-static";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * An Atom feed with one entry per dated day. An entry's text is its counts and a link to the
 * page, which holds the detail: a feed reader caches what it is given, and a figure copied
 * into an entry would stay there after the next build moved it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changes" });
  const { events } = getChangeLog();
  const days = groupByDate(events, 120);
  const base = `${siteUrl()}/${locale}`;
  const updated = days.length > 0 ? `${days[0].date}T00:00:00Z` : "1970-01-01T00:00:00Z";

  const entries = days
    .map((day) => {
      const counts = dayCounts(day);
      const summary = counts.shifted
        ? t("summaryShift")
        : t("summary", { added: counts.added, removed: counts.removed, gate: counts.gate, moved: counts.moved });
      return `  <entry>
    <id>${escape(`${base}/changes#day-${day.date}`)}</id>
    <title>${escape(`${day.date}`)}</title>
    <updated>${day.date}T00:00:00Z</updated>
    <link href="${escape(`${base}/changes#day-${day.date}`)}"/>
    <summary>${escape(summary)}</summary>
  </entry>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${locale}">
  <id>${escape(`${base}/changes`)}</id>
  <title>${escape(`${t("title")} · ModelHub`)}</title>
  <subtitle>${escape(t("metaDescription"))}</subtitle>
  <updated>${updated}</updated>
  <link rel="self" href="${escape(`${base}/changes/feed.xml`)}"/>
  <link href="${escape(`${base}/changes`)}"/>
${entries}
</feed>
`;
  return new Response(body, { headers: { "content-type": "application/atom+xml; charset=utf-8" } });
}
