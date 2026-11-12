/**
 * lib/plans.ts: the order of the plans page. Run with `npm run test:fit` (node:test, no
 * dependencies). The rate is a round 20 pesos per dollar so the order can be read by eye.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sortPlans } from "../lib/plans.ts";
import type { FxRate } from "../lib/currency.ts";
import type { Plan } from "../lib/types.ts";

const FX: FxRate = { mxn: 20, date: "2026-11-06", publisher: "reference" };

function plan(id: string, price: number | null, currency: Plan["currency"], name = id): Plan {
  return {
    id,
    name,
    price_per_month: price,
    currency,
    region: "MX",
    model_ids: ["m"],
    source_url: "https://example.org",
    verified_at: "2026-11-09",
  };
}

const ids = (plans: Plan[]) => plans.map((entry) => entry.id);

test("cheapest first, with a free plan ahead of a paid one and no fee last", () => {
  const sorted = sortPlans(
    [plan("paid", 399, "MXN"), plan("unlisted", null, null), plan("free", 0, "MXN"), plan("mid", 129, "MXN")],
    FX,
  );
  assert.deepEqual(ids(sorted), ["free", "mid", "paid", "unlisted"]);
});

test("fees in two currencies are ordered by value, not by the bare number", () => {
  // 399 pesos are 19.95 dollars at 20 per dollar, so they come before 20 dollars.
  const sorted = sortPlans([plan("usd-20", 20, "USD"), plan("mxn-399", 399, "MXN"), plan("mxn-500", 500, "MXN")], FX);
  assert.deepEqual(ids(sorted), ["mxn-399", "usd-20", "mxn-500"]);
});

test("two currencies and no rate: by name, rather than comparing 399 with 20", () => {
  const sorted = sortPlans([plan("b", 399, "MXN", "Beta"), plan("a", 20, "USD", "Alpha")], null);
  assert.deepEqual(ids(sorted), ["a", "b"]);
  const zero = sortPlans([plan("b", 399, "MXN", "Beta"), plan("a", 20, "USD", "Alpha")], { ...FX, mxn: 0 });
  assert.deepEqual(ids(zero), ["a", "b"]);
});

test("one currency needs no rate to be ordered by fee", () => {
  const sorted = sortPlans([plan("b", 399, "MXN"), plan("a", 129, "MXN")], null);
  assert.deepEqual(ids(sorted), ["a", "b"]);
});

test("equal fees fall back to the name, then the id, and the input is left alone", () => {
  const input = [plan("z", 399, "MXN", "Same"), plan("a", 399, "MXN", "Same"), plan("m", 399, "MXN", "Earlier")];
  const sorted = sortPlans(input, FX);
  assert.deepEqual(ids(sorted), ["m", "a", "z"]);
  assert.deepEqual(ids(input), ["z", "a", "m"]);
  assert.deepEqual(sortPlans([], FX), []);
});
