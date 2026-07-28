/**
 * Shared shapes. Kept free of Node imports so client components can use them
 * without dragging the filesystem reader into the browser bundle.
 */

export const CATEGORIES = [
  "reasoning",
  "coding",
  "math",
  "human_preference",
  "instruction_following",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Model = {
  id: string;
  /** null for provisional models: they are shown, but never occupy a ranked slot. */
  rank: number | null;
  display_name: string;
  provider_id: string;
  is_open_weights: boolean;
  license: string | null;
  api_only: boolean;
  release_date: string | null;
  country: string;
  modalities: string[];
  status: string;
  category_scores: Partial<Record<Category, number>>;
  composite: number;
  coverage: { covered: number; total: number; missing: string[] };
  /** Below the coverage bar: listed separately rather than competing for a top-N slot. */
  provisional: boolean;
  /** Has the benchmarks but no Arena votes yet. Not a penalty, just a disclosure. */
  awaiting_human_votes: boolean;
  vision: { rating: number; rank: number; measured_at: string } | null;
};

export type Meta = {
  generated_at: string;
  model_count: number;
  ranked_count: number;
  provisional_count: number;
  min_coverage_for_ranking: number;
  snapshots: Record<string, string | null>;
  arena_normalization: { method: string; min: number; max: number };
};

export type Provider = { id: string; display_name: string; country: string };

export type SourceState = "ok" | "cached" | "stale" | "failed";

export type SourceStatus = {
  state: SourceState;
  last_success: string | null;
  age_days?: number;
  error?: string | null;
};

export type SnapshotAge = {
  date: string | null;
  age_days: number | null;
  freshness: "fresh" | "aging" | "degraded" | "unknown";
  /** The composite category this source feeds, when it feeds exactly one. */
  category?: string;
};

export type Status = {
  generated_at: string;
  ok: boolean;
  sources: Record<string, SourceStatus>;
  snapshot_ages?: Record<string, SnapshotAge>;
  thresholds?: { snapshot_warn_days: number; snapshot_degraded_days: number };
  rejected_snapshots?: unknown[];
};

/** A source whose upstream measurement has gone stale, even if the fetch succeeded. */
export type AgedSource = { name: string } & SnapshotAge;

/** A model plus everything the table needs, already resolved on the server. */
export type Row = Model & {
  provider_name: string;
  /** Normalised 0-1 points for the sparkline, oldest first. */
  trend: number[];
};
