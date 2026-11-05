/**
 * Reads the JSON that `llmfit recommend --json` prints, entirely in the browser.
 *
 * The text never leaves the page: it is parsed here, the hardware block prefills the form,
 * and llmfit's own verdict for a model is shown beside ours as a cross-check. Defensive on
 * purpose: the input is pasted by a person, from a tool whose output format can change, so
 * every field is checked and an unknown shape is an error rather than a guess.
 *
 * No Node imports: safe for client components.
 */
import type { FitLevel, RunMode } from "./fit";

export type ImportedHardware = {
  gpuName: string | null;
  hasGpu: boolean;
  unified: boolean;
  /** GPU VRAM, or the shared pool on unified memory, GB. */
  gpuMemoryGb: number | null;
  totalRamGb: number | null;
  gpuBandwidthGbps: number | null;
  cpuCores: number | null;
};

export type ImportedVerdict = {
  level: FitLevel | null;
  mode: RunMode | null;
  quant: string | null;
  memoryRequiredGb: number | null;
  tokensPerSecond: number | null;
};

export type LlmfitImport = {
  hardware: ImportedHardware;
  /** llmfit's verdict keyed by the Hugging Face repo id it printed. */
  verdicts: Map<string, ImportedVerdict>;
};

export type ImportError = "empty" | "too_large" | "invalid_json" | "not_llmfit";

/** A recommend list is a few kilobytes; this stops a mis-pasted catalogue dump. */
export const MAX_IMPORT_CHARS = 5_000_000;

const LEVELS: Record<string, FitLevel> = {
  perfect: "perfect",
  good: "good",
  marginal: "marginal",
  "too tight": "too_tight",
  too_tight: "too_tight",
};

const MODES: Record<string, RunMode> = {
  gpu: "gpu",
  moe: "moe_offload",
  "cpu+gpu": "cpu_offload",
  cpu: "cpu_only",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A sane positive number, else null: llmfit prints null for what it could not detect. */
function positive(value: unknown, max = 100_000): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

export function parseLlmfitImport(raw: string): LlmfitImport | { error: ImportError } {
  const source = raw.trim();
  if (!source) return { error: "empty" };
  if (source.length > MAX_IMPORT_CHARS) return { error: "too_large" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { error: "invalid_json" };
  }
  if (!isRecord(parsed) || !isRecord(parsed.system) || !Array.isArray(parsed.models)) {
    return { error: "not_llmfit" };
  }

  const system = parsed.system;
  const gpus = Array.isArray(system.gpus) ? system.gpus : [];
  const firstGpu = isRecord(gpus[0]) ? gpus[0] : null;
  const hasGpu = system.has_gpu === true;
  const unified = system.unified_memory === true;

  const hardware: ImportedHardware = {
    gpuName: text(system.gpu_name),
    hasGpu,
    unified,
    gpuMemoryGb: hasGpu ? positive(system.gpu_vram_gb) : null,
    totalRamGb: positive(system.total_ram_gb),
    gpuBandwidthGbps: firstGpu ? positive(firstGpu.memory_bandwidth_gbps, 20_000) : null,
    cpuCores: positive(system.cpu_cores, 1024),
  };

  const verdicts = new Map<string, ImportedVerdict>();
  for (const entry of parsed.models) {
    if (!isRecord(entry)) continue;
    const name = text(entry.name);
    if (!name) continue;
    const level = typeof entry.fit_level === "string" ? LEVELS[entry.fit_level.toLowerCase()] ?? null : null;
    const mode = typeof entry.run_mode === "string" ? MODES[entry.run_mode.toLowerCase()] ?? null : null;
    verdicts.set(name, {
      level,
      mode,
      quant: text(entry.best_quant),
      memoryRequiredGb: positive(entry.memory_required_gb),
      tokensPerSecond: positive(entry.estimated_tps),
    });
  }

  return { hardware, verdicts };
}
