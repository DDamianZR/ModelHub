"""How much each category actually moved the composite, as opposed to its stated weight.

A weight is a multiplier, not a share of influence, and the two are not the same number.
How much a category actually moves the ranking depends on how much it varies between
models: a category where everyone scores alike cannot separate anyone regardless of the
weight in front of it.

Normalising per benchmark narrows the gap but cannot close it. The remaining driver is that
human_preference is one benchmark per model while reasoning averages up to three, and
averaging k correlated benchmarks shrinks a category's variance while k=1 shrinks nothing.

The honest response is to publish the gap rather than engineer it away. Normalising the
category score to a fixed sd would make nominal equal effective by construction, but it
would fabricate discrimination: instruction_following measures models that genuinely are
alike, and rescaling it would make that likeness look like a decisive difference.
"""
from __future__ import annotations

import statistics


def _histogram(counts: list[int]) -> dict[str, int]:
    """How many models carry how many benchmarks, keyed by count."""
    out: dict[str, int] = {}
    for count in sorted(counts):
        key = str(count)
        out[key] = out.get(key, 0) + 1
    return out


def _covariance(xs: list[float], ys: list[float]) -> float:
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (len(xs) - 1)


def audit(models: list[dict], weights: dict[str, float], methodology_version: str) -> dict:
    """Effective influence per category: cov(w_i * x_i, composite) / var(composite).

    Measured over models with every category present. A model missing a category is scored
    on available weight, so including it would attribute the gap to whichever categories it
    does have and overstate them.
    """
    full = [m for m in models if len(m.get("category_scores") or {}) == len(weights)]

    # Two models cannot produce a variance, and one cannot produce anything at all.
    if len(full) < 3:
        return {
            "methodology_version": methodology_version,
            "n_models_full_coverage": len(full),
            "note": "too few fully measured models to attribute influence",
            "categories": {
                c: {"nominal": w, "effective": None, "category_sd": None}
                for c, w in weights.items()
            },
        }

    composites = [m["composite"] for m in full]
    variance = statistics.variance(composites)

    categories = {}
    for category, weight in weights.items():
        values = [m["category_scores"][category] for m in full]
        contribution = [v * weight for v in values]
        categories[category] = {
            "nominal": round(weight, 4),
            "effective": (
                round(_covariance(contribution, composites) / variance, 4)
                if variance > 0 else None
            ),
            "category_sd": round(statistics.stdev(values), 2),
            # A distribution rather than a median, because these are bimodal: reasoning is
            # 14 models measured on one benchmark and 12 on three, and a median of 1 would
            # describe neither group. This is the residual driver of the gap between the
            # nominal weight and the effective one, so it is reported as it is.
            "benchmarks_per_model": _histogram(
                [m.get("benchmark_counts", {}).get(category, 0) for m in full]
            ),
        }

    return {
        "methodology_version": methodology_version,
        "n_models_full_coverage": len(full),
        "composite_variance": round(variance, 4),
        "definition": (
            "effective = cov(weight * category_score, composite) / var(composite), over "
            "models measured on every category. Weights are multipliers, not shares of "
            "influence; this is the influence they actually had in this build."
        ),
        "categories": categories,
    }
