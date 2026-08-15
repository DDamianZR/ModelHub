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
      className="eyebrow row-shift shrink-0 border px-2 py-[3px]"
      style={{ borderColor: "var(--line-default)", color: "var(--text-tertiary)" }}
      aria-label={tl("switchAria")}
    >
      {tl("switch")}
    </Link>
  );
}
