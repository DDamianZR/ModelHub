import fs from "node:fs";
import path from "node:path";
import type { AgedSource, Meta, Model, Provider, Row, Status } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) as T;
}

function readHistory(): Map<string, { date: string; value: number }[]> {
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
  value: number;
  unit: string;
  source_type: "human_eval" | "third_party_benchmark" | "vendor_claim";
  source_url: string;
  measured_at: string | null;
  contamination_flag: boolean;
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
type Descriptions = Record<string, { es?: string; en?: string }>;

export function getDescriptions(): Descriptions {
  const file = path.join(DATA_DIR, "i18n", "descriptions.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Descriptions;
  } catch {
    return {};
  }
}

export function getModelDetail(id: string): {
  model: Row;
  scores: (ScoreRow & { benchmark: Benchmark | null })[];
  history: { date: string; value: number }[];
  description: { es?: string; en?: string } | null;
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
      (history.get(model.id) ?? []).map((point) => point.value),
    ),
  }));

  return {
    rows,
    meta,
    sourceCount: new Set(benchmarks.map((b) => b.source)).size,
  };
}
