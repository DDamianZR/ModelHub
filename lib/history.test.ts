import assert from "node:assert/strict";
import { test } from "node:test";
import { groupHistory, parseHistory, seriesFor } from "./history.ts";
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
