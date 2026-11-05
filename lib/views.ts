import {
  getBestBy,
  getRanking,
  readHistory,
  readJson,
  type Benchmark,
  type ScoreRow,
} from "./data";
import { comparableDates, orderPair } from "./compare";
import type {
  BoardCard,
  BoardModel,
  Provider,
  Row,
  ScatterPoint,
  SearchEntry,
  TrendSeries,
} from "./types";

/**
 * Read-only projections of /data for the home, the vs pages and the provider and
 * benchmark pages. Everything here is derived at build time from files the ingest already
 * wrote; nothing is a new measurement and nothing feeds back into the composite.
 */

/** Rank order with the score deciding only inside a tied group. Provisional models last. */
export function byRank(a: Row, b: Row): number {
  return (
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
    b.composite - a.composite ||
    a.id.localeCompare(b.id)
  );
}

function toBoardModel(row: Row): BoardModel {
  return {
    id: row.id,
    display_name: row.display_name,
    provider_name: row.provider_name,
    rank: row.rank,
    tied_with: row.tied_with,
    composite: row.composite,
    composite_error: row.composite_error,
    price: row.blended_price_usd_per_m ?? null,
  };
}

/** The "best by" boards from best_by.json, each winner resolved to a model. */
export function getBoardCards(): { cards: BoardCard[]; generatedAt: string } {
  const bestBy = getBestBy();
  const byId = new Map(getRanking().rows.map((row) => [row.id, row]));
  const cards = bestBy.boards.map((board) => ({
    ...board,
    winners: board.winners
      .map((id) => byId.get(id))
      .filter((row): row is Row => row !== undefined)
      .sort(byRank)
      .map(toBoardModel),
  }));
  return { cards, generatedAt: bestBy.meta.generated_at };
}

/**
 * The first `limit` ranked models in rank order, plus how many more share the last rank.
 * With a tie at the cut the list is not a clean "top N", so the overflow is returned for
 * the page to state rather than hidden.
 */
export function getTopModels(limit: number): {
  top: BoardModel[];
  rankedCount: number;
  tiedBeyond: number;
} {
  const ranked = getRanking()
    .rows.filter((row) => !row.provisional)
    .sort(byRank);
  const top = ranked.slice(0, limit);
  const last = top[top.length - 1];
  const tiedBeyond = last ? ranked.slice(limit).filter((row) => row.rank === last.rank).length : 0;
  return { top: top.map(toBoardModel), rankedCount: ranked.length, tiedBeyond };
}

/** Ranked models that have a price: the population the cost frontier is evaluated on. */
export function getScatterPoints(): ScatterPoint[] {
  return getRanking()
    .rows.filter((row) => !row.provisional && (row.blended_price_usd_per_m ?? null) !== null)
    .sort(byRank)
    .map((row) => ({
      id: row.id,
      name: row.display_name,
      price: row.blended_price_usd_per_m as number,
      composite: row.composite,
      error: row.composite_error,
      frontier: row.pareto_frontier === true,
    }));
}

/** A snapshot must measure at least this share of the fullest snapshot's models to count. */
const MIN_SNAPSHOT_SHARE = 0.5;

/**
 * Which snapshot dates are comparable. history.jsonl does not hold the same models on
 * every date: on 2026-11-05 its first 79 rows (every date before 2026-10-15) belong to a
 * single model and the whole cohort appears from 2026-10-15 on. A group's best rating on a
 * date with one model is that model's rating, so plotting it beside a full snapshot draws a
 * jump that is coverage, not performance. Dates measuring fewer than half the models of the
 * fullest date are therefore left out, and the page states how many.
 */
export function getTrendWindow(): {
  dates: string[];
  excluded: number;
  total: number;
  fullest: number;
} {
  const perDate = new Map<string, Set<string>>();
  const catalogue = new Set(getRanking().rows.map((row) => row.id));
  for (const [modelId, points] of readHistory()) {
    if (!catalogue.has(modelId)) continue;
    for (const { date } of points) {
      const set = perDate.get(date) ?? new Set<string>();
      set.add(modelId);
      perDate.set(date, set);
    }
  }
  const counts = Object.fromEntries([...perDate].map(([date, set]) => [date, set.size]));
  const dates = comparableDates(counts, MIN_SNAPSHOT_SHARE);
  const fullest = Math.max(0, ...Object.values(counts));
  return { dates, excluded: perDate.size - dates.length, total: perDate.size, fullest };
}

/**
 * For each comparable snapshot date, the highest Arena rating among a group's models. A
 * maximum is used instead of a mean because the set of models measured changes from one
 * snapshot to the next: a mean moves when a weaker model is added, a maximum only when the
 * best one moves. Only models still in the catalogue are counted, a survivorship limit the
 * page states.
 */
function groupTrend(keyOf: (row: Row) => string | null, keys: string[]): TrendSeries[] {
  const usable = new Set(getTrendWindow().dates);
  const group = new Map<string, string>();
  for (const row of getRanking().rows) {
    const key = keyOf(row);
    if (key) group.set(row.id, key);
  }
  const best = new Map<string, Map<string, number>>();
  const members = new Map<string, Set<string>>();
  for (const [modelId, points] of readHistory()) {
    const key = group.get(modelId);
    if (!key) continue;
    const byDate = best.get(key) ?? new Map<string, number>();
    for (const { date, value } of points) {
      if (!usable.has(date)) continue;
      if (value > (byDate.get(date) ?? -Infinity)) byDate.set(date, value);
    }
    best.set(key, byDate);
    const set = members.get(key) ?? new Set<string>();
    set.add(modelId);
    members.set(key, set);
  }
  return keys
    .filter((key) => (best.get(key)?.size ?? 0) > 0)
    .map((key) => ({
      key,
      models: members.get(key)?.size ?? 0,
      points: [...(best.get(key) ?? [])]
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));
}

export function getAccessTrends(): TrendSeries[] {
  return groupTrend((row) => (row.is_open_weights ? "open" : "proprietary"), [
    "open",
    "proprietary",
  ]);
}

export function getCountryTrends(): TrendSeries[] {
  const countries = Array.from(
    new Set(getRanking().rows.map((row) => row.country).filter(Boolean)),
  ).sort();
  return groupTrend((row) => row.country || null, countries);
}

/** The static search index: every model, provider and benchmark, by name only. */
export function getSearchIndex(): SearchEntry[] {
  const { rows } = getRanking();
  const { providers } = readJson<{ providers: Provider[] }>("providers.json");
  const { benchmarks } = readJson<{ benchmarks: Benchmark[] }>("benchmarks.json");
  const used = new Set(rows.map((row) => row.provider_id));
  return [
    ...rows
      .slice()
      .sort(byRank)
      .map((row) => ({
        t: "model" as const,
        id: row.id,
        n: row.display_name,
        s: row.provider_name,
      })),
    ...providers
      .filter((p) => used.has(p.id))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map((p) => ({ t: "provider" as const, id: p.id, n: p.display_name })),
    ...benchmarks
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b) => ({ t: "benchmark" as const, id: b.id, n: b.name, s: b.category })),
  ];
}

/** Providers that have at least one model in the catalogue. */
export function getProviderIds(): string[] {
  const used = new Set(getRanking().rows.map((row) => row.provider_id));
  return readJson<{ providers: Provider[] }>("providers.json")
    .providers.map((p) => p.id)
    .filter((id) => used.has(id));
}

export function getProviderPage(id: string): {
  provider: Provider;
  rows: Row[];
  rankedCount: number;
  totalRanked: number;
} | null {
  const provider = readJson<{ providers: Provider[] }>("providers.json").providers.find(
    (p) => p.id === id,
  );
  if (!provider) return null;
  const { rows, meta } = getRanking();
  const own = rows.filter((row) => row.provider_id === id).sort(byRank);
  if (own.length === 0) return null;
  return {
    provider,
    rows: own,
    rankedCount: own.filter((row) => !row.provisional).length,
    totalRanked: meta.ranked_count,
  };
}

export function getBenchmarkIds(): string[] {
  return readJson<{ benchmarks: Benchmark[] }>("benchmarks.json").benchmarks.map((b) => b.id);
}

export function getBenchmarkPage(id: string): {
  benchmark: Benchmark;
  weight: number | null;
  rows: (ScoreRow & { display_name: string; provider_name: string })[];
} | null {
  const { benchmarks } = readJson<{ benchmarks: Benchmark[] }>("benchmarks.json");
  const benchmark = benchmarks.find((b) => b.id === id);
  if (!benchmark) return null;
  const { scores } = readJson<{ scores: ScoreRow[] }>("scores.json");
  const byId = new Map(getRanking().rows.map((row) => [row.id, row]));
  const rows = scores
    .filter((score) => score.benchmark_id === id)
    .flatMap((score) => {
      const model = byId.get(score.model_id);
      return model
        ? [{ ...score, display_name: model.display_name, provider_name: model.provider_name }]
        : [];
    })
    .sort((a, b) => b.value - a.value || a.display_name.localeCompare(b.display_name));
  const { weights } = readJson<{ weights: Record<string, number> }>("../config/weights.json");
  return { benchmark, weight: weights[benchmark.category] ?? null, rows };
}

/** How many models the vs pages prerender; the rest render on first request and are cached. */
export const VS_PRERENDER_TOP = 30;

// Re-exported so the pages keep one import for everything about a pair.
export { orderPair };

/** Every unordered pair among the top `n` ranked models, in canonical order. */
export function getVsPairs(n: number = VS_PRERENDER_TOP): [string, string][] {
  const ids = getRanking()
    .rows.filter((row) => !row.provisional)
    .sort(byRank)
    .slice(0, n)
    .map((row) => row.id);
  const pairs: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) pairs.push(orderPair(ids[i], ids[j]));
  }
  return pairs;
}

export function getVsModels(
  a: string,
  b: string,
): { a: Row; b: Row; rankedCount: number } | null {
  const { rows, meta } = getRanking();
  const left = rows.find((row) => row.id === a);
  const right = rows.find((row) => row.id === b);
  if (!left || !right || left.id === right.id) return null;
  return { a: left, b: right, rankedCount: meta.ranked_count };
}

/** The oldest and newest measured_at among one model's scores, for "measured between". */
export function getScoreDateRange(id: string): { from: string; to: string } | null {
  const { scores } = readJson<{ scores: ScoreRow[] }>("scores.json");
  const dates = scores
    .filter((score) => score.model_id === id && score.measured_at)
    .map((score) => score.measured_at as string)
    .sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
}
