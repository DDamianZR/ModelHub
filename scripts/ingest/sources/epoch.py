"""Epoch AI — AI Benchmarking Hub (CC-BY-4.0).

Supplies the canonical model registry and first-hand benchmark results. Files without an
"_external" suffix are evaluations Epoch runs itself and publishes inspect logs for; the
"_external" ones are aggregated from elsewhere and are not used here, so that every score
credited to Epoch is one Epoch actually measured.
"""
from __future__ import annotations

import csv
import io
import zipfile

from ..common import SourceError, fetch, norm

URL = "https://epoch.ai/data/benchmark_data.zip"
ATTRIBUTION = "https://epoch.ai/benchmarks"
MIN_RELEASE_DATE = "2025-06-01"

BENCHMARKS = {
    "gpqa_diamond.csv": ("gpqa_diamond", "reasoning"),
    "simpleqa_verified.csv": ("simpleqa_verified", "reasoning"),
    "math_level_5.csv": ("math_level_5", "math"),
    "frontiermath.csv": ("frontiermath", "math"),
    "swe_bench_verified.csv": ("swe_bench_verified", "coding"),
}


def collect() -> dict:
    """Return {"registry": {...}, "scores": {key: [...]}}."""
    archive = zipfile.ZipFile(io.BytesIO(fetch(URL, timeout=180)))

    def read(name: str) -> list[dict]:
        with archive.open(name) as handle:
            return list(csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8")))

    try:
        index = read("epoch_capabilities_index.csv")
    except KeyError as exc:
        raise SourceError("epoch: capabilities index missing from archive") from exc

    registry: dict[str, dict] = {}
    for row in index:
        if (row.get("Release date") or "") < MIN_RELEASE_DATE:
            continue
        key = norm(row["Model version"])
        if not key:
            continue
        eci = float(row["ECI Score"] or 0)
        if key in registry and eci <= registry[key]["eci"]:
            continue
        registry[key] = {
            "eci": eci,
            "display_name": (
                row.get("Display name") or row.get("Model name") or row["Model version"]
            ).strip(),
            "organization": (row.get("Organization") or "Unknown").strip(),
            "country": (row.get("Country") or "").strip(),
            "release_date": row.get("Release date") or None,
            "accessibility": (row.get("Model accessibility") or "").strip(),
        }

    scores: dict[str, list[dict]] = {}
    for filename, (benchmark_id, category) in BENCHMARKS.items():
        try:
            rows = read(filename)
        except KeyError:
            # A benchmark disappearing is not fatal; the rest of the source still stands.
            continue
        for row in rows:
            raw = row.get("mean_score") or row.get("Best score (across scorers)")
            key = norm(row.get("Model version", ""))
            if not raw or key not in registry:
                continue
            try:
                value = float(raw) * 100.0
            except ValueError:
                continue
            scores.setdefault(key, []).append({
                "benchmark_id": benchmark_id,
                "category": category,
                "value": round(value, 2),
                "source_type": "third_party_benchmark",
                "source_url": ATTRIBUTION,
                "measured_at": (row.get("Started at") or "")[:10] or None,
            })

    if not registry:
        raise SourceError("epoch: registry came back empty")

    return {"registry": registry, "scores": scores}
