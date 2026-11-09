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
  /** Tokens the model accepts, from the router catalogue. null when unlisted. */
  context_window: number | null;
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
  /**
   * What the router catalogue lists for API use, in USD per million tokens. A side that the
   * catalogue does not price is null, never 0. Absent when the model is not matched there.
   */
  pricing?: {
    input_usd_per_m: number | null;
    output_usd_per_m: number | null;
    source_url: string;
    measured_at: string;
  } | null;
  /** USD per million tokens at the fixed input:output blend in config/weights.json. */
  blended_price_usd_per_m?: number | null;
  /** Blended price divided by composite. null when unpriced or not ranked. */
  price_per_composite_point?: number | null;
  /**
   * Not dominated on (price, composite). null means not evaluated (unpriced or
   * provisional), which is different from false (evaluated and dominated).
   */
  pareto_frontier?: boolean | null;
  vision: { rating: number; rank: number; measured_at: string; variant?: string } | null;
};

export type Meta = {
  generated_at: string;
  model_count: number;
  ranked_count: number;
  provisional_count: number;
  min_coverage_for_ranking: number;
  min_release_date: string;
  contamination_reviewed_at: string | null;
  snapshots: Record<string, string | null>;
  arena_normalization: { method: string; min: number; max: number };
};

export type Provider = { id: string; display_name: string; country: string };

/**
 * A consumer subscription plan that includes a model (data/plans.json, from config/plans.json).
 * Access information entered by pull request, with the page it came from and the day someone
 * last read it. Never a score, and the fee is never converted into a per-token price.
 */
export type Plan = {
  id: string;
  name: string;
  /** USD per month, or null when the plan page lists no fee. */
  price_usd_per_month: number | null;
  model_ids: string[];
  source_url: string;
  verified_at: string;
};

export type SourceState = "ok" | "cached" | "stale" | "failed";

/** Which release one category was scored from, and the measurement that decided it. */
export type CategoryRule = {
  release: string;
  fallback: boolean;
  /** Mean absolute gap on the models two releases share; null when nothing was compared. */
  drift: number | null;
  common_models: number;
  reason: string;
  max_drift: number;
  min_common_models: number;
};

export type SourceStatus = {
  state: SourceState;
  last_success: string | null;
  age_days?: number;
  error?: string | null;
  /** Newer releases the source published that the ingest could not use. */
  skipped_releases?: { date: string; reason: string }[];
  category_rule?: Record<string, CategoryRule>;
};

export type SnapshotAge = {
  date: string | null;
  age_days: number | null;
  freshness: "fresh" | "aging" | "degraded" | "unknown";
  /** Date of the newest release the source published, when that differs from `date`. */
  snapshot?: string | null;
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

/**
 * Narrowed shape for the ranking table: exactly the fields it reads, and nothing else.
 *
 * The full `Row` carries 28 fields and the table renders 16 of them. The rest were being
 * serialised into every browser, including two the schema defines but no source populates.
 * Anything added here must have a call site in RankingTable — the projection is the
 * contract, and a field nobody reads is payload nobody asked for.
 */
export type RankingRow = Pick<
  Row,
  | "id"
  | "rank"
  | "display_name"
  | "provider_name"
  | "provider_id"
  | "is_open_weights"
  | "country"
  | "context_window"
  | "blended_price_usd_per_m"
  | "pareto_frontier"
  | "composite"
  | "composite_error"
  | "tied_with"
  | "category_scores"
  | "provisional"
  | "awaiting_human_votes"
  | "trend"
> & {
  /** Only the two numbers the meter draws; the list of missing categories stays on the server. */
  coverage: { covered: number; total: number };
  /** How many benchmarks stand behind the composite (Row.evidence.benchmarks). */
  benchmarks: number;
};

/** One "best by" rule from config/weights.json, evaluated. Derived, never scored. */
export interface BestByBoard {
  id: string;
  metric: string;
  order: "max" | "min";
  filter: {
    is_open_weights?: boolean;
    max_blended_price?: number;
    min_coverage?: number;
  };
  candidates: number;
  value: number | null;
  /** Every model nobody in the pool is measurably ahead of; more than one is a tie. */
  winners: string[];
  indistinguishable: boolean;
}

export interface BestBy {
  meta: {
    generated_at: string;
    price_blend: { input: number; output: number };
    ranked_only: boolean;
    pareto_members: number;
    pareto_evaluated: number;
  };
  boards: BestByBoard[];
}

/**
 * One open-weights model with the shape needed to size it for a local machine
 * (data/local_models.json). Sizes come from the llmfit catalogue and are joined to a scored
 * model by normalised name; nothing here is a measurement of quality.
 */
export interface LocalModelSpec {
  model_id: string;
  hf_repo: string;
  parameters_raw: number;
  /** Per-token active parameters for mixture-of-experts models; null for dense ones. */
  active_parameters: number | null;
  is_moe: boolean;
  num_experts: number | null;
  active_experts: number | null;
  context_length: number;
  num_hidden_layers: number | null;
  num_attention_heads: number | null;
  num_key_value_heads: number | null;
  head_dim: number | null;
  architecture: string | null;
  /**
   * Hybrid models: layers with a context-scaled KV cache versus layers with fixed-size
   * state. Read from config/local.json by name pattern at ingest, so the browser carries
   * no model names. null means "unknown", sized as all full attention.
   */
  attention_layout: { full: number; linear: number } | null;
  /** The quantisation the catalogue lists the repo at; the fit search starts from the ladder. */
  quantization: string;
  min_ram_gb: number;
  min_vram_gb: number | null;
  license: string | null;
}

/**
 * Facts about a Hugging Face repo that a card shows and the fit arithmetic never reads.
 * `hf_downloads` and `hf_likes` measure popularity on the hub, not quality.
 */
export interface LocalRepoFacts {
  source_url: string;
  /** "vision" when the repo takes images as well as text; null when the catalogue omits it. */
  modality: "text" | "vision" | null;
  hf_downloads: number | null;
  hf_likes: number | null;
  /** Repos sharing this normalised name in the catalogue; the most downloaded was used. */
  candidates: number;
  /** How many of them report a parameter count more than 10% away from the one used. */
  size_disagreement: number;
}

export type LocalModelRow = LocalModelSpec & LocalRepoFacts;

/**
 * What /local needs per model: the sizing shape, plus the model's measured standing when
 * ModelHub scores it. The composite is displayed as-is and never used to decide whether a
 * model fits. A model ModelHub does not measure (`measured: false`) carries no composite,
 * rank or coverage at all: the page lists it because it can run, not because it was ranked.
 */
export interface LocalEntry {
  spec: LocalModelSpec;
  display_name: string;
  measured: boolean;
  hf_url: string;
  modality: "text" | "vision" | null;
  hf_downloads: number | null;
  hf_likes: number | null;
  /** null for provisional and unmeasured models, which never hold a ranked slot. */
  rank: number | null;
  tied_with: number;
  composite: number | null;
  composite_error: number | null;
  provisional: boolean;
  coverage: { covered: number; total: number } | null;
  measured_at: string | null;
}

export interface LocalModels {
  meta: {
    generated_at: string;
    source: string;
    license: string;
    in_composite: false;
    open_weights_scored: number;
    matched: number;
    catalogue_rows: number;
    catalogue_rules: {
      min_downloads?: number;
      min_likes?: number;
      max_rows?: number;
    };
  };
  models: LocalModelRow[];
  /** Most downloaded models outside the cohort: sized, linked, never scored. */
  catalogue: (LocalModelRow & { display_name: string })[];
}

/** One entry of the static search index served at /search-index.json. Short keys on purpose. */
export interface SearchEntry {
  t: "model" | "provider" | "benchmark";
  id: string;
  /** Display name. */
  n: string;
  /** Secondary text: the provider of a model, the category of a benchmark. */
  s?: string;
}

/** A model as it appears on a "best by" card: just enough to name it and place it. */
export interface BoardModel {
  id: string;
  display_name: string;
  provider_name: string;
  rank: number | null;
  tied_with: number;
  composite: number;
  composite_error: number | null;
  price: number | null;
}

/** A "best by" board resolved against the models. Derived, never scored. */
export interface BoardCard extends Omit<BestByBoard, "winners"> {
  winners: BoardModel[];
}

/** One priced, ranked model on the cost-versus-composite chart. */
export interface ScatterPoint {
  id: string;
  name: string;
  price: number;
  composite: number;
  error: number | null;
  frontier: boolean;
  rank: number | null;
  open: boolean | null;
}

/** A group's best measured Arena rating on each snapshot date. */
export interface TrendSeries {
  key: string;
  /** How many catalogue models of the group have at least one rating. */
  models: number;
  points: { date: string; value: number }[];
}
