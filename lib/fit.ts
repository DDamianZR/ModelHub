/**
 * "What runs on my machine?" — memory fit and decode-speed estimate for a local model.
 *
 * Ported from llmfit (https://github.com/AlexsJones/llmfit, MIT, (c) 2026 Alex Jones):
 * `llmfit-core/src/models.rs` for bytes per parameter, KV cache and MoE memory, and
 * `llmfit-core/src/fit.rs` for the verdict bands, run-mode selection and the bandwidth
 * speed model. Attribution is in NOTICE and on /methodology.
 *
 * Pure arithmetic, no Node imports and no I/O: safe for client components. Nothing here
 * reads who made a model; the only inputs are sizes, architecture shape and the machine.
 *
 * What is NOT ported, so callers do not read more precision into the output than exists:
 *  - hybrid layouts are used when the data carries one (`attention_layout`), but this module
 *    never infers one from a name: models without a recorded layout are sized as all-full
 *    attention, which over-estimates their KV cache;
 *  - llmfit's two-tier MoE decomposition for GPU-resident experts: speed uses active
 *    parameters over bandwidth alone, which is an upper bound for those models;
 *  - tensor-parallel clusters, vLLM and pre-quantised formats, MLX, BitNet;
 *  - prefill / time-to-first-token.
 */
import type { LocalModelSpec } from "./types";

// ---------------------------------------------------------------------------------------
// Constants (llmfit fit.rs / models.rs; the line of provenance is the function name)
// ---------------------------------------------------------------------------------------

/** Verdict bands on memory use: fit.rs FIT_PERFECT / FIT_GOOD / FIT_MARGINAL_MAX_RATIO. */
export const FIT_PERFECT_MAX_RATIO = 0.6;
export const FIT_GOOD_MAX_RATIO = 0.85;
/** Stops short of 1.00: a pool filled to the last percent has no room for the allocator. */
export const FIT_MARGINAL_MAX_RATIO = 0.98;

/** fit.rs DEFAULT_ESTIMATION_CTX: runtimes rarely use the advertised maximum window. */
export const DEFAULT_ESTIMATION_CTX = 8192;
/** models.rs best_quant_for_budget_with: halving is only retried above this many tokens. */
export const MIN_RETRY_CTX = 1024;
/** Runtime allowance (CUDA/Metal context, buffers) added to weights + KV cache, in GB. */
export const RUNTIME_OVERHEAD_GB = 0.5;
/** fit.rs CalcConfig.efficiency: kernel overhead, KV reads and memory-controller loss. */
export const BANDWIDTH_EFFICIENCY = 0.55;
/** fit.rs fallback when DDR bandwidth is unknown: DDR4-3200 dual channel. */
export const DEFAULT_DDR_BANDWIDTH_GBPS = 50;
/** Active-expert VRAM carries a 10% allowance, moe_memory_for_quant. */
const MOE_ACTIVE_VRAM_FACTOR = 1.1;
const MOE_MIN_ACTIVE_VRAM_GB = 0.5;

/** fit.rs RunModeFactors defaults, by the modes this port keeps. */
export const RUN_MODE_FACTORS = { gpu: 1.0, moe_offload: 0.8, cpu_offload: 0.5, cpu_only: 0.3 } as const;

const GIB = 1024 ** 3;

/** models.rs QUANT_HIERARCHY, best quality first. */
export const QUANT_LADDER = ["Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M", "Q3_K_M", "Q2_K"] as const;
/** models.rs MXFP4_QUANT_HIERARCHY: the released weights of MXFP4-native models. */
export const MXFP4_LADDER = ["MXFP4"] as const;

/** Bytes per parameter used to size memory (models.rs quant_bpp). Unknown labels: 0.58. */
const QUANT_BPP: Record<string, number> = {
  F32: 4.0,
  F16: 2.0,
  BF16: 2.0,
  Q8_0: 1.05,
  Q6_K: 0.8,
  Q5_K_M: 0.68,
  Q4_K_M: 0.58,
  Q4_0: 0.58,
  Q3_K_M: 0.48,
  Q2_K: 0.37,
  MXFP4: 0.55,
};

/** Bytes per parameter used to size speed (models.rs quant_bytes_per_param). Unknown: 0.5. */
const QUANT_BYTES_PER_PARAM: Record<string, number> = {
  F32: 4.0,
  F16: 2.0,
  BF16: 2.0,
  Q8_0: 1.0,
  Q6_K: 0.75,
  Q5_K_M: 0.625,
  Q4_K_M: 0.5,
  Q4_0: 0.5,
  Q3_K_M: 0.375,
  Q2_K: 0.25,
  MXFP4: 0.53,
};

/** models.rs quant_speed_multiplier, used only by the CPU-only constant fallback. */
const QUANT_SPEED_MULTIPLIER: Record<string, number> = {
  F32: 0.3,
  F16: 0.6,
  BF16: 0.6,
  Q8_0: 0.8,
  Q6_K: 0.95,
  Q5_K_M: 1.0,
  Q4_K_M: 1.15,
  Q4_0: 1.15,
  Q3_K_M: 1.25,
  Q2_K: 1.35,
  MXFP4: 1.15,
};

export function quantBpp(quant: string): number {
  return QUANT_BPP[quant] ?? 0.58;
}

export function quantBytesPerParam(quant: string): number {
  return QUANT_BYTES_PER_PARAM[quant] ?? 0.5;
}

// ---------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------

export type FitLevel = "perfect" | "good" | "marginal" | "too_tight";
export type RunMode = "gpu" | "moe_offload" | "cpu_offload" | "cpu_only";

/**
 * The machine. `discrete`: separate VRAM and RAM pools. `unified`: one pool shared by CPU
 * and GPU (Apple silicon), where there is nothing to spill to. `cpu`: no usable GPU.
 */
export type Hardware =
  | { kind: "discrete"; vramGb: number; ramGb: number; bandwidthGbps?: number | null; ddrBandwidthGbps?: number | null; cpuCores?: number }
  | { kind: "unified"; poolGb: number; bandwidthGbps?: number | null; cpuCores?: number }
  | { kind: "cpu"; ramGb: number; ddrBandwidthGbps?: number | null; cpuCores?: number };

export type FitResult = {
  level: FitLevel;
  mode: RunMode;
  quant: string;
  /** Memory the chosen path needs in its pool, GB. */
  memoryRequiredGb: number;
  /** The pool that number is judged against, GB. */
  memoryAvailableGb: number;
  /** required / available. Infinity when the pool is empty. */
  utilization: number;
  /** MoE offload only: inactive experts parked in system RAM, GB. */
  offloadedRamGb: number | null;
  /** Context the memory figure assumes, and whether the half-context retry was needed. */
  contextTokens: number;
  halvedContext: boolean;
  /** Decode tokens per second, or null when the machine gives nothing to estimate from. */
  tokensPerSecond: number | null;
};

// ---------------------------------------------------------------------------------------
// Model arithmetic (models.rs)
// ---------------------------------------------------------------------------------------

const paramsB = (m: LocalModelSpec) => m.parameters_raw / 1e9;

/** Architectures whose KV cache is one compressed latent per token (models.rs mla_kv_width). */
const MLA_ARCHITECTURES = new Set(["deepseek_v2", "deepseek_v3", "kimi_k2", "kimi_k25", "kimi_vl", "glm4_moe_lite"]);
const MLA_KV_WIDTH = 576;

/** True for released-as-MXFP4 weights (models.rs is_mxfp4_native). */
export function isMxfp4Native(m: Pick<LocalModelSpec, "architecture" | "hf_repo">): boolean {
  const arch = (m.architecture ?? "").toLowerCase();
  if (!(arch.startsWith("gpt_oss") || arch.startsWith("gptoss"))) return false;
  const name = m.hf_repo.toLowerCase();
  return !["bf16", "-mlx", "mlx-community", "awq", "gptq", "nvfp4", "autoround"].some((s) => name.includes(s));
}

export function quantLadderFor(m: Pick<LocalModelSpec, "architecture" | "hf_repo">): readonly string[] {
  return isMxfp4Native(m) ? MXFP4_LADDER : QUANT_LADDER;
}

/**
 * Layers that keep a context-scaled KV cache. A hybrid model mixes full attention with
 * linear / state-space layers, which hold a fixed-size state instead; a layout given as a
 * ratio is scaled to the real layer count (models.rs normalized_for_layers), so a 16/48
 * template becomes 6/18 on a 24-layer model.
 */
export function fullAttentionLayers(m: LocalModelSpec): number | null {
  const layers = m.num_hidden_layers;
  const layout = m.attention_layout;
  if (!layers) return null;
  if (!layout) return layers;
  const total = layout.full + layout.linear;
  if (total === 0) return layers;
  if (total === layers) return layout.full;
  return Math.min(Math.floor((layers * layout.full + Math.floor(total / 2)) / total), layers);
}

/**
 * KV cache in GB at `ctx` tokens, fp16 (models.rs kv_cache_gb):
 * 2 · full-attention layers · kv_heads · head_dim · ctx · 2 bytes, or the coarse
 * 0.000008 · B · ctx when the shape is unknown. MLA models cache one 576-wide latent per layer.
 */
export function kvCacheGb(m: LocalModelSpec, ctx: number): number {
  const bytesPerElement = 2;
  const layers = fullAttentionLayers(m);
  if (layers && MLA_ARCHITECTURES.has((m.architecture ?? "").toLowerCase())) {
    return (MLA_KV_WIDTH * ctx * bytesPerElement * layers) / GIB;
  }
  if (layers && m.head_dim) {
    const kvHeads = m.num_key_value_heads ?? m.num_attention_heads ?? 8;
    return (2 * kvHeads * m.head_dim * ctx * bytesPerElement * layers) / GIB;
  }
  const layout = m.attention_layout;
  const fraction = layout && layout.full + layout.linear > 0 ? layout.full / (layout.full + layout.linear) : 1;
  return 0.000008 * paramsB(m) * ctx * fraction;
}

/** Weights + KV cache + runtime allowance, GB (models.rs estimate_memory_gb). */
export function estimateMemoryGb(m: LocalModelSpec, quant: string, ctx: number): number {
  return paramsB(m) * quantBpp(quant) + kvCacheGb(m, ctx) + RUNTIME_OVERHEAD_GB;
}

/**
 * MoE with experts split across pools: active experts in VRAM (with a 10% allowance, 0.5 GB
 * floor) and the inactive ones in RAM (fit.rs moe_memory_for_quant). Null for dense models
 * and for MoE entries that publish no active-parameter count.
 */
export function moeMemoryForQuant(
  m: LocalModelSpec,
  quant: string,
): { activeVramGb: number; offloadedRamGb: number } | null {
  if (!m.is_moe || !m.active_parameters) return null;
  const bpp = quantBpp(quant);
  const activeVramGb = Math.max(((m.active_parameters * bpp) / GIB) * MOE_ACTIVE_VRAM_FACTOR, MOE_MIN_ACTIVE_VRAM_GB);
  const inactive = Math.max(m.parameters_raw - m.active_parameters, 0);
  return { activeVramGb, offloadedRamGb: (inactive * bpp) / GIB };
}

/**
 * Best quantisation whose full estimate fits `budgetGb`, trying the whole ladder at `ctx`
 * first and then once more at half the context (models.rs best_quant_for_budget_with).
 */
export function bestQuantForBudget(
  m: LocalModelSpec,
  budgetGb: number,
  ctx: number,
  ladder: readonly string[] = quantLadderFor(m),
): { quant: string; memoryGb: number; contextTokens: number; halvedContext: boolean } | null {
  for (const quant of ladder) {
    const memoryGb = estimateMemoryGb(m, quant, ctx);
    if (memoryGb <= budgetGb) return { quant, memoryGb, contextTokens: ctx, halvedContext: false };
  }
  const half = Math.floor(ctx / 2);
  if (half >= MIN_RETRY_CTX) {
    for (const quant of ladder) {
      const memoryGb = estimateMemoryGb(m, quant, half);
      if (memoryGb <= budgetGb) return { quant, memoryGb, contextTokens: half, halvedContext: true };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Verdict (fit.rs pure_ratio_verdict, cap_for_run_mode, score_fit)
// ---------------------------------------------------------------------------------------

/** Memory the verdict still accepts in a pool: the quant picked is never one rated too tight. */
const quantBudget = (poolGb: number) => poolGb * FIT_MARGINAL_MAX_RATIO;

/** A non-finite ratio (empty or unknown pool) is too tight: a pool we cannot size cannot fit. */
export function ratioVerdict(ratio: number): FitLevel {
  if (!Number.isFinite(ratio) || ratio > FIT_MARGINAL_MAX_RATIO) return "too_tight";
  if (ratio <= FIT_PERFECT_MAX_RATIO) return "perfect";
  if (ratio <= FIT_GOOD_MAX_RATIO) return "good";
  return "marginal";
}

/** Perfect means "fits with room and runs on the GPU": every other path caps at good. */
export function capForRunMode(level: FitLevel, mode: RunMode): FitLevel {
  if (mode === "gpu") return level;
  return level === "perfect" ? "good" : level;
}

export function scoreFit(requiredGb: number, availableGb: number, mode: RunMode): FitLevel {
  const ratio = availableGb > 0 ? requiredGb / availableGb : Number.POSITIVE_INFINITY;
  return capForRunMode(ratioVerdict(ratio), mode);
}

// ---------------------------------------------------------------------------------------
// Speed (fit.rs estimate_tps, dense_cpu_offload_tps)
// ---------------------------------------------------------------------------------------

type Path = {
  mode: RunMode;
  required: number;
  available: number;
  quant: string;
  contextTokens: number;
  halved: boolean;
  offloadedRamGb: number | null;
};

function ddrBandwidth(hw: Hardware): number {
  const configured = hw.kind === "unified" ? null : hw.ddrBandwidthGbps;
  return configured && configured > 0 ? configured : DEFAULT_DDR_BANDWIDTH_GBPS;
}

/** The pool a fully-resident GPU model is judged against, used to size spilled layers. */
function gpuPoolGb(hw: Hardware): number {
  if (hw.kind === "discrete") return hw.vramGb;
  if (hw.kind === "unified") return hw.poolGb;
  return 0;
}

function denseCpuOffloadTps(m: LocalModelSpec, hw: Hardware, bandwidth: number, weightGb: number, ctx: number): number {
  const vramForWeights = Math.max(gpuPoolGb(hw) - kvCacheGb(m, ctx) - RUNTIME_OVERHEAD_GB, 0);
  let gpuGb: number;
  let ramGb: number;
  const layers = m.num_hidden_layers;
  if (layers && layers > 0) {
    const slice = weightGb / layers;
    const onGpu = Math.min(Math.max(Math.floor(vramForWeights / slice), 0), layers);
    if (onGpu === layers) {
      gpuGb = weightGb;
      ramGb = 0;
    } else {
      gpuGb = onGpu * slice;
      ramGb = weightGb - gpuGb;
    }
  } else {
    gpuGb = Math.min(weightGb, vramForWeights);
    ramGb = weightGb - gpuGb;
  }
  if (ramGb === 0) {
    if (weightGb <= 0) return 0.1;
    return Math.max((bandwidth / weightGb) * BANDWIDTH_EFFICIENCY * RUN_MODE_FACTORS.gpu, 0.1);
  }
  const gpuRate = bandwidth * BANDWIDTH_EFFICIENCY * RUN_MODE_FACTORS.gpu;
  if (gpuGb > 0 && gpuRate <= 0) return 0.1;
  const gpuTime = gpuGb > 0 ? gpuGb / gpuRate : 0;
  const total = gpuTime + ramGb / ddrBandwidth(hw);
  return Number.isFinite(total) && total > 0 ? Math.max(1 / total, 0.1) : 0.1;
}

/**
 * Decode tokens/s. The base case is the one the page states in words:
 * `bandwidth / GB × 0.55`, where GB is the bytes read per token (active parameters only
 * for MoE). Null when a GPU path has no bandwidth: there is no honest constant to use.
 */
export function estimateTps(m: LocalModelSpec, path: Path, hw: Hardware): number | null {
  const params = Math.max(m.is_moe && m.active_parameters ? m.active_parameters / 1e9 : paramsB(m), 0.1);
  const activeGb = params * quantBytesPerParam(path.quant);
  const cores = hw.cpuCores ?? 8;

  if (path.mode === "cpu_only") {
    // llmfit's CPU constant: 70 / params, scaled by quant and thread count, then the mode factor.
    let base = (70 / params) * (QUANT_SPEED_MULTIPLIER[path.quant] ?? 1);
    if (cores >= 8) base *= 1.1;
    return Math.max(base * RUN_MODE_FACTORS.cpu_only, 0.1);
  }

  const bandwidth = hw.kind === "cpu" ? null : hw.bandwidthGbps;
  if (!bandwidth || bandwidth <= 0) return null;

  if (path.mode === "moe_offload") {
    // Active experts are read from DDR by the CPU and computed on the GPU, in sequence.
    const total = activeGb / ddrBandwidth(hw) + activeGb / (bandwidth * BANDWIDTH_EFFICIENCY);
    return Math.max((1 / total) * RUN_MODE_FACTORS.moe_offload, 0.1);
  }
  if (path.mode === "cpu_offload" && !m.is_moe) {
    return denseCpuOffloadTps(m, hw, bandwidth, activeGb, path.contextTokens);
  }
  const base = (bandwidth / activeGb) * BANDWIDTH_EFFICIENCY;
  return Math.max(base * RUN_MODE_FACTORS[path.mode], 0.1);
}

// ---------------------------------------------------------------------------------------
// Path selection (fit.rs analyze_inner, cpu_path, moe_offload_path)
// ---------------------------------------------------------------------------------------

function cpuPath(m: LocalModelSpec, ramGb: number, ctx: number): Path {
  const own = m.quantization;
  if (m.is_moe) {
    // Expert offload needs a GPU. llmfit sizes the CPU-only MoE case from the catalogue's
    // own minimum-RAM figure rather than re-deriving it.
    return { mode: "cpu_only", required: m.min_ram_gb, available: ramGb, quant: own, contextTokens: ctx, halved: false, offloadedRamGb: null };
  }
  const best = bestQuantForBudget(m, quantBudget(ramGb), ctx);
  if (best) {
    return { mode: "cpu_only", required: best.memoryGb, available: ramGb, quant: best.quant, contextTokens: best.contextTokens, halved: best.halvedContext, offloadedRamGb: null };
  }
  return { mode: "cpu_only", required: estimateMemoryGb(m, own, ctx), available: ramGb, quant: own, contextTokens: ctx, halved: false, offloadedRamGb: null };
}

function moeOffloadPath(m: LocalModelSpec, vramGb: number, ramGb: number, ctx: number): Path {
  for (const quant of quantLadderFor(m)) {
    const need = moeMemoryForQuant(m, quant);
    if (need && need.activeVramGb <= vramGb && need.offloadedRamGb <= ramGb) {
      return { mode: "moe_offload", required: need.activeVramGb, available: vramGb, quant, contextTokens: ctx, halved: false, offloadedRamGb: need.offloadedRamGb };
    }
  }
  if (m.min_ram_gb <= ramGb) {
    return { mode: "cpu_offload", required: m.min_ram_gb, available: ramGb, quant: m.quantization, contextTokens: ctx, halved: false, offloadedRamGb: null };
  }
  const minVram = m.min_vram_gb ?? m.min_ram_gb;
  return { mode: "gpu", required: minVram, available: vramGb, quant: m.quantization, contextTokens: ctx, halved: false, offloadedRamGb: null };
}

function pathFor(m: LocalModelSpec, hw: Hardware, ctx: number): Path {
  const own = m.quantization;
  const resident = (pool: number): Path => {
    const best = bestQuantForBudget(m, quantBudget(pool), ctx);
    if (best) {
      return { mode: "gpu", required: best.memoryGb, available: pool, quant: best.quant, contextTokens: best.contextTokens, halved: best.halvedContext, offloadedRamGb: null };
    }
    return { mode: "gpu", required: estimateMemoryGb(m, own, ctx), available: pool, quant: own, contextTokens: ctx, halved: false, offloadedRamGb: null };
  };

  if (hw.kind === "unified") {
    // One pool: nothing to spill to, so no cpu_offload and no expert split.
    return resident(hw.poolGb);
  }
  if (hw.kind === "cpu" || hw.vramGb <= 0) {
    return cpuPath(m, hw.ramGb, ctx);
  }
  const fitsVram = bestQuantForBudget(m, quantBudget(hw.vramGb), ctx);
  if (fitsVram) return resident(hw.vramGb);
  if (m.is_moe) return moeOffloadPath(m, hw.vramGb, hw.ramGb, ctx);

  const fitsRam = bestQuantForBudget(m, quantBudget(hw.ramGb), ctx);
  if (fitsRam) {
    return { mode: "cpu_offload", required: fitsRam.memoryGb, available: hw.ramGb, quant: fitsRam.quant, contextTokens: fitsRam.contextTokens, halved: fitsRam.halvedContext, offloadedRamGb: null };
  }
  // Fits nowhere: reported against VRAM because a GPU is the preferred path.
  return resident(hw.vramGb);
}

/**
 * Verdict, run mode, quantisation and speed for one model on one machine.
 * `contextLimit` caps the context the memory figure assumes (default 8192 tokens, or the
 * model's own window when smaller).
 */
export function analyze(m: LocalModelSpec, hw: Hardware, contextLimit?: number): FitResult {
  const requested = Math.min(m.context_length, contextLimit ?? DEFAULT_ESTIMATION_CTX);
  const path = pathFor(m, hw, requested);
  const utilization = path.available > 0 ? path.required / path.available : Number.POSITIVE_INFINITY;
  const level = scoreFit(path.required, path.available, path.mode);
  return {
    level,
    mode: path.mode,
    quant: path.quant,
    memoryRequiredGb: path.required,
    memoryAvailableGb: path.available,
    utilization,
    offloadedRamGb: path.offloadedRamGb,
    contextTokens: path.contextTokens,
    halvedContext: path.halved,
    tokensPerSecond: level === "too_tight" ? null : estimateTps(m, path, hw),
  };
}

/** Ordering for "what fits": best verdict first. */
export const FIT_ORDER: Record<FitLevel, number> = { perfect: 0, good: 1, marginal: 2, too_tight: 3 };

export function runs(level: FitLevel): boolean {
  return level !== "too_tight";
}

// ---------------------------------------------------------------------------------------
// GPU presets
// ---------------------------------------------------------------------------------------

export type HardwarePreset = {
  id: string;
  label: string;
  kind: "discrete" | "unified";
  /** VRAM for discrete cards; for unified chips, the memory configurations on sale. */
  memoryGb: number;
  bandwidthGbps: number;
};

/**
 * Bandwidth is llmfit's `gpu_memory_bandwidth_gbps` table (hardware.rs); capacity is the
 * card's published memory. Sorted by label, with no entry marked as a default: a preset is
 * a convenience for typing the numbers, not a recommendation. Laptop parts are absent on
 * purpose: llmfit declines to guess their bus width, and so does this list (use "custom").
 */
const PRESET_ROWS: HardwarePreset[] = [
  { id: "gtx-1660", label: "GeForce GTX 1660 (6 GB)", kind: "discrete", memoryGb: 6, bandwidthGbps: 192 },
  { id: "rtx-2060", label: "GeForce RTX 2060 (6 GB)", kind: "discrete", memoryGb: 6, bandwidthGbps: 336 },
  { id: "rtx-3060", label: "GeForce RTX 3060 (12 GB)", kind: "discrete", memoryGb: 12, bandwidthGbps: 360 },
  { id: "rtx-3070", label: "GeForce RTX 3070 (8 GB)", kind: "discrete", memoryGb: 8, bandwidthGbps: 448 },
  { id: "rtx-3080", label: "GeForce RTX 3080 (10 GB)", kind: "discrete", memoryGb: 10, bandwidthGbps: 760 },
  { id: "rtx-3090", label: "GeForce RTX 3090 (24 GB)", kind: "discrete", memoryGb: 24, bandwidthGbps: 936 },
  { id: "rtx-4060", label: "GeForce RTX 4060 (8 GB)", kind: "discrete", memoryGb: 8, bandwidthGbps: 272 },
  { id: "rtx-4060-ti-16", label: "GeForce RTX 4060 Ti (16 GB)", kind: "discrete", memoryGb: 16, bandwidthGbps: 288 },
  { id: "rtx-4070", label: "GeForce RTX 4070 (12 GB)", kind: "discrete", memoryGb: 12, bandwidthGbps: 504 },
  { id: "rtx-4080", label: "GeForce RTX 4080 (16 GB)", kind: "discrete", memoryGb: 16, bandwidthGbps: 717 },
  { id: "rtx-4090", label: "GeForce RTX 4090 (24 GB)", kind: "discrete", memoryGb: 24, bandwidthGbps: 1008 },
  { id: "rtx-5070", label: "GeForce RTX 5070 (12 GB)", kind: "discrete", memoryGb: 12, bandwidthGbps: 672 },
  { id: "rtx-5080", label: "GeForce RTX 5080 (16 GB)", kind: "discrete", memoryGb: 16, bandwidthGbps: 960 },
  { id: "rtx-5090", label: "GeForce RTX 5090 (32 GB)", kind: "discrete", memoryGb: 32, bandwidthGbps: 1792 },
  { id: "rx-6800-xt", label: "Radeon RX 6800 XT (16 GB)", kind: "discrete", memoryGb: 16, bandwidthGbps: 512 },
  { id: "rx-7900-xtx", label: "Radeon RX 7900 XTX (24 GB)", kind: "discrete", memoryGb: 24, bandwidthGbps: 960 },
  { id: "apple-m1", label: "Apple M1 (unified)", kind: "unified", memoryGb: 16, bandwidthGbps: 68 },
  { id: "apple-m2-pro", label: "Apple M2 Pro (unified)", kind: "unified", memoryGb: 32, bandwidthGbps: 200 },
  { id: "apple-m3-max", label: "Apple M3 Max (unified)", kind: "unified", memoryGb: 64, bandwidthGbps: 400 },
  { id: "apple-m4-pro", label: "Apple M4 Pro (unified)", kind: "unified", memoryGb: 48, bandwidthGbps: 273 },
];

export const HARDWARE_PRESETS: HardwarePreset[] = [...PRESET_ROWS].sort((a, b) =>
  a.label.localeCompare(b.label, "en"),
);
