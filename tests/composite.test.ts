/**
 * lib/composite.ts against the numbers the ingest published. The port is only worth having
 * if it reproduces data/models.json digit for digit at the site's weights; everything a
 * reader then does with other weights rests on that. Run with `npm run test:fit`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SHARE_EPSILON,
  coveredShare,
  minCoveredShare,
  pyRound,
  pySum,
  significanceRanks,
  weightedComposite,
} from "../lib/composite.ts";

interface Model {
  id: string;
  composite: number;
  composite_error: number | null;
  rank: number | null;
  tied_with: number;
  provisional: boolean;
  category_scores: Record<string, number>;
  category_errors: Record<string, number | null>;
}

const { models } = JSON.parse(readFileSync("data/models.json", "utf8")) as { models: Model[] };
const config = JSON.parse(readFileSync("config/weights.json", "utf8")) as {
  weights: Record<string, number>;
  min_coverage_for_ranking: number;
};
const SITE = config.weights;

test("pySum: compensated, so the order of cancelling terms does not lose the small one", () => {
  // A plain left-to-right sum returns 0 here; Python 3.12's sum() returns 2.
  assert.equal(pySum([1, 1e100, 1, -1e100]), 2);
  assert.equal(pySum([]), 0);
  assert.equal(pySum([0.25, 0.25, 0.2, 0.15, 0.15]), 1);
});

test("pyRound: an exact half goes to the even digit, anything else to the nearest", () => {
  // 0.125, 0.375 and 2.5 are exact in binary, so they are true ties.
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(2.5, 0), 2);
  assert.equal(pyRound(3.5, 0), 4);
  assert.equal(pyRound(-0.125, 2), -0.12);
  // 2.675 is stored just below the half, so it rounds down in Python and here alike.
  assert.equal(pyRound(2.675, 2), 2.67);
  assert.equal(pyRound(84.4885, 2), 84.49);
  assert.equal(pyRound(80, 2), 80);
});

test("parity: every published composite and interval is reproduced at the site's weights", () => {
  assert.ok(models.length > 0);
  const different: string[] = [];
  for (const model of models) {
    const got = weightedComposite(model, SITE);
    if (!got || got.composite !== model.composite || got.error !== model.composite_error) {
      different.push(
        `${model.id}: published ${model.composite} ±${model.composite_error}, got ${got?.composite} ±${got?.error}`,
      );
    }
  }
  assert.deepEqual(different, [], `${different.length} of ${models.length} differ`);
});

test("parity: every published rank and tie is reproduced from the published composites", () => {
  const ranked = models.filter((model) => !model.provisional);
  const placed = significanceRanks(
    ranked.map((model) => ({ composite: model.composite, error: model.composite_error })),
  );
  const different = ranked.filter(
    (model, i) => placed[i].rank !== model.rank || placed[i].tied_with !== model.tied_with,
  );
  assert.deepEqual(
    different.map((model) => model.id),
    [],
    `${different.length} of ${ranked.length} differ`,
  );
});

test("gate: the share form of the rule agrees with the published one on every model", () => {
  const bar = minCoveredShare(SITE, config.min_coverage_for_ranking);
  // 0.15 + 0.15 + 0.20 + 0.25 of 1.00 with the weights decided on 2026-07-27.
  assert.ok(Math.abs(bar - 0.75) < SHARE_EPSILON, `bar is ${bar}`);
  const different = models.filter(
    (model) => (coveredShare(model, SITE) + SHARE_EPSILON < bar) !== model.provisional,
  );
  assert.deepEqual(different.map((model) => model.id), []);
});

test("other weights: a category weighing zero drops out of the mean and of the coverage", () => {
  const model = {
    category_scores: { reasoning: 90, coding: 60 },
    category_errors: { reasoning: 2, coding: null },
  };
  // Only coding counts: its score, and no interval because none was published for it.
  assert.deepEqual(weightedComposite(model, { reasoning: 0, coding: 1, math: 0 }), {
    composite: 60,
    error: null,
  });
  // Half and half: (90 + 60) / 2, and the interval is 0.5 * 2 from the one known input.
  assert.deepEqual(weightedComposite(model, { reasoning: 1, coding: 1 }), { composite: 75, error: 1 });
  // Math carries a third of the weight and this model was never measured on it.
  const share = coveredShare(model, { reasoning: 1, coding: 1, math: 1 });
  assert.ok(Math.abs(share - 2 / 3) < SHARE_EPSILON);
  assert.equal(coveredShare(model, { reasoning: 1, coding: 1, math: 0 }), 1);
  assert.equal(weightedComposite(model, { math: 1 }), null);
  assert.equal(coveredShare(model, { reasoning: 0, coding: 0 }), 0);
});

test("ranks: overlap is a tie, a clean gap is not, and a missing interval is a point", () => {
  const placed = significanceRanks([
    { composite: 90, error: 1 },
    { composite: 89, error: 1 }, // overlaps the first
    { composite: 80, error: 1 }, // clear of both
    { composite: 79.5, error: null }, // a point inside the third's interval
  ]);
  assert.deepEqual(placed, [
    { rank: 1, tied_with: 1 },
    { rank: 1, tied_with: 1 },
    { rank: 3, tied_with: 1 },
    { rank: 3, tied_with: 1 },
  ]);
});
