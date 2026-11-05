/**
 * lib/compare.ts: the interval rule shared by Compare and the vs pages, the canonical pair
 * order, and the snapshot-coverage rule behind the trend charts. Run with `npm run test:fit`
 * (node:test, no dependencies). Expected values are worked out in the comment beside each.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { comparableDates, orderPair, separation } from "../lib/compare.ts";

test("separation: a gap inside the combined interval is not a separation", () => {
  // 83.41 - 82.85 = 0.56; combined interval 0.36 + 0.72 = 1.08, so 0.56 < 1.08.
  const r = separation(83.41, 0.36, 82.85, 0.72);
  assert.equal(r.separated, false);
  assert.ok(Math.abs(r.gap - 0.56) < 1e-9);
  assert.ok(Math.abs((r.combined ?? 0) - 1.08) < 1e-9);
});

test("separation: a gap beyond the combined interval is one", () => {
  // 90 - 80 = 10 > 1 + 2.
  assert.equal(separation(90, 1, 80, 2).separated, true);
});

test("separation: the sign of the gap does not change the verdict", () => {
  assert.equal(separation(80, 2, 90, 1).separated, true);
  assert.equal(separation(80, 2, 90, 1).gap, -10);
});

test("separation: a missing interval is unknown, never zero", () => {
  // Treating null as 0 would claim 10 > 0 + 1 here.
  const r = separation(90, null, 80, 1);
  assert.equal(r.separated, false);
  assert.equal(r.combined, null);
  assert.equal(separation(90, undefined, 80, undefined).combined, null);
});

test("separation: a gap exactly equal to the combined interval is not a separation", () => {
  assert.equal(separation(10, 1, 7, 2).separated, false); // |3| is not > 3
});

test("orderPair: one canonical order for both directions, by id", () => {
  assert.deepEqual(orderPair("b-model", "a-model"), ["a-model", "b-model"]);
  assert.deepEqual(orderPair("a-model", "b-model"), ["a-model", "b-model"]);
});

test("orderPair: depends on the ids only, not on which model is which", () => {
  // The same two ids in either argument order give the same pair, whoever makes them.
  const ids = ["z-one", "m-two", "a-three"];
  for (const x of ids) for (const y of ids) if (x !== y) assert.deepEqual(orderPair(x, y), orderPair(y, x));
});

test("comparableDates: drops snapshots that measure under half the fullest one", () => {
  // The committed history, in miniature: one model for months, then the whole cohort.
  const counts = {
    "2026-01-09": 1,
    "2026-06-01": 1,
    "2026-10-15": 5,
    "2026-10-20": 39,
    "2026-10-22": 39,
    "2026-10-28": 40,
  };
  // Fullest is 40, so the bar is 20: 1, 1 and 5 are out, 39, 39 and 40 stay.
  assert.deepEqual(comparableDates(counts, 0.5), ["2026-10-20", "2026-10-22", "2026-10-28"]);
});

test("comparableDates: a uniform history keeps everything, in date order", () => {
  assert.deepEqual(comparableDates({ "2026-02-01": 10, "2026-01-01": 10 }, 0.5), [
    "2026-01-01",
    "2026-02-01",
  ]);
});

test("comparableDates: an empty history is empty", () => {
  assert.deepEqual(comparableDates({}, 0.5), []);
});
