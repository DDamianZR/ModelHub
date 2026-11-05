/**
 * lib/fit.ts against hand-computed values. Run with `npm run test:fit` (node:test, no
 * dependencies). Every expected number below is derived in the comment beside it from the
 * llmfit constants, not copied from this module's output.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  HARDWARE_PRESETS,
  analyze,
  bestQuantForBudget,
  capForRunMode,
  estimateMemoryGb,
  fullAttentionLayers,
  isMxfp4Native,
  kvCacheGb,
  moeMemoryForQuant,
  quantBpp,
  quantBytesPerParam,
  quantLadderFor,
  ratioVerdict,
  scoreFit,
} from "../lib/fit.ts";
import type { LocalModelSpec } from "../lib/types.ts";

const GIB = 1024 ** 3;

function spec(over: Partial<LocalModelSpec>): LocalModelSpec {
  return {
    model_id: "test",
    hf_repo: "org/test",
    parameters_raw: 7e9,
    active_parameters: null,
    is_moe: false,
    num_experts: null,
    active_experts: null,
    context_length: 32768,
    num_hidden_layers: 32,
    num_attention_heads: 32,
    num_key_value_heads: 8,
    head_dim: 128,
    architecture: "llama",
    attention_layout: null,
    quantization: "Q4_K_M",
    min_ram_gb: 4,
    min_vram_gb: 4,
    license: null,
    ...over,
  };
}

// 46.7B total, 12.9B active, 8 experts, 2 per token: the catalogue row for an 8x7B mixture.
const MIXTRAL = spec({
  hf_repo: "org/mixtral-8x7b",
  parameters_raw: 46_700_000_000,
  active_parameters: 12_900_000_000,
  is_moe: true,
  num_experts: 8,
  active_experts: 2,
  architecture: "mixtral",
  min_ram_gb: 26.1,
  min_vram_gb: 23.9,
});

test("quantisation tables match llmfit", () => {
  assert.equal(quantBpp("Q4_K_M"), 0.58);
  assert.equal(quantBpp("Q8_0"), 1.05);
  assert.equal(quantBpp("unknown-label"), 0.58);
  assert.equal(quantBytesPerParam("Q4_K_M"), 0.5);
  assert.equal(quantBytesPerParam("F16"), 2.0);
});

test("verdict bands are inclusive at 60%, 85% and 98%", () => {
  assert.equal(ratioVerdict(0.6), "perfect");
  assert.equal(ratioVerdict(0.6001), "good");
  assert.equal(ratioVerdict(0.85), "good");
  assert.equal(ratioVerdict(0.8501), "marginal");
  assert.equal(ratioVerdict(0.98), "marginal");
  assert.equal(ratioVerdict(0.9801), "too_tight");
  assert.equal(ratioVerdict(Number.NaN), "too_tight");
  assert.equal(ratioVerdict(Number.POSITIVE_INFINITY), "too_tight");
});

test("only the GPU path may be perfect; every other mode caps at good", () => {
  assert.equal(capForRunMode("perfect", "gpu"), "perfect");
  for (const mode of ["moe_offload", "cpu_offload", "cpu_only"] as const) {
    assert.equal(capForRunMode("perfect", mode), "good");
    assert.equal(capForRunMode("marginal", mode), "marginal");
    assert.equal(capForRunMode("too_tight", mode), "too_tight");
  }
  assert.equal(scoreFit(4, 32, "cpu_only"), "good");
  assert.equal(scoreFit(4, 0, "gpu"), "too_tight");
});

test("KV cache: 2 * layers * kv_heads * head_dim * ctx * 2 bytes", () => {
  // 2 * 32 * 8 * 128 * 8192 * 2 = 1 GiB exactly.
  assert.equal(kvCacheGb(MIXTRAL, 8192), 1);
  // Shape unknown: 0.000008 * 7 * 8192.
  const bare = spec({ num_hidden_layers: null, head_dim: null });
  assert.ok(Math.abs(kvCacheGb(bare, 8192) - 0.000008 * 7 * 8192) < 1e-12);
});

test("hybrid layout scales the full-attention layer count to the real depth", () => {
  // 16 full + 48 linear is a 64-layer template. On 24 layers: (24*16 + 32) / 64 = 6.5 -> 6.
  const hybrid = spec({ num_hidden_layers: 24, attention_layout: { full: 16, linear: 48 } });
  assert.equal(fullAttentionLayers(hybrid), 6);
  // Exact depth keeps the layout as given.
  assert.equal(fullAttentionLayers(spec({ num_hidden_layers: 64, attention_layout: { full: 16, linear: 48 } })), 16);
  // KV is charged on those layers only: 2 * 8 * 128 * 8192 * 2 * 6 / 2^30 = 0.1875 GB.
  assert.ok(Math.abs(kvCacheGb(hybrid, 8192) - 0.1875) < 1e-12);
  // No layout recorded: every layer counts.
  assert.equal(fullAttentionLayers(spec({ num_hidden_layers: 24 })), 24);
});

test("dense memory: weights + KV + 0.5 GB", () => {
  // 7 * 0.58 + 1.0 + 0.5 = 5.56 at 8192 tokens.
  assert.ok(Math.abs(estimateMemoryGb(spec({}), "Q4_K_M", 8192) - 5.56) < 1e-9);
});

test("Mixtral 8x7B active experts in VRAM at Q4_K_M", () => {
  // llmfit sizes memory with quant_bpp: 12.9e9 * 0.58 / 2^30 * 1.1 = 7.665 GB.
  const need = moeMemoryForQuant(MIXTRAL, "Q4_K_M");
  assert.ok(need);
  const expected = ((12.9e9 * 0.58) / GIB) * 1.1;
  assert.ok(Math.abs(need.activeVramGb - expected) < 1e-9);
  assert.ok(Math.abs(need.activeVramGb - 7.665) < 0.005);
  // Inactive experts: (46.7 - 12.9)e9 * 0.58 / 2^30 = 18.26 GB in RAM.
  assert.equal(need.offloadedRamGb.toFixed(2), "18.26");
});

test("Mixtral 8x7B is 6.6 GB only if sized with the speed table's 0.5 B/param", () => {
  // The expectation "about 6.6 GB" reproduces with quant_bytes_per_param (0.5) and the same
  // 1.1 allowance: 12.9e9 * 0.5 / 2^30 * 1.1. It is not what llmfit's memory path computes,
  // which uses quant_bpp (0.58) because Q4_K_M files carry scales and higher-precision
  // tensors. Kept as a test so the discrepancy is visible rather than silently resolved.
  const withSpeedTable = ((12.9e9 * quantBytesPerParam("Q4_K_M")) / GIB) * 1.1;
  assert.equal(withSpeedTable.toFixed(1), "6.6");
  const withMemoryTable = moeMemoryForQuant(MIXTRAL, "Q4_K_M")!.activeVramGb;
  assert.ok(withMemoryTable > withSpeedTable);
});

test("best quant retries at half the context before giving up", () => {
  const m = spec({ context_length: 8192 });
  // Q2_K at 8192: 7*0.37 + 1.0 + 0.5 = 4.09. At 4096: 2.59 + 0.5 + 0.5 = 3.59.
  const full = bestQuantForBudget(m, 4.1, 8192);
  assert.equal(full?.quant, "Q2_K");
  assert.equal(full?.halvedContext, false);
  assert.equal(full?.contextTokens, 8192);
  const retried = bestQuantForBudget(m, 3.7, 8192);
  assert.equal(retried?.quant, "Q2_K");
  assert.equal(retried?.halvedContext, true);
  assert.equal(retried?.contextTokens, 4096);
  assert.equal(bestQuantForBudget(m, 3.0, 8192), null);
});

test("dense model on a roomy GPU runs resident, perfect, at bandwidth/GB x 0.55", () => {
  const hw = { kind: "discrete", vramGb: 24, ramGb: 32, bandwidthGbps: 1000 } as const;
  const r = analyze(spec({}), hw);
  // Q8_0: 7*1.05 + 1.0 + 0.5 = 8.85 <= 24*0.98. Ratio 8.85/24 = 0.369 -> perfect.
  assert.equal(r.mode, "gpu");
  assert.equal(r.quant, "Q8_0");
  assert.equal(r.level, "perfect");
  assert.ok(Math.abs(r.memoryRequiredGb - 8.85) < 1e-9);
  // 1000 / (7 * 1.0) * 0.55 = 78.571...
  assert.ok(Math.abs(r.tokensPerSecond! - (1000 / 7) * 0.55) < 1e-9);
});

test("a model that overflows VRAM spills to RAM as CPU+GPU, capped at good", () => {
  const big = spec({ parameters_raw: 30e9, num_hidden_layers: 48 });
  const hw = { kind: "discrete", vramGb: 8, ramGb: 64, bandwidthGbps: 400 } as const;
  const r = analyze(big, hw);
  assert.equal(r.mode, "cpu_offload");
  assert.notEqual(r.level, "perfect");
  assert.ok(r.tokensPerSecond! > 0);
  // Resident would be bandwidth-limited at 400/(30*quant)*0.55; spilling must be slower.
  const resident = analyze(big, { kind: "discrete", vramGb: 80, ramGb: 64, bandwidthGbps: 400 });
  assert.equal(resident.mode, "gpu");
  assert.ok(r.tokensPerSecond! < resident.tokensPerSecond!);
});

test("MoE that does not fit VRAM offloads inactive experts to RAM", () => {
  const hw = { kind: "discrete", vramGb: 8, ramGb: 64, bandwidthGbps: 400 } as const;
  const r = analyze(MIXTRAL, hw);
  // Q4_K_M active experts 7.665 GB fit 8 GB; Q5_K_M (9.0 GB) does not.
  assert.equal(r.mode, "moe_offload");
  assert.equal(r.quant, "Q4_K_M");
  assert.equal(r.offloadedRamGb!.toFixed(2), "18.26");
  assert.equal(r.level, "marginal"); // 7.665 / 8 = 0.958
  // Speed: 12.9 * 0.5 = 6.45 GB per token; 1 / (6.45/50 + 6.45/(400*0.55)) * 0.8.
  const t = 6.45 / 50 + 6.45 / (400 * 0.55);
  assert.ok(Math.abs(r.tokensPerSecond! - (1 / t) * 0.8) < 1e-9);
});

test("MoE that fits entirely in VRAM stays on the GPU path", () => {
  // Q8_0 resident: 46.7 * 1.05 + 1.0 + 0.5 = 50.5 GB, 0.42 of 120 GB.
  const r = analyze(MIXTRAL, { kind: "discrete", vramGb: 120, ramGb: 64, bandwidthGbps: 2000 });
  assert.equal(r.mode, "gpu");
  assert.equal(r.level, "perfect");
});

test("CPU-only is never perfect and needs no bandwidth", () => {
  const r = analyze(spec({}), { kind: "cpu", ramGb: 32 });
  assert.equal(r.mode, "cpu_only");
  assert.equal(r.level, "good");
  // 70 / 7 * 1.0 (Q8_0 multiplier 0.8) * 1.1 (>= 8 cores) * 0.3
  assert.ok(Math.abs(r.tokensPerSecond! - (70 / 7) * 0.8 * 1.1 * 0.3) < 1e-9);
});

test("no bandwidth on a GPU path means no speed, not a guessed one", () => {
  const r = analyze(spec({}), { kind: "discrete", vramGb: 24, ramGb: 32 });
  assert.equal(r.level, "perfect");
  assert.equal(r.tokensPerSecond, null);
});

test("a model that fits nowhere is too tight and reports no speed", () => {
  const huge = spec({ parameters_raw: 700e9, min_ram_gb: 400, min_vram_gb: 400 });
  const r = analyze(huge, { kind: "discrete", vramGb: 24, ramGb: 32, bandwidthGbps: 1000 });
  assert.equal(r.level, "too_tight");
  assert.equal(r.tokensPerSecond, null);
});

test("unified memory has one pool and never spills", () => {
  const r = analyze(spec({ parameters_raw: 30e9 }), { kind: "unified", poolGb: 16, bandwidthGbps: 200 });
  assert.equal(r.mode, "gpu");
  assert.equal(r.memoryAvailableGb, 16);
});

test("MXFP4-native weights are sized at their own precision", () => {
  const oss = { architecture: "gpt_oss", hf_repo: "org/gpt-oss-20b" };
  assert.equal(isMxfp4Native(oss), true);
  assert.deepEqual([...quantLadderFor(oss)], ["MXFP4"]);
  assert.equal(isMxfp4Native({ ...oss, hf_repo: "org/gpt-oss-20b-bf16" }), false);
  assert.equal(isMxfp4Native({ architecture: "llama", hf_repo: "org/x" }), false);
});

test("presets carry no default and are ordered by label", () => {
  const labels = HARDWARE_PRESETS.map((p) => p.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "en")));
  assert.equal(new Set(HARDWARE_PRESETS.map((p) => p.id)).size, HARDWARE_PRESETS.length);
  for (const p of HARDWARE_PRESETS) {
    assert.ok(p.memoryGb > 0 && p.bandwidthGbps > 0);
    assert.equal("default" in p, false);
  }
});
