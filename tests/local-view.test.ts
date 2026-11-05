/**
 * lib/local-view.ts: the selection and ordering rules behind /local. Run with
 * `npm run test:fit` (node:test, no dependencies). Inputs are built by hand, so each
 * expectation is a statement about the rule and not a copy of the module's output.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTERS,
  GPU_STOPS,
  applyFilters,
  nearestStop,
  nextJump,
  sortResults,
  speedTier,
  summarise,
  unlocked,
  type Result,
} from "../lib/local-view.ts";
import type { FitLevel } from "../lib/fit.ts";
import type { LocalEntry } from "../lib/types.ts";

type Over = {
  id: string;
  name?: string;
  params?: number;
  moe?: boolean;
  measured?: boolean;
  provisional?: boolean;
  composite?: number | null;
  downloads?: number | null;
  modality?: "text" | "vision" | null;
  level?: FitLevel;
  tps?: number | null;
};

function result(o: Over): Result {
  const measured = o.measured ?? true;
  const entry = {
    spec: {
      model_id: o.id,
      hf_repo: `org/${o.name ?? o.id}`,
      parameters_raw: o.params ?? 7e9,
      is_moe: o.moe ?? false,
    },
    display_name: o.name ?? o.id,
    measured,
    modality: o.modality ?? "text",
    hf_downloads: o.downloads ?? null,
    composite: measured ? (o.composite ?? 50) : null,
    provisional: o.provisional ?? false,
  } as unknown as LocalEntry;
  return {
    entry,
    fit: { level: o.level ?? "good", tokensPerSecond: o.tps ?? null } as Result["fit"],
  };
}

const ids = (list: Result[]) => list.map((r) => r.entry.spec.model_id);

test("nearestStop snaps to the closest rung and keeps the first of two equals", () => {
  assert.equal(GPU_STOPS[nearestStop(GPU_STOPS, 11)], 10); // 10 and 12 tie: the lower one
  assert.equal(GPU_STOPS[nearestStop(GPU_STOPS, 13)], 12);
  assert.equal(GPU_STOPS[nearestStop(GPU_STOPS, 1)], 2);
  assert.equal(GPU_STOPS[nearestStop(GPU_STOPS, 9999)], 128);
});

test("speed bands cut at 10 and 30 tokens per second, and unknown stays unknown", () => {
  assert.equal(speedTier(30), "fast");
  assert.equal(speedTier(29.9), "comfortable");
  assert.equal(speedTier(10), "comfortable");
  assert.equal(speedTier(9.9), "slow");
  assert.equal(speedTier(null), "unknown");
});

test("summary: provisional and unmeasured models never take the 'best measured' slot", () => {
  const list = [
    result({ id: "ranked-low", composite: 40, params: 8e9, tps: 20 }),
    result({ id: "ranked-high", composite: 70, params: 30e9, tps: 12 }),
    result({ id: "provisional", provisional: true, composite: 99, params: 14e9, tps: 18 }),
    result({ id: "unmeasured", measured: false, params: 600e9, tps: 90 }),
    result({ id: "too-big", composite: 99, params: 700e9, level: "too_tight", tps: null }),
  ];
  const s = summarise(list);
  assert.equal(s.runs, 4);
  assert.equal(s.total, 5);
  assert.equal(s.bestMeasured?.entry.spec.model_id, "ranked-high");
  assert.equal(s.largest?.entry.spec.model_id, "unmeasured"); // 600B beats 30B; 700B does not run
  assert.equal(s.fastest?.entry.spec.model_id, "unmeasured");
});

test("summary of a machine that runs nothing is all nulls, not a crash", () => {
  const s = summarise([result({ id: "a", level: "too_tight" })]);
  assert.deepEqual([s.runs, s.largest, s.bestMeasured, s.fastest], [0, null, null, null]);
});

test("filters: default hides what does not fit; 'all' keeps it", () => {
  const list = [result({ id: "yes" }), result({ id: "no", level: "too_tight" })];
  assert.deepEqual(ids(applyFilters(list, DEFAULT_FILTERS)), ["yes"]);
  assert.deepEqual(ids(applyFilters(list, { ...DEFAULT_FILTERS, fit: "all" })), ["yes", "no"]);
});

test("filters: scope, modality, architecture, speed band and text search combine", () => {
  const list = [
    result({ id: "a", name: "Alpha", moe: true, modality: "vision", tps: 40 }),
    result({ id: "b", name: "Beta", measured: false, tps: 5 }),
    result({ id: "c", name: "Gamma", modality: null, tps: 15 }),
  ];
  const f = (patch: object) => ids(applyFilters(list, { ...DEFAULT_FILTERS, ...patch }));
  assert.deepEqual(f({ scope: "unmeasured" }), ["b"]);
  assert.deepEqual(f({ scope: "measured" }), ["a", "c"]);
  assert.deepEqual(f({ modality: "vision" }), ["a"]);
  assert.deepEqual(f({ modality: "text" }), ["b", "c"]); // an unknown modality reads as text
  assert.deepEqual(f({ arch: "moe" }), ["a"]);
  assert.deepEqual(f({ arch: "dense" }), ["b", "c"]);
  assert.deepEqual(f({ tier: "slow" }), ["b"]);
  assert.deepEqual(f({ query: " ALP " }), ["a"]);
  assert.deepEqual(f({ query: "org/gam" }), ["c"]); // the repo name is searchable too
  assert.deepEqual(f({ scope: "measured", tier: "fast" }), ["a"]);
});

test("default order: ranked by composite, then provisional, then unmeasured by downloads", () => {
  const list = [
    result({ id: "unm-small", measured: false, downloads: 10 }),
    result({ id: "prov", provisional: true, composite: 95 }),
    result({ id: "rank-low", composite: 40 }),
    result({ id: "unm-big", measured: false, downloads: 5_000_000 }),
    result({ id: "rank-high", composite: 70 }),
  ];
  assert.deepEqual(ids(sortResults(list, "composite")), [
    "rank-high", "rank-low", "prov", "unm-big", "unm-small",
  ]);
});

test("explicit orders put missing values last and settle ties by name", () => {
  const list = [
    result({ id: "z", name: "Zed", tps: 10, downloads: 1 }),
    result({ id: "a", name: "Ada", tps: 10, downloads: null }),
    result({ id: "m", name: "Mia", tps: null, downloads: 9 }),
  ];
  assert.deepEqual(ids(sortResults(list, "speed")), ["a", "z", "m"]);
  assert.deepEqual(ids(sortResults(list, "popularity")), ["m", "z", "a"]);
  assert.deepEqual(ids(sortResults(list, "name")), ["a", "m", "z"]);
  assert.deepEqual(
    ids(sortResults([result({ id: "s", params: 1e9 }), result({ id: "l", params: 9e9 })], "size")),
    ["l", "s"],
  );
});

test("sorting never mutates its input", () => {
  const list = [result({ id: "b", composite: 1 }), result({ id: "a", composite: 2 })];
  sortResults(list, "composite");
  assert.deepEqual(ids(list), ["b", "a"]);
});

test("unlocked: only models that newly run, measured evidence first, then the largest", () => {
  const now = [result({ id: "stays" }), result({ id: "was-out", level: "too_tight" })];
  const next = [
    result({ id: "stays" }),
    result({ id: "was-out" }),
    result({ id: "new-measured-low", composite: 30 }),
    result({ id: "new-measured-high", composite: 60 }),
    result({ id: "new-unm-small", measured: false, params: 3e9 }),
    result({ id: "new-unm-big", measured: false, params: 30e9 }),
    result({ id: "still-out", level: "too_tight" }),
  ];
  // "was-out" is measured at the default composite of 50, so it sits between 60 and 30.
  assert.deepEqual(ids(unlocked(now, next)), [
    "new-measured-high", "was-out", "new-measured-low", "new-unm-big", "new-unm-small",
  ]);
});

test("nextJump: first rung above the typed value that runs more than the typed machine", () => {
  const stops = [8, 12, 16, 24, 32, 48];
  const counts = [3, 3, 7, 7, 9, 9];
  assert.equal(nextJump(stops, counts, 8, 3), 2); // 12 adds nothing; 16 does
  assert.equal(nextJump(stops, counts, 16, 7), 4);
  assert.equal(nextJump(stops, counts, 48, 9), null); // top of the scale
  assert.equal(nextJump(stops, counts, 20, 7), 4); // between rungs: 24 adds nothing, 32 does
  assert.equal(nextJump(stops, counts, 11, 4), 2); // typed 11 runs 4: 12 holds 3, so skip it
  assert.equal(nextJump(stops, [5, 5, 5, 5, 5, 5], 8, 5), null);
});
