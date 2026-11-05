/**
 * Whether the gap between two measurements is larger than their combined 95% intervals.
 *
 * This is the ranking's own rule, shared by the interactive Compare board and the static
 * vs pages. An interval that can only widen supports "these two overlap" but never "these
 * two differ", so a bare subtraction must not read as a win. A missing error is unknown,
 * not zero: no separation is claimed against it. No Node imports: client-safe.
 */
export function separation(
  a: number,
  errorA: number | null | undefined,
  b: number,
  errorB: number | null | undefined,
): { gap: number; combined: number | null; separated: boolean } {
  const gap = a - b;
  if (errorA == null || errorB == null) return { gap, combined: null, separated: false };
  const combined = errorA + errorB;
  return { gap, combined, separated: Math.abs(gap) > combined };
}

/**
 * Canonical order of a pair of model ids: alphabetical. A data-neutral rule, so /vs/a/b and
 * /vs/b/a are one page (the second redirects) and neither model is "first" by preference.
 */
export function orderPair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
}

/**
 * Snapshot dates fit to plot together: those that measure at least `share` of the models the
 * fullest snapshot measures. `counts` maps a date to how many models it measured. A date with
 * one model sits beside a date with forty only by accident of when collection began, and
 * plotting both draws that accident as a trend.
 */
export function comparableDates(counts: Record<string, number>, share: number): string[] {
  const fullest = Math.max(0, ...Object.values(counts));
  return Object.entries(counts)
    .filter(([, n]) => n >= fullest * share)
    .map(([date]) => date)
    .sort();
}
