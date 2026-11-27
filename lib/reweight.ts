/**
 * A reader's own ranking: the published category scores under weights the reader chose.
 *
 * Everything here is arithmetic over data/models.json done by lib/composite.ts, which is
 * checked against the published numbers. With the site's weights this returns the site's
 * ranking exactly, and tests/reweight.test.ts holds it to that.
 *
 * Three rules, each the site's own rule carried over rather than a new one:
 *
 * - Coverage. A model is placed only if the categories it was measured on carry at least
 *   the share of weight the site's gate admits (lib/composite.ts minCoveredShare). The
 *   others are listed apart and never given a place.
 * - Rank. One plus the number of models measurably ahead, so models whose intervals
 *   overlap share a place.
 * - Filters hide rows; they do not change the cohort. A model's place is its place among
 *   every comparable model, as on the home, so narrowing the list by price cannot make a
 *   model "first".
 *
 * No Node imports: this runs in the browser.
 */
import {
  SHARE_EPSILON,
  coveredShare,
  significanceRanks,
  weightedComposite,
  type Weights,
  // The extension is spelled out because the tests run this file under Node directly,
  // which resolves a runtime import only by its full name.
} from "./composite.ts";

/** What the page ships per model: the published inputs and the published placing. */
export interface ReweightRow {
  id: string;
  display_name: string;
  provider_name: string;
  category_scores: Record<string, number>;
  category_errors: Record<string, number | null>;
  /** As published, for the comparison with the reader's ranking. */
  composite: number;
  composite_error: number | null;
  rank: number | null;
  tied_with: number;
  is_open_weights: boolean;
  context_window: number | null;
  blended_price_usd_per_m: number | null;
}

export interface Placed {
  row: ReweightRow;
  composite: number;
  error: number | null;
  rank: number;
  tied_with: number;
}

export interface Reweighted {
  /** Comparable under these weights, in rank order. */
  placed: Placed[];
  /** Measured on too little of the chosen weight to be placed, by name. */
  apart: ReweightRow[];
  /** Models placed under both weightings, and how many of them hold a different place. */
  compared: number;
  moved: number;
}

/** Slider points to weights. 25 becomes the same double the config's 0.25 parses to. */
export function pointsToWeights(categories: readonly string[], points: readonly number[]): Weights {
  return Object.fromEntries(categories.map((category, i) => [category, (points[i] ?? 0) / 100]));
}

/** Weights to slider points, for the site's defaults. */
export function weightsToPoints(categories: readonly string[], weights: Weights): number[] {
  return categories.map((category) => Math.round((weights[category] ?? 0) * 100));
}

/** "25,25,20,15,15" to points; null unless it is one whole number from 0 to 100 per category. */
export function parsePoints(text: string | null, count: number): number[] | null {
  if (!text) return null;
  const parts = text.split(",");
  if (parts.length !== count) return null;
  const points = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return points.every((value) => value >= 0 && value <= 100) ? points : null;
}

export function reweight(rows: ReweightRow[], weights: Weights, bar: number): Reweighted {
  const candidates: Array<Omit<Placed, "rank" | "tied_with">> = [];
  const apart: ReweightRow[] = [];
  for (const row of rows) {
    const scored = weightedComposite(row, weights);
    if (scored && coveredShare(row, weights) + SHARE_EPSILON >= bar) {
      candidates.push({ row, composite: scored.composite, error: scored.error });
    } else {
      apart.push(row);
    }
  }

  const ranks = significanceRanks(candidates);
  const placed = candidates
    .map((candidate, i) => ({ ...candidate, ...ranks[i] }))
    // Rank first, score inside a rank, id last so the order never depends on input order.
    .sort((a, b) => a.rank - b.rank || b.composite - a.composite || a.row.id.localeCompare(b.row.id));
  apart.sort((a, b) => a.display_name.localeCompare(b.display_name));

  // Movement is counted among the models placed under both weightings, with both ranks
  // recomputed over that common set. Comparing the two rank columns directly would count
  // every model below a newcomer as moved, which is displacement and not disagreement.
  const common = placed.filter((entry) => entry.row.rank !== null);
  const here = significanceRanks(common);
  const site = significanceRanks(
    common.map((entry) => ({ composite: entry.row.composite, error: entry.row.composite_error })),
  );
  const moved = common.filter((_, i) => here[i].rank !== site[i].rank).length;

  return { placed, apart, compared: common.length, moved };
}
