"""Rebuild the composite from the versioned caches, with no network and no writes.

The same inputs tests/test_golden.py rebuilds from, packaged so the neutrality checks can
run the real pipeline on the real cohort instead of on a toy fixture. An invariance that
only holds on three hand-made models proves very little about the eighty-odd that ship.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Callable

from scripts.ingest import catalogue, derived, row_dates
from scripts.ingest.composite import build_models
from scripts.ingest.sources import lmarena

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"


def cache_available() -> bool:
    return (CACHE / "epoch.json").exists()


def _cache_file(name: str) -> dict:
    return json.loads((CACHE / f"{name}.json").read_text(encoding="utf-8"))


def load_inputs() -> dict:
    """Keyword arguments for build_models(), read from data/cache."""
    epoch = _cache_file("epoch")["payload"]

    livebench_cached = _cache_file("livebench")
    livebench = livebench_cached["payload"]
    if (CACHE / f"{row_dates.STATE}.json").exists():
        row_dates.stamp(
            livebench["scores"], livebench["snapshot"], _cache_file(row_dates.STATE),
            livebench_cached["fetched_at"],
        )

    arena = lmarena.upgrade_payload(_cache_file("lmarena")["payload"])
    return {
        "registry": epoch.get("registry") or {},
        "epoch_scores": epoch.get("scores") or {},
        "livebench_scores": livebench.get("scores") or {},
        "arena_text": arena.get("text") or {},
        "arena_vision": arena.get("vision") or {},
        "arena_snapshot": arena.get("snapshot"),
        "vision_snapshot": arena.get("vision_snapshot"),
        # run.py passes the boards too: a third-party measurement outside the composite
        # still corroborates that a model exists. Without them this rebuild dropped every
        # model admitted that way (4 of 89 on 2026-11-12, the first-ranked one included),
        # so every delta reported them as gone and shifted the ranks below them.
        "epoch_boards": epoch.get("boards") or {},
    }


def rebuild(
    inputs: dict | None = None,
    registry_transform: Callable[[dict], dict] | None = None,
) -> tuple[list[dict], dict]:
    """Return (models, aliases) exactly as build_models() produces them.

    `registry_transform` receives a deep copy of the registry and returns the one to score.
    Only the registry is ever transformed: it is the one input that carries who made a
    model, which is the thing the composite must not depend on.
    """
    kwargs = dict(inputs if inputs is not None else load_inputs())
    registry = copy.deepcopy(kwargs["registry"])
    if registry_transform is not None:
        registry = registry_transform(registry)
    kwargs["registry"] = registry
    models, _scores, _providers, aliases, _minmax = build_models(**kwargs)
    # Same metadata step run.py applies after scoring; it reads no score and no label of
    # who made a model, so it cannot change a ranking, only fill price and context.
    if (CACHE / "openrouter.json").exists():
        cached = _cache_file("openrouter")
        keys = {mid: info["canonical_key"] for mid, info in aliases.items()}
        matches = catalogue.match_models(keys, cached["payload"].get("catalogue") or {})
        catalogue.apply_metadata(models, matches, cached["fetched_at"])
    # Derived from composite and price only; recomputed here so the rebuild stays the same
    # model list run.py publishes.
    derived.annotate(models)
    return models, aliases
