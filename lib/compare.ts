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
