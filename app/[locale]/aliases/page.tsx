import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { getAliases, getIntegrity } from "@/lib/data";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const SOURCES = ["epoch", "livebench", "lmarena"] as const;
const REPO = "https://github.com/DDamianZR/ModelHub";

/**
 * The name-matching audit.
 *
 * Sources call the same model different things — `claude-opus-5_max`,
 * `claude-opus-5-max-effort`, `claude-opus-5-max` — and the ingest collapses them onto one
 * canonical key. If that collapse is wrong, one model is credited with another's scores.
 * It is the worst failure this pipeline can have and the only one it cannot detect on its
 * own, so the whole mapping is published for anyone to check.
 */
export default async function AliasesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("aliases");
  const entries = getAliases();
  const integrity = getIntegrity();
  const muted = { color: "var(--muted)" } as const;

  // Not "matched in more than one source": a model needs two sources to appear at all,
  // so that number is always the whole table and says nothing. The audit risk is a
  // source that matched several names onto one key, which is where a wrong collapse
  // would hide.
  const ambiguous = entries.filter((entry) =>
    SOURCES.some((source) => (entry.matched[source] ?? []).length > 1),
  ).length;
  const totalNames = entries.reduce(
    (sum, entry) =>
      sum + SOURCES.reduce((n, s) => n + (entry.matched[s] ?? []).length, 0),
    0,
  );

  return (
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="aliases" />

      <div id="main-content" className="mt-8 max-w-[46rem]">
        <h2
          className="text-[30px] leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title")}
        </h2>
        <p className="mt-3 text-[15px] leading-[1.65]" style={muted}>
          {t("intro")}
        </p>
        <p className="mt-3 text-[14px] leading-[1.65]" style={muted}>
          {t("counts", {
            models: entries.length,
            names: totalNames,
            ambiguous,
          })}
        </p>
        <p
          className="mt-3 border-l-2 py-2 pl-3 text-[14px] leading-[1.6]"
          style={{ borderColor: "var(--amber)" }}
        >
          {t("report")}{" "}
          <a
            href={`${REPO}/issues/new?labels=alias&title=${encodeURIComponent(
              "Alias mismatch: ",
            )}&body=${encodeURIComponent(
              "Model page / canonical id:\n\nWhich source matched the wrong name:\n\nWhat it should map to, and how you checked:\n",
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
            style={{ color: "var(--amber)" }}
          >
            {t("reportLink")}
          </a>
        </p>
      </div>

      <section className="mt-10">
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse text-left"
            style={{ minWidth: "58rem" }}
          >
            <caption className="sr-only">{t("title")}</caption>
            <thead>
              <tr className="border-b rule">
                <th scope="col" className="py-2 pr-3">
                  <span className="eyebrow">{t("model")}</span>
                </th>
                <th scope="col" className="py-2 pr-3">
                  <span className="eyebrow">{t("canonical")}</span>
                </th>
                {SOURCES.map((source) => (
                  <th key={source} scope="col" className="py-2 pr-3">
                    <span className="eyebrow">{source}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b rule align-top">
                  <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                    <a
                      href={`/${locale}/model/${entry.id}`}
                      className="inline-block py-[5px] underline-offset-2 hover:underline"
                    >
                      {entry.display_name}
                    </a>
                    {entry.variant && (
                      <span className="num block text-[10px]" style={muted}>
                        {t("variant", { variant: entry.variant })}
                      </span>
                    )}
                  </th>
                  <td className="num py-2 pr-3 text-[11px]" style={muted}>
                    {entry.canonical_key}
                  </td>
                  {SOURCES.map((source) => {
                    const names = entry.matched[source] ?? [];
                    return (
                      <td key={source} className="num py-2 pr-3 text-[11px]">
                        {names.length === 0 ? (
                          <span style={muted}>—</span>
                        ) : (
                          names.map((name) => {
                            // The Arena row actually scored, as opposed to the other
                            // variants that merely matched the same canonical key.
                            const scored =
                              source === "lmarena" && name === entry.scored_arena_name;
                            return (
                              <span
                                key={name}
                                className="block"
                                style={scored ? { color: "var(--amber)" } : muted}
                              >
                                {/* Marked in text as well as in colour. Hue alone fails
                                    anyone who cannot see it, and the project already
                                    holds its charts to exactly this rule. */}
                                {scored ? "▸ " : ""}
                                {name}
                                {scored && (
                                  <span className="sr-only"> — {t("scoredMarker")}</span>
                                )}
                              </span>
                            );
                          })
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px]" style={muted}>
          {t("scoredNote")}
        </p>
      </section>

      {integrity && (
        <section className="mt-12 max-w-[46rem]">
          <h3
            className="border-b rule pb-2 text-[22px] leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("integrityTitle")}
          </h3>
          <p className="mt-3 text-[14px] leading-[1.65]" style={muted}>
            {t("integrityBody")}
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {Object.entries(integrity).map(([source, record]) => (
              <div key={source}>
                <p className="eyebrow">{source}</p>
                <p className="num mt-1 break-all text-[11px]" style={muted}>
                  {t("normalised")} {record.normalised_sha256}
                </p>
                {record.upstream.length > 0 ? (
                  record.upstream.map((artifact) => (
                    <p
                      key={artifact.url}
                      className="num mt-1 break-all text-[11px]"
                      style={muted}
                    >
                      {artifact.url} — {artifact.sha256} ({artifact.bytes} B)
                    </p>
                  ))
                ) : (
                  <p className="num mt-1 text-[11px]" style={muted}>
                    {t("paginated", { requests: record.requests })}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
