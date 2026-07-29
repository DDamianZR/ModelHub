"""Per-benchmark normalisation against the frozen reference distribution.

A raw score is capability x benchmark difficulty. Averaging raw scores inside a category
therefore ranks models partly on which benchmarks happened to measure them: FrontierMath
has a median of 28.6 and LiveBench Math a median of 90.1, and both used to be averaged into
"math" as if they were the same measurement.

Normalising maps each benchmark onto a common scale first, so the top of FrontierMath and
the top of LiveBench Math both read as "high". The reference is fixed rather than computed
from the cohort in each build, which is what stops a model's score depending on who else
was measured that day.

See config/benchmark_reference.json for the distribution and scripts/analysis for the
script that regenerates it.
"""
from __future__ import annotations

import json

from .common import CONFIG


class ReferenceError(RuntimeError):
    """The reference cannot be used as it stands. The run stops rather than guessing."""


class Reference:
    """The frozen distribution, plus the benchmarks deliberately held out of it."""

    def __init__(self, payload: dict):
        self.methodology_version = payload.get("methodology_version", "unknown")
        self.computed_at = payload.get("computed_at")
        self.min_n = int(payload.get("min_n", 0))
        self.scale_factor = float(payload.get("scale_factor", 12.5))
        self.benchmarks: dict[str, dict] = payload.get("benchmarks") or {}
        self.excluded: dict[str, dict] = payload.get("excluded") or {}

        for benchmark_id, entry in self.benchmarks.items():
            for field in ("mean", "sd", "n"):
                if entry.get(field) is None:
                    raise ReferenceError(
                        f"{benchmark_id}: reference entry is missing {field!r}"
                    )
            if float(entry["sd"]) <= 0:
                raise ReferenceError(
                    f"{benchmark_id}: reference sd must be positive, got {entry['sd']}"
                )
            # Enforced here as well as at build time, so hand-editing the file to sneak a
            # thinly measured benchmark past the bar fails instead of quietly scoring.
            if int(entry["n"]) < self.min_n:
                raise ReferenceError(
                    f"{benchmark_id}: n={entry['n']} is below min_n={self.min_n}; it "
                    f"belongs in 'excluded', not in 'benchmarks'"
                )

    def scores(self, benchmark_id: str) -> bool:
        """Whether this benchmark may contribute to the composite at all."""
        if benchmark_id in self.benchmarks:
            return True
        if benchmark_id in self.excluded:
            return False
        # Neither scored nor deliberately excluded: the benchmark is new and nobody has
        # decided what distribution it is measured against. Inventing a scale here would be
        # exactly the silent, unreviewable judgement this file exists to remove.
        raise ReferenceError(
            f"{benchmark_id}: not present in config/benchmark_reference.json. Regenerate "
            f"it with `python -m scripts.analysis.build_reference --write` and review the "
            f"ranking effect before shipping."
        )


def load_reference(path=None) -> Reference:
    path = path or (CONFIG / "benchmark_reference.json")
    if not path.exists():
        raise ReferenceError(
            f"{path} not found. Generate it with "
            f"`python -m scripts.analysis.build_reference --write`."
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ReferenceError(f"{path}: invalid JSON ({exc})") from exc
    return Reference(payload)


def normalize(value: float, benchmark_id: str, reference: Reference) -> tuple[float, dict]:
    """Map a raw score onto the common scale. Returns (normalized, explanation).

    The explanation travels with the score so the page can show its own arithmetic: a
    derived number the reader cannot get back to the raw one from is just an assertion.
    """
    entry = reference.benchmarks[benchmark_id]
    mean = float(entry["mean"])
    sd = float(entry["sd"])

    z = (value - mean) / sd
    raw_normalized = 50.0 + reference.scale_factor * z
    normalized = min(100.0, max(0.0, raw_normalized))

    # Clipping is disclosed rather than smoothed over. A model beyond +/-4 sd of the
    # reference is a signal the reference has aged, and a run where it starts happening
    # often is a run that should raise methodology_version.
    clipped = normalized != raw_normalized

    return round(normalized, 2), {
        "z": round(z, 4),
        "mean": mean,
        "sd": sd,
        "scale_factor": reference.scale_factor,
        "clipped": clipped,
    }
