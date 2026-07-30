# ModelHub

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
  first two feed the composite.**
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

Every benchmark is normalised against a **frozen reference distribution** before its category
average is taken: `normalized = 50 + 12.5 × (raw − mean) / sd`. 50 is the reference-average
model on that benchmark and 12.5 points is one standard deviation.

This matters more than it sounds. A raw score measures capability *times* benchmark difficulty,
so averaging raw scores ranked models partly on which benchmarks happened to measure them —
FrontierMath has a median of 28.6 and LiveBench Mathematics 90.1, and both are "maths". And
because the reference is fixed rather than recomputed per build, a model's score no longer
depends on who else was measured that day: deleting one model used to move 48 of the other 52
composites, and now moves none.

The site keeps showing the raw number everywhere; only the composite uses the converted one,
and each cell carries its own mean, sd and z so the conversion can be checked in place. The
full method lives at `/methodology` with a version and a
[changelog](CHANGELOG-methodology.md), and every figure is reproducible by hand from the
public files.

Composite values are **not comparable across methodology versions** — normalisation recentres
the whole scale. Only the ordering carries across a version bump, which is why every stored row
records the version that produced it and why `/snapshot/<date>` renders a past ranking from
what was stored rather than recomputing it.

## The other views

- **`/local`** — what you can actually run on your own card. Pick your VRAM, context and
  quantisation; it computes weights plus KV cache from measured parameter counts and measured
  GGUF file sizes, with the formula on the page. Useful even at 8 GB.
- **`/gaps`** — what each vendor claimed about its own model, beside the independent
  measurement of the same benchmark. A difference is only computed when the benchmark *and* the
  configuration match; everything else is shown side by side with the reason.
- **`/snapshot/<date>`** — the ranking as it stood on a date, frozen, with a citation block.

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

Tests run on Node's own runner, with no test framework to install. That needs **Node 22.18 or
newer**, which is the version from which Node can execute TypeScript directly:

```bash
npm test
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

### Deployment identity

`NEXT_PUBLIC_SITE_URL` is the origin this deployment publishes as its own — it fills the
`canonical`, `hreflang` and `og:url` tags. Set it in Vercel under **Project Settings →
Environment Variables** to the deployment's own URL. Vercel's
`VERCEL_PROJECT_PRODUCTION_URL` is used as a fallback when system environment variables are
enabled for the project.

There is no hardcoded default, on purpose. A canonical tag pointing at a URL the project does
not own tells search engines to index that page instead of this one, and a default is exactly
how that survives unnoticed. A build on Vercel that cannot resolve an origin fails with a
message naming the variable; a local build just omits the tags.

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind v4 · next-intl · Python 3 (stdlib only).

Hosting on Vercel's free tier, ingest on GitHub Actions. Operating cost is zero by design, and
any change that would introduce a bill is out of scope.

## Who made this

A computer science student at ESCOM-IPN, as a tool that gets used rather than a course
project that gets graded. That is also why the rules are enforced in code: a one-person
project cannot rely on remembering to be careful.

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
