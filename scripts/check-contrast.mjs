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
 *
 * Hardened for the card-based palette (2026-08-29):
 *  - `--accent` floor raised 3.0 -> 4.5. It renders as 11px eyebrow text
 *    (`.eyebrow.text-accent`), not just a border, and the old 3.0 floor let an
 *    illegible accent pass CI — a real gap in the previous guard. Shipped:
 *    5.07:1 light, 5.31:1 dark.
 *  - `--attention` added to the text rules at 4.5, same reasoning as --accent
 *    (it paints banner labels). Shipped: 4.95:1 light, 6.21:1 dark.
 *  - `--mark` added to the border rules at 3.0. It paints CategoryBars and was
 *    previously unchecked entirely.
 *  - Hover-plane criterion changed. Before: `ratio(raised, canvas) >= 1.25`.
 *    In a card layout the row sits on the card, not the canvas — and with
 *    canvas/card themselves at 1.12:1 (light), no third plane can be 1.25:1
 *    from both at once, so the old comparison isn't just stricter, it is
 *    unsatisfiable here. After: `ratio(raised, default) >= 1.25` AND
 *    `ratio(default, canvas) >= 1.08`. Shipped: 1.26/1.12 light, 1.33/1.23 dark.
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
  { token: "--accent", min: 4.5, why: "selected-control boundary, focus ring, and 11px eyebrow text" },
  { token: "--mark", min: 3, why: "chart/data mark identity" },
];

/** Text tokens: 4.5:1 for body, 3:1 for large. Tertiary is used at 11-12px, so 4.5. */
const TEXT_RULES = [
  { token: "--text-primary", min: 4.5 },
  { token: "--text-tertiary", min: 4.5 },
  { token: "--attention", min: 4.5 },
];

/** Hover plane must be perceptible against the card it sits on, and the card itself
 *  must read as its own plane against the canvas. Two relations, not one: see the
 *  header comment for why a single raised-vs-canvas check stopped being satisfiable. */
const HOVER_MIN = 1.25;
const ELEVATION_MIN = 1.08;

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

  const hover = ratio(tokens["--surface-raised"], tokens["--surface-default"]);
  const okHover = hover >= HOVER_MIN;
  if (!okHover) failures += 1;
  report.push(
    `  ${okHover ? "ok  " : "FAIL"}  ${theme.padEnd(5)}  --surface-raised   on --surface-default  ${hover.toFixed(2)}:1  (min ${HOVER_MIN}) ${okHover ? "" : "<- hover must be perceptible on the card"}`,
  );

  const elevation = ratio(tokens["--surface-default"], tokens["--surface-canvas"]);
  const okElevation = elevation >= ELEVATION_MIN;
  if (!okElevation) failures += 1;
  report.push(
    `  ${okElevation ? "ok  " : "FAIL"}  ${theme.padEnd(5)}  --surface-default  on --surface-canvas   ${elevation.toFixed(2)}:1  (min ${ELEVATION_MIN}) ${okElevation ? "" : "<- card must read as its own plane"}`,
  );
}

console.log("Token contrast check\n");
console.log(report.join("\n"));

if (failures > 0) {
  console.error(`\n${failures} pairing(s) below the floor.`);
  process.exit(1);
}
console.log("\nAll pairings clear their floor.");
