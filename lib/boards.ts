/**
 * Boards: third-party measurements the ingest keeps outside the composite and writes to
 * data/boards.json. They never become a category score and never count toward coverage;
 * here they are only turned into rows a benchmark page can print.
 *
 * No Node imports: lib/views.ts does the reading and hands the parsed file in.
 */

/** One row of a board, as the ingest writes it. */
export interface BoardRow {
  model_id: string;
  variant?: string | null;
  value: number;
  stderr?: number | null;
  measured_at?: string | null;
}

export interface BoardsFile {
  boards: Array<{
    id: string;
    benchmarks: Array<{ id: string; name: string; source_url: string; rows: BoardRow[] }>;
  }>;
}

/** Categories that exist only as a board and have a label in messages/*.json (table.*). */
export const BOARD_CATEGORIES = ["knowledge", "agentic"] as const;

/**
 * The 95% half-width of a published standard error, to three decimals: the same arithmetic
 * scripts/ingest/composite.py applies to scored rows (CONFIDENCE_Z = 1.96), so a board row
 * and a scored row from the same source print comparable intervals.
 */
export function halfWidth95(stderr: number | null | undefined): number | null {
  if (stderr === null || stderr === undefined) return null;
  return Math.round(stderr * 1.96 * 1000) / 1000;
}

/** The board benchmark with this id, or null when no board carries it. */
export function findBoardBenchmark(
  file: BoardsFile,
  benchmarkId: string,
): { board: string; source_url: string; rows: BoardRow[] } | null {
  for (const board of file.boards) {
    const benchmark = board.benchmarks.find((entry) => entry.id === benchmarkId);
    if (benchmark) {
      return { board: board.id, source_url: benchmark.source_url, rows: benchmark.rows };
    }
  }
  return null;
}
