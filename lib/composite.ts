/**
 * The site's composite, interval and rank, recomputed in the browser.
 *
 * A port of three pieces of scripts/ingest/composite.py, so a reader can change the weights
 * and see the ranking that follows without the site computing anything new about a model:
 * the inputs are the category scores and intervals already published in data/models.json.
 *
 *   weightedComposite   <- the weighted mean in build_models() and combine_weighted()
 *   significanceRanks   <- assign_significance_ranks()
 *   minCoveredShare     <- the coverage gate, restated as a share of weight
 *
 * The port is checked, not trusted: tests/composite.test.ts recomputes every published
 * composite, interval, rank and tie from the committed data with the site's own weights
 * and fails on the first difference. Two details exist only to make that equality hold:
 *
 * - Sums use the compensated summation Python's sum() applies to floats since 3.12, the
 *   version the ingest runs on. A plain left-to-right sum can differ in the last bit.
 * - Rounding is half-to-even on the exact binary value, as Python's round() does. JS
 *   toFixed() rounds an exact half up.
 *
 * Neither changes a published digit today; both are what "the same number" means.
 *
 * No Node imports: this runs in the browser.
 */

/** Python's sum() over floats (3.12+): Neumaier compensated summation. */
export function pySum(values: number[]): number {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation +=
      Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }
  return total + compensation;
}

/** Python's round(x, digits): half-to-even, decided on the exact value of the double. */
export function pyRound(x: number, digits: number): number {
  // toFixed is exact decimal arithmetic; 60 places hold every digit of a double this size.
  const exact = Math.abs(x).toFixed(60);
  const cut = exact.indexOf(".") + 1 + digits;
  if (!/^50*$/.test(exact.slice(cut))) return Number(x.toFixed(digits));
  // With no decimals kept, the slice ends on the point itself; drop it to reach the digit.
  const kept = exact.slice(0, cut).replace(/\.$/, "");
  const down = Number(kept);
  const even = Number(kept[kept.length - 1]) % 2 === 0;
  const magnitude = even ? down : Number((down + 10 ** -digits).toFixed(digits));
  return x < 0 ? -magnitude : magnitude;
}

export type Weights = Record<string, number>;

export interface Scored {
  category_scores: Record<string, number>;
  category_errors?: Record<string, number | null>;
}

/** The categories that carry weight and that this model has a score for, in weight order. */
function available(model: Scored, weights: Weights): string[] {
  return Object.keys(weights).filter(
    (category) => weights[category] > 0 && category in model.category_scores,
  );
}

/**
 * Composite and 95% half-width under `weights`, rounded as published. Null when the model
 * has no score in any weighted category.
 *
 * Missing categories are left out and the rest renormalised, never zero-filled; the gate
 * below is what keeps a thinly measured model from ranking on what it is missing. The
 * interval is a floor, for the reasons stated in composite.py: inputs without a published
 * uncertainty add nothing to it, and the categories are treated as independent.
 */
export function weightedComposite(
  model: Scored,
  weights: Weights,
): { composite: number; error: number | null } | null {
  const categories = available(model, weights);
  const total = pySum(categories.map((category) => weights[category]));
  if (categories.length === 0 || !total) return null;

  const composite =
    pySum(categories.map((category) => model.category_scores[category] * weights[category])) /
    total;

  const known = categories.filter((category) => {
    const halfWidth = model.category_errors?.[category];
    return halfWidth !== null && halfWidth !== undefined;
  });
  const error =
    known.length === 0
      ? null
      : Math.sqrt(
          pySum(
            known.map((category) => {
              const share = weights[category] / total;
              const halfWidth = model.category_errors![category] as number;
              return share * share * halfWidth * halfWidth;
            }),
          ),
        );

  return { composite: pyRound(composite, 2), error: error === null ? null : pyRound(error, 2) };
}

/** Share of the total weight that falls on categories this model has a score for. */
export function coveredShare(model: Scored, weights: Weights): number {
  const weighted = Object.keys(weights).filter((category) => weights[category] > 0);
  const total = pySum(weighted.map((category) => weights[category]));
  if (!total) return 0;
  return pySum(available(model, weights).map((category) => weights[category])) / total;
}

/**
 * The coverage gate as a share of weight: the least the site's own rule ever admits.
 *
 * The site ranks a model with `minCoverage` of its categories measured. Under the site's
 * weights the thinnest model that rule lets in is one holding the `minCoverage` lightest
 * categories, so that share is the bar. With 4 of 5 and 25/25/20/15/15 it is 0.75: any four
 * categories cover at least 0.75, any three at most 0.70, so at the site's weights the two
 * statements of the rule agree on every model. Under other weights only the share is
 * meaningful, because "four categories" says nothing once one of them weighs zero.
 */
export function minCoveredShare(siteWeights: Weights, minCoverage: number): number {
  const ascending = Object.values(siteWeights).sort((a, b) => a - b);
  return pySum(ascending.slice(0, minCoverage)) / pySum(ascending);
}

/** Tolerance for comparing shares that are sums of the same few floats in another order. */
export const SHARE_EPSILON = 1e-9;

export interface Rankable {
  composite: number;
  error: number | null;
}

/**
 * Significance rank and tie count for each entry, in input order.
 *
 * A model's rank is one plus the number of models measurably ahead of it: those whose
 * composite minus its interval still clears this model's composite plus its own. An entry
 * with no interval is compared as a point, as the ingest does and for the reason it gives.
 */
export function significanceRanks(entries: Rankable[]): Array<{ rank: number; tied_with: number }> {
  const ranks = entries.map((entry) => {
    const ceiling = entry.composite + (entry.error ?? 0);
    let ahead = 0;
    for (const other of entries) {
      if (other !== entry && other.composite - (other.error ?? 0) > ceiling) ahead += 1;
    }
    return 1 + ahead;
  });
  const shared = new Map<number, number>();
  for (const rank of ranks) shared.set(rank, (shared.get(rank) ?? 0) + 1);
  return ranks.map((rank) => ({ rank, tied_with: (shared.get(rank) as number) - 1 }));
}
