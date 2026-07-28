"""Score normalisation, the weighted composite, and the coverage gate."""
from __future__ import annotations

import json

from .common import CONFIG, slugify

DEFAULT_WEIGHTS = {
    "reasoning": 0.25,
    "coding": 0.25,
    "math": 0.20,
    "human_preference": 0.15,
    "instruction_following": 0.15,
}

DEFAULT_MIN_COVERAGE = 4


def load_weights() -> tuple[dict[str, float], int]:
    """Weights are config, not code: they are meant to be changed by pull request."""
    path = CONFIG / "weights.json"
    if not path.exists():
        return dict(DEFAULT_WEIGHTS), DEFAULT_MIN_COVERAGE
    payload = json.loads(path.read_text(encoding="utf-8"))
    weights = payload.get("weights") or DEFAULT_WEIGHTS
    minimum = int(payload.get("min_coverage_for_ranking", DEFAULT_MIN_COVERAGE))
    return dict(weights), minimum


def minmax(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 1.0
    low, high = min(values), max(values)
    return (low, high) if high > low else (low, low + 1.0)


def build_models(
    registry: dict,
    epoch_scores: dict,
    livebench_scores: dict,
    arena_text: dict,
    arena_vision: dict,
    arena_snapshot: str | None,
    vision_snapshot: str | None,
) -> tuple[list[dict], list[dict], dict, dict, tuple[float, float]]:
    """Return (models, score rows, providers, aliases, arena min-max used)."""
    weights, min_coverage = load_weights()

    # A model needs corroboration from at least two independent sources to appear at all.
    keys = sorted(
        key
        for key in registry
        if sum([
            bool(epoch_scores.get(key)),
            bool(livebench_scores.get(key)),
            key in arena_text,
        ]) >= 2
    )

    # Arena ratings are Bradley-Terry, not a percentage, so they are min-max normalised
    # across the cohort actually present in this build. Documented in /methodology.
    arena_low, arena_high = minmax(
        [arena_text[key]["rating"] for key in keys if key in arena_text]
    )

    models: list[dict] = []
    score_rows: list[dict] = []
    providers: dict[str, dict] = {}
    aliases: dict[str, list[str]] = {}

    for key in keys:
        meta = registry[key]
        organization = meta["organization"]
        provider_id = slugify(organization)
        model_id = f"{provider_id}-{key}"
        providers.setdefault(organization, {
            "id": provider_id,
            "display_name": organization,
            "country": meta["country"],
        })

        seen_alias = {key}
        by_category: dict[str, list[float]] = {}

        # Several vendor variants (effort levels, thinking modes) collapse onto one
        # canonical model, so the same benchmark can arrive several times. Average them
        # into a single score per benchmark first.
        #
        # This is not cosmetic. Appending each variant separately would give that
        # benchmark extra weight inside its category purely because the vendor shipped
        # more variants of the model - three LiveBench rows would outvote one Epoch row.
        merged: dict[str, dict] = {}
        for entry in list(epoch_scores.get(key, [])) + list(livebench_scores.get(key, [])):
            slot = merged.setdefault(entry["benchmark_id"], {
                "category": entry["category"],
                "values": [],
                "source_type": entry["source_type"],
                "source_url": entry["source_url"],
                "measured_at": entry["measured_at"],
            })
            slot["values"].append(entry["value"])
            latest = slot["measured_at"]
            if entry["measured_at"] and (not latest or entry["measured_at"] > latest):
                slot["measured_at"] = entry["measured_at"]

        for benchmark_id, slot in merged.items():
            variants = len(slot["values"])
            value = round(sum(slot["values"]) / variants, 2)
            by_category.setdefault(slot["category"], []).append(value)
            score_rows.append({
                "model_id": model_id,
                "benchmark_id": benchmark_id,
                "value": value,
                "unit": "percent",
                "source_type": slot["source_type"],
                "source_url": slot["source_url"],
                "measured_at": slot["measured_at"],
                "contamination_flag": False,
                "notes": (
                    f"mean of {variants} published variants of this model"
                    if variants > 1 else None
                ),
            })

        if key in arena_text:
            row = arena_text[key]
            seen_alias.add(row["model_name"])
            scaled = (row["rating"] - arena_low) / (arena_high - arena_low) * 100.0
            by_category.setdefault("human_preference", []).append(round(scaled, 2))
            score_rows.append({
                "model_id": model_id,
                "benchmark_id": "lmarena_text_overall",
                "value": round(row["rating"], 1),
                "unit": "bradley_terry_rating",
                "source_type": "human_eval",
                "source_url": "https://lmarena.ai/leaderboard",
                "measured_at": arena_snapshot,
                "contamination_flag": False,
                "notes": f"{int(row['vote_count'])} votes; rank {int(row['rank'])}",
            })

        category_scores = {
            category: round(sum(values) / len(values), 2)
            for category, values in by_category.items()
        }
        available = {c: w for c, w in weights.items() if c in category_scores}
        if not available:
            continue

        composite = sum(
            category_scores[c] * w for c, w in available.items()
        ) / sum(available.values())

        accessibility = meta["accessibility"].lower()
        is_open = "open weights" in accessibility

        vision = None
        if key in arena_vision:
            vision = {
                "rating": round(arena_vision[key]["rating"], 1),
                "rank": int(arena_vision[key]["rank"]),
                "measured_at": vision_snapshot,
                "source_url": "https://lmarena.ai/leaderboard",
            }

        models.append({
            "id": model_id,
            "display_name": meta["display_name"],
            "provider_id": provider_id,
            "is_open_weights": is_open,
            "license": meta["accessibility"] or None,
            "api_only": not is_open,
            "release_date": meta["release_date"],
            "country": meta["country"],
            "context_window": None,
            "modalities": ["text"] + (["vision"] if vision else []),
            "pricing": None,
            "acquisition": {
                "hf_repo": None, "provider_page": None,
                "api_docs": None, "ollama_tag": None,
            },
            "status": "verified",
            "category_scores": category_scores,
            "composite": round(composite, 2),
            "coverage": {
                "covered": len(available),
                "total": len(weights),
                "missing": sorted(set(weights) - set(available)),
            },
            "provisional": len(available) < min_coverage,
            "awaiting_human_votes": "human_preference" not in available,
            "vision": vision,
            "arena_name": arena_text[key]["model_name"] if key in arena_text else None,
        })
        aliases[model_id] = sorted(seen_alias)

    # Ranked and provisional are ordered independently; only the ranked set gets numbers,
    # so a thinly measured model can never occupy a top-N slot.
    models.sort(key=lambda m: m["composite"], reverse=True)
    rank = 0
    for model in models:
        if model["provisional"]:
            model["rank"] = None
        else:
            rank += 1
            model["rank"] = rank
    models.sort(key=lambda m: (m["provisional"], -m["composite"]))

    return models, score_rows, providers, aliases, (arena_low, arena_high)
