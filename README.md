<img src="public/logo.png" alt="ModelHub" width="380">

# ModelHub

[![CI](https://github.com/DDamianZR/ModelHub/actions/workflows/ci.yml/badge.svg)](https://github.com/DDamianZR/ModelHub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/DDamianZR/ModelHub)](LICENSE)

*[Léeme en español](README.es.md)*

**The independent frontier model scoreboard.** *El baremo independiente de modelos frontera.*

An open ranking of frontier AI models — closed and open-weights on the same field — built so
you can see who is actually ahead without reading it through the marketing of the companies
selling the models.

Every number carries its source, its date, and how it was measured. What a vendor claims about
its own model is stored and displayed, but it never counts toward the score.

## Why this exists

The landscape changes weekly, and there is no clean, bilingual, transparent view that puts
closed and open models in one table. Leaderboards are scattered, vendor benchmark claims
circulate faster than independent measurements, and some sources go stale without saying so.

HuggingFace's Open LLM Leaderboard still reports its Space as `RUNNING`. Its results dataset
has not changed since March 2025. Checking that took one API call, and it is the reason
[SOURCES.md](SOURCES.md) records what every source *actually* does rather than what it
appears to do.

The same standard applies inward. A model whose generated description contradicts itself or
strays outside what `/data` actually records is rejected, and the site shows "description
pending" rather than filling the space. An honest gap ships; invented filler does not.

ModelHub is built for students who want numbers rather than hype.

## How the anti-bias works

It is enforced in the schema and the pipeline, not in a disclaimer.

- Every score is tagged `human_eval`, `third_party_benchmark`, or `vendor_claim`. **Only the
  first two feed the composite.** The three sources currently ingested — Epoch AI,
  LiveBench, LMArena — are all third-party or human-eval; nothing here has ingested a
  vendor's own claim yet, so `vendor_claim` is schema support waiting for a source, not a
  populated category today.
- Nothing is shown without `measured_at`. No number floats free of a date.
- Models missing a category are marked partial and scored on the weight actually available,
  never zero-filled. The table shows a five-segment coverage meter next to each score, so a
  composite built from three categories can't pass for one built from five.
- **A model needs 4 of 5 categories to be ranked at all.** Below that it appears in a
  provisional section without a rank. Spreading the weight across only the categories a model
  happens to have measured would otherwise lift it on what it is *missing* — a thinly evaluated
  model scoring well on two benchmarks would outrank a thoroughly evaluated one. The bar is 4
  rather than 5 so a newly released model with all four benchmarks but no Arena votes yet still
  ranks, flagged "no human votes yet". Evidence is required; being new is not penalised.
- Multimodal is measured but deliberately kept **out** of the composite. Penalising a text-only
  model for a category it doesn't compete in would invent a difference that isn't there.
- Weights live in [`config/weights.json`](config/weights.json) and are debatable by pull
  request.

### Git as the database

There is no external database. The data under `/data` is the source of truth, committed as
plain JSON. The daily ingest runs in GitHub Actions and commits its output, so **every change
to every number is an auditable diff** and the git history is the time series behind the
sparklines.

## Composite

| Category | Weight |
|---|---|
| Reasoning | 25% |
| Coding | 25% |
| Math | 20% |
| Human preference (LMArena) | 15% |
| Instruction-following | 15% |

Percent-scale benchmarks are used as-is. LMArena's Bradley-Terry ratings are min-max normalised
across the cohort in each build. The full method lives at `/methodology`, and every figure is
reproducible by hand from the public files.

## Sources

Currently ingested — see [SOURCES.md](SOURCES.md) for the full audit, including what was
checked, what was rejected, and why.

| Source | What it provides | Licence |
|---|---|---|
| [Epoch AI](https://epoch.ai/benchmarks) | First-hand evals with public logs; open/closed flag; country | CC BY 4.0 |
| [LMArena](https://lmarena.ai/leaderboard) | Blind human voting, plus full rating history | CC BY 4.0 |
| [LiveBench](https://livebench.ai/) | Contamination-resistant per-task scores | Apache-2.0 |

Deliberately excluded: the Open LLM Leaderboard (archived, its data frozen since March 2025
even though the Space still reports as running), Aider Polyglot (frozen since October 2025),
and swebench.com (CC-BY-NC, incompatible with this repo's MIT licence).

## Running it

```bash
npm install
npm run dev
```

Rebuilding the dataset from the live sources requires only Python 3 — the ingest uses the
standard library and nothing else:

```bash
npm run ingest
```

That same command runs daily in GitHub Actions and commits whatever changed. If a source is
unreachable the run still completes: its last good payload is reused from `data/cache/`, the
outage is recorded in `data/status.json`, and the site says on the page which source is stale
and how old its numbers are. Silence about staleness would be its own kind of dishonesty.

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind v4 · next-intl · Python 3 (stdlib only).

Hosting on Vercel's free tier, ingest on GitHub Actions. Operating cost is zero by design, and
any change that would introduce a bill is out of scope.

## Who made this

A computer science student at ESCOM-IPN, as a tool that gets used rather than a course
project that gets graded. That is also why the rules are enforced in code: a one-person
project cannot rely on remembering to be careful.

- **Repository:** [github.com/DDamianZR/ModelHub](https://github.com/DDamianZR/ModelHub)
- **Portfolio / Personal Site:** [ddzendreros.github.io/dzendreros](https://ddzendreros.github.io/dzendreros)
- **Instagram:** [@diego_zr.p](https://www.instagram.com/diego_zr.p/)

Contributions are welcome.

## Contributing

Disagreement about the weights is the point, not a problem — that is why they sit in a config
file rather than in code. Open a pull request against `config/weights.json` with your reasoning,
or file an issue to suggest a model or challenge a number.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to challenge a number, argue with the weights,
or propose a source.

## Licence

Code is [MIT](LICENSE). Data under `/data` is derived from the sources above and keeps their
terms; see [NOTICE](NOTICE) for attribution.
