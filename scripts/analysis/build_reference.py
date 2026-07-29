"""Compute the frozen reference distribution each benchmark is normalised against.

A raw score measures capability x benchmark difficulty. Aggregating raw scores across
benchmarks therefore adds difficulty into the ranking: a model measured on FrontierMath
(median 28.6) is punished against one measured on LiveBench Math (median 90.1) for nothing
it did. Normalising each benchmark against a fixed reference removes the difficulty term.

The reference is FROZEN on purpose. Normalising against the cohort present in each build is
what made the ranking depend on who else happened to be measured that day - removing one
model moved 48 of 52 composites. A fixed reference means a model's score depends only on
its own measurements.

Recomputing it moves every historical score, so it is a deliberate act: raise
methodology_version in config/weights.json, regenerate, and record the measured effect in
the changelog.

Usage:
    python -m scripts.analysis.build_reference                       # print to stdout
    python -m scripts.analysis.build_reference --write               # write the config
    python -m scripts.analysis.build_reference --scores PATH --benchmarks PATH
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

from scripts.ingest.common import CONFIG, DATA
from scripts.ingest.composite import load_methodology_version

# A benchmark needs this many measurements before its mean and sd describe a distribution
# rather than noise. The standard error of a standard deviation is sd/sqrt(2(n-1)): 35% at
# n=5, 17% at n=18, 12% at n=34. Below the bar every future model would be graded against
# that noise, so the benchmark does not score at all.
#
# Set to 15 rather than 20 on measurement: 20 also excludes swe_bench_verified (n=18), and
# 12 of the 18 models measured on it have no other coding benchmark, so 11 fall to
# provisional and one leaves the site entirely.
MIN_N = 15

# Presentation constant: 50 is the reference-average model, and 12.5 points is one standard
# deviation, so +/-4 sd spans the 0-100 scale. It changes how a number reads, never which
# model is ahead of which.
SCALE_FACTOR = 12.5

# Only what the composite is allowed to score. A vendor's own claim is stored and shown but
# never fed back into the distribution it would be measured against.
SCORING_SOURCE_TYPES = ("human_eval", "third_party_benchmark")

MIN_N_RATIONALE = (
    "The standard error of a standard deviation is sd/sqrt(2(n-1)): 35% at n=5, 17% at "
    "n=18, 12% at n=34. Below this bar the reference would be noise and every future model "
    "would be graded against that noise, so the benchmark does not enter the composite."
)

NOTE = (
    "Frozen on purpose. Scores depend on this reference, not on the cohort present in a "
    "given build, which is what stops one model entering or leaving from moving everybody "
    "else. Recomputing it moves every historical score: raise methodology_version, "
    "regenerate, and record the measured ranking effect in the changelog."
)


def build(scores: list[dict], benchmarks: dict[str, dict], computed_from: str,
          methodology_version: str, min_n: int = MIN_N) -> dict:
    """Reference distribution per benchmark, plus the ones held below the bar."""
    values: dict[str, list[float]] = {}
    for row in scores:
        if row.get("source_type") not in SCORING_SOURCE_TYPES:
            continue
        values.setdefault(row["benchmark_id"], []).append(float(row["value"]))

    included: dict[str, dict] = {}
    excluded: dict[str, dict] = {}
    for benchmark_id in sorted(values):
        sample = values[benchmark_id]
        n = len(sample)
        category = benchmarks.get(benchmark_id, {}).get("category")

        if n < min_n:
            excluded[benchmark_id] = {
                "category": category,
                "n": n,
                "reason": f"below min_n ({n} < {min_n})",
            }
            continue

        # Sample standard deviation, not population: these are a sample of the models that
        # exist, and it is the estimator the SE(sd) bound above is stated for.
        sd = statistics.stdev(sample)
        if sd <= 0:
            # Every model scored identically, so the benchmark cannot separate anything and
            # dividing by it would be undefined.
            excluded[benchmark_id] = {
                "category": category, "n": n, "reason": "zero variance",
            }
            continue

        included[benchmark_id] = {
            "category": category,
            "n": n,
            "mean": round(statistics.fmean(sample), 6),
            "sd": round(sd, 6),
            "observed_min": round(min(sample), 6),
            "observed_max": round(max(sample), 6),
            "se_of_sd_pct": round(100 / math.sqrt(2 * (n - 1)), 2),
        }

    return {
        "schema_version": 1,
        "methodology_version": methodology_version,
        "computed_at": computed_from,
        "computed_from": (
            "data/baseline/methodology-1.0-scores.json, the frozen snapshot of the last "
            "build before normalisation. Regenerate with "
            "python -m scripts.analysis.build_reference"
        ),
        "min_n": min_n,
        "min_n_rationale": MIN_N_RATIONALE,
        "scale_factor": SCALE_FACTOR,
        "formula": "normalized = 50 + scale_factor * (raw - mean) / sd, clipped to [0, 100]",
        "note": NOTE,
        "benchmarks": included,
        "excluded": excluded,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--scores", type=Path,
        default=DATA / "baseline" / "methodology-1.0-scores.json",
        help="frozen scores.json the reference is computed from",
    )
    parser.add_argument(
        "--benchmarks", type=Path, default=DATA / "benchmarks.json",
        help="benchmark catalogue, for category labels",
    )
    parser.add_argument("--min-n", type=int, default=MIN_N)
    parser.add_argument(
        "--write", action="store_true",
        help="write config/benchmark_reference.json instead of printing",
    )
    args = parser.parse_args(argv)

    payload = json.loads(args.scores.read_text(encoding="utf-8"))
    catalogue = {
        b["id"]: b
        for b in json.loads(args.benchmarks.read_text(encoding="utf-8"))["benchmarks"]
    }

    # Dated by the snapshot it was computed from, never by the clock: a reference that
    # stamped "now" could not be regenerated byte for byte, and reproducibility is the
    # property that makes freezing it meaningful.
    computed_from = payload.get("meta", {}).get("generated_at")
    if not computed_from:
        raise SystemExit(f"{args.scores}: meta.generated_at is required to date the reference")

    reference = build(
        payload["scores"], catalogue, computed_from, load_methodology_version(), args.min_n
    )
    text = json.dumps(reference, indent=2, ensure_ascii=False) + "\n"

    if args.write:
        (CONFIG / "benchmark_reference.json").write_text(text, encoding="utf-8")
        print(f"wrote config/benchmark_reference.json: "
              f"{len(reference['benchmarks'])} benchmarks, "
              f"{len(reference['excluded'])} excluded")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
