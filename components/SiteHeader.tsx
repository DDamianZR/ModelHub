import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/LogoMark";

export async function SiteHeader({
  locale,
  active,
}: {
  locale: string;
  active: "ranking" | "compare" | "methodology" | "aliases";
}) {
  const t = await getTranslations("masthead");
  const tn = await getTranslations("nav");
  const tl = await getTranslations("locale");
  const other = locale === "es" ? "en" : "es";

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
          {/* Decorative beside the linked wordmark: making it a second link to "/" would
              have screen readers announce the same destination twice. */}
          <LogoMark className="h-11 w-11 shrink-0 sm:h-[52px] sm:w-[52px]" />
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
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href="https://github.com/DDamianZR/ModelHub"
            target="_blank"
            rel="noopener noreferrer"
            className="eyebrow row-shift flex items-center gap-1.5 border px-2 py-[5px]"
            style={{ borderColor: "var(--rule)", color: "var(--muted)" }}
            title="GitHub Repository"
            aria-label="GitHub Repository"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span className="hidden sm:inline">Repo</span>
          </a>

          <a
            href="https://ddzendreros.github.io/dzendreros"
            target="_blank"
            rel="noopener noreferrer"
            className="eyebrow row-shift flex items-center gap-1.5 border px-2 py-[5px]"
            style={{ borderColor: "var(--rule)", color: "var(--muted)" }}
            title="Portfolio"
            aria-label="Portfolio"
          >
            <svg className="w-3.5 h-3.5 stroke-current fill-none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span className="hidden sm:inline">Portfolio</span>
          </a>

          <a
            href="https://www.instagram.com/diego_zr.p/"
            target="_blank"
            rel="noopener noreferrer"
            className="eyebrow row-shift flex items-center gap-1.5 border px-2 py-[5px]"
            style={{ borderColor: "var(--rule)", color: "var(--muted)" }}
            title="Instagram"
            aria-label="Instagram"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
            <span className="hidden sm:inline">Instagram</span>
          </a>

          <Link
            href="/"
            locale={other}
            className="eyebrow row-shift shrink-0 border px-2 py-[5px]"
            style={{ borderColor: "var(--rule)" }}
            aria-label={tl("switchAria")}
          >
            {tl("switch")}
          </Link>
        </div>
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
