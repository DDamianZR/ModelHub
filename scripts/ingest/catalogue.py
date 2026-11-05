"""Join the router catalogue and the coding-agent board onto the scored cohort.

Nothing here touches a score. It fills price, context window and modalities on models the
ranking already holds, and publishes every other catalogue entry as unranked. Matching is
by normalised name with pattern rules only: the namespace before the slash and the
provider of a model are never read.
"""
from __future__ import annotations

from .common import norm
from .sources.openrouter import ATTRIBUTION, catalogue_key

_VISION_INPUTS = {"image"}


def match_key(key: str) -> str:
    """Same dot-to-hyphen rule as the catalogue side, so both sides compare equal."""
    return catalogue_key(key)


def _preference(entry: dict) -> tuple[int, int]:
    # The plain listing beats ':free' / ':batch' variants, and a name without a suffix
    # such as "-preview" beats one that carries it.
    return (":" in entry["slug"], len(entry["slug"]))


def index_by_key(catalogue: dict[str, dict]) -> dict[str, dict]:
    chosen: dict[str, dict] = {}
    for entry in catalogue.values():
        current = chosen.get(entry["key"])
        if current is None or _preference(entry) < _preference(current):
            chosen[entry["key"]] = entry
    return chosen


def match_models(canonical_keys: dict[str, str], catalogue: dict[str, dict]
                 ) -> dict[str, dict]:
    """model_id -> catalogue entry, for ids whose canonical key appears in the catalogue."""
    index = index_by_key(catalogue)
    return {
        model_id: index[match_key(key)]
        for model_id, key in canonical_keys.items() if match_key(key) in index
    }


def apply_metadata(models: list[dict], matches: dict[str, dict], measured_at: str) -> int:
    """Fill pricing, context and modalities. Returns how many models received anything."""
    touched = 0
    for model in models:
        entry = matches.get(model["id"])
        if not entry:
            continue
        priced = (entry["price_input_usd_per_m"] is not None
                  or entry["price_output_usd_per_m"] is not None)
        if priced:
            model["pricing"] = {
                "input_usd_per_m": entry["price_input_usd_per_m"],
                "output_usd_per_m": entry["price_output_usd_per_m"],
                "source_url": ATTRIBUTION,
                "measured_at": measured_at,
            }
        if entry["context_length"]:
            model["context_window"] = entry["context_length"]
        extra = [
            "vision" if m in _VISION_INPUTS else m for m in entry["input_modalities"]
        ]
        for modality in extra:
            if modality not in model["modalities"]:
                model["modalities"].append(modality)
        touched += 1
    return touched


def build_unranked(catalogue: dict[str, dict], matches: dict[str, dict],
                   measured_at: str) -> list[dict]:
    """Catalogue entries with no benchmark in the cohort: visible, never ranked."""
    matched_slugs = {entry["key"] for entry in matches.values()}
    rows = []
    for entry in index_by_key(catalogue).values():
        if entry["key"] in matched_slugs:
            continue
        rows.append({
            "slug": entry["slug"],
            "name": entry["name"],
            "status": "unranked",
            "context_length": entry["context_length"],
            "input_modalities": entry["input_modalities"],
            "price_input_usd_per_m": entry["price_input_usd_per_m"],
            "price_output_usd_per_m": entry["price_output_usd_per_m"],
            "open_weights": entry["open_weights"],
            "hugging_face_id": entry["hugging_face_id"],
            "measured_at": measured_at,
        })
    return sorted(rows, key=lambda r: r["slug"])


def build_boards(epoch_boards: dict[str, dict[str, dict]], canonical_keys: dict[str, str]
                 ) -> list[dict]:
    """Separate boards, never summed into the composite. Rows only for scored models."""
    by_key = {norm(key): model_id for model_id, key in canonical_keys.items()}
    out = []
    for board_id in ("agentic", "knowledge"):
        benchmarks = []
        for benchmark_id, info in sorted((epoch_boards.get(board_id) or {}).items()):
            rows = [
                {"model_id": by_key[key], **row}
                for key, row in info["rows"].items() if key in by_key
            ]
            if rows:
                benchmarks.append({
                    "id": benchmark_id, "name": info["name"],
                    "source_url": "https://epoch.ai/benchmarks",
                    "rows": sorted(rows, key=lambda r: (-r["value"], r["model_id"])),
                })
        out.append({"id": board_id, "in_composite": False, "benchmarks": benchmarks})
    return out
