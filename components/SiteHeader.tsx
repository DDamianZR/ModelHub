import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
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
  // LocaleSwitch is a client component (it reads the current pathname to preserve it
  // across the switch), and the root provider deliberately ships no messages - see
  // app/[locale]/layout.tsx. Scoped here, on the one header every page renders, rather
  // than once per page.
  const messages = await getMessages();

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
              <h1 className="text-lg leading-[1.05] font-semibold tracking-snug sm:text-3xl sm:tracking-tight">
                {t("wordmark")}
              </h1>
            </Link>
            <p className="eyebrow mt-1 hidden sm:block">{t("tagline")}</p>
          </div>
        </div>

        <NextIntlClientProvider messages={{ locale: messages.locale }}>
          <LocaleSwitch locale={locale} />
        </NextIntlClientProvider>
      </div>

      <nav
        className="mt-3 flex gap-1 border-b border-subtle pb-2 sm:mt-5"
        aria-label={tn("label")}
      >
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            /* The active item carries both a fill and a hue, so the state is not
               colour-alone — same signature as .control-on. */
            className={clsx(
              "eyebrow row-shift flex min-h-8 items-center rounded-control px-3",
              active === link.key
                ? "bg-sunk font-semibold text-accent"
                : "text-tertiary hover:text-primary",
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
