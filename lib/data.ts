import fs from "node:fs";
import path from "node:path";
import type { Meta, Model, Provider, Row, Status } from "./types";

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

/** Sources that did not refresh on the last run, so the page can say so out loud. */
export function getDegradedSources(): { name: string; status: Status["sources"][string] }[] {
  const file = path.join(DATA_DIR, "status.json");
  if (!fs.existsSync(file)) return [];
  const status = JSON.parse(fs.readFileSync(file, "utf8")) as Status;
  return Object.entries(status.sources ?? {})
    .filter(([, value]) => value.state !== "ok")
    .map(([name, value]) => ({ name, status: value }));
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
