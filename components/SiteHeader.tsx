import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import clsx from "clsx";
import { Link } from "@/i18n/navigation";
import { CommandPalette } from "@/components/CommandPalette";
import { CurrencySwitch, CurrencyToggle } from "@/components/CurrencySwitch";
import { LogoMark } from "@/components/LogoMark";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { formatRate } from "@/lib/currency";
import { getFx } from "@/lib/data";

export async function SiteHeader({
  locale,
  active,
}: {
  locale: string;
  active: "ranking" | "compare" | "reweight" | "local" | "methodology" | "aliases" | "none";
}) {
  const t = await getTranslations("masthead");
  const tn = await getTranslations("nav");
  const ts = await getTranslations("search");
  const tui = await getTranslations("ui");
  // LocaleSwitch is a client component (it reads the current pathname to preserve it
  // across the switch), and the root provider deliberately ships no messages - see
  // app/[locale]/layout.tsx. Scoped here, on the one header every page renders, rather
  // than once per page.
  const messages = await getMessages();
  const fx = getFx();

  const links = [
    { key: "ranking", href: "/" },
    { key: "compare", href: "/compare" },
    { key: "reweight", href: "/reweight" },
    { key: "local", href: "/local" },
    { key: "methodology", href: "/methodology" },
    { key: "aliases", href: "/aliases" },
  ] as const;

  return (
    <header className="pt-3 sm:pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Decorative — making it a second link to "/" would announce the same
              destination twice to screen readers. */}
          <LogoMark className="h-7 w-7 shrink-0" />
          <Link href="/" className="min-w-0">
            <span className="block truncate font-serif text-lg leading-none font-semibold tracking-snug">
              {t("wordmark")}
            </span>
          </Link>
          <span className="eyebrow hidden border-l border-subtle pl-2.5 lg:block">
            {t("tagline")}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <CommandPalette
            labels={{
              trigger: ts("trigger"),
              placeholder: ts("placeholder"),
              title: ts("title"),
              empty: ts("empty"),
              loading: ts("loading"),
              failed: ts("failed"),
              hint: ts("hint"),
              model: ts("model"),
              provider: ts("provider"),
              benchmark: ts("benchmark"),
            }}
          />
          <ThemeToggle
            labels={{
              toLight: tui("themeToLight"),
              toDark: tui("themeToDark"),
              light: tui("themeLight"),
              dark: tui("themeDark"),
            }}
          />
          <CurrencySwitch
            label={tui("currencyLabel")}
            note={
              fx
                ? tui("currencyNote", { rate: formatRate(fx.mxn), date: fx.date })
                : ""
            }
          />
          <NextIntlClientProvider messages={{ locale: messages.locale }}>
            <LocaleSwitch locale={locale} />
          </NextIntlClientProvider>
        </div>
      </div>

      {/* The border and spacing moved to this wrapper so the phone-sized currency button can
          sit beside the links; from sm up the button is hidden and the nav fills the row as
          it always did. */}
      <div className="mt-3 flex items-start gap-2 border-b border-subtle pb-2">
        <nav
          className="no-scrollbar flex min-w-0 flex-1 gap-x-1 overflow-x-auto"
          aria-label={tn("label")}
        >
          {links.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              /* The active item carries both a fill and a hue, so the state is not
                 colour-alone — same signature as .control-on. */
              className={clsx(
                "eyebrow row-shift flex min-h-8 shrink-0 items-center rounded-control px-3",
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
        <CurrencyToggle
          label={tui("currencyLabel")}
          note={fx ? tui("currencyNote", { rate: formatRate(fx.mxn), date: fx.date }) : ""}
          switchTo={{
            USD: tui("currencySwitchTo", { to: "USD" }),
            MXN: tui("currencySwitchTo", { to: "MXN" }),
          }}
        />
      </div>
    </header>
  );
}
