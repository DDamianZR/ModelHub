/**
 * Turning history rows into series. Pure, and deliberately free of runtime imports so it
 * can be loaded and tested on its own — see history.test.ts.
 */
import type { HistoryIndex, HistoryPoint, HistoryRow } from "./types";

/**
 * Group history rows into one series per (model, benchmark).
 *
 * Keyed by model alone, every reading a model has lands in a single bucket: Arena ratings
 * around 1400 interleaved with percentages between 0 and 100, sorted by date into one
 * meaningless line. That was harmless only while the file held a single benchmark, and
 * stops being harmless the moment the ingest records more than one.
 */
export function groupHistory(rows: HistoryRow[]): HistoryIndex {
  const grouped: HistoryIndex = new Map();

  for (const row of rows) {
    // Nested rather than a composite string key: model ids and benchmark ids both contain
    // punctuation, and a benchmark id may itself be "category:reasoning", so any separator
    // picked for a flat key is a collision waiting to be found by real data.
    let byBenchmark = grouped.get(row.model_id);
    if (!byBenchmark) {
      byBenchmark = new Map();
      grouped.set(row.model_id, byBenchmark);
    }
    const bucket = byBenchmark.get(row.benchmark_id);
    if (bucket) bucket.push({ date: row.date, value: row.value });
    else byBenchmark.set(row.benchmark_id, [{ date: row.date, value: row.value }]);
  }

  for (const byBenchmark of grouped.values()) {
    for (const bucket of byBenchmark.values()) {
      bucket.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return grouped;
}

/** One model's readings for one benchmark, oldest first. Empty when never measured. */
export function seriesFor(
  index: HistoryIndex,
  modelId: string,
  benchmarkId: string,
): HistoryPoint[] {
  return index.get(modelId)?.get(benchmarkId) ?? [];
}

/**
 * Parse history.jsonl content into rows, discarding anything unusable.
 *
 * A row without a benchmark cannot be placed in a series without guessing which one it
 * belongs to, and guessing is how the scales got mixed in the first place. One malformed
 * line does not take the build down with it.
 */
export function parseHistory(contents: string): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as HistoryRow;
      if (row.model_id && row.benchmark_id && typeof row.value === "number") {
        rows.push(row);
      }
    } catch {
      // Skip it.
    }
  }
  return rows;
}
