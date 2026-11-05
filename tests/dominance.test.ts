/**
 * lib/dominance.ts: the rule behind the home chart's "beaten by / beats" readout. Run with
 * `npm run test:fit` (node:test, no dependencies). The last test holds the rule to the
 * frontier flag the ingest published in data/models.json, so the chart can never say
 * something the table does not.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dominanceMap, dominates } from "../lib/dominance.ts";

const p = (id: string, price: number, composite: number) => ({ id, price, composite });

test("cheaper and better dominates; equal on both dominates neither", () => {
  assert.equal(dominates(p("b", 1, 80), p("a", 2, 70)), true);
  assert.equal(dominates(p("a", 2, 70), p("b", 1, 80)), false);
  // Identical price and composite: neither is strictly better, so neither is beaten.
  assert.equal(dominates(p("x", 1, 80), p("y", 1, 80)), false);
  assert.equal(dominates(p("x", 1, 80), p("x", 1, 80)), false);
});

test("same price, higher score dominates; same score, lower price dominates", () => {
  assert.equal(dominates(p("b", 2, 75), p("a", 2, 70)), true);
  assert.equal(dominates(p("b", 1, 70), p("a", 2, 70)), true);
});

test("a trade-off (cheaper but worse) is not dominance in either direction", () => {
  assert.equal(dominates(p("cheap", 1, 60), p("dear", 5, 80)), false);
  assert.equal(dominates(p("dear", 5, 80), p("cheap", 1, 60)), false);
});

test("beats and beatenBy are mirror images", () => {
  const pts = [p("a", 1, 60), p("b", 2, 80), p("c", 3, 70), p("d", 4, 90)];
  const map = dominanceMap(pts);
  // c (3, 70) is beaten by b (2, 80). d (4, 90) beats nobody on price, so nobody beats it.
  assert.deepEqual(map.get("c")!.beatenBy, ["b"]);
  assert.deepEqual(map.get("b")!.beats, ["c"]);
  for (const [id, entry] of map) {
    for (const other of entry.beats) assert.ok(map.get(other)!.beatenBy.includes(id));
  }
});

test("the published frontier flag is exactly 'beaten by nobody' on the real data", () => {
  const { models } = JSON.parse(readFileSync("data/models.json", "utf8")) as {
    models: Array<{
      id: string;
      composite: number | null;
      blended_price_usd_per_m: number | null;
      pareto_frontier: boolean | null;
    }>;
  };
  const evaluated = models.filter((m) => m.pareto_frontier !== null && m.pareto_frontier !== undefined);
  assert.ok(evaluated.length > 20, "the real data should carry an evaluated cohort");
  const map = dominanceMap(
    evaluated.map((m) => p(m.id, m.blended_price_usd_per_m as number, m.composite as number)),
  );
  const disagreements = evaluated.filter(
    (m) => (map.get(m.id)!.beatenBy.length === 0) !== m.pareto_frontier,
  );
  assert.deepEqual(
    disagreements.map((m) => m.id),
    [],
  );
});
