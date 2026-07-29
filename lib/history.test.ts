import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confidenceWidth,
  groupHistory,
  parseHistory,
  seriesFor,
  sharedScale,
  summariseTrend,
} from "./history.ts";
import type { HistoryRow } from "./types.ts";

function row(
  model_id: string,
  benchmark_id: string,
  date: string,
  value: number,
): HistoryRow {
  return { model_id, benchmark_id, date, value };
}

test("two benchmarks for one model produce two series, never one concatenated", () => {
  // The failure this exists to catch: an Arena rating around 1400 and a percentage between
  // 0 and 100 landing in the same bucket, sorted by date into a line that means nothing.
  const index = groupHistory([
    row("openai-gpt-5", "lmarena_text_overall", "2026-01-01", 1420),
    row("openai-gpt-5", "frontiermath", "2026-01-01", 38.2),
    row("openai-gpt-5", "lmarena_text_overall", "2026-02-01", 1435),
    row("openai-gpt-5", "frontiermath", "2026-02-01", 41),
  ]);

  assert.equal(index.get("openai-gpt-5")?.size, 2);
  assert.deepEqual(seriesFor(index, "openai-gpt-5", "lmarena_text_overall"), [
    { date: "2026-01-01", value: 1420 },
    { date: "2026-02-01", value: 1435 },
  ]);
  assert.deepEqual(seriesFor(index, "openai-gpt-5", "frontiermath"), [
    { date: "2026-01-01", value: 38.2 },
    { date: "2026-02-01", value: 41 },
  ]);
});

test("category and composite series stay separate from their benchmarks", () => {
  const index = groupHistory([
    row("openai-gpt-5", "frontiermath", "2026-01-01", 38.2),
    row("openai-gpt-5", "livebench_math", "2026-01-01", 91.4),
    row("openai-gpt-5", "category:math", "2026-01-01", 64.8),
    row("openai-gpt-5", "composite", "2026-01-01", 71.2),
  ]);

  assert.equal(index.get("openai-gpt-5")?.size, 4);
  assert.deepEqual(seriesFor(index, "openai-gpt-5", "category:math"), [
    { date: "2026-01-01", value: 64.8 },
  ]);
  assert.deepEqual(seriesFor(index, "openai-gpt-5", "composite"), [
    { date: "2026-01-01", value: 71.2 },
  ]);
});

test("models are kept apart even when they share a benchmark", () => {
  const index = groupHistory([
    row("openai-gpt-5", "frontiermath", "2026-01-01", 38.2),
    row("anthropic-claude-opus-5", "frontiermath", "2026-01-01", 44.1),
  ]);

  assert.deepEqual(seriesFor(index, "openai-gpt-5", "frontiermath"), [
    { date: "2026-01-01", value: 38.2 },
  ]);
  assert.deepEqual(seriesFor(index, "anthropic-claude-opus-5", "frontiermath"), [
    { date: "2026-01-01", value: 44.1 },
  ]);
});

test("a series is sorted oldest first regardless of file order", () => {
  const index = groupHistory([
    row("m", "b", "2026-03-01", 3),
    row("m", "b", "2026-01-01", 1),
    row("m", "b", "2026-02-01", 2),
  ]);

  assert.deepEqual(
    seriesFor(index, "m", "b").map((p) => p.value),
    [1, 2, 3],
  );
});

test("asking for a series that was never measured yields an empty array", () => {
  const index = groupHistory([row("m", "b", "2026-01-01", 1)]);

  assert.deepEqual(seriesFor(index, "m", "other"), []);
  assert.deepEqual(seriesFor(index, "absent", "b"), []);
});

test("a malformed or incomplete line is skipped, not fatal", () => {
  const rows = parseHistory(
    [
      '{"model_id":"m","benchmark_id":"b","date":"2026-01-01","value":1}',
      "{ this is not json",
      '{"model_id":"m","date":"2026-01-02","value":2}',
      '{"model_id":"m","benchmark_id":"b","date":"2026-01-03","value":"high"}',
      "",
      '{"model_id":"m","benchmark_id":"b","date":"2026-01-04","value":4}',
    ].join("\n"),
  );

  assert.deepEqual(
    rows.map((r) => r.value),
    [1, 4],
  );
});

test("a movement inside the published confidence interval is not drawn as a trend", () => {
  // The failure: 23 of 49 models had a total span under 5 Elo while Arena's own interval on
  // those models is around 25 points, and every one was drawn full height like a real climb.
  const trend = summariseTrend(
    [
      { date: "2026-01-01", value: 1400, ci_low: 1388, ci_high: 1412 },
      { date: "2026-02-01", value: 1402, ci_low: 1390, ci_high: 1414 },
      { date: "2026-03-01", value: 1401, ci_low: 1389, ci_high: 1413 },
    ],
    null,
  );

  assert.equal(trend.span, 2);
  assert.equal(trend.ciWidth, 24);
  assert.equal(trend.significant, false);
});

test("a movement larger than the interval is drawn", () => {
  const trend = summariseTrend(
    [
      { date: "2026-01-01", value: 1400, ci_low: 1394, ci_high: 1406 },
      { date: "2026-02-01", value: 1464, ci_low: 1458, ci_high: 1470 },
    ],
    null,
  );

  assert.equal(trend.span, 64);
  assert.equal(trend.ciWidth, 12);
  assert.equal(trend.significant, true);
});

test("a series with no published interval is drawn when it moved at all", () => {
  const trend = summariseTrend(
    [
      { date: "2026-01-01", value: 40 },
      { date: "2026-02-01", value: 44 },
    ],
    null,
  );

  assert.equal(trend.ciWidth, null);
  assert.equal(trend.significant, true);
});

test("a shared scale makes two series comparable instead of both filling the box", () => {
  const small = [
    { date: "2026-01-01", value: 1400 },
    { date: "2026-02-01", value: 1401 },
  ];
  const large = [
    { date: "2026-01-01", value: 1400 },
    { date: "2026-02-01", value: 1464 },
  ];
  const scale = sharedScale([small, large]);

  const a = summariseTrend(small, scale);
  const b = summariseTrend(large, scale);

  // Against its own range the small series would span the full 0..1 like the large one.
  assert.ok(a.points[1] - a.points[0] < 0.05);
  assert.ok(b.points[1] - b.points[0] > 0.9);
});

test("the confidence width is a median, so one huge early interval does not dominate", () => {
  const width = confidenceWidth([
    { date: "2026-01-01", value: 1400, ci_low: 1200, ci_high: 1600 },
    { date: "2026-02-01", value: 1400, ci_low: 1394, ci_high: 1406 },
    { date: "2026-03-01", value: 1400, ci_low: 1395, ci_high: 1405 },
  ]);

  assert.equal(width, 12);
});

test("a one-point series has nothing to draw", () => {
  const trend = summariseTrend([{ date: "2026-01-01", value: 1400 }], null);

  assert.deepEqual(trend.points, []);
  assert.equal(trend.significant, false);
});
