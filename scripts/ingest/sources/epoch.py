"""Epoch AI — AI Benchmarking Hub (CC-BY-4.0).

Supplies the canonical model registry and first-hand benchmark results. Files without an
"_external" suffix are evaluations Epoch runs itself and publishes inspect logs for; the
"_external" ones are aggregated from elsewhere and are not used here, so that every score
credited to Epoch is one Epoch actually measured.
"""
from __future__ import annotations

import csv
import io
import json
import zipfile

from ..common import CONFIG, SourceError, fetch, norm

URL = "https://epoch.ai/data/benchmark_data.zip"
ATTRIBUTION = "https://epoch.ai/benchmarks"

# Fallback only: normal operation reads this from config/weights.json, where it is a
# methodology choice documented and debatable by PR, not a bare constant buried in an
# adapter. This value is what ships if that file is ever missing or malformed.
_FALLBACK_MIN_RELEASE_DATE = "2025-06-01"


def min_release_date() -> str:
    """Public: also read from run.py to publish the same value into meta.min_release_date,
    so the frontend states the cutoff it actually applied rather than a remembered one."""
    path = CONFIG / "weights.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _FALLBACK_MIN_RELEASE_DATE
    return payload.get("min_release_date") or _FALLBACK_MIN_RELEASE_DATE


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

    cutoff = min_release_date()
    registry: dict[str, dict] = {}
    for row in index:
        if (row.get("Release date") or "") < cutoff:
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
            # Published on the same 0-1 scale as the score, so it scales with it. Epoch
            # carries this on every row we use; a missing one stays None rather than
            # being read as zero uncertainty.
            try:
                stderr = round(float(row["stderr"]) * 100.0, 3)
            except (KeyError, TypeError, ValueError):
                stderr = None
            scores.setdefault(key, []).append({
                "benchmark_id": benchmark_id,
                "category": category,
                # The raw published name, kept so the variant policy can choose between
                # effort levels instead of silently blending them.
                "variant": row.get("Model version", "").strip(),
                "value": round(value, 2),
                "stderr": stderr,
                "source_type": "third_party_benchmark",
                "source_url": ATTRIBUTION,
                "measured_at": (row.get("Started at") or "")[:10] or None,
            })

    if not registry:
        raise SourceError("epoch: registry came back empty")

    return {"registry": registry, "scores": scores}
