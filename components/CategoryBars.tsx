/**
 * Horizontal bars on a shared 0-100 axis, one row per series.
 *
 * Deliberately NOT a radar. Radar distorts area and makes precise comparison across
 * five axes harder than reading bars off a common baseline, which is the whole job here.
 *
 * Every bar uses the same accent: model identity is carried by row position and a direct
 * label, never by colour. A four-hue categorical palette cannot be built inside this
 * project's single-accent brief without failing chroma and lightness checks, and identity
 * by label is more accessible than identity by hue anyway.
 */
export function CategoryBars({
  rows,
  emptyLabel,
}: {
  rows: { label: string; value: number | undefined; sublabel?: string }[];
  emptyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="grid grid-cols-[1fr_auto] gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px]">{row.label}</span>
              <span
                className="num shrink-0 text-[12px]"
                style={{ color: row.value === undefined ? "var(--muted)" : "inherit" }}
              >
                {row.value === undefined ? emptyLabel : row.value.toFixed(1)}
              </span>
            </div>
            <div
              className="mt-[3px] h-[6px] w-full"
              style={{ background: "var(--paper-sunk)" }}
              role="img"
              aria-label={`${row.label}: ${
                row.value === undefined ? emptyLabel : row.value.toFixed(1)
              }`}
            >
              {row.value !== undefined && (
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, row.value))}%`,
                    background: "var(--mark)",
                    borderRadius: "0 3px 3px 0",
                  }}
                />
              )}
            </div>
            {row.sublabel && (
              <div className="num mt-[2px] text-[10px]" style={{ color: "var(--muted)" }}>
                {row.sublabel}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
