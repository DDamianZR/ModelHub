/**
 * lib/boards.ts: locating a benchmark on a board and printing its interval the way scored
 * rows print theirs. Run with `npm run test:fit` (node:test, no dependencies).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findBoardBenchmark, halfWidth95, type BoardsFile } from "../lib/boards.ts";

test("halfWidth95: 1.96 standard errors, three decimals, null when none was published", () => {
  // 0.751 * 1.96 = 1.47196
  assert.equal(halfWidth95(0.751), 1.472);
  // 2.483 * 1.96 = 4.86668, the value data/scores.json carries for the same stderr.
  assert.equal(halfWidth95(2.483), 4.867);
  assert.equal(halfWidth95(0), 0);
  assert.equal(halfWidth95(null), null);
  assert.equal(halfWidth95(undefined), null);
});

test("halfWidth95 agrees with every scored row that publishes a standard error", () => {
  const { scores } = JSON.parse(readFileSync("data/scores.json", "utf8")) as {
    scores: Array<{ stderr?: number | null; half_width_95?: number | null }>;
  };
  const withError = scores.filter((row) => typeof row.stderr === "number");
  assert.ok(withError.length > 0);
  for (const row of withError) assert.equal(halfWidth95(row.stderr), row.half_width_95);
});

test("findBoardBenchmark: found with its board, absent as null", () => {
  const file: BoardsFile = {
    boards: [
      { id: "one", benchmarks: [{ id: "alpha", name: "Alpha", source_url: "https://a.example", rows: [] }] },
      {
        id: "two",
        benchmarks: [
          { id: "beta", name: "Beta", source_url: "https://b.example", rows: [{ model_id: "m", value: 1 }] },
        ],
      },
    ],
  };
  assert.deepEqual(findBoardBenchmark(file, "beta"), {
    board: "two",
    source_url: "https://b.example",
    rows: [{ model_id: "m", value: 1 }],
  });
  assert.equal(findBoardBenchmark(file, "missing"), null);
});

test("the committed boards file has the shape this module reads", () => {
  const file = JSON.parse(readFileSync("data/boards.json", "utf8")) as BoardsFile;
  assert.ok(file.boards.length > 0);
  for (const board of file.boards) {
    for (const benchmark of board.benchmarks) {
      assert.equal(typeof benchmark.id, "string");
      assert.equal(typeof benchmark.source_url, "string");
      for (const row of benchmark.rows) {
        assert.equal(typeof row.model_id, "string");
        assert.equal(typeof row.value, "number");
      }
    }
  }
});
