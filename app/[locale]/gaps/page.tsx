import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { getRanking, getVendorClaims, type VendorClaim } from "@/lib/data";
import { routing } from "@/i18n/routing";
import { localeMetadata } from "@/lib/metadata";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return localeMetadata(locale, "/gaps");
}

export default async function GapsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("gaps");
  const payload = getVendorClaims();
  const { rows } = getRanking();
  const names = new Map(rows.map((row) => [row.id, row.display_name]));

  const muted = { color: "var(--muted)" } as const;
  const claims = payload?.claims ?? [];
  const gaps = claims.filter((claim) => claim.gap_flagged);
  // Everything contrasted that is not a flagged gap, kept visible with its reason. The
  // reason is the finding here as much as a gap would be.
  const rest = claims.filter((claim) => !claim.gap_flagged);

  const label = (claim: VendorClaim) => names.get(claim.model_id) ?? claim.model_id;

  return (
    <main className="mx-auto max-w-[80rem] px-5 pb-20 sm:px-8">
      <SiteHeader locale={locale} active="gaps" />

      <div className="mt-8 max-w-[46rem]">
        <h2
          className="text-[30px] leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title")}
        </h2>
        <p className="mt-3 text-[15px] leading-[1.65]" style={muted}>
          {t("intro")}
        </p>
      </div>

      {!payload || claims.length === 0 ? (
        <p
          className="mt-6 border-l-2 py-2 pl-3 text-[13px]"
          style={{ borderColor: "var(--rule)", color: "var(--muted)" }}
        >
          {t("unavailable")}
        </p>
      ) : (
        <>
          <div className="mt-6 max-w-[46rem]">
            <p className="num text-[18px]">
              {gaps.length === 0
                ? t("summaryZero", { claims: claims.length })
                : t("summary", { claims: claims.length, gaps: gaps.length })}
            </p>
            <p className="num mt-1 text-[12px]" style={muted}>
              {t("threshold", { percent: Math.round(payload.gap_threshold * 100) })}
            </p>
            {gaps.length === 0 && (
              <p
                className="mt-3 border-l-2 py-2 pl-3 text-[14px]"
                style={{ borderColor: "var(--amber)" }}
              >
                {t("nullResult")}
              </p>
            )}
          </div>

          <section className="mt-10">
            <h3
              className="border-b rule pb-2 text-[20px] leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("gapsTitle")}
            </h3>
            {gaps.length === 0 ? (
              <p className="mt-3 text-[13px]" style={muted}>
                {t("gapsNone")}
              </p>
            ) : (
              <ClaimTable claims={gaps} label={label} showGap />
            )}
          </section>

          <section className="mt-10">
            <h3
              className="border-b rule pb-2 text-[20px] leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("notComparableTitle")}
            </h3>
            <p className="mt-2 max-w-[46rem] text-[13px]" style={muted}>
              {t("notComparableIntro")}
            </p>
            <ClaimTable claims={rest} label={label} />
          </section>

          <p className="mt-8 max-w-[46rem] text-[12px]" style={muted}>
            {t("extractedBy")} {t("neverScoredNote")}
          </p>
        </>
      )}
    </main>
  );

  function ClaimTable({
    claims: shown,
    label: name,
    showGap = false,
  }: {
    claims: VendorClaim[];
    label: (claim: VendorClaim) => string;
    showGap?: boolean;
  }) {
    return (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left" style={{ minWidth: "52rem" }}>
          <thead>
            <tr className="border-b rule">
              <th scope="col" className="py-2 pr-3">
                <span className="eyebrow">{t("model")}</span>
              </th>
              <th scope="col" className="py-2 pr-3">
                <span className="eyebrow">{t("benchmark")}</span>
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                <span className="eyebrow">{t("vendorValue")}</span>
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                <span className="eyebrow">{t("thirdPartyValue")}</span>
              </th>
              <th scope="col" className="py-2">
                <span className="eyebrow">{showGap ? t("gap") : t("reason")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((claim) => (
              <tr key={`${claim.model_id}-${claim.benchmark_id}-${claim.vendor_label}`}
                  className="border-b rule">
                <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                  {name(claim)}
                </th>
                <td className="py-2 pr-3 text-[12px]">
                  {claim.vendor_label}
                  <span className="num block text-[10px]" style={muted}>
                    {claim.stated_configuration}
                  </span>
                </td>
                {/* The vendor's own figure, greyed and labelled unverified, with both its
                    date and its link. Never presented as a measurement. */}
                <td className="num py-2 pr-3 text-right text-[13px]" style={muted}>
                  {claim.value.toFixed(1)}%
                  <span className="block text-[10px]">
                    <a
                      href={claim.claim_url}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="underline underline-offset-2"
                      style={{ color: "var(--amber)" }}
                      title={t("unverifiedLabel")}
                    >
                      {t("claimedOn", { date: claim.claim_date })}
                    </a>
                  </span>
                </td>
                <td className="num py-2 pr-3 text-right text-[13px]">
                  {claim.third_party_value === null
                    ? "—"
                    : `${claim.third_party_value.toFixed(1)}%`}
                  {claim.third_party_measured_at && (
                    <span className="block text-[10px]" style={muted}>
                      <a
                        href={claim.third_party_source_url ?? "#"}
                        rel="noopener noreferrer"
                        target="_blank"
                        className="underline underline-offset-2"
                        style={{ color: "var(--amber)" }}
                      >
                        {t("measuredOn", { date: claim.third_party_measured_at })}
                      </a>
                    </span>
                  )}
                </td>
                <td className="py-2 text-[12px]" style={muted}>
                  {showGap && claim.gap !== null ? (
                    <span className="num" style={{ color: "var(--amber)" }}>
                      ⚠ {(claim.gap * 100).toFixed(1)}%
                    </span>
                  ) : claim.comparison === "different_measurement" ? (
                    t("reason_different_measurement", {
                      reason: claim.not_comparable_reason ?? "",
                    })
                  ) : claim.comparison === "different_configuration" ? (
                    t("reason_different_configuration", {
                      variant: claim.third_party_configuration ?? "—",
                      stated: claim.stated_configuration,
                    })
                  ) : claim.comparison === "no_third_party_measurement" ? (
                    t("reason_no_third_party_measurement")
                  ) : claim.gap !== null ? (
                    <span className="num">{(claim.gap * 100).toFixed(1)}%</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}
