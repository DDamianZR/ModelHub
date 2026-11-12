import fs from "node:fs";
import path from "node:path";
import type { FxRate } from "./currency";
import type {
  AgedSource,
  CategoryRule,
  Meta,
  Model,
  ExpiredPlan,
  Plan,
  Provider,
  RejectedSnapshot,
  RankingRow,
  BestBy,
  LocalEntry,
  LocalModels,
  Row,
  SnapshotAge,
  Status,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

// The data only changes between builds, and the prerender reads the same files for every
// page (the vs pages alone are 870). Memoised in production; in dev a file edit shows up.
const jsonCache = new Map<string, unknown>();

export function readJson<T>(file: string): T {
  const memo = process.env.NODE_ENV === "production";
  if (memo && jsonCache.has(file)) return jsonCache.get(file) as T;
  const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) as T;
  if (memo) jsonCache.set(file, parsed);
  return parsed;
}

/**
 * USD to MXN reference rate, or null when none has ever been fetched or the file is unusable.
 * Null is not an error: the page then shows USD only and hides the selector.
 */
export function getFx(): FxRate | null {
  const file = path.join(DATA_DIR, "fx.json");
  if (!fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as {
      date?: string;
      rates?: { MXN?: number };
      meta?: { publisher?: string };
    };
    const mxn = payload.rates?.MXN;
    if (typeof mxn !== "number" || !Number.isFinite(mxn) || mxn <= 0 || !payload.date) return null;
    return { mxn, date: payload.date, publisher: payload.meta?.publisher ?? "" };
  } catch {
    return null;
  }
}

/**
 * How many days a plan entry stays current, as config/plans.json states it. Read from the
 * config, where the number is decided, rather than from the generated file. Null when the
 * config does not state one, in which case no page quotes a limit.
 */
export function getPlanMaxAgeDays(): number | null {
  try {
    const days = readJson<{ max_age_days?: unknown }>("../config/plans.json").max_age_days;
    return typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null;
  } catch {
    return null;
  }
}

/**
 * Everything on record about subscription plans: the ones fit to show, the ones set aside
 * because nobody has re-read their page within the limit, and that limit in days. A missing
 * or unreadable file is an empty record, never an error: plans are optional information.
 */
export function getPlans(): { plans: Plan[]; expired: ExpiredPlan[]; maxAgeDays: number | null } {
  const file = path.join(DATA_DIR, "plans.json");
  if (!fs.existsSync(file)) return { plans: [], expired: [], maxAgeDays: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      plans?: Plan[];
      expired?: ExpiredPlan[];
    };
    return {
      plans: parsed.plans ?? [],
      expired: parsed.expired ?? [],
      maxAgeDays: getPlanMaxAgeDays(),
    };
  } catch {
    return { plans: [], expired: [], maxAgeDays: null };
  }
}

/** Plans that include a model, in file order. An empty answer means none are on record. */
export function getPlansFor(modelId: string): Plan[] {
  return getPlans().plans.filter((plan) => plan.model_ids.includes(modelId));
}

export function getBestBy(): BestBy {
  return readJson<BestBy>("best_by.json");
}

export function readHistory(): Map<string, { date: string; value: number }[]> {
  const file = path.join(DATA_DIR, "history.jsonl");
  const grouped = new Map<string, { date: string; value: number }[]>();
  if (!fs.existsSync(file)) return grouped;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as {
      model_id: string;
      value: number;
      date: string;
    };
    const bucket = grouped.get(row.model_id) ?? [];
    bucket.push({ date: row.date, value: row.value });
    grouped.set(row.model_id, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.date.localeCompare(b.date));
  }
  return grouped;
}

/**
 * Scale a series into 0-1 against its own range. A flat series sits in the middle
 * rather than at an edge, so a model with no movement doesn't read as a collapse.
 *
 * Rounded to three decimals because the only consumer is a 64x16 sparkline that already
 * rounds its coordinates to one decimal before drawing. Full float precision was 41 788
 * characters of the home page's RSC payload — 29% of it — expressing detail no pixel on
 * that chart can show.
 */
function normaliseTrend(values: number[]): number[] {
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => Math.round(((v - min) / (max - min)) * 1000) / 1000);
}

function readStatus(): Status | null {
  const file = path.join(DATA_DIR, "status.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Status;
  } catch {
    return null;
  }
}

/**
 * Sources whose upstream measurement has aged past the warning threshold.
 *
 * Distinct from a failed fetch: these fetched fine, but the numbers behind them are old.
 * That is the failure that ages in silence, so it is stated rather than left implicit.
 *
 * Requires state "ok" for the same reason: a source that is not fetching cleanly has no
 * measurable age at all - its last known snapshot might be stale, or the source might have
 * published five new ones today. Claiming otherwise would be an assertion about a third
 * party the site never actually checked. That source is already named in the degraded
 * banner, which is a statement about this site's own fetch, not about the source.
 */
export function getAgedSources(): AgedSource[] {
  const status = readStatus();
  if (!status?.snapshot_ages) return [];
  return Object.entries(status.snapshot_ages)
    .filter(([name, value]) => {
      if (value.freshness !== "aging" && value.freshness !== "degraded") return false;
      return status.sources?.[name]?.state === "ok";
    })
    .map(([name, value]) => ({ name, ...value }));
}

const DAY_MS = 86_400_000;

/**
 * Age keyed by the composite category it affects, for flagging a table column.
 *
 * A source that declares a per-category rule (which release each category came from) is aged
 * per category, from the release the number was measured in: one source can serve a fresh
 * category and one that stopped being published months ago.
 */
export function getCategoryAges(): Record<string, AgedSource> {
  const out: Record<string, AgedSource> = {};
  const status = readStatus();
  const perCategory = new Set(
    Object.entries(status?.sources ?? {})
      .filter(([, value]) => value.category_rule)
      .map(([name]) => name),
  );
  for (const source of getAgedSources()) {
    if (source.category && !perCategory.has(source.name)) out[source.category] = source;
  }
  if (!status) return out;
  const today = Date.parse(status.generated_at.slice(0, 10));
  for (const name of perCategory) {
    const age = status.snapshot_ages?.[name];
    if (!age?.warn_days || !age.degraded_days) continue;
    for (const [category, rule] of Object.entries(status.sources[name].category_rule ?? {})) {
      const days = Math.round((today - Date.parse(rule.release)) / DAY_MS);
      if (days <= age.warn_days) continue;
      out[category] = {
        name,
        ...age,
        date: rule.release,
        age_days: days,
        freshness: days >= age.degraded_days ? "degraded" : "aging",
      };
    }
  }
  return out;
}

/** Per-category release decisions of every source that makes them, for the data footnote. */
export function getCategoryRules(): {
  name: string;
  newest: string | null;
  rules: [string, CategoryRule][];
  skipped: { date: string; reason: string }[];
}[] {
  const status = readStatus();
  if (!status) return [];
  return Object.entries(status.sources ?? {})
    .filter(([, value]) => value.category_rule)
    .map(([name, value]) => ({
      name,
      newest: status.snapshot_ages?.[name]?.snapshot ?? null,
      rules: Object.entries(value.category_rule ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      skipped: value.skipped_releases ?? [],
    }));
}

/**
 * Sources that did not refresh on the last run, so the page can say so out loud.
 *
 * `status.last_success` is the day the fetch last worked - not the day the data is from.
 * `snapshotDate` (status.snapshot_ages[name].date) is the actual date of what's shown, so
 * the banner can state both instead of passing off the fetch date as the data's own.
 */
export function getDegradedSources(): {
  name: string;
  status: Status["sources"][string];
  snapshotDate: string | null;
}[] {
  const file = path.join(DATA_DIR, "status.json");
  if (!fs.existsSync(file)) return [];
  const status = JSON.parse(fs.readFileSync(file, "utf8")) as Status;
  return Object.entries(status.sources ?? {})
    .filter(([, value]) => value.state !== "ok")
    .map(([name, value]) => ({
      name,
      status: value,
      snapshotDate: status.snapshot_ages?.[name]?.date ?? null,
    }));
}

export type ScoreRow = {
  model_id: string;
  benchmark_id: string;
  value: number;
  unit: string;
  /** As the source published it. null where the source publishes none. */
  stderr?: number | null;
  /** The same figure as a 95% half-width, in the score's own units. */
  half_width_95?: number | null;
  /** The configuration this row measures, when it is not the model's chosen one. */
  variant_mismatch?: string | null;
  /** The exact name the source published for the row that scored. */
  measured_name?: string | null;
  source_type: "human_eval" | "third_party_benchmark" | "vendor_claim";
  source_url: string;
  measured_at: string | null;
  contamination_flag: boolean;
  /** Public evidence backing the flag, from config/contamination.json. Empty when the
   * flag is false - never used to attenuate the value above, only to disclose it. */
  contamination_evidence?: { evidence_url: string; noted_at: string; note: string }[];
  notes: string | null;
};

export type Benchmark = {
  id: string;
  name: string;
  category: string;
  source: string;
  source_type: string;
  url: string;
  notes?: string;
};

/** Layer B fills this in. Until then it is legitimately empty. */
type Descriptions = Record<
  string,
  { es?: string; en?: string; generated_at?: string; generated_by?: string; manual?: boolean }
>;

export function getDescriptions(): Descriptions {
  const file = path.join(DATA_DIR, "i18n", "descriptions.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Descriptions;
  } catch {
    return {};
  }
}

export type AcquisitionEntry = {
  acquisition: Record<string, string | null>;
  verified: Record<string, boolean>;
  checked_at: string;
};

/**
 * Acquisition links, filtered to the ones that actually resolved when last checked.
 *
 * An unverified link is withheld rather than shown with a caveat: a dead link on a site
 * whose pitch is that its data can be checked costs more than an absent one.
 */
export function getAcquisition(id: string): {
  links: { field: string; url: string }[];
  checkedAt: string | null;
  withheld: number;
} {
  const file = path.join(DATA_DIR, "acquisition.json");
  if (!fs.existsSync(file)) return { links: [], checkedAt: null, withheld: 0 };

  let payload: Record<string, AcquisitionEntry>;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { links: [], checkedAt: null, withheld: 0 };
  }

  const entry = payload[id];
  if (!entry) return { links: [], checkedAt: null, withheld: 0 };

  const links: { field: string; url: string }[] = [];
  let withheld = 0;
  for (const [field, url] of Object.entries(entry.acquisition ?? {})) {
    if (!url) continue;
    if (entry.verified?.[field]) {
      links.push({
        field,
        url: field === "ollama_tag" ? `https://ollama.com/library/${url}` : url,
      });
    } else {
      withheld += 1;
    }
  }

  return { links, checkedAt: entry.checked_at ?? null, withheld };
}

export function getModelDetail(id: string): {
  model: Row;
  scores: (ScoreRow & { benchmark: Benchmark | null })[];
  history: { date: string; value: number }[];
  description:
    | { es?: string; en?: string; generated_at?: string; generated_by?: string; manual?: boolean }
    | null;
} | null {
  const { rows } = getRanking();
  const model = rows.find((row) => row.id === id);
  if (!model) return null;

  const { scores } = readJson<{ scores: ScoreRow[] }>("scores.json");
  const { benchmarks } = readJson<{ benchmarks: Benchmark[] }>("benchmarks.json");
  const catalogue = new Map(benchmarks.map((b) => [b.id, b]));

  const forModel = scores
    .filter((score) => score.model_id === id)
    .map((score) => ({
      ...score,
      benchmark: catalogue.get(score.benchmark_id) ?? null,
    }))
    .sort((a, b) => a.benchmark_id.localeCompare(b.benchmark_id));

  return {
    model,
    scores: forModel,
    history: readHistory().get(id) ?? [],
    description: getDescriptions()[id] ?? null,
  };
}

export type AliasEntry = {
  id: string;
  canonical_key: string;
  display_name: string;
  variant: string | null;
  scored_arena_name: string | null;
  names: string[];
  matched: Record<string, string[]>;
};

/**
 * What each source called this model. A wrong match silently credits one model with
 * another's scores, which is the worst failure this pipeline can have and the one it
 * cannot detect on its own — so the mapping is published for anyone to check.
 */
export function getAliases(): AliasEntry[] {
  const file = path.join(DATA_DIR, "aliases.json");
  if (!fs.existsSync(file)) return [];
  const payload = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
    string,
    Omit<AliasEntry, "id">
  >;
  return Object.entries(payload)
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/** Digests and rejections the ingest recorded, for the audit pages. */
export function getIntegrity(): Status["integrity"] {
  return readStatus()?.integrity;
}

export function getRejectedSnapshots(): RejectedSnapshot[] {
  const rejected = readStatus()?.rejected_snapshots;
  return Array.isArray(rejected) ? (rejected as RejectedSnapshot[]) : [];
}

/**
 * The figures /methodology quotes about itself, derived from /data on every build.
 *
 * They were hardcoded into messages/*.json first, which was a mistake of exactly the kind
 * this project exists to catch: a number written by hand into prose is a claim with no
 * source and no date, and it goes quietly false the next time the cohort changes. Anything
 * the data can recompute is recomputed here; anything it cannot is dated in the copy.
 */
export function getMethodologyStats() {
  const { rows } = getRanking();
  const ranked = rows
    .filter((row) => !row.provisional)
    .sort((a, b) => b.composite - a.composite);

  const gaps: number[] = [];
  let overlapping = 0;
  let identical = 0;
  for (let i = 1; i < ranked.length; i += 1) {
    const better = ranked[i - 1];
    const worse = ranked[i];
    const gap = better.composite - worse.composite;
    gaps.push(gap);
    if (gap < 0.005) identical += 1;
    if (
      worse.composite + (worse.composite_error ?? 0) >=
      better.composite - (better.composite_error ?? 0)
    ) {
      overlapping += 1;
    }
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length
    ? gaps.length % 2
      ? gaps[(gaps.length - 1) / 2]
      : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2
    : 0;

  const measuredInputs = ranked.reduce((n, r) => n + r.uncertainty.measured_inputs, 0);
  const totalInputs = ranked.reduce((n, r) => n + r.uncertainty.total_inputs, 0);

  // Per-benchmark median published error, so the page can state the real spread rather
  // than a remembered one.
  const { scores } = readJson<{ scores: ScoreRow[] }>("scores.json");
  const byBenchmark = new Map<string, number[]>();
  for (const score of scores) {
    if (score.unit !== "percent" || score.stderr == null) continue;
    const bucket = byBenchmark.get(score.benchmark_id) ?? [];
    bucket.push(score.stderr);
    byBenchmark.set(score.benchmark_id, bucket);
  }
  const medians: number[] = [];
  for (const values of byBenchmark.values()) {
    values.sort((a, b) => a - b);
    medians.push(values[Math.floor(values.length / 2)]);
  }
  medians.sort((a, b) => a - b);

  // How much an Arena rating moves between consecutive snapshots, from the series itself.
  // This is what justifies calling a rating "still" in the recalibration notice, so it is
  // measured on every build rather than quoted from the day someone last checked.
  const moves: number[] = [];
  for (const series of readHistory().values()) {
    for (let i = 1; i < series.length; i += 1) {
      moves.push(Math.abs(series[i].value - series[i - 1].value));
    }
  }
  moves.sort((a, b) => a - b);
  const at = (q: number) => moves[Math.floor(moves.length * q)] ?? 0;

  const contaminatedBenchmarks = new Set(
    scores.filter((s) => s.contamination_flag).map((s) => s.benchmark_id),
  ).size;

  return {
    contaminatedBenchmarks,
    transitions: moves.length,
    moveMedian: at(0.5).toFixed(2),
    moveP75: at(0.75).toFixed(2),
    stillPoints: readStatus()?.thresholds?.recalibration_raw_still ?? null,
    ranked: ranked.length,
    distinctRanks: new Set(ranked.map((row) => row.rank)).size,
    overlappingPairs: overlapping,
    adjacentPairs: gaps.length,
    identicalPairs: identical,
    medianGap: medianGap.toFixed(2),
    measuredInputs,
    totalInputs,
    withoutInterval: ranked.filter((row) => row.composite_error === null).length,
    stderrLow: (medians[0] ?? 0).toFixed(2),
    stderrHigh: (medians[medians.length - 1] ?? 0).toFixed(2),
  };
}

/** Declared versus observed publishing rhythm, for the cadence paragraph. */
export function getCadence(source: string): SnapshotAge | null {
  return readStatus()?.snapshot_ages?.[source] ?? null;
}

/**
 * Which named sources feed each weighted category, from the benchmark catalogue itself
 * rather than typed by hand - a category backed by one source is a fact about the data,
 * not an opinion, and it drifts the moment a source is added or dropped from BENCHMARK_
 * CATALOGUE in scripts/ingest/run.py.
 */
export function getCategorySources(): Record<string, string[]> {
  const { benchmarks } = readJson<{ benchmarks: Benchmark[] }>("benchmarks.json");
  const byCategory = new Map<string, Set<string>>();
  for (const benchmark of benchmarks) {
    const sources = byCategory.get(benchmark.category) ?? new Set<string>();
    sources.add(benchmark.source);
    byCategory.set(benchmark.category, sources);
  }
  return Object.fromEntries(
    Array.from(byCategory.entries()).map(([category, sources]) => [
      category,
      Array.from(sources).sort(),
    ]),
  );
}

export function getModelIds(): string[] {
  const { models } = readJson<{ models: Model[] }>("models.json");
  return models.map((model) => model.id);
}

/** Narrowed rows for the ranking table — smaller RSC payload than full Row[]. */
export function getRankingRows(): RankingRow[] {
  const { rows } = getRanking();
  return rows.map((row) => ({
    id: row.id,
    rank: row.rank,
    display_name: row.display_name,
    provider_name: row.provider_name,
    provider_id: row.provider_id,
    is_open_weights: row.is_open_weights,
    country: row.country,
    context_window: row.context_window ?? null,
    blended_price_usd_per_m: row.blended_price_usd_per_m ?? null,
    pareto_frontier: row.pareto_frontier ?? null,
    composite: row.composite,
    composite_error: row.composite_error,
    tied_with: row.tied_with,
    coverage: { covered: row.coverage.covered, total: row.coverage.total },
    benchmarks: row.evidence.benchmarks,
    category_scores: row.category_scores,
    provisional: row.provisional,
    awaiting_human_votes: row.awaiting_human_votes,
    trend: row.trend,
  }));
}

/** Prev/next ranked neighbours for model-page navigation. */
export function getAdjacentModels(
  id: string,
): {
  prev: { id: string; display_name: string } | null;
  next: { id: string; display_name: string } | null;
} {
  const { rows } = getRanking();
  const sorted = rows
    .filter((r) => !r.provisional)
    .sort(
      (a, b) =>
        (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
        b.composite - a.composite,
    );
  const idx = sorted.findIndex((r) => r.id === id);
  return {
    prev: idx > 0 ? { id: sorted[idx - 1].id, display_name: sorted[idx - 1].display_name } : null,
    next:
      idx >= 0 && idx < sorted.length - 1
        ? { id: sorted[idx + 1].id, display_name: sorted[idx + 1].display_name }
        : null,
  };
}

export function getRanking(): { rows: Row[]; meta: Meta; sourceCount: number } {
  const { meta, models } = readJson<{ meta: Meta; models: Model[] }>("models.json");
  const { providers } = readJson<{ providers: Provider[] }>("providers.json");
  const { benchmarks } = readJson<{ benchmarks: { source: string }[] }>(
    "benchmarks.json",
  );
  const history = readHistory();
  const providerNames = new Map(providers.map((p) => [p.id, p.display_name]));

  const rows: Row[] = models.map((model) => ({
    ...model,
    provider_name: providerNames.get(model.provider_id) ?? model.provider_id,
    trend: normaliseTrend(
      (history.get(model.id) ?? []).map((point) => point.value),
    ),
  }));

  return {
    rows,
    meta,
    sourceCount: new Set(benchmarks.map((b) => b.source)).size,
  };
}

/**
 * Models that have a size on record: the open-weights models ModelHub scores, joined to their
 * measured standing, followed by the most downloaded models it does not score, which carry
 * a size and a Hugging Face link and nothing else. Returned in no meaningful order: the page
 * decides how to order what fits.
 */
export function getLocalEntries(): {
  entries: LocalEntry[];
  generatedAt: string;
  rankedCount: number;
  openWeightsScored: number;
  measuredCount: number;
  unmeasuredCount: number;
  unsized: number;
  withoutLayout: number;
  catalogueRules: { minDownloads: number | null; minLikes: number | null; maxRows: number | null };
} {
  const local = readJson<LocalModels>("local_models.json");
  const { rows, meta } = getRanking();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const entries: LocalEntry[] = [];
  for (const spec of local.models) {
    const row = byId.get(spec.model_id);
    if (!row) continue;
    entries.push({
      spec,
      display_name: row.display_name,
      measured: true,
      hf_url: spec.source_url,
      modality: spec.modality,
      hf_downloads: spec.hf_downloads,
      hf_likes: spec.hf_likes,
      rank: row.rank,
      tied_with: row.tied_with,
      composite: row.composite,
      composite_error: row.composite_error,
      provisional: row.provisional,
      coverage: { covered: row.coverage.covered, total: row.coverage.total },
      measured_at: meta.generated_at,
    });
  }
  const measuredCount = entries.length;
  for (const spec of local.catalogue ?? []) {
    entries.push({
      spec,
      display_name: spec.display_name,
      measured: false,
      hf_url: spec.source_url,
      modality: spec.modality,
      hf_downloads: spec.hf_downloads,
      hf_likes: spec.hf_likes,
      rank: null,
      tied_with: 0,
      composite: null,
      composite_error: null,
      provisional: false,
      coverage: null,
      measured_at: null,
    });
  }
  const rules = local.meta.catalogue_rules ?? {};
  return {
    entries,
    generatedAt: local.meta.generated_at,
    rankedCount: meta.ranked_count,
    openWeightsScored: local.meta.open_weights_scored,
    measuredCount,
    unmeasuredCount: entries.length - measuredCount,
    unsized: local.meta.open_weights_scored - local.meta.matched,
    withoutLayout: entries.filter((e) => e.spec.attention_layout === null).length,
    catalogueRules: {
      minDownloads: rules.min_downloads ?? null,
      minLikes: rules.min_likes ?? null,
      maxRows: rules.max_rows ?? null,
    },
  };
}
