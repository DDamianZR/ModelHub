import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[60vh] max-w-[80rem] flex-col items-start justify-center px-5 pb-20 sm:px-8"
    >
      <p className="eyebrow mb-3" style={{ color: "var(--text-tertiary)" }}>
        404
      </p>
      <h1
        className="font-display text-[40px] leading-tight sm:text-[52px]"
      >
        {t("title")}
      </h1>
      <p className="mt-4 max-w-[34rem] text-[15px] leading-[1.6]"
        style={{ color: "var(--text-tertiary)" }}>
        {t("message")}
      </p>
      <Link
        href="/"
        className="eyebrow row-shift mt-8 border px-3 py-1.5"
        style={{ borderColor: "var(--line-default)", color: "var(--text-tertiary)" }}
      >
        ← {t("back")}
      </Link>
    </main>
  );
}
