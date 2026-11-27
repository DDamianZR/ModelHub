/**
 * The context and price steps the ranking and the reweighting page both filter by, kept in
 * one place so the two cannot offer different thresholds for the same question.
 *
 * Context floors are in tokens and price ceilings in USD per million. Round numbers a
 * reader would pick, not tuned to the current catalogue. Filters always compare in USD;
 * the currency switch only changes how a ceiling is printed.
 */
export const CONTEXT_FLOORS = [131_072, 262_144, 1_000_000] as const;
export const PRICE_CEILINGS = [0.5, 1, 3, 10] as const;

export function formatContext(tokens: number | null): string {
  if (tokens === null) return "·";
  return tokens >= 1_000_000
    ? `${Math.round((tokens / 1_000_000) * 10) / 10}M`
    : `${Math.round(tokens / 1024)}K`;
}
