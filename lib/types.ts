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
  /** Half-width of a 95% interval per category. null where nothing was published. */
  category_errors: Partial<Record<Category, number | null>>;
  composite: number;
  /**
   * Half-width of a 95% interval on the composite, in composite points. A floor, not an
   * estimate: inputs publishing no uncertainty contribute zero. null means no input
   * published one at all, which is "unknown", never "zero".
   */
  composite_error: number | null;
  uncertainty: {
    measured_inputs: number;
    total_inputs: number;
    is_lower_bound: boolean;
  };
  /** How many other ranked models share this rank because nothing separates them. */
  tied_with: number;
  /**
   * Set when the normalised Arena value moved while the rating did not: the cohort was
   * renormalised around this model, nobody voted differently. Attributing that shift to
   * the model would credit or blame it for a change in the scale.
   */
  cohort_recalibration: {
    raw_delta: number;
    normalized_delta: number;
    composite_effect: number;
    /** The median gap between neighbours this was measured against. */
    threshold: number;
  } | null;
  coverage: { covered: number; total: number; missing: string[] };
  /**
   * How much independent evidence stands behind the composite — a different question
   * from how many categories it covers. Two models can hold the same score with six
   * benchmarks behind one and four behind the other.
   */
  evidence: { sources: number; max_sources: number; benchmarks: number };
  /** Below the coverage bar: listed separately rather than competing for a top-N slot. */
  provisional: boolean;
  /** Has the benchmarks but no Arena votes yet. Not a penalty, just a disclosure. */
  awaiting_human_votes: boolean;
  /** The single published configuration every score below is reported under. */
  variant: string | null;
  /**
   * Set only when Arena never published `variant`, naming the configuration its rating
   * does describe. Stated rather than hidden: the two axes measure two setups.
   */
  human_preference_variant: string | null;
  vision: { rating: number; rank: number; measured_at: string; variant?: string } | null;
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
  cadence_days?: number;
  /** Thresholds the run actually applied, so the page quotes them rather than redoing them. */
  warn_days?: number;
  degraded_days?: number;
  /** The rhythm the source actually kept, measured from its own published dates. */
  observed?: {
    snapshots: number;
    median_gap_days: number;
    longest_gap_days: number;
    first: string;
    last: string;
  };
  /** The declared cadence is contradicted by the observed one. */
  cadence_disputed?: boolean;
};

/** A snapshot a guard refused, kept so the policy can be audited rather than believed. */
export type RejectedSnapshot = {
  date: string;
  ratio: number;
  config: string;
  reason: string;
};

export type SourceIntegrity = {
  /** SHA-256 of the normalised payload the ingest produced from this source. */
  normalised_sha256: string;
  requests: number;
  /** Empty for paginated sources, where a per-URL list would be unreadable. */
  upstream: { url: string; sha256: string; bytes: number }[];
};

export type Status = {
  generated_at: string;
  ok: boolean;
  sources: Record<string, SourceStatus>;
  snapshot_ages?: Record<string, SnapshotAge>;
  thresholds?: {
    warn_cadence_multiple?: number;
    degraded_cadence_multiple?: number;
    /** Arena rating points below which a rating counts as unmoved. */
    recalibration_raw_still?: number;
  };
  rejected_snapshots?: unknown[];
  integrity?: Record<string, SourceIntegrity>;
};

/** A source whose upstream measurement has gone stale, even if the fetch succeeded. */
export type AgedSource = { name: string } & SnapshotAge;

/** A model plus everything the table needs, already resolved on the server. */
export type Row = Model & {
  provider_name: string;
  /** Normalised 0-1 points for the sparkline, oldest first. */
  trend: number[];
};
