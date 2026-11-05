/**
 * parseLlmfitImport against the shape `llmfit recommend --json` printed on 2026-11-05
 * (llmfit 1.1.16), trimmed to the fields that matter, plus the ways a paste goes wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_IMPORT_CHARS, parseLlmfitImport } from "../lib/llmfit-import.ts";

const SAMPLE = {
  system: {
    available_ram_gb: 57.6,
    backend: "CUDA",
    cpu_cores: 8,
    gpu_name: "Example GPU",
    gpu_vram_gb: 8.0,
    gpus: [{ memory_bandwidth_gbps: null, name: "Example GPU", unified_memory: false, vram_gb: 8.0 }],
    has_gpu: true,
    total_ram_gb: 64.0,
    unified_memory: false,
  },
  models: [
    { name: "org/Model-7B", fit_level: "Perfect", run_mode: "GPU", best_quant: "Q8_0", memory_required_gb: 8.85, estimated_tps: 38.1 },
    { name: "org/Big-MoE", fit_level: "Good", run_mode: "MoE", best_quant: "Q4_K_M", memory_required_gb: 3.2, estimated_tps: null },
    { name: "org/Spill-30B", fit_level: "Marginal", run_mode: "CPU+GPU", best_quant: "Q4_K_M", memory_required_gb: 20, estimated_tps: 4 },
  ],
};

test("reads the hardware block", () => {
  const out = parseLlmfitImport(JSON.stringify(SAMPLE));
  assert.ok(!("error" in out));
  assert.deepEqual(out.hardware, {
    gpuName: "Example GPU",
    hasGpu: true,
    unified: false,
    gpuMemoryGb: 8,
    totalRamGb: 64,
    gpuBandwidthGbps: null, // llmfit printed null: unknown stays unknown
    cpuCores: 8,
  });
});

test("maps llmfit's labels onto ours and keeps unknown numbers null", () => {
  const out = parseLlmfitImport(JSON.stringify(SAMPLE));
  assert.ok(!("error" in out));
  assert.deepEqual(out.verdicts.get("org/Model-7B"), {
    level: "perfect", mode: "gpu", quant: "Q8_0", memoryRequiredGb: 8.85, tokensPerSecond: 38.1,
  });
  assert.equal(out.verdicts.get("org/Big-MoE")?.mode, "moe_offload");
  assert.equal(out.verdicts.get("org/Big-MoE")?.tokensPerSecond, null);
  assert.equal(out.verdicts.get("org/Spill-30B")?.mode, "cpu_offload");
  assert.equal(out.verdicts.get("org/Spill-30B")?.level, "marginal");
});

test("a machine with no GPU reports no GPU memory even if a number is present", () => {
  const out = parseLlmfitImport(JSON.stringify({ ...SAMPLE, system: { ...SAMPLE.system, has_gpu: false, gpu_vram_gb: 12 } }));
  assert.ok(!("error" in out));
  assert.equal(out.hardware.gpuMemoryGb, null);
});

test("rejects what is not llmfit output, without throwing", () => {
  assert.deepEqual(parseLlmfitImport("   "), { error: "empty" });
  assert.deepEqual(parseLlmfitImport("{not json"), { error: "invalid_json" });
  assert.deepEqual(parseLlmfitImport("[1,2,3]"), { error: "not_llmfit" });
  assert.deepEqual(parseLlmfitImport(JSON.stringify({ models: [] })), { error: "not_llmfit" });
  assert.deepEqual(parseLlmfitImport("x".repeat(MAX_IMPORT_CHARS + 1)), { error: "too_large" });
});

test("hostile or malformed fields are dropped rather than trusted", () => {
  const out = parseLlmfitImport(
    JSON.stringify({
      system: { has_gpu: true, gpu_vram_gb: -4, total_ram_gb: "64", cpu_cores: 1e9, gpu_name: "x".repeat(500), gpus: "nope" },
      models: [null, 7, { name: 42 }, { name: "org/ok", fit_level: "Excellent", run_mode: "TPU", memory_required_gb: Infinity }],
    }),
  );
  assert.ok(!("error" in out));
  assert.equal(out.hardware.gpuMemoryGb, null);
  assert.equal(out.hardware.totalRamGb, null);
  assert.equal(out.hardware.cpuCores, null);
  assert.equal(out.hardware.gpuName, null);
  assert.deepEqual(out.verdicts.get("org/ok"), { level: null, mode: null, quant: null, memoryRequiredGb: null, tokensPerSecond: null });
  assert.equal(out.verdicts.size, 1);
});
