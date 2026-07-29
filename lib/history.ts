/**
 * Turning history rows into series. Pure, and deliberately free of runtime imports so it
 * can be loaded and tested on its own — see history.test.ts.
 */
import type { HistoryIndex, HistoryPoint, HistoryRow, Trend } from "./types";

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
    const point: HistoryPoint = { date: row.date, value: row.value };
    if (row.ci_low !== undefined) point.ci_low = row.ci_low;
    if (row.ci_high !== undefined) point.ci_high = row.ci_high;

    const bucket = byBenchmark.get(row.benchmark_id);
    if (bucket) bucket.push(point);
    else byBenchmark.set(row.benchmark_id, [point]);
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

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The width of the source's own error bar, as a median across the series.
 *
 * Median rather than mean because early readings on few votes carry enormous intervals that
 * would swamp the settled ones.
 */
export function confidenceWidth(points: HistoryPoint[]): number | null {
  const widths = points
    .filter((p) => p.ci_low !== undefined && p.ci_high !== undefined)
    .map((p) => (p.ci_high as number) - (p.ci_low as number));
  return median(widths);
}

/**
 * Turn a series into something a sparkline can draw honestly.
 *
 * Two rules, both of which the previous version broke.
 *
 * Scaled against a SHARED range, not each series' own. Scaling every line to its own min and
 * max makes a model that moved 0.5 Elo look identical to one that climbed 64, because both
 * fill the box top to bottom. Of the 49 models with a series, 23 had a total span under
 * 5 Elo and two were flat to within half a point.
 *
 * And no trend at all when the movement does not clear the source's published confidence
 * interval. LMArena ships rating_lower and rating_upper; a typical interval is around 25
 * rating points, which is wider than most models' entire history. Drawing that as a rising
 * line is inventing a finding out of noise.
 */
export function summariseTrend(
  points: HistoryPoint[],
  scale: { min: number; max: number } | null,
): Trend {
  const values = points.map((point) => point.value);
  const empty: Trend = {
    points: [],
    first: null,
    last: null,
    span: 0,
    ciWidth: null,
    significant: false,
  };
  if (values.length < 2) return empty;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const ciWidth = confidenceWidth(points);
  // With no published interval there is nothing to test the movement against, so the series
  // is drawn — the source simply has not given us grounds to suppress it.
  const significant = ciWidth === null ? span > 0 : span > ciWidth;

  const low = scale?.min ?? min;
  const high = scale?.max ?? max;
  const range = high - low;

  return {
    points: values.map((value) =>
      range > 0 ? Math.min(1, Math.max(0, (value - low) / range)) : 0.5,
    ),
    first: values[0],
    last: values[values.length - 1],
    span: Number(span.toFixed(1)),
    ciWidth: ciWidth === null ? null : Number(ciWidth.toFixed(1)),
    significant,
  };
}

/** The min and max across every series drawn in one table, so rows are comparable. */
export function sharedScale(series: HistoryPoint[][]): { min: number; max: number } | null {
  const values = series.flatMap((points) => points.map((point) => point.value));
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
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
      // Fields beyond model/benchmark/value/date are optional: rows written before the
      // schema carried confidence bounds are still perfectly readable.
    } catch {
      // Skip it.
    }
  }
  return rows;
}
