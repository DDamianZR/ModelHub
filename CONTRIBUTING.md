# Contributing to ModelHub

Disagreement about how models should be scored is the point of this project, not a problem
with it. That is why the weights live in a config file rather than in code, and why every
number carries the source it came from.

There are three useful ways to contribute, in rough order of value.

## 1. Challenge a number

If a figure on the site looks wrong, it probably is, and finding out is worth more than any
feature. Open an issue with the model, the number, and what you think it should be.

Before opening one, it is worth checking `data/scores.json`: every score records its
`source_type`, its `measured_at` date and the URL it came from. If our number matches the
source and the source is wrong, that is a different problem — tell us anyway, because we may
need to stop trusting that source.

## 2. Argue with the weights

The composite is Reasoning 25 · Coding 25 · Math 20 · Human preference 15 ·
Instruction-following 15, and none of that is handed down from anywhere. It is a judgement
call in [`config/weights.json`](config/weights.json), and a well-argued pull request is the
intended way to change it.

A weights PR should say what you are changing, why the current split misrepresents something,
and what the ranking looks like after the change. Run `npm run ingest` locally and include
the before and after of the top ten. A proposal that moves the ranking without saying so is
the one thing that will get it closed.

The same applies to `min_coverage_for_ranking` and `variant_policy`, which are also judgement
calls and also documented on [`/methodology`](https://github.com/DDamianZR/ModelHub).

## 3. Suggest a model or a source

Use the issue templates. For a model, the useful information is where an independent
evaluation of it exists — we do not ingest vendor-published figures, so a link to a company
blog post is not enough on its own.

For a source, the questions we will ask are in [`SOURCES.md`](SOURCES.md): what licence does
it carry, how is it accessed, how often does it actually update, and has it gone quietly
stale while still looking alive. Two candidate sources were rejected for exactly that.

### The onboarding filter

`npm run onboard` reads what is trending on the HuggingFace Hub and drafts anything the
catalogue does not already know. Before writing a draft it discards, deterministically:

| Rule | Why |
|---|---|
| Packaging formats: GGUF, AWQ, GPTQ, EXL2, MLX, and quantisation suffixes | A requantised upload is packaging, not a new model |
| Names ending in `-Dev`, `-Preview`, `-RC`, `-beta`, `-alpha` | Pre-release numbers change underneath us. Ingesting them repeats what made another leaderboard unusable |
| Known parameter count below **7B** | This project tracks frontier models. Out of scope, not out of favour |

The size rule discards only what is **known** to be small. When the Hub reports no
parameter count and the name states none, the candidate goes to review rather than to the
bin — discarding what we merely failed to measure is the error the coverage gate exists to
avoid. When signals disagree the largest wins, because one 35B repo reports a safetensors
total three orders of magnitude too small and would otherwise be filtered out as tiny.

All three rules live in `scripts/enrich/onboard.py` and are meant to be argued with. Lowering
the floor to 3B is a legitimate PR; so is dropping it entirely if someone shows the weekly
list stays manageable without it.

Approving a draft moves it to `data/watchlist.json`, which pre-registers the name so the
ingest recognises it as soon as a source measures it. **Approving is not ranking**: a model
with no measurements has no composite and appears nowhere in the table until Layer A finds
it in a real source.

## Ground rules that are not negotiable

These exist because the site's only real asset is that its numbers can be checked.

- **No number comes from a language model.** Layer B writes prose. Scores, rankings and URLs
  are produced deterministically or not at all.
- **Vendor claims never enter the composite.** They can be stored and displayed as
  `vendor_claim`, greyed out and labelled. A vendor has every incentive to publish the run
  that flatters it, and no way for us to audit the one it did not publish.
- **Nothing is shown without a date.** If a value has no `measured_at`, it does not ship.
- **A change that moves the ranking has to say so, with numbers.** Measure against the
  previous state and state the metric. "Plausible" is not a standard.

## Working on the code

```bash
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run lint
npm run typecheck
npm run build
```

CI runs the same three. Python has no dependencies at all, by design — the ingest must keep
running on a free runner with nothing to maintain, so please do not add any.

Rebuilding the data needs only Python 3:

```bash
npm run ingest
```

The enrichment layer needs [Ollama](https://ollama.com) running locally with
`qwen3-coder:30b` pulled. It is never run in CI and never commits by itself:

```bash
npm run enrich
```

## Commits

Conventional Commits, in English, one concern per commit. Explain *why* in the body — the
history is a record of decisions, and several of the rules above exist because someone had to
reconstruct why a number changed.

## Language

Code, comments and repository documentation are in English. Everything a visitor reads is
bilingual Spanish and English, and both are first-class: a Spanish string that reads like a
translation is a bug.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
