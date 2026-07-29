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
/data/baseline     frozen models.json snapshots to measure a change against
/config            weights.json, sources.json
/scripts/ingest    run.py (orchestrator) · sources/ · composite.py · common.py
/scripts/analysis  measurement tools, run by hand, never part of the ingest
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
npm test           # node:test over lib/*.test.ts, via type stripping (needs Node >= 22.18)
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

The instrument for that measurement is `scripts/analysis/compare_rankings.py`, which diffs
two `models.json` snapshots and reports mean and max displacement, order changes, and top-10
entries and exits. `data/baseline/` holds frozen snapshots to measure against.

```bash
python -m scripts.analysis.compare_rankings data/baseline/2026-07-28-models.json data/models.json
```

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
- **The duplication ratio is counted per (date, benchmark), not per (date, model).** While
  history held only Arena ratings the two were the same measurement. With sixteen series per
  model, a per-model count reads a normal day as sixteen-fold duplication and rejects every
  date. Per benchmark the original invariant is unchanged: one model, one reading, one date.
  `scripts/tests/test_merge_history.py` pins both halves — a tripled snapshot is still
  rejected, and a model carrying ten benchmarks plus five categories plus the composite on
  one date is not. A guard that stops firing looks exactly like a guard with nothing to
  catch, which is why the rejection cases are tested and not just the acceptance ones.
- **History stores measurements, not runs.** A benchmark row is dated by its `measured_at`,
  so re-running the ingest re-emits identical rows that deduplicate away and the file grows
  only when upstream actually re-measures. A score with no `measured_at` is skipped rather
  than dated by the run: inventing a date is the one thing worse than a gap. Category and
  composite rows are dated by the run because they are that build's computation, and they
  carry `methodology_version` so a stored series can never be read under a formula that did
  not produce it.
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
- **A description is a derivative, and carries the methodology version that produced it.**
  It says which of a model's categories are relatively stronger, so it is only true under
  the formula that ordered them. Normalising reordered them and 39 of the 40 descriptions
  carrying a comparison began contradicting the bar chart directly above them. The site
  withholds any description whose version does not match the build; `scripts/enrich/audit.py`
  counts them and names the command to regenerate, but does not fail, because stale is the
  correct state immediately after a version bump. R14 applies to sentences, not just floats.
- **A rejected generation is a gap, never a partial write.** Output is validated for length,
  banned marketing vocabulary and numeric claims; failing twice skips the model and leaves
  the entry absent. Entries carrying `"manual": true` are never overwritten, including under
  `--force`.
- **Charts carry identity by position and label, not by hue.** A multi-hue categorical
  palette fails chroma and lightness checks inside the single-accent brief; `--mark` is the
  validated accent per theme.
- **The normalisation reference is frozen, and a benchmark missing from it stops the run.**
  A benchmark is either scored, or listed in `excluded` with a reason. Absent from both means
  nobody has decided what distribution it is measured against, and inventing a scale there is
  exactly the silent judgement the file exists to remove — so `normalize.py` raises instead
  of guessing, before anything is written to `/data`.
- **Composite values are not comparable across methodology versions.** Normalisation
  recentres the whole scale on 50, so the mean composite fell from 64.5 to 48.1 between 1.0
  and 1.1 without any model getting worse. Only the ordering carries across a version bump,
  which is why every stored row and every build records the version that produced it.
- **Matching a model name to a HuggingFace repository is string search, and string search is
  confidently wrong.** DeepSeek-V4-Pro, at 1.6 trillion parameters, matched a 0.1B
  distillation's GGUF repository; GLM-4.6 matched GLM-4.6V-Flash. Both would have published
  that a frontier model fits in 6 GB. Every file size is checked against the safetensors
  parameter count, and a repository whose sizes cannot belong to the model is rejected whole
  rather than per file — it is the wrong repository, not a repository with one bad file.
- **MoE memory is total parameters, never active ones.** A 30B-A3B holds all 30B resident
  while computing with 3B per token; sizing it on the active count gives ~2 GB instead of
  ~18.6, and would recommend models that do not start. The easiest mistake here to
  reintroduce, so it is commented in `lib/vram.ts` rather than left implicit.
- **The local view plots `arena_rating`, never `score`.** Rows carry either a five-category
  composite (0-100) or an Arena rating (past 1400). Plotting whichever a row happens to have
  would order models by the kind of score they carry. Every row carries `arena_rating` for
  the axis; `score` states the claim and its kind per row.
- **Ollama's registry is excluded on its terms, not on capability.** It answers 200
  anonymously and reports exact layer sizes, but its terms prohibit automated access without
  permission — the same standard already applied to Artificial Analysis. HuggingFace GGUF
  repositories give the same measurement under permissive terms and agree to 0.35%. Showing
  a copyable `ollama pull` command is not automated access.
- **z-score rather than percentile, on measurement.** Both order models almost identically
  (Spearman 0.9965), so the choice costs no information either way. Percentile saturates
  where the interesting comparison lives: 23 category scores land above 95 or below 5 against
  0 under z, because the normal CDF is flat at the extremes. Verified 2026-07-29.

## Composite

Reasoning 25 · Coding 25 · Math 20 · Human preference 15 · Instruction-following 15.

Every benchmark is normalised against a frozen reference before its category average is
taken: `normalized = 50 + 12.5 × (raw − mean) / sd`, clipped to [0, 100]. 50 is the
reference-average model on that benchmark; 12.5 points is one standard deviation. LMArena is
no longer a special case. The reference lives in `config/benchmark_reference.json` and is
regenerated by `scripts/analysis/build_reference.py`.

The site keeps showing the raw number everywhere; only the composite uses the normalised one,
and each cell carries its own mean, sd and z so the conversion can be checked in place.

Models missing a category are scored on available weight and flagged partial — never
zero-filled. Coverage is shown in the table as a five segment meter beside the score, and the
model page shows how many benchmarks stand behind each category, because the mean of one is
noisier than the mean of three.

**Coverage gate: a model needs 4 of 5 categories to enter the main ranking.** Below that it
goes to a provisional section — visible, but never assigned a rank. Renormalising over
available weight otherwise lets a thinly measured model rank high on what it is *missing*
rather than on being better, which is the bias this project exists to fight. The bar sits at 4
rather than 5 on purpose: a new model with all four benchmarks but no Arena votes yet still
ranks, flagged `awaiting_human_votes`. Evidence is required; novelty is not punished. The
threshold lives in `config/weights.json` and is debatable by PR.

## Decisions taken for the normalisation rework

Settled 2026-07-28, each against a measurement rather than an argument. Reopening one means
redoing its measurement, not restating the reasoning.

- **A benchmark needs n ≥ 15 measurements to serve as a normalisation reference.** The
  standard error of a standard deviation is `sd/sqrt(2(n-1))`: 35% at n=5, 17% at n=18, 12%
  at n=34. Below the bar the reference would be noise, and every future model would be
  graded against that noise. This excludes `math_level_5` (n=5, sd 1.1, every model between
  94.9 and 98.1 — it does not discriminate either). The stricter n ≥ 20 was rejected on
  measurement: it also excludes `swe_bench_verified` (n=18), and 12 of the 18 models
  measured on it have no other coding benchmark, so 11 models fall to provisional and one
  leaves the site entirely.
- **Weights are multipliers, not shares of influence, and the gap is published rather than
  engineered away.** Normalising per benchmark narrows it but cannot close it: the driver is
  that `human_preference` is one benchmark per model while `reasoning` averages up to three,
  and averaging k correlated benchmarks shrinks a category's variance while k=1 shrinks
  nothing. Normalising the category score to a fixed sd would make nominal ≈ effective by
  construction, but it fabricates discrimination — `instruction_following` (sd 5.6, models
  that genuinely are alike) would be amplified until it looked as decisive as `math`
  (sd 11.7). The real gap goes in `data/weight_audit.json` and onto `/methodology`.
- **The local view needs a second registry path, because Epoch's registry is a frontier
  registry.** Measured over LMArena's non-proprietary rows: of the candidates that plausibly
  fit 8 GB, 0 of 43 have an Epoch registry entry; at 12 GB, 0 of 18; at 24 GB, 4 of 29.
  Restricting the view to models already in the registry does not make it thin, it makes it
  empty below 24 GB. Arena-only rows are labelled as such per row and never called a
  composite.
- **Tests run on `node:test`, not a new framework.** Zero new dependencies, consistent with
  the stdlib-only discipline the Python side already keeps.

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

The v3 improvement plan runs alongside these and has its own numbering. Closed so far:
canonical identity, the full time series, per-benchmark normalisation (methodology 1.1), and
`/local`.

Update this section when a phase closes.
