/**
 * lib/ranking-wire.ts: the packed form of the ranking rows must give back exactly the rows
 * it was built from. Run with `npm run test:fit` (node:test, no dependencies).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packRankingRows, unpackRankingRows } from "../lib/ranking-wire.ts";
import type { RankingRow } from "../lib/types.ts";

function row(overrides: Partial<RankingRow>): RankingRow {
  return {
    id: "a-one",
    rank: 1,
    display_name: "One",
    provider_name: "A",
    provider_id: "a",
    is_open_weights: false,
    country: "Mexico",
    context_window: null,
    blended_price_usd_per_m: null,
    pareto_frontier: false,
    composite: 80,
    composite_error: null,
    tied_with: 0,
    coverage: { covered: 5, total: 5 },
    benchmarks: 6,
    category_scores: { reasoning: 80 },
    provisional: false,
    awaiting_human_votes: false,
    trend: [],
    ...overrides,
  };
}

test("round trip: usual values are dropped and restored", () => {
  const rows = [row({})];
  const packed = packRankingRows(rows);
  // Only what differs from the usual value travels.
  assert.deepEqual(Object.keys(packed.rows[0]).sort(), [
    "benchmarks", "category_scores", "composite", "coverage", "display_name", "id", "p", "rank",
  ]);
  assert.deepEqual(unpackRankingRows(packed), rows);
});

test("round trip: unusual values survive, including the three states of the frontier", () => {
  const rows = [
    row({ id: "a-1", pareto_frontier: true, is_open_weights: true, tied_with: 2 }),
    row({ id: "a-2", pareto_frontier: null, rank: null, provisional: true }),
    row({ id: "a-3", pareto_frontier: false, composite_error: 0.45, trend: [1400, 1410.5] }),
    row({ id: "a-4", context_window: 131072, blended_price_usd_per_m: 0, awaiting_human_votes: true }),
  ];
  assert.deepEqual(unpackRankingRows(packRankingRows(rows)), rows);
});

test("providers are stored once, and a differing country gets its own entry", () => {
  const rows = [
    row({ id: "a-1" }),
    row({ id: "a-2" }),
    row({ id: "a-3", country: "Spain" }),
    row({ id: "b-1", provider_id: "b", provider_name: "B" }),
  ];
  const packed = packRankingRows(rows);
  assert.deepEqual(packed.providers, [
    ["a", "A", "Mexico"],
    ["a", "A", "Spain"],
    ["b", "B", "Mexico"],
  ]);
  assert.deepEqual(unpackRankingRows(packed), rows);
});

test("round trip on the published cohort, and the packed form is the smaller one", () => {
  // Rebuilt from the same fields lib/data.ts getRankingRows() reads; the trend is left
  // empty here because it comes from history.jsonl, and the cases above cover it.
  type Model = Omit<RankingRow, "provider_name" | "coverage" | "benchmarks" | "trend"> & {
    context_window?: number | null;
    blended_price_usd_per_m?: number | null;
    pareto_frontier?: boolean | null;
    coverage: { covered: number; total: number };
    evidence: { benchmarks: number };
  };
  const { models } = JSON.parse(readFileSync("data/models.json", "utf8")) as { models: Model[] };
  const { providers } = JSON.parse(readFileSync("data/providers.json", "utf8")) as {
    providers: Array<{ id: string; display_name: string }>;
  };
  const names = new Map(providers.map((p) => [p.id, p.display_name]));
  const rows: RankingRow[] = models.map((m) => ({
    id: m.id,
    rank: m.rank,
    display_name: m.display_name,
    provider_name: names.get(m.provider_id) ?? m.provider_id,
    provider_id: m.provider_id,
    is_open_weights: m.is_open_weights,
    country: m.country,
    context_window: m.context_window ?? null,
    blended_price_usd_per_m: m.blended_price_usd_per_m ?? null,
    pareto_frontier: m.pareto_frontier ?? null,
    composite: m.composite,
    composite_error: m.composite_error,
    tied_with: m.tied_with,
    coverage: { covered: m.coverage.covered, total: m.coverage.total },
    benchmarks: m.evidence.benchmarks,
    category_scores: m.category_scores,
    provisional: m.provisional,
    awaiting_human_votes: m.awaiting_human_votes,
    trend: [],
  }));
  assert.ok(rows.length > 0);

  const packed = packRankingRows(rows);
  assert.deepEqual(unpackRankingRows(packed), rows);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(rows).length);
});
