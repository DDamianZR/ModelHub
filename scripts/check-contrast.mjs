#!/usr/bin/env node
/**
 * Token contrast guard.
 *
 * `--line-default` and above must measure >= 3:1 against every surface they can sit on
 * (WCAG 2.2 SC 1.4.11, non-text contrast). `--line-subtle` is decorative and exempt, and
 * is therefore never permitted as the boundary of an interactive control.
 *
 * This runs in CI for the same reason `scripts/enrich/checks.py` does: a check that only
 * runs during the post-mortem is not a check. Values are parsed out of app/globals.css so
 * the stylesheet stays the single source of truth — no second copy of the palette here.
 *
 * Node stdlib only, mirroring the Python-stdlib-only discipline on the ingest side.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

/** Pull the `:root` block and the `prefers-color-scheme: dark` block separately. */
function extractTokens(source) {
  const light = {};
  const dark = {};

  const darkStart = source.indexOf("@media (prefers-color-scheme: dark)");
  const lightPart = darkStart === -1 ? source : source.slice(0, darkStart);
  const darkPart = darkStart === -1 ? "" : source.slice(darkStart);

  const pattern = /(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const [, name, value] of lightPart.matchAll(pattern)) light[name] = value;
  for (const [, name, value] of darkPart.matchAll(pattern)) dark[name] = value;

  // Dark inherits anything it does not override.
  return { light, dark: { ...light, ...dark } };
}

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every surface a control boundary can legally sit on. */
const SURFACES = [
  "--surface-canvas",
  "--surface-default",
  "--surface-sunk",
  "--surface-raised",
  "--surface-overlay",
];

/** Boundary tokens that must carry contrast, and the floor each must clear. */
const RULES = [
  { token: "--line-default", min: 3, why: "interactive control boundary (SC 1.4.11)" },
  { token: "--line-strong", min: 3, why: "emphasised boundary" },
  { token: "--accent", min: 3, why: "selected-control boundary and focus ring" },
];

/** Text tokens: 4.5:1 for body, 3:1 for large. Tertiary is used at 11-12px, so 4.5. */
const TEXT_RULES = [
  { token: "--text-primary", min: 4.5 },
  { token: "--text-tertiary", min: 4.5 },
];

/** Hover plane must be perceptible against canvas without becoming a block of colour. */
const HOVER_MIN = 1.25;

let failures = 0;
const report = [];

for (const [theme, tokens] of Object.entries(extractTokens(css))) {
  for (const { token, min, why } of [...RULES, ...TEXT_RULES.map((r) => ({ ...r, why: "text" }))]) {
    const value = tokens[token];
    if (!value) {
      report.push(`  MISSING  ${theme}  ${token}`);
      failures += 1;
      continue;
    }
    for (const surface of SURFACES) {
      const bg = tokens[surface];
      if (!bg) continue;
      const r = ratio(value, bg);
      const ok = r >= min;
      if (!ok) failures += 1;
      report.push(
        `  ${ok ? "ok  " : "FAIL"}  ${theme.padEnd(5)}  ${token.padEnd(18)} on ${surface.padEnd(18)} ${r.toFixed(2)}:1  (min ${min}) ${ok ? "" : "<- " + why}`,
      );
    }
  }

  const raised = ratio(tokens["--surface-raised"], tokens["--surface-canvas"]);
  const okHover = raised >= HOVER_MIN;
  if (!okHover) failures += 1;
  report.push(
    `  ${okHover ? "ok  " : "FAIL"}  ${theme.padEnd(5)}  --surface-raised   on --surface-canvas   ${raised.toFixed(2)}:1  (min ${HOVER_MIN}) ${okHover ? "" : "<- hover must be perceptible"}`,
  );
}

console.log("Token contrast check\n");
console.log(report.join("\n"));

if (failures > 0) {
  console.error(`\n${failures} pairing(s) below the floor.`);
  process.exit(1);
}
console.log("\nAll pairings clear their floor.");
