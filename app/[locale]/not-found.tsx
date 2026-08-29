import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[60vh] max-w-[80rem] flex-col items-start justify-center px-5 pb-20 sm:px-8"
    >
      <p className="eyebrow mb-3 text-tertiary">
        404
      </p>
      <h1 className="text-3xl leading-tight font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-4 max-w-[34rem] text-md leading-[1.6] text-tertiary">
        {t("message")}
      </p>
      <Link href="/" className="control eyebrow mt-8">
        ← {t("back")}
      </Link>
    </main>
  );
}
