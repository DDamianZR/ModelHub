import { getTranslations } from "next-intl/server";
import clsx from "clsx";
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
    // Compressed on mobile: the masthead reads once on a large screen, but on a phone
    // every pixel it takes pushes the ranking — the actual product — below the fold.
    <header className="pt-4 sm:pt-8">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Decorative — making it a second link to "/" would announce the same
              destination twice to screen readers. */}
          <LogoMark className="h-8 w-8 shrink-0 sm:h-[52px] sm:w-[52px]" />
          <div>
            <Link href="/">
              <h1 className="font-display text-lg leading-[1.05] tracking-[-0.01em] sm:text-3xl">
                {t("wordmark")}
              </h1>
            </Link>
            <p className="eyebrow mt-1 hidden sm:block">{t("tagline")}</p>
          </div>
        </div>

        <LocaleSwitch locale={locale} />
      </div>

      <nav
        className="mt-3 flex gap-4 border-b border-subtle pb-2 sm:mt-5"
        aria-label={tn("label")}
      >
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            /* Targets raised from 22px to 32px. The active item carries both a hue and
               an underline, so the state is not colour-alone. */
            className={clsx(
              "eyebrow row-shift -mb-[9px] flex min-h-[32px] items-center border-b-2 pb-1.5",
              active === link.key
                ? "border-accent text-accent"
                : "border-transparent hover:text-primary",
            )}
            aria-current={active === link.key ? "page" : undefined}
          >
            {tn(link.key)}
          </Link>
        ))}
      </nav>
    </header>
  );
}
