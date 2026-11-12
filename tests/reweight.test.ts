/**
 * lib/reweight.ts: with the site's weights a reader's ranking must be the site's ranking,
 * and with other weights it must follow the site's rules. Run with `npm run test:fit`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { minCoveredShare } from "../lib/composite.ts";
import {
  parsePoints,
  pointsToWeights,
  reweight,
  weightsToPoints,
  type ReweightRow,
} from "../lib/reweight.ts";

type Published = ReweightRow & { provisional: boolean; provider_id: string };

const { models } = JSON.parse(readFileSync("data/models.json", "utf8")) as { models: Published[] };
const config = JSON.parse(readFileSync("config/weights.json", "utf8")) as {
  weights: Record<string, number>;
  min_coverage_for_ranking: number;
};
const CATEGORIES = Object.keys(config.weights);
const BAR = minCoveredShare(config.weights, config.min_coverage_for_ranking);
const rows: ReweightRow[] = models.map((model) => ({
  ...model,
  provider_name: model.provider_id,
  context_window: model.context_window ?? null,
  blended_price_usd_per_m: model.blended_price_usd_per_m ?? null,
}));

test("points: the site's weights survive the trip to slider points and back, bit for bit", () => {
  const points = weightsToPoints(CATEGORIES, config.weights);
  assert.deepEqual(points, [25, 25, 20, 15, 15]);
  assert.deepEqual(pointsToWeights(CATEGORIES, points), config.weights);
});

test("parsePoints: one whole number from 0 to 100 per category, or nothing", () => {
  assert.deepEqual(parsePoints("25,25,20,15,15", 5), [25, 25, 20, 15, 15]);
  assert.deepEqual(parsePoints("0,100,0,0,0", 5), [0, 100, 0, 0, 0]);
  for (const bad of [null, "", "25,25,20,15", "25,25,20,15,15,5", "a,b,c,d,e", "25,25,20,15,101", "25,25,20,15,-5", "2.5,25,20,15,15", "25,25,20,15,"]) {
    assert.equal(parsePoints(bad, 5), null, String(bad));
  }
});

test("site weights: the reader's ranking is the published ranking, model for model", () => {
  const points = weightsToPoints(CATEGORIES, config.weights);
  const result = reweight(rows, pointsToWeights(CATEGORIES, points), BAR);
  const ranked = models.filter((model) => !model.provisional);

  assert.equal(result.placed.length, ranked.length);
  assert.deepEqual(
    result.apart.map((row) => row.id).sort(),
    models.filter((model) => model.provisional).map((model) => model.id).sort(),
  );
  const different = result.placed.filter(
    (entry) =>
      entry.rank !== entry.row.rank ||
      entry.tied_with !== entry.row.tied_with ||
      entry.composite !== entry.row.composite ||
      entry.error !== entry.row.composite_error,
  );
  assert.deepEqual(different.map((entry) => entry.row.id), []);
  assert.equal(result.compared, ranked.length);
  assert.equal(result.moved, 0);
});

test("site weights: the order is the one the ingest publishes", () => {
  const result = reweight(rows, config.weights, BAR);
  const published = models.filter((model) => !model.provisional).map((model) => model.id);
  // models.json lists the ranked models by rank, then score; ties in both are broken here
  // by id, so compare as (rank, composite) sequences rather than as id lists.
  const key = (rank: number | null, composite: number) => `${rank}:${composite}`;
  assert.deepEqual(
    result.placed.map((entry) => key(entry.rank, entry.composite)),
    published.map((id) => {
      const model = models.find((m) => m.id === id) as Published;
      return key(model.rank, model.composite);
    }),
  );
});

function row(id: string, scores: Record<string, number>, rank: number | null = 1): ReweightRow {
  return {
    id,
    display_name: id,
    provider_name: "p",
    category_scores: scores,
    category_errors: {},
    composite: 0,
    composite_error: null,
    rank,
    tied_with: 0,
    is_open_weights: false,
    context_window: null,
    blended_price_usd_per_m: null,
  };
}

test("other weights: a model missing the category that carries the weight is set apart", () => {
  const full = row("m-full", { reasoning: 60, coding: 60 });
  const partial = row("m-partial", { reasoning: 99 });
  // Coding carries 80% and m-partial has no coding score: 20% covered, under any bar here.
  const result = reweight([full, partial], { reasoning: 0.2, coding: 0.8 }, 0.75);
  assert.deepEqual(result.placed.map((entry) => entry.row.id), ["m-full"]);
  assert.deepEqual(result.apart.map((entry) => entry.id), ["m-partial"]);
  // With the weight moved onto what it was measured on, it is comparable and ahead.
  const again = reweight([full, partial], { reasoning: 1, coding: 0 }, 0.75);
  assert.deepEqual(again.placed.map((entry) => entry.row.id), ["m-partial", "m-full"]);
  assert.deepEqual(again.apart, []);
});

test("other weights: no weight at all places nobody", () => {
  const result = reweight([row("m-a", { reasoning: 50 })], { reasoning: 0, coding: 0 }, 0.75);
  assert.deepEqual(result.placed, []);
  assert.equal(result.apart.length, 1);
});

test("moved: counted among models placed both ways, not by comparing rank columns", () => {
  // Published: a ahead of b ahead of c, and d unranked. Under coding only, d becomes
  // comparable and lands first. a, b and c each sit one place lower than published, yet
  // among themselves nothing changed, so nothing moved.
  const published = (id: string, composite: number, rank: number | null, coding: number): ReweightRow => ({
    ...row(id, { coding }, rank),
    composite,
  });
  const cohort = [
    published("m-a", 90, 1, 90),
    published("m-b", 80, 2, 80),
    published("m-c", 70, 3, 70),
    published("m-d", 95, null, 99),
  ];
  const result = reweight(cohort, { coding: 1 }, 0.75);
  assert.deepEqual(result.placed.map((entry) => [entry.row.id, entry.rank]), [
    ["m-d", 1], ["m-a", 2], ["m-b", 3], ["m-c", 4],
  ]);
  assert.equal(result.compared, 3);
  assert.equal(result.moved, 0);
});
