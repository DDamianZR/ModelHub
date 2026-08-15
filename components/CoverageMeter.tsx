import clsx from "clsx";

/**
 * Five segments, one per weighted category, filled when that category has data.
 *
 * A composite built from three categories is not the same claim as one built from five,
 * and the ranking is dishonest if it hides the difference. This puts the evidence base
 * next to the number instead of in a footnote.
 */
export function CoverageMeter({
  covered,
  total,
  label,
}: {
  covered: number;
  total: number;
  label: string;
}) {
  const partial = covered < total;

  return (
    <span
      className="inline-flex items-center gap-[3px]"
      role="img"
      aria-label={label}
      title={label}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={clsx(
            "block h-[13px] w-[3px]",
            i < covered ? "bg-accent" : "border border-line",
            i < covered && partial && "opacity-65",
          )}
        />
      ))}
    </span>
  );
}
