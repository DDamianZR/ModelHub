# Data Sources

Status of every candidate source, verified on **2026-07-27** by issuing real HTTP requests
against each endpoint. Nothing here is taken from documentation or memory: if a claim could
not be checked against a live response, it is marked `unverified`.

Machine-readable version: [`config/sources.json`](config/sources.json).

## Summary

| Source | Status | Freshness | v1 | Access | License |
|---|---|---|---|---|---|
| Epoch AI — Benchmarking Hub | active | fresh (today) | **include** | ZIP download, no auth | CC-BY-4.0 |
| LMArena — Leaderboard Dataset | active | fresh (2026-07-21) | **include** | HF dataset + REST, no auth | CC-BY-4.0 |
| LiveBench | active | fresh (2026-06-25) | **include** | static CSV/JSON, no auth | Apache-2.0 |
| SWE-bench | active | stale (2026-02-26) | **blocked** | static JSON on GitHub | **CC-BY-NC-4.0** |
| HuggingFace Hub API | active | live | **include** (discovery only) | public API, no auth | n/a |
| Scale Labs (ex-SEAL) | active | fresh | defer | HTML scrape only | unverified |
| Open LLM Leaderboard v2 | archived | frozen (2025-03-20) | exclude | — | — |
| Aider Polyglot | active | frozen (2025-10-03) | exclude | — | Apache-2.0 |
| Artificial Analysis | active | fresh | exclude | — | unverified |

---

## Included in v1

### Epoch AI — AI Benchmarking Hub — *backbone*

`https://epoch.ai/data/benchmark_data.zip` — 0.39 MB, no auth, no rate limit observed,
**last updated the same day it was checked**.

The single most valuable source found. A 75-file CSV bundle where files *without* an
`_external` suffix are evaluations Epoch runs itself and publishes inspect logs for, and files
*with* it are aggregated from elsewhere and carry `Source` / `Source link` columns so the
provenance can be passed straight through to our `source_url`.

Per-benchmark columns: `Model version, mean_score, Best score (across scorers), Release date,
Organization, Country, Training compute (FLOP), stderr, Log viewer, Logs, Started at, id`.

Two columns are worth more than they look:

- **`Model accessibility`** (in `epoch_capabilities_index.csv`) resolves to `API access` /
  `Open weights` / `Open weights (non-commercial)`. This is the cleanest open-vs-closed signal
  in any source, and it means the `is_open_weights` flag does not have to be hand-maintained.
- **`Country`** gives the China-vs-US framing the project wants for free, sourced rather than
  asserted by us.

Licensed CC-BY-4.0 with attribution required (`README.md` inside the ZIP). `stderr` and public
eval logs per row mean scores arrive with uncertainty and a reproducibility trail attached.

> One trap: `epoch_capabilities_index.csv` is Epoch's own composite (ECI). It must **not** feed
> our composite — its constituent benchmarks are already in our inputs, so including it would
> double-count them. Keep it as an external cross-check only.

### LMArena — Leaderboard Dataset — *backbone, `human_eval`*

HuggingFace dataset `lmarena-ai/leaderboard-dataset`, CC-BY-4.0, parquet, readable anonymously
as JSON through the HF datasets-server REST API (`/rows`, `/filter`) — no Python `datasets`
dependency required for a smoke test.

Columns: `model_name, organization, license, rating, rating_lower, rating_upper, variance,
vote_count, rank, category, leaderboard_publish_date`. Twenty configs (`text`,
`text_style_control`, `vision`, `search`, `document`, `webdev`, `agent` + per-signal subsets,
image/video). Two splits: `full` (every historical snapshot) and `latest`.

**Ingest the `full` split, not `latest`.** `full` hands us the complete time series that
`history.jsonl` and the sparklines need — a single model was observed with 61 dated points —
and it sidesteps the anomaly below.

> ⚠️ **Verified anomaly.** The newest snapshot (2026-07-21) returns **1113 rows for
> `category='overall'` across only 378 distinct models** — roughly 3× duplication, with
> `rank=1` appearing three separate times and divergent ratings for the same model on the same
> date. The 2026-06-04 snapshot is clean at 365 rows. Ingest must deduplicate **and** guard:
> if `rows / distinct_models > ~1.2`, treat the snapshot as suspect and fall back to the last
> clean one. Shipping this raw would put three different "rank 1" models on the home page.

Publishing is irregular, not daily (no rows exist for 2026-07-01 or 2026-07-15), so the daily
cron will frequently find nothing new. That is fine and must be idempotent, not an error.

Methodology breaks to respect in `/methodology`: Elo → Bradley-Terry on 2024-01-09; style
control became default for text/vision on 2025-05-16; frequency re-weighting on 2025-07-23.
Ratings across those boundaries are not directly comparable.

### LiveBench — *backbone, contamination-resistant*

Serves plain files from the site root:
`table_{YYYY_MM_DD}.csv`, `categories_{YYYY_MM_DD}.json`, `cost_{YYYY_MM_DD}.csv`.
Current snapshot `2026_06_25`; 46 models × 23 task columns. `robots.txt` is
`User-agent: * / Disallow:` — an empty disallow, i.e. crawling permitted.

The CSV ships **raw per-task scores with no precomputed aggregate**. We compute category
averages ourselves from `categories_{date}.json`, which maps tasks into `Reasoning`, `Coding`,
`Agentic Coding`, `Mathematics`, `Data Analysis`, `Language`, `IF`. That is a feature: the
entire chain stays reproducible by hand from public files, which is what `/methodology`
promises. The category names also map almost one-to-one onto our composite.

LiveBench refreshes its questions specifically to resist training-data contamination, which
earns it a slot despite the smaller model count.

> **Fragility (medium).** The list of available snapshot dates lives in a JS array inside
> `https://livebench.ai/static/js/main.{hash}.js`, and the hash changes on every deploy.
> Ingest must walk `index.html` → bundle URL → date array → newest date, and fall back to the
> last known-good snapshot when that walk fails.

> The HuggingFace datasets under the `livebench` org are **question sets** last touched
> 2025-04, not the leaderboard. Do not ingest them.

> Licence **verified as Apache-2.0**. The GitHub API reports `NOASSERTION` only because the
> LICENSE file opens with a note that it is carried over from `lm-sys/FastChat`; the body is
> the standard Apache License 2.0. Attribution required, commercial use permitted.

### SWE-bench — *supporting, agentic coding*

`https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json`
— 7.3 MB JSON, six leaderboards: Verified (180 entries, 31 open-weight), Lite (84),
bash-only (48), Multilingual (14), Multimodal (22), Test (24). `os_model` and `os_system` flag
the model and the agent scaffold as open-source independently. `robots.txt` contains only
Cloudflare content-signal *comments* and no actual directives, so no restriction is expressed.

Included, but with two honest qualifications:

1. **It is stale.** Newest Verified entry is 2026-02-26 and the site repo was last pushed
   2026-03-29 — effectively frozen for ~5 months. It should be presented as a slow-moving
   reference, and the daily cron should not expect it to change.
2. **Entries are scaffolds, not models.** Rows read `live-SWE-agent + Claude 4.5 Opus medium
   (20251101)` or `Sonar Foundation Agent + Claude 4.5 Opus`. Collapsing a scaffold's score
   onto a bare model would itself introduce bias — the scaffold often contributes more than
   the model. This is the main reason `aliases.json` needs to exist, and the UI must disclose
   the scaffold rather than hide it.

Where Epoch's own `swe_bench_verified.csv` covers the same model, prefer Epoch's first-hand
run and keep this source for breadth.

> 🚫 **Blocking licence conflict.** The repo that serves `data/leaderboards.json`
> (`SWE-bench/swe-bench.github.io`) is licensed **CC BY-NC 4.0 — Attribution-NonCommercial**.
> ModelHub is MIT. MIT grants commercial reuse that CC-BY-NC withholds, so committing this
> data into `/data` would hand every forker a repository whose licence overstates the rights
> they actually have.
>
> **Resolved 2026-07-27 — permanently excluded.** The swebench.com ingest is dropped. SWE-bench
> Verified figures come from Epoch's own CC-BY-4.0 runs, and the site links out to
> swebench.com so the scaffold leaderboard stays one click away without a byte of its data
> entering this repo. Because SWE-bench was already barred from the composite (see rule below),
> this costs nothing in the ranking — only the breadth of the scaffold leaderboard.

**Standing rule regardless of the licence outcome:** SWE-bench never contributes a bare-model
score to the composite. Epoch's `swe_bench_verified.csv` is what carries the Coding weight. If
SWE-bench entries are ever shown, the agent scaffold must be visible in the UI, never collapsed
into the model name.

### HuggingFace Hub API — *discovery only, no scores*

`https://huggingface.co/api/models?sort=trendingScore&direction=-1&filter=text-generation`
works anonymously and returns `id`, `downloads`, `likes`, `trendingScore`. Used by Layer B to
spot trending open-weights models missing from `models.json`. **It never contributes a score**,
so it carries no `source_type`. Exact anonymous rate limits are `unverified`.

---

## Deferred

### Scale Labs (formerly SEAL) — recommend v1.1

The old `scale.com/leaderboard` now redirects to **`labs.scale.com`**, and it is very much
alive: 20+ benchmarks, 100+ models, including SWE-Bench Pro (public *and* private datasets),
Humanity's Last Exam, MCP Atlas, the SWE Atlas family, HiL-Bench and DrugDiscoveryBench.

Its anti-contamination value is the highest of any source here, because several evals are
held-out and private — precisely what a vendor cannot train against.

Deferred anyway: no API or dataset export was found, so it would require scraping a Next.js
app. That is the most maintenance-heavy option on this list, and a scraper that breaks
regularly would violate the "no daily human maintenance" constraint. `labs.scale.com/robots.txt`
returns 404 (no restrictions declared) and the parent `scale.com` allows `/` while disallowing
query-string URLs, but Scale's terms of use remain **unverified**.

---

## Excluded from v1

### Open LLM Leaderboard v2 — archived, and it looks alive

The brief flagged this one, and the check confirmed it with a twist worth recording: the Space
still reports runtime stage `RUNNING` and was touched 2026-05-27, so at a glance it looks
healthy. Its underlying results dataset (`open-llm-leaderboard/contents`) has not moved since
**2025-03-20** — roughly 16 months. Officially retired; no new submissions.

Its only defensible use is as a historical snapshot of open-weights models circa early 2025.
It cannot inform a "who is frontier now" ranking.

### Aider Polyglot — frozen

The file parses cleanly (`polyglot_leaderboard.yml`, 45.7 KB, 69 entries, Apache-2.0), but its
**newest entry is dated 2025-10-03** while the aider project itself stayed active through
2026-05-22. The leaderboard, not the project, was abandoned.

Ingesting it would place 2025 numbers beside 2026 numbers in a ranking whose entire premise is
currency — worse than omitting it. If the historical depth is wanted later, take it through
Epoch's `aider_polyglot_external.csv`, which already carries source provenance.

### Artificial Analysis — excluded by directive; terms unverified

`robots.txt` is fully permissive (`Allow: /`). However, a permissive robots.txt is not a
permissive terms of use, and the terms page could not be located at all: `/terms`,
`/terms-of-use`, `/terms-and-conditions`, `/legal/terms` and `/about` each returned 404 to a
non-browser client. **Terms remain unverified** — no scraping until a human reads them in a
browser.

Independently of that, its coverage is largely redundant with Epoch AI, which is CC-BY licensed
and offers a clean download.

---

## Decisions taken at Checkpoint 0

**Source set for v1:** Epoch AI, LMArena, LiveBench and SWE-bench as score sources, plus the
HuggingFace Hub API for discovery only. Scale Labs deferred to v1.1.

**Composite:** Multimodal is removed from the composite and LMArena enters it as its own
category. Final weights for `config/weights.json`:

| Category | Weight | Primary sources |
|---|---|---|
| Reasoning | 25% | LiveBench Reasoning, Epoch GPQA Diamond / ARC-AGI / HLE |
| Coding | 25% | LiveBench Coding + Agentic Coding, Epoch SWE-bench Verified, SWE-bench |
| Math | 20% | LiveBench Mathematics, Epoch MATH L5 / FrontierMath / AIME |
| Human preference | 15% | LMArena `text` (`human_eval`) |
| Instruction-Following | 15% | LiveBench IF |

Multimodal is **not** part of the composite. It gets a separate view and its own vision score,
sourced from LMArena `vision` plus Epoch's `video_mme_external` / `vpct_external`, so that
text-only models are never ranked against a category they don't compete in.

The two findings that led to these decisions are kept below, since `/methodology` needs to
explain *why* the weights are what they are.

### 1. The default composite weights assume data we barely have

Mapping §7's default weights onto what the confirmed sources actually provide:

| Category | Weight | Coverage | Sources |
|---|---|---|---|
| Reasoning | 25% | strong | LiveBench Reasoning, Epoch GPQA Diamond, ARC-AGI, HLE |
| Coding | 25% | strong | LiveBench Coding + Agentic Coding, Epoch SWE-bench Verified, SWE-bench |
| Math | 20% | strong | LiveBench Mathematics, Epoch MATH L5 / FrontierMath / AIME |
| Instruction-Following | 15% | adequate | LiveBench IF |
| **Multimodal** | **15%** | **weak** | LMArena `vision` only; Epoch `video_mme_external`, `vpct_external` |

Multimodal carries 15% of the score on the thinnest evidence base of the five, and many
text-only models will have no multimodal data at all. Under the §7 partial-coverage rule that
is survivable, but it means a large share of the ranking would be decided by a category most
models don't compete in.

Options: reweight (e.g. Reasoning 30 / Coding 30 / Math 20 / IF 20, with Multimodal as a
separate opt-in view), or keep 15% and lean on the "4/5 categories" coverage badge.

### 2. LMArena's human votes don't fit in any of the five categories

LMArena is the source hardest to game and the brief's stated favourite, but `human_eval` is a
*source type*, not one of the five weighted categories. As specified, it has no way into the
composite.

Options: (a) add a sixth "Human preference" category with its own weight; (b) keep it out of
the composite and display Arena rating as a prominent parallel column; (c) use it as a
tie-breaker. Recommendation: **(a)**, because excluding the least-gameable signal from the
headline number is hard to defend on a site whose whole pitch is anti-gaming.

Both are `config/weights.json` decisions, so they stay debatable by PR either way.
