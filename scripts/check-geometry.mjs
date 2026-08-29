#!/usr/bin/env node
/**
 * Concentric-radius guard.
 *
 * Apple defines the radius of a nested element as `outer radius - inset`. This repo's
 * radius scale is built on that rule as a strict arithmetic progression, step 4:
 * overlay -> surface -> control -> inner, each one `inset` smaller than the last. Nobody
 * can eyeball whether four hand-tuned pixel values still form that progression after an
 * edit, so it is checked the same way contrast is: parsed out of app/globals.css and
 * failed in CI if the arithmetic breaks.
 *
 * Node stdlib only, mirroring scripts/check-contrast.mjs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

function pxToken(name) {
  const match = css.match(new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px\\s*;`));
  return match ? Number(match[1]) : null;
}

/** Outer to inner: each step must be exactly `inset` smaller than the one before it. */
const STEPS = [
  { token: "--radius-overlay", label: "overlay" },
  { token: "--radius-surface", label: "surface" },
  { token: "--radius-control", label: "control" },
  { token: "--radius-inner", label: "inner" },
];

const inset = pxToken("--inset-nested");
const values = STEPS.map((step) => ({ ...step, value: pxToken(step.token) }));

let failures = 0;
const report = [];

if (inset === null) {
  report.push(`  FAIL  --inset-nested is missing or not a plain px value`);
  failures += 1;
}

for (const { token, value } of values) {
  if (value === null) {
    report.push(`  FAIL  ${token} is missing or not a plain px value`);
    failures += 1;
  }
}

if (failures === 0) {
  // Strict descent: overlay > surface > control > inner.
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i];
    const b = values[i + 1];
    const ok = a.value > b.value;
    if (!ok) failures += 1;
    report.push(
      `  ${ok ? "ok  " : "FAIL"}  ${a.token} (${a.value}px) > ${b.token} (${b.value}px) ${ok ? "" : "<- radii must strictly decrease outer to inner"}`,
    );
  }

  // Arithmetic: each step is exactly one inset smaller than the last.
  for (let i = 0; i < values.length - 1; i++) {
    const outer = values[i];
    const inner = values[i + 1];
    const expected = outer.value - inset;
    const ok = inner.value === expected;
    if (!ok) failures += 1;
    report.push(
      `  ${ok ? "ok  " : "FAIL"}  ${outer.token} - --inset-nested (${inset}px) = ${expected}px, ${inner.token} is ${inner.value}px ${ok ? "" : "<- progression broken"}`,
    );
  }
}

console.log("Concentric radius check\n");
console.log(report.join("\n"));

if (failures > 0) {
  console.error(`\n${failures} step(s) break the progression.`);
  process.exit(1);
}
console.log("\nProgression intact: overlay > surface > control > inner, step " + inset + "px.");
