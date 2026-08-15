"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export function LocaleSwitch({ locale }: { locale: string }) {
  const tl = useTranslations("locale");
  const pathname = usePathname();
  const other = locale === "es" ? "en" : "es";

  return (
    <Link
      href={pathname}
      locale={other}
      className="tactile tactile-sm eyebrow shrink-0"
      aria-label={tl("switchAria")}
    >
      {tl("switch")}
    </Link>
  );
}
