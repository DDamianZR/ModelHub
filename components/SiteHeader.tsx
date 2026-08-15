import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/LogoMark";
import { LocaleSwitch } from "@/components/LocaleSwitch";

export async function SiteHeader({
  locale,
  active,
}: {
  locale: string;
  active: "ranking" | "compare" | "methodology" | "aliases";
}) {
  const t = await getTranslations("masthead");
  const tn = await getTranslations("nav");

  const links = [
    { key: "ranking", href: "/" },
    { key: "compare", href: "/compare" },
    { key: "methodology", href: "/methodology" },
    { key: "aliases", href: "/aliases" },
  ] as const;

  return (
    <header className="pt-8">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Decorative — making it a second link to "/" would announce the same
              destination twice to screen readers. */}
          <LogoMark className="h-11 w-11 shrink-0 sm:h-[52px] sm:w-[52px]" />
          <div>
            <Link href="/">
              <h1
                className="font-display text-[34px] leading-[1.05] tracking-[-0.01em] sm:text-[42px]"
              >
                {t("wordmark")}
              </h1>
            </Link>
            <p className="eyebrow mt-1">{t("tagline")}</p>
          </div>
        </div>

        <LocaleSwitch locale={locale} />
      </div>

      <nav
        className="mt-5 flex gap-4 border-b pb-2"
        style={{ borderColor: "var(--line-subtle)" }}
        aria-label={tn("label")}
      >
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className="eyebrow row-shift"
            style={{
              color: active === link.key ? "var(--accent)" : "var(--text-tertiary)",
              borderBottom:
                active === link.key ? "1px solid var(--accent)" : "1px solid transparent",
              paddingTop: "3px",
              paddingBottom: "7px",
              marginBottom: "-9px",
            }}
            aria-current={active === link.key ? "page" : undefined}
          >
            {tn(link.key)}
          </Link>
        ))}
      </nav>
    </header>
  );
}
