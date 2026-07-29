import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function SiteHeader({
  locale,
  active,
}: {
  locale: string;
  active: "ranking" | "compare" | "methodology";
}) {
  const t = await getTranslations("masthead");
  const tn = await getTranslations("nav");
  const tl = await getTranslations("locale");
  const other = locale === "es" ? "en" : "es";

  const links = [
    { key: "ranking", href: "/" },
    { key: "compare", href: "/compare" },
    { key: "methodology", href: "/methodology" },
  ] as const;

  return (
    <header className="pt-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/">
            <h1
              className="text-[34px] leading-[1.05] tracking-[-0.01em] sm:text-[42px]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("wordmark")}
            </h1>
          </Link>
          <p className="eyebrow mt-1">{t("tagline")}</p>
        </div>

        <Link
          href="/"
          locale={other}
          className="eyebrow row-shift shrink-0 border px-2 py-[3px]"
          style={{ borderColor: "var(--rule)" }}
          aria-label={tl("switchAria")}
        >
          {tl("switch")}
        </Link>
      </div>

      <nav className="mt-5 flex gap-4 border-b rule pb-2" aria-label={tn("label")}>
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className="eyebrow row-shift"
            style={{
              color: active === link.key ? "var(--amber)" : "var(--muted)",
              borderBottom:
                active === link.key ? "1px solid var(--amber)" : "1px solid transparent",
              paddingBottom: "6px",
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
