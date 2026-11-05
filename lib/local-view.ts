/**
 * Selection, ordering and summary logic behind /local, kept apart from the component so it
 * is plain functions over plain data and the node test runner can hold it to its word.
 *
 * Nothing here computes a fit: `analyze` in ./fit does, and its result arrives as an input.
 * Nothing here reads who made a model either. The only things ever compared are sizes,
 * speeds, the composite ModelHub already published, and Hugging Face download counts.
 *
 * No Node imports and no runtime imports: safe for client components.
 */
import type { FitResult } from "./fit";
import type { LocalEntry } from "./types";

export type Result = { entry: LocalEntry; fit: FitResult };

// ---------------------------------------------------------------------------------------
// Stops: the values a slider can rest on
// ---------------------------------------------------------------------------------------

/** Memory sizes that exist on shelves, so a slider lands on a real card or a real kit. */
export const GPU_STOPS = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128] as const;
export const UNIFIED_STOPS = [8, 16, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512] as const;
export const RAM_STOPS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512] as const;

/** Index of the stop closest to `value` (the first of two equally close ones). */
export function nearestStop(stops: readonly number[], value: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - value) < Math.abs(stops[best] - value)) best = i;
  }
  return best;
}

// ---------------------------------------------------------------------------------------
// Speed bands
// ---------------------------------------------------------------------------------------

/**
 * Display bands for the estimated decode speed. They are a reading aid, not a standard:
 * the page prints the numbers next to the names so the cut points are never hidden.
 */
export const SPEED_FAST = 30;
export const SPEED_COMFORTABLE = 10;

export type SpeedTier = "fast" | "comfortable" | "slow" | "unknown";

export function speedTier(tokensPerSecond: number | null): SpeedTier {
  if (tokensPerSecond === null) return "unknown";
  if (tokensPerSecond >= SPEED_FAST) return "fast";
  if (tokensPerSecond >= SPEED_COMFORTABLE) return "comfortable";
  return "slow";
}

export const runsHere = (r: Result) => r.fit.level !== "too_tight";

// ---------------------------------------------------------------------------------------
// Summary: what this machine can reach
// ---------------------------------------------------------------------------------------

export type Summary = {
  runs: number;
  total: number;
  /** Largest model by parameter count that runs. */
  largest: Result | null;
  /** Highest composite among ranked models that run. Provisional models never qualify. */
  bestMeasured: Result | null;
  /** Highest estimated speed among models that run. */
  fastest: Result | null;
};

/** First of equals wins, so the headline never flips between reloads. */
function best(list: Result[], score: (r: Result) => number | null): Result | null {
  let winner: Result | null = null;
  let top = -Infinity;
  for (const r of list) {
    const value = score(r);
    if (value !== null && value > top) {
      winner = r;
      top = value;
    }
  }
  return winner;
}

export function summarise(results: Result[]): Summary {
  const fits = results.filter(runsHere);
  return {
    runs: fits.length,
    total: results.length,
    largest: best(fits, (r) => r.entry.spec.parameters_raw),
    bestMeasured: best(
      fits.filter((r) => r.entry.measured && !r.entry.provisional),
      (r) => r.entry.composite,
    ),
    fastest: best(fits, (r) => r.fit.tokensPerSecond),
  };
}

// ---------------------------------------------------------------------------------------
// Filters and ordering
// ---------------------------------------------------------------------------------------

export type Scope = "all" | "measured" | "unmeasured";
export type Modality = "all" | "text" | "vision";
export type Arch = "all" | "dense" | "moe";
export type TierFilter = "all" | "fast" | "comfortable" | "slow";
export type FitScope = "runs" | "all";
export type SortKey = "composite" | "speed" | "size" | "popularity" | "name";

export type Filters = {
  query: string;
  scope: Scope;
  modality: Modality;
  arch: Arch;
  tier: TierFilter;
  fit: FitScope;
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  scope: "all",
  modality: "all",
  arch: "all",
  tier: "all",
  fit: "runs",
};

export function applyFilters(results: Result[], f: Filters): Result[] {
  const q = f.query.trim().toLowerCase();
  return results.filter(({ entry, fit }) => {
    if (f.fit === "runs" && fit.level === "too_tight") return false;
    if (f.scope === "measured" && !entry.measured) return false;
    if (f.scope === "unmeasured" && entry.measured) return false;
    if (f.modality !== "all" && (entry.modality ?? "text") !== f.modality) return false;
    if (f.arch === "moe" && !entry.spec.is_moe) return false;
    if (f.arch === "dense" && entry.spec.is_moe) return false;
    if (f.tier !== "all" && speedTier(fit.tokensPerSecond) !== f.tier) return false;
    if (q && !`${entry.display_name} ${entry.spec.hf_repo}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const byName = (a: Result, b: Result) =>
  a.entry.display_name.localeCompare(b.entry.display_name, "en") ||
  a.entry.spec.model_id.localeCompare(b.entry.spec.model_id, "en");

/** Descending on a number that may be missing: missing goes last, then name settles ties. */
function desc(value: (r: Result) => number | null) {
  return (a: Result, b: Result) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || byName(a, b);
  };
}

/**
 * Default order is the standing ModelHub measured: ranked models by composite, then
 * provisional ones, then models it does not score, by popularity. Every other order is the
 * reader's explicit choice, so how well a model fits only ever reorders the list on request.
 */
export function sortResults(results: Result[], key: SortKey): Result[] {
  const list = [...results];
  switch (key) {
    case "composite":
      return list.sort((a, b) => {
        const group = (r: Result) => (r.entry.measured ? (r.entry.provisional ? 1 : 0) : 2);
        return (
          group(a) - group(b) ||
          desc((r) => (r.entry.measured ? r.entry.composite : r.entry.hf_downloads))(a, b)
        );
      });
    case "speed":
      return list.sort(desc((r) => r.fit.tokensPerSecond));
    case "size":
      return list.sort(desc((r) => r.entry.spec.parameters_raw));
    case "popularity":
      return list.sort(desc((r) => r.entry.hf_downloads));
    case "name":
      return list.sort(byName);
  }
}

// ---------------------------------------------------------------------------------------
// Upgrade ladder: what the next step of memory would open
// ---------------------------------------------------------------------------------------

/**
 * Models that run in `next` and do not run in `now`, best-measured first, then the largest.
 * The first measured models lead because they carry evidence; the rest follow by size.
 */
export function unlocked(now: Result[], next: Result[]): Result[] {
  const running = new Set(now.filter(runsHere).map((r) => r.entry.spec.model_id));
  return next
    .filter((r) => runsHere(r) && !running.has(r.entry.spec.model_id))
    .sort((a, b) => {
      const ranked = (r: Result) => (r.entry.measured && !r.entry.provisional ? 0 : 1);
      return (
        ranked(a) - ranked(b) ||
        desc((r) => (ranked(r) === 0 ? r.entry.composite : r.entry.spec.parameters_raw))(a, b)
      );
    });
}

/**
 * Index of the first stop above what is typed whose count beats what the typed machine runs
 * now, or null at the top of the scale. Compared with the typed value and not with the
 * nearest stop, so 11 GB is not told it already has what 12 GB would give.
 */
export function nextJump(
  stops: readonly number[],
  counts: readonly number[],
  typed: number,
  runsNow: number,
): number | null {
  for (let i = 0; i < stops.length; i++) {
    if (stops[i] > typed && counts[i] > runsNow) return i;
  }
  return null;
}
