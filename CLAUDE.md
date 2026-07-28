# ModelHub

Independent, open-source aggregator of frontier AI model rankings. Built for ESCOM-IPN
students and the wider Spanish-speaking community. Tagline: *the independent frontier model
scoreboard*.

Core thesis: **radical transparency and anti-bias enforced in code, not in promises.**

## Hard constraints (R1-R8)

| # | Constraint |
|---|---|
| R1 | Operating cost is $0. No paid APIs, no services that bill, no free tiers needing a card. |
| R2 | All LLM work runs locally via Ollama. Zero calls to hosted model APIs. |
| R3 | Data is versioned in the repo. Text files are the source of truth; git history is the time series. No external database. |
| R4 | Bilingual ES/EN from day one, in the architecture rather than patched on. |
| R5 | Open source, MIT, public repo. |
| R6 | No user auth in v1. |
| R7 | Professional design. Explicitly not the generic "AI startup" look. |
| R8 | No daily human maintenance. Daily ingest runs in GitHub Actions. |

If a decision conflicts with R1-R8, stop and ask rather than trading a constraint for
convenience.

## Two-layer architecture

**Layer A — deterministic ingest (cloud, daily, no LLM).** Python in GitHub Actions on a cron.
Pulls structured data from confirmed sources, normalises, computes the composite, writes JSON
to `/data`, commits. The push triggers a Vercel redeploy, so the site stays current without
anyone's machine being on.

**Layer B — local enrichment (Ollama, on demand).** Runs on the user's machine via a command,
not on a schedule. Writes editorial ES/EN descriptions, acquisition links, and drafts for new
models. Human reviews the diff and approves.

> Golden rule: if a value can be obtained deterministically, the LLM does not touch it. The LLM
> writes prose and helps with ambiguous name matching. **Numbers never come from an LLM.**

**Frontend.** Next.js 15 App Router + TypeScript, reading `/data` JSON at build time. Deployed
on Vercel.

## Stack

Next.js 15.5 · React 19 · TypeScript 5.9 · Tailwind v4 · next-intl 4 · Python 3 stdlib only.

Python deliberately has no dependencies: the ingest must run on a free runner with nothing to
maintain.

## Layout

```
/app/[locale]      routes (es | en)
/components        UI
/lib               types.ts (no Node imports, safe for client) + data.ts (server-only reader)
/messages          en.json, es.json
/data              models, scores, benchmarks, providers, aliases, history.jsonl
/config            weights.json, sources.json
/scripts/ingest    run.py (orchestrator) · sources/ · composite.py · common.py
/.github/workflows ingest.yml (daily cron) · ci.yml
```

The ingest caches each source's normalised payload in `data/cache/`. A source that fails is
served from its cache, reported in `data/status.json`, and surfaced on the page as degraded —
the run never dies because one site is down.

`lib/types.ts` must stay free of Node imports. Client components import types from there;
importing from `lib/data.ts` drags `node:fs` into the browser bundle and breaks the build.

## Commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run ingest     # rebuild /data from live sources (python -m scripts.ingest.run)
npm run enrich     # Layer B: local Ollama descriptions + acquisition links
npm run onboard    # Layer B: draft entries for trending models we don't track
```

Layer B never runs in CI and never commits. It writes `data/i18n/descriptions.json`,
`data/acquisition.json` and `data/onboarding.json`, then stops for a human to read the diff.

Observed timings on the primary model, `qwen3-coder:30b`: ~57s per model. With `--fast`
(`qwen3:8b`): ~6.5s per model once loaded, so a full 53-model pass is roughly 6 minutes
against roughly 50 on the 30b. Use `--fast` for iteration, the 30b for a real pass.

Run lint, typecheck and build before calling any phase done.

Never run `npm run build` while `npm run dev` is running: they share `.next` and the dev
server ends up serving missing-module errors until the directory is cleared.

## Anti-bias rules

1. Every score carries `source_type`: `human_eval`, `third_party_benchmark`, or `vendor_claim`.
   **Only the first two feed the composite.** `vendor_claim` is never scored.
2. `vendor_claim` values render greyed out and labelled as unverified.
3. Delta flag: when vendor and third party measure the same benchmark and
   `|vendor - third_party| / third_party > 0.10`, show the gap.
4. `contamination_flag` marks benchmarks with training-contamination evidence.
5. `measured_at` is visible per score. No number without a date.
6. Methodology is public at `/methodology`; weights live in `config/weights.json` and are
   debatable by PR.
7. Every daily change is an auditable commit.

### How to change anything that moves a number

Any fix that alters published values must be **measured against the previous clean state**,
not argued as plausible. State the metric, the before, and the after.

The pattern that set this norm: four LMArena snapshots were being rejected as duplicated. The
candidate fix was validated by measuring rating drift against the last clean snapshot —
0.80 points for the chosen rule versus 11.94 for the alternatives, with 100 of 374 models
moving more than 10 points under the wrong one. That is what "verified" means here.

Report the weaknesses of your own fix with numbers before anyone asks. "This policy only
finds a plain variant in 7 of 56 cases" is worth more than a paragraph of reasoning.

### Rules earned the hard way

- **LMArena duplication guard is non-negotiable.** Recent snapshots have shipped ~3 rows per
  model with repeated ranks. Any snapshot where `rows / distinct_models > 1.2` is rejected in
  favour of the last clean one. Without this the home page shows three different "rank 1"
  models. Verified on the 2026-07-20 and 2026-07-21 snapshots.
- **SWE-bench never contributes a bare-model score.** Its rows describe agent scaffolds
  (`live-SWE-agent + Claude 4.5 Opus`), and the scaffold often matters more than the model.
  Epoch's `swe_bench_verified.csv` is what carries the Coding weight. If scaffold results are
  ever displayed, the scaffold stays visible.
- **swebench.com data is CC-BY-NC-4.0 and this repo is MIT.** Permanently excluded (decided
  2026-07-27). The site links out to swebench.com so the scaffold leaderboard stays reachable
  without ingesting a byte of it.
- **Multimodal is out of the composite** and shown as a separate vision score, so text-only
  models are never ranked against a category they don't compete in.
- **Collapse benchmark variants before scoring, under `variant_policy`.** Vendor variants of
  one model normalise to the same canonical key, so a benchmark can arrive several times.
  Counting each copy gives that benchmark extra weight in its category purely because the
  vendor shipped more variants — it changed the top three when found. Which variant wins is a
  methodology choice living in `config/weights.json`, documented on `/methodology`, and
  disclosed per score in the model page's sources table.
- **LMArena publishes mislabelled slices, not duplicates.** From 2026-06-10 snapshots carry
  up to six rows per model under `category='overall'`. No column labels them; the genuine row
  is the one with the highest `vote_count`. Verified 2026-07-28: picking max vote_count gives
  0.80 mean rating drift against the last clean snapshot, versus 11.94 for first-row or
  max-rating. Filter, don't reject — the ratio guard stays only as a backstop.
- **Snapshot age is tracked separately from fetch success.** A source can fetch perfectly and
  still serve month-old numbers. `data/status.json` carries per-source snapshot age; the page
  warns at 7 days and marks degraded at 14, both in a banner and on the affected category
  column.
- **Measure duplication on raw rows, never deduplicated ones.** Deduplicating on
  (model, benchmark, date) first makes the ratio structurally 1.0, so the guard silently
  stops working. Rejected snapshot dates are also excluded from history explicitly.
- **A description asserts only what is in `/data`.** That is: what the model is, how it is
  obtained, and how its own measured categories compare. Use cases are deliberately absent
  from `/data`, so a description never states what a model is "for" — asking the model for
  that produced filler like "for use in various applications" on the first pass. Students
  get the real answer from the composite and from Compare, not from an editorial sentence.
  Corollaries enforced in the prompt and the validator: one idea per sentence and no
  sentence over 20 words; the real category, never "an artificial intelligence model";
  category names copied verbatim from `messages/*.json` so they don't drift per model;
  "open weights" is never rendered as "código abierto", which claims a software licence we
  are not asserting; and the strong/weak comparison is relative to the model's own
  categories, never a verdict like "deja mucho que desear".
- **Below 4 of 5 measured categories, a description passes no comparative judgement.** A
  provisional model gets a plain statement of which categories were measured and which were
  not. With two measurements, "better at X than Y" only says one number is larger than the
  other, and asserting it overstates what is known — the same over-claiming the coverage
  gate exists to prevent.
- **One standard, enforced in one place: `scripts/enrich/checks.py`.** The generator and
  `scripts/enrich/audit.py` call the same function, and CI runs the audit over the committed
  file. This exists because a lenient generator once passed a full pass that a stricter
  post-hoc audit found 55 defects in. A check that only runs during the post-mortem is not
  a check. Never add a rule to one side only.
- **Layer B writes prose and nothing else.** URLs are built deterministically and then
  verified over HTTP; anything that does not resolve is withheld from the UI rather than
  shown with a caveat. The model never produces a URL, a number or a score.
- **A rejected generation is a gap, never a partial write.** Output is validated for length,
  banned marketing vocabulary and numeric claims; failing twice skips the model and leaves
  the entry absent. Entries carrying `"manual": true` are never overwritten, including under
  `--force`.
- **Charts carry identity by position and label, not by hue.** A multi-hue categorical
  palette fails chroma and lightness checks inside the single-accent brief; `--mark` is the
  validated accent per theme.

## Composite

Reasoning 25 · Coding 25 · Math 20 · Human preference 15 · Instruction-following 15.

Benchmarks on a percent scale are used as-is. LMArena's Bradley-Terry ratings are min-max
normalised across the cohort in each build. Models missing a category are scored on available
weight and flagged partial — never zero-filled. Coverage is shown in the table as a five
segment meter beside the score.

**Coverage gate: a model needs 4 of 5 categories to enter the main ranking.** Below that it
goes to a provisional section — visible, but never assigned a rank. Renormalising over
available weight otherwise lets a thinly measured model rank high on what it is *missing*
rather than on being better, which is the bias this project exists to fight. The bar sits at 4
rather than 5 on purpose: a new model with all four benchmarks but no Arena votes yet still
ranks, flagged `awaiting_human_votes`. Evidence is required; novelty is not punished. The
threshold lives in `config/weights.json` and is debatable by PR.

## Commit convention

Conventional Commits, English, atomic. The author is the human.

**Never reference AI, Claude, "generated with", or "co-authored-by" in commit messages, code,
or comments.** This is not negotiable.

## Phase status

- [x] **Phase 0** — source research. `SOURCES.md` + `config/sources.json`.
- [x] **Phase 1** — static MVP: scaffolding, i18n, real seed data from 3 sources, home ranking.
- [x] **Phase 2** — automated ingest (Layer A) + GitHub Actions cron.
- [x] **Phase 3** — Compare + Model detail + `/methodology`.
- [x] **Phase 4** — Layer B: Ollama enrichment, ES/EN descriptions, acquisition links.
- [ ] **Phase 5** — community hardening, a11y, performance.

Update this section when a phase closes.
