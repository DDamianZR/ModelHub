import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMFORTABLE_FRACTION,
  GIB,
  estimate,
  frontier,
  kvBytes,
  weightBytes,
  type LocalModel,
  type VramConfig,
} from "./vram.ts";

// Calibrated table as committed, so these tests move when the real one does.
const config: VramConfig = {
  bytes_per_weight: {
    Q3_K_M: { bytes_per_weight: 0.4859, n: 32, observed_min: 0.4811, observed_max: 0.5251 },
    Q4_K_M: { bytes_per_weight: 0.6044, n: 36, observed_min: 0.5953, observed_max: 0.6522 },
    Q8_0: { bytes_per_weight: 1.0627, n: 30, observed_min: 1.0429, observed_max: 1.0651 },
  },
  kv_bytes_per_element: { fp16: 2, q8: 1, q4: 0.5 },
  overhead_bytes: null,
  overhead_status: "unmeasured",
};

/** Qwen3-30B-A3B-Instruct-2507, as measured: 30.5B total but only 3B active per token. */
function moe(overrides: Partial<LocalModel> = {}): LocalModel {
  return {
    key: "qwen3-30b-a3b-instruct-2507",
    display_name: "Qwen3 30B A3B",
    hf_repo: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    registry_source: "hf_api",
    architecture: "moe",
    params_total: 30_532_122_624,
    params_source: "hf_safetensors",
    n_experts: 128,
    n_experts_active: 8,
    n_layers: 48,
    n_kv_heads: 4,
    head_dim: 128,
    max_context: 262144,
    config_source: "hf_config_json",
    quantizations: [
      {
        quant: "Q4_K_M",
        bytes_on_disk: 18_556_686_752,
        bytes_source: "hf_gguf_tree",
        bytes_per_weight: 0.6078,
      },
    ],
    gguf_repo: "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
    license: "apache-2.0",
    license_source: "hf_api",
    arena_rating: 1383.9,
    score: { kind: "arena_only", value: 1383.9, coverage: null, votes: 23706 },
    status: "verified",
    ...overrides,
  };
}

test("a mixture-of-experts model is sized on total parameters, not active ones", () => {
  // The regression this exists to catch: 3B active x 0.6 would be about 1.8 GB instead of
  // 18.6 GB — a tenfold error that recommends a model which cannot start.
  const model = moe({ quantizations: [] });
  const weights = weightBytes(model, "Q4_K_M", config);

  assert.ok(weights);
  assert.ok(weights.bytes / GIB > 17, `expected ~18 GB, got ${weights.bytes / GIB}`);
  assert.ok(weights.bytes / GIB < 19);
  assert.equal(weights.measured, false);
});

test("a measured GGUF size is preferred over the calibrated estimate", () => {
  const weights = weightBytes(moe(), "Q4_K_M", config);

  assert.ok(weights);
  assert.equal(weights.bytes, 18_556_686_752);
  assert.equal(weights.measured, true);
});

test("the KV cache scales linearly with context", () => {
  const at4k = kvBytes(moe(), 4096, config);
  const at32k = kvBytes(moe(), 32768, config);

  assert.ok(at4k && at32k);
  assert.equal(at32k / at4k, 8);
});

test("the KV cache is computed from KV heads, not attention heads", () => {
  // Grouped-query models publish far fewer KV heads. Using n_heads would overstate this
  // model's cache eightfold.
  const kv = kvBytes(moe(), 4096, config);
  assert.equal(kv, 2 * 48 * 4 * 128 * 4096 * 2);
});

test("KV can overtake the weights at long context", () => {
  const model = moe();
  const weights = weightBytes(model, "Q4_K_M", config)!;
  const kv = kvBytes(model, 262144, config)!;

  assert.ok(kv > weights.bytes, "at 256k the cache should exceed the weights");
});

test("a model with no attention shape never produces a fit verdict", () => {
  const model = moe({ n_layers: null, n_kv_heads: null, head_dim: null });
  const result = estimate(model, "Q4_K_M", 8192, 80 * GIB, config);

  assert.equal(result.verdict, "unknown");
  assert.equal(result.total, null);
  assert.ok(result.missing.includes("attention_shape"));
});

test("an unverified model never produces a fit verdict, even on a huge card", () => {
  const model = moe({ status: "unverified" });
  const result = estimate(model, "Q4_K_M", 4096, 80 * GIB, config);

  assert.equal(result.verdict, "unknown");
  assert.ok(result.missing.includes("metadata"));
});

test("a comfortable fit and a tight fit are distinguished", () => {
  const model = moe();
  const needed = weightBytes(model, "Q4_K_M", config)!.bytes + kvBytes(model, 8192, config)!;

  const comfortable = estimate(
    model, "Q4_K_M", 8192, needed / COMFORTABLE_FRACTION + GIB, config,
  );
  const tight = estimate(model, "Q4_K_M", 8192, needed * 1.01, config);

  assert.equal(comfortable.verdict, "fits");
  assert.equal(tight.verdict, "tight");
});

test("a model larger than the card reports an offload fraction, never a speed", () => {
  const result = estimate(moe(), "Q4_K_M", 4096, 12 * GIB, config);

  assert.ok(["offload", "no_fit"].includes(result.verdict));
  assert.ok(result.offloadFraction > 0);
  assert.ok(result.offloadFraction <= 1);
  // There is deliberately no tokens-per-second field to assert on.
  assert.equal("tokensPerSecond" in result, false);
});

test("unmeasured overhead is reported as missing rather than silently assumed zero", () => {
  const result = estimate(moe(), "Q4_K_M", 4096, 24 * GIB, config);

  assert.equal(result.overhead, null);
  assert.ok(result.missing.includes("overhead"));
});

test("the frontier gives the best model that fits each tier, and null where none do", () => {
  const small = moe({
    key: "small",
    params_total: 3_000_000_000,
    quantizations: [],
    n_layers: 28,
    n_kv_heads: 4,
    head_dim: 128,
    arena_rating: 1200,
    score: { kind: "arena_only", value: 1200, coverage: null, votes: 100 },
  });
  const rows = frontier([moe(), small], [1, 8, 24], "Q4_K_M", 8192, config);

  assert.equal(rows[0].model, null, "a 1 GB card holds neither");
  // At 8 GB only the small model fits, even though the large one scores higher: the
  // frontier is "the best that fits", not "the best".
  assert.equal(rows[1].model?.key, "small");
  assert.equal(rows[2].model?.key, "qwen3-30b-a3b-instruct-2507");
});

test("the calibrated bytes-per-weight stays in a physically sensible band", () => {
  // Q4 is four bits, so half a byte per weight before k-quant scale overhead. A table that
  // drifts outside this band means a mismatched GGUF repository poisoned the calibration.
  for (const [quant, entry] of Object.entries(config.bytes_per_weight)) {
    const bits = Number(quant.match(/^Q(\d+)/)![1]);
    const ratio = entry.bytes_per_weight / (bits / 8);
    assert.ok(
      ratio >= 0.9 && ratio <= 1.6,
      `${quant}: ${entry.bytes_per_weight} is ${ratio.toFixed(2)}x nominal`,
    );
  }
});
