/**
 * What a model actually needs in VRAM, and whether it fits.
 *
 *     VRAM_total = W + KV + O
 *
 *     W  = the quantised weights, measured from the GGUF file where one exists,
 *          otherwise params_total x bytes_per_weight from the calibrated table
 *     KV = 2 x n_layers x n_kv_heads x head_dim x context x bytes_per_element
 *     O  = runtime overhead: context, activations, allocator fragmentation
 *
 * Pure, and free of Node imports, because the same arithmetic runs on the server at build
 * time and in the browser when someone moves a control. `lib/types.ts` keeps that rule for
 * the same reason.
 *
 * Every VRAM calculator on the internet reports W and stops. People believe them, pick a
 * model, and run out of memory — because KV grows with context and can overtake the weights
 * entirely. On a 30B MoE at 128k context the KV cache is 12.9 GB against 18.6 GB of weights.
 * That is why context is an input here and not an assumption.
 */

export const GIB = 1024 ** 3;

export type Quantisation = "Q3_K_M" | "Q4_K_M" | "Q5_K_M" | "Q6_K" | "Q8_0";
export const QUANTISATIONS: Quantisation[] = [
  "Q3_K_M",
  "Q4_K_M",
  "Q5_K_M",
  "Q6_K",
  "Q8_0",
];

export type KvPrecision = "fp16" | "q8" | "q4";

/** Verdicts, worst to best, so a caller can compare them. */
export type Verdict = "no_fit" | "offload" | "tight" | "fits" | "unknown";

/**
 * Headroom below which a fit is called comfortable rather than tight.
 *
 * A card is never entirely yours: the desktop, the browser and the compositor are already
 * holding some of it. Calling a 99%-full card "fits" is how someone ends up with a model
 * that loads and then dies on the first long prompt.
 */
export const COMFORTABLE_FRACTION = 0.9;

export type LocalModel = {
  key: string;
  display_name: string;
  hf_repo: string;
  registry_source: "epoch" | "hf_api";
  architecture: "moe" | "dense";
  params_total: number;
  params_source: string;
  n_experts: number | null;
  n_experts_active: number | null;
  n_layers: number | null;
  n_kv_heads: number | null;
  head_dim: number | null;
  max_context: number | null;
  config_source: string | null;
  quantizations: {
    quant: string;
    bytes_on_disk: number;
    bytes_source: string;
    bytes_per_weight: number;
  }[];
  gguf_repo: string | null;
  license: string | null;
  license_source: string;
  /**
   * LMArena's Bradley-Terry rating, present on every row. This is the axis the frontier is
   * drawn on. `score` below is the richest claim the row can make, and a composite runs
   * 0-100 while a rating runs past 1400 - putting both on one axis would order models by
   * which kind of score they happen to carry rather than by how good they are.
   */
  arena_rating: number;
  score:
    | { kind: "composite"; value: number; coverage: string; model_id: string; provisional: boolean }
    | { kind: "arena_only"; value: number; coverage: null; votes: number };
  status: "verified" | "partial" | "unverified";
};

export type VramConfig = {
  bytes_per_weight: Record<
    string,
    { bytes_per_weight: number; n: number; observed_min: number; observed_max: number }
  >;
  kv_bytes_per_element: Record<KvPrecision, number>;
  overhead_bytes: number | null;
  overhead_status: "measured" | "unmeasured";
};

export type Estimate = {
  /** Weight bytes, and whether they were measured or derived from the table. */
  weights: number;
  weightsMeasured: boolean;
  /** KV cache bytes at the requested context, or null when the shape is unknown. */
  kv: number | null;
  /** Runtime overhead, null while nobody has measured it on declared hardware. */
  overhead: number | null;
  /** W + KV, and + O once it exists. Null when KV cannot be computed. */
  total: number | null;
  verdict: Verdict;
  /** Fraction of the weights that would sit in system RAM. 0 when it all fits. */
  offloadFraction: number;
  /** Why no verdict could be given, when that is the case. */
  missing: string[];
};

/**
 * Weight bytes for one quantisation.
 *
 * MoE models use TOTAL parameters, never active ones. A 30B-A3B has to hold all 30B
 * resident even though it computes with 3B per token; estimating from the active count
 * gives about 2 GB instead of 18.6, a tenfold error that would recommend models which do
 * not start. This is the single easiest mistake to reintroduce here, which is why it is
 * written down rather than left to be inferred from the absence of a branch.
 *
 * (llama.cpp can offload experts to CPU, which changes the arithmetic. That is an advanced
 * case, deliberately outside the default estimate, and noted on /methodology.)
 */
export function weightBytes(
  model: LocalModel,
  quant: Quantisation,
  config: VramConfig,
): { bytes: number; measured: boolean } | null {
  const measured = model.quantizations.find((q) => q.quant === quant);
  if (measured) return { bytes: measured.bytes_on_disk, measured: true };

  const calibrated = config.bytes_per_weight[quant];
  if (!calibrated) return null;
  return { bytes: model.params_total * calibrated.bytes_per_weight, measured: false };
}

/**
 * KV cache bytes at a given context length.
 *
 *     2 (one key tensor and one value tensor) x layers x kv_heads x head_dim x ctx x bytes
 *
 * Grouped-query and multi-query models publish fewer KV heads than attention heads, and it
 * is the KV count that drives this. Gemma 3 27B carries 62 layers x 16 KV heads where
 * Qwen3-30B-A3B carries 48 x 4, so their caches differ by more than five times per token
 * even though the models are a similar size on disk.
 */
export function kvBytes(
  model: LocalModel,
  context: number,
  config: VramConfig,
  precision: KvPrecision = "fp16",
): number | null {
  const { n_layers, n_kv_heads, head_dim } = model;
  if (!n_layers || !n_kv_heads || !head_dim) return null;
  const perElement = config.kv_bytes_per_element[precision] ?? 2;
  return 2 * n_layers * n_kv_heads * head_dim * context * perElement;
}

export function estimate(
  model: LocalModel,
  quant: Quantisation,
  context: number,
  vramBytes: number,
  config: VramConfig,
  precision: KvPrecision = "fp16",
): Estimate {
  const missing: string[] = [];
  const weights = weightBytes(model, quant, config);
  const kv = kvBytes(model, context, config, precision);

  if (!weights) missing.push("weights");
  if (kv === null) missing.push("attention_shape");
  if (model.status === "unverified") missing.push("metadata");

  const overhead = config.overhead_status === "measured" ? config.overhead_bytes : null;
  if (overhead === null) missing.push("overhead");

  // No weights or no attention shape means no total, and no total means no verdict. A model
  // whose metadata could not be established is listed saying so, and never told a reader it
  // fits — the whole value of this page is that its "yes" can be trusted.
  if (!weights || kv === null || model.status === "unverified") {
    return {
      weights: weights?.bytes ?? 0,
      weightsMeasured: weights?.measured ?? false,
      kv,
      overhead,
      total: null,
      verdict: "unknown",
      offloadFraction: 0,
      missing,
    };
  }

  const total = weights.bytes + kv + (overhead ?? 0);

  let verdict: Verdict;
  let offloadFraction = 0;
  if (total <= vramBytes * COMFORTABLE_FRACTION) {
    verdict = "fits";
  } else if (total <= vramBytes) {
    verdict = "tight";
  } else if (kv < vramBytes) {
    // The cache still has to be resident; only weights can be split across the boundary.
    // How much runs in system RAM is calculable. How slow that makes it is NOT, and no
    // number for it appears anywhere on this site.
    const roomForWeights = Math.max(0, vramBytes - kv - (overhead ?? 0));
    offloadFraction = Math.min(1, 1 - roomForWeights / weights.bytes);
    verdict = offloadFraction < 0.85 ? "offload" : "no_fit";
  } else {
    verdict = "no_fit";
  }

  return {
    weights: weights.bytes,
    weightsMeasured: weights.measured,
    kv,
    overhead,
    total,
    verdict,
    offloadFraction,
    missing,
  };
}

/** The best-scoring model that fits each VRAM tier — the frontier the chart draws. */
export function frontier(
  models: LocalModel[],
  tiers: number[],
  quant: Quantisation,
  context: number,
  config: VramConfig,
): { tier: number; model: LocalModel | null; estimate: Estimate | null }[] {
  return tiers.map((tier) => {
    const vramBytes = tier * GIB;
    let best: { model: LocalModel; estimate: Estimate } | null = null;

    for (const model of models) {
      const result = estimate(model, quant, context, vramBytes, config);
      if (result.verdict !== "fits" && result.verdict !== "tight") continue;
      // arena_rating, never score: see the field's comment. Every row has one, and they are
      // the only values here that can honestly be compared with each other.
      if (!best || model.arena_rating > best.model.arena_rating) {
        best = { model, estimate: result };
      }
    }
    return { tier, model: best?.model ?? null, estimate: best?.estimate ?? null };
  });
}

export function formatGiB(bytes: number, digits = 1): string {
  return (bytes / GIB).toFixed(digits);
}
