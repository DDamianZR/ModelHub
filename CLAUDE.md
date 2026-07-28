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
/scripts/seed      build_seed.py (becomes /scripts/ingest in Phase 2)
```

`lib/types.ts` must stay free of Node imports. Client components import types from there;
importing from `lib/data.ts` drags `node:fs` into the browser bundle and breaks the build.

## Commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run seed       # rebuild /data from live sources
```

Run lint, typecheck and build before calling any phase done.

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
- [ ] **Phase 2** — automated ingest (Layer A) + GitHub Actions cron.
- [ ] **Phase 3** — Compare + Model detail + `/methodology`.
- [ ] **Phase 4** — Layer B: Ollama enrichment, ES/EN descriptions, acquisition links.
- [ ] **Phase 5** — community hardening, a11y, performance.

Update this section when a phase closes.
