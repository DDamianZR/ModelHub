/**
 * The dated log of what moved between builds (data/changes.jsonl), as the site reads it.
 * Written by scripts/ingest/changelog.py; this file only parses and groups it.
 *
 * Nothing here infers a cause. A move lists the model's own score rows that changed, and an
 * empty list is shown as exactly that: it moved while its own measurements stood still.
 *
 * No Node imports: safe for client components.
 */

export type ChangeEvent =
  | { date: string; type: "model_added" | "model_removed"; model_id: string; ranked: boolean; rank: number | null; tied: boolean; composite: number }
  | { date: string; type: "gate_crossed"; model_id: string; entered: boolean; covered: [number, number]; total: number }
  | { date: string; type: "moved"; model_id: string; among: number; position: [number, number]; rank: [number | null, number | null]; tied: [boolean, boolean]; composite: [number, number]; inputs: Array<{ benchmark_id: string; value: [number | null, number | null] }> }
  | { date: string; type: "cohort_shift"; compared: number; moved: number }
  | { date: string; type: "price_changed"; model_id: string; blended_usd_per_m: [number | null, number | null] }
  | { date: string; type: "benchmark_updated"; benchmark_id: string; changed: number; added: number; removed: number }
  | { date: string; type: "arena_scale"; min: [number, number]; max: [number, number] };

export type ChangeType = ChangeEvent["type"];

const TYPES: readonly string[] = [
  "model_added", "model_removed", "gate_crossed", "moved",
  "cohort_shift", "price_changed", "benchmark_updated", "arena_scale",
];

/** One JSON object per line. A line that is not one, or of an unknown kind, is skipped. */
export function parseChanges(text: string): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as ChangeEvent;
      if (typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && TYPES.includes(event.type)) {
        events.push(event);
      }
    } catch {
      // A half-written line is not worth failing a build over.
    }
  }
  return events;
}

export interface ChangeDay {
  date: string;
  events: ChangeEvent[];
}

/** Display order inside a day: arrivals and departures, gate, moves, then the rest. */
const ORDER: Record<ChangeType, number> = {
  cohort_shift: 0, model_added: 1, model_removed: 2, gate_crossed: 3,
  moved: 4, price_changed: 5, benchmark_updated: 6, arena_scale: 7,
};

function sortKey(event: ChangeEvent): string {
  const id = "model_id" in event ? event.model_id : "benchmark_id" in event ? event.benchmark_id : "";
  return `${ORDER[event.type]}:${id}`;
}

/** The newest `days` dates that have events, newest first, events in a stable order. */
export function groupByDate(events: ChangeEvent[], days: number): ChangeDay[] {
  const byDate = new Map<string, ChangeEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, days)
    .map(([date, list]) => ({ date, events: [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b))) }));
}

/** Counts a day's headline is written from. Price and benchmark lines are not counted. */
export function dayCounts(day: ChangeDay): { added: number; removed: number; gate: number; moved: number; shifted: boolean } {
  const count = (type: ChangeType) => day.events.filter((event) => event.type === type).length;
  return {
    added: count("model_added"),
    removed: count("model_removed"),
    gate: count("gate_crossed"),
    moved: count("moved"),
    shifted: count("cohort_shift") > 0,
  };
}

/** Events about one model, newest first. */
export function eventsForModel(events: ChangeEvent[], modelId: string): ChangeEvent[] {
  return events
    .filter((event) => "model_id" in event && event.model_id === modelId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
