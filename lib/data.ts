import fs from "node:fs";
import path from "node:path";
import { groupHistory, parseHistory, seriesFor } from "./history";
import type { LocalModel, VramConfig } from "./vram";
import {
  HOME_TREND_BENCHMARK,
  type AgedSource,
  type HistoryIndex,
  type Meta,
  type Model,
  type Normalization,
  type Provider,
  type Row,
  type Status,
  type WeightAudit,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) as T;
}

function readHistory(): HistoryIndex {
  const file = path.join(DATA_DIR, "history.jsonl");
  if (!fs.existsSync(file)) return new Map();
  return groupHistory(parseHistory(fs.readFileSync(file, "utf8")));
}

/**
 * Scale a series into 0-1 against its own range. A flat series sits in the middle
 * rather than at an edge, so a model with no movement doesn't read as a collapse.
 */
function normaliseTrend(values: number[]): number[] {
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
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
 */
export function getAgedSources(): AgedSource[] {
  const status = readStatus();
  if (!status?.snapshot_ages) return [];
  return Object.entries(status.snapshot_ages)
    .filter(([, value]) => value.freshness === "aging" || value.freshness === "degraded")
    .map(([name, value]) => ({ name, ...value }));
}

/** Age keyed by the composite category it affects, for flagging a table column. */
export function getCategoryAges(): Record<string, AgedSource> {
  const out: Record<string, AgedSource> = {};
  for (const source of getAgedSources()) {
    if (source.category) out[source.category] = source;
  }
  return out;
}

/** Sources that did not refresh on the last run, so the page can say so out loud. */
export function getDegradedSources(): { name: string; status: Status["sources"][string] }[] {
  const file = path.join(DATA_DIR, "status.json");
  if (!fs.existsSync(file)) return [];
  const status = JSON.parse(fs.readFileSync(file, "utf8")) as Status;
  return Object.entries(status.sources ?? {})
    .filter(([, value]) => value.state !== "ok")
    .map(([name, value]) => ({ name, status: value }));
}

export type ScoreRow = {
  model_id: string;
  benchmark_id: string;
  /** As published by the source. Always shown; this is the thing that was measured. */
  value: number;
  /** null when the benchmark sits below min_n and therefore scores nothing. */
  value_normalized?: number | null;
  normalization?: Normalization;
  unit: string;
  source_type: "human_eval" | "third_party_benchmark" | "vendor_claim";
  source_url: string;
  measured_at: string | null;
  contamination_flag: boolean;
  notes: string | null;
};

/**
 * The effective-weight audit, or null when the run has not written one.
 *
 * Follows the same pattern as getAcquisition(): a data file the build must survive the
 * absence of, rather than a file whose absence takes the site down.
 */
export function getWeightAudit(): WeightAudit | null {
  const file = path.join(DATA_DIR, "weight_audit.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as WeightAudit;
  } catch {
    return null;
  }
}

export type BenchmarkReference = {
  methodology_version: string;
  computed_at: string;
  min_n: number;
  min_n_rationale?: string;
  scale_factor: number;
  formula?: string;
  note?: string;
  benchmarks: Record<
    string,
    {
      category?: string;
      n: number;
      mean: number;
      sd: number;
      observed_min: number;
      observed_max: number;
      se_of_sd_pct?: number;
    }
  >;
  excluded: Record<string, { category?: string; n: number; reason: string }>;
};

/**
 * The local-view catalogue and the VRAM calibration, or nulls when absent.
 *
 * Both follow getAcquisition()'s pattern rather than readJson()'s: a missing or malformed
 * file leaves the page saying so, instead of taking the whole build down. Every data file
 * added is a new way for CI to break, and this one is populated over several runs by design,
 * so its absence is an ordinary state rather than an error.
 */
export function getLocalModels(): {
  generated_at: string;
  ceiling: { model_name: string; arena_rating: number } | null;
  models: LocalModel[];
} | null {
  const file = path.join(DATA_DIR, "local_models.json");
  if (!fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as {
      generated_at: string;
      ceiling: { model_name: string; arena_rating: number } | null;
      models: LocalModel[];
    };
    return Array.isArray(payload?.models) ? payload : null;
  } catch {
    return null;
  }
}

export function getVramConfig(): VramConfig | null {
  const file = path.join(process.cwd(), "config", "vram.json");
  if (!fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as VramConfig;
    return payload?.bytes_per_weight ? payload : null;
  } catch {
    return null;
  }
}

/** The frozen reference, read from /config so /methodology can publish it verbatim. */
export function getBenchmarkReference(): BenchmarkReference | null {
  const file = path.join(process.cwd(), "config", "benchmark_reference.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as BenchmarkReference;
  } catch {
    return null;
  }
}

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
  { es?: string; en?: string; methodology_version?: string }
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

/**
 * A description, or null when it was written under a superseded methodology.
 *
 * A description says which of a model's categories are relatively stronger, so it is a
 * derivative of the category scores and only true under the formula that produced them.
 * Normalising the composite reordered those categories for 39 of the 40 models carrying a
 * comparison: prose claiming a model is best at maths now sits directly above a bar chart
 * showing maths as its second worst.
 *
 * Withheld rather than shown with a caveat, which is the same rule acquisition links
 * follow. Re-run `npm run enrich` to regenerate them under the current methodology.
 */
export function getDescription(
  id: string,
  methodologyVersion: string | undefined,
): { es?: string; en?: string } | null {
  const entry = getDescriptions()[id];
  if (!entry) return null;
  if (!methodologyVersion) return entry;
  return entry.methodology_version === methodologyVersion ? entry : null;
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
  description: { es?: string; en?: string } | null;
} | null {
  const { rows, meta } = getRanking();
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
    history: seriesFor(readHistory(), id, HOME_TREND_BENCHMARK),
    description: getDescription(id, meta.methodology_version),
  };
}

export function getModelIds(): string[] {
  const { models } = readJson<{ models: Model[] }>("models.json");
  return models.map((model) => model.id);
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
      seriesFor(history, model.id, HOME_TREND_BENCHMARK).map((point) => point.value),
    ),
  }));

  return {
    rows,
    meta,
    sourceCount: new Set(benchmarks.map((b) => b.source)).size,
  };
}
