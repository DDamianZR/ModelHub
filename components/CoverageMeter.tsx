import clsx from "clsx";

/**
 * Five segments, one per weighted category, filled when that category has data.
 *
 * A composite built from three categories is not the same claim as one built from five,
 * and the ranking is dishonest if it hides the difference. This puts the evidence base
 * next to the number instead of in a footnote.
 *
 * One element, drawn in CSS (see .coverage in globals.css) from two custom properties.
 * It used to be one <span> per segment, five per meter, rendered twice per model in the
 * ranking: 68 KB of the home page's HTML for a five-bar glyph.
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
  return (
    <span
      className={clsx("coverage", covered < total && "coverage-partial")}
      style={{ "--covered": covered, "--total": total } as React.CSSProperties}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
