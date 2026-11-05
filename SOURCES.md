# Data Sources

Machine-readable definition: [`config/sources.json`](config/sources.json).  
Live fetch status: `data/status.json` (written by each ingest run).

## Active sources (ingested daily)

| Source | Type | Licence | Live today? |
|---|---|---|---|
| [Epoch AI](https://epoch.ai/benchmarks) | `third_party_benchmark` | CC-BY-4.0 | ✅ |
| [LMArena](https://lmarena.ai/leaderboard) | `human_eval` | CC-BY-4.0 | ✅ |
| [LiveBench](https://livebench.ai/) | `third_party_benchmark` | Apache-2.0 | ⚠ stale (serving cached snapshot) |

## Discovery only (no scores)

| Source | Purpose |
|---|---|
| [HuggingFace Hub API](https://huggingface.co/models) | Trending open-weights model detection for Layer B onboarding |

## Deferred

| Source | Reason |
|---|---|
| [Scale Labs](https://labs.scale.com) | High anti-contamination value, but no API — scraping a Next.js app violates the no-maintenance constraint. Deferred to v1.1. |

## Excluded

| Source | Reason | Decided |
|---|---|---|
| swebench.com | CC-BY-NC-4.0, incompatible with MIT. SWE-bench Verified comes from Epoch's own CC-BY-4.0 runs instead. | 2026-07-27 |
| Open LLM Leaderboard v2 | Archived; results frozen since 2025-03-20. | 2026-07-27 |
| Aider Polyglot | Leaderboard frozen since 2025-10-03; available via Epoch's external CSV if needed. | 2026-07-27 |
| Artificial Analysis | Terms of use unverified; coverage redundant with Epoch AI. | 2026-07-27 |
| La Leaderboard (ES) | Zero cohort overlap (51 small models vs 57 frontier). Space in RUNTIME_ERROR. | 2026-08-03 |
| IberBench (ES) | Frozen since 2025-03-20. Space SLEEPING, dataset unlicensed. | 2026-08-03 |

Full audit rationale for each decision is preserved in git history (see the pre-reduction
version of this file).
