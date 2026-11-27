import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ChangeEvent } from "@/lib/changes";

/** "=3" for a shared place, "3" for a sole one, "·" for none: the home table's notation. */
function place(rank: number | null, tied: boolean): string {
  return rank === null ? "·" : tied ? `=${rank}` : String(rank);
}

function Name({ id, names }: { id: string; names: Record<string, string> }) {
  const known = id in names;
  return known ? (
    <Link href={`/model/${id}`} className="underline underline-offset-2 hover:text-accent">
      {names[id]}
    </Link>
  ) : (
    <span>{id}</span>
  );
}

/**
 * One event as a sentence. It says what the log says and stops: a move lists the model's own
 * rows that changed, and when there are none it says so instead of guessing a reason.
 */
export function ChangeLine({
  event,
  models,
  benchmarks,
}: {
  event: ChangeEvent;
  models: Record<string, string>;
  benchmarks: Record<string, string>;
}) {
  const t = useTranslations("changes");
  const bench = (id: string) => benchmarks[id] ?? id;

  switch (event.type) {
    case "model_added":
      return (
        <>
          <Name id={event.model_id} names={models} />{" "}
          {event.ranked
            ? t("addedRanked", { place: place(event.rank, event.tied) })
            : t("addedProvisional")}
        </>
      );
    case "model_removed":
      return (
        <>
          <Name id={event.model_id} names={models} /> {t("removed")}
        </>
      );
    case "gate_crossed":
      return (
        <>
          <Name id={event.model_id} names={models} />{" "}
          {t(event.entered ? "gateEntered" : "gateLeft", {
            from: event.covered[0],
            to: event.covered[1],
            total: event.total,
          })}
        </>
      );
    case "moved":
      return (
        <>
          <Name id={event.model_id} names={models} />{" "}
          {t("moved", {
            from: place(event.rank[0], event.tied[0]),
            to: place(event.rank[1], event.tied[1]),
            before: event.composite[0].toFixed(2),
            after: event.composite[1].toFixed(2),
          })}{" "}
          {event.inputs.length === 0
            ? t("ownUnchanged")
            : t("ownChanged", {
                rows: event.inputs
                  .map((row) => `${bench(row.benchmark_id)} ${row.value[0] ?? "·"} → ${row.value[1] ?? "·"}`)
                  .join("; "),
              })}
        </>
      );
    case "cohort_shift":
      return <>{t("cohortShift", { moved: event.moved, compared: event.compared })}</>;
    case "price_changed":
      return (
        <>
          <Name id={event.model_id} names={models} />{" "}
          {t("price", {
            before: event.blended_usd_per_m[0] === null ? "·" : event.blended_usd_per_m[0].toFixed(3),
            after: event.blended_usd_per_m[1] === null ? "·" : event.blended_usd_per_m[1].toFixed(3),
          })}
        </>
      );
    case "benchmark_updated":
      return (
        <>
          {bench(event.benchmark_id)}:{" "}
          {t("benchmarkRows", { changed: event.changed, added: event.added, removed: event.removed })}
        </>
      );
    case "arena_scale":
      return (
        <>
          {t("arenaScale", {
            minBefore: event.min[0],
            minAfter: event.min[1],
            maxBefore: event.max[0],
            maxAfter: event.max[1],
          })}
        </>
      );
  }
}
