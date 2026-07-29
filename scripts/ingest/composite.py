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

# Raised whenever a change alters how a published number is computed. Every models.json
# build and every history.jsonl row carries it, so a stored value is always readable under
# the formula that produced it rather than the one in force when it is read back.
DEFAULT_METHODOLOGY_VERSION = "1.0"

# What to do when one canonical model was published under several variants (effort levels,
# thinking modes) and a benchmark therefore arrives more than once.
#
#   default  - use the variant the vendor published without an effort qualifier; fall back
#              to the highest score when no such plain variant exists.
#   best     - use the highest score across variants.
#   average  - use the mean across variants.
#   separate - do not collapse; not implemented, see notes in /methodology.
#
# This is a methodology choice, not an implementation detail: it changes the ranking. It
# lives in config so it can be argued with in a pull request.
DEFAULT_VARIANT_POLICY = "model"
VARIANT_POLICIES = ("model", "default", "best", "average")

# Effort tokens, longest first so "xhigh" is not swallowed by "high".
_EFFORT_TOKENS = (
    "xhigh", "promax", "max", "high", "medium", "low", "minimal", "none", "unknown",
)


def effort_label(variant: str, key: str) -> str:
    """Reduce a published variant name to the configuration it represents.

    Sources spell the same configuration differently - Epoch writes "claude-opus-5_max",
    LiveBench "claude-opus-5-max-effort" - so comparing raw strings would treat one
    configuration as several. This maps both onto "max".
    """
    text = (variant or "").strip().lower().replace("_", "-")
    if not text:
        return "unlabelled"

    remainder = text[len(key):] if text.startswith(key) else text
    remainder = remainder.strip("-")
    remainder = remainder.replace("-effort", "").replace("thinking-", "")

    if not remainder or remainder == "thinking":
        return "plain"
    for token in _EFFORT_TOKENS:
        if token in remainder.split("-"):
            return token
    return remainder


def load_weights() -> tuple[dict[str, float], int, str]:
    """Weights are config, not code: they are meant to be changed by pull request."""
    path = CONFIG / "weights.json"
    if not path.exists():
        return dict(DEFAULT_WEIGHTS), DEFAULT_MIN_COVERAGE, DEFAULT_VARIANT_POLICY
    payload = json.loads(path.read_text(encoding="utf-8"))
    weights = payload.get("weights") or DEFAULT_WEIGHTS
    minimum = int(payload.get("min_coverage_for_ranking", DEFAULT_MIN_COVERAGE))
    policy = payload.get("variant_policy", DEFAULT_VARIANT_POLICY)
    if policy not in VARIANT_POLICIES:
        raise ValueError(
            f"variant_policy must be one of {VARIANT_POLICIES}, got {policy!r}"
        )
    return dict(weights), minimum, policy


def load_methodology_version() -> str:
    """Read from config so a formula change and its version bump land in the same diff."""
    path = CONFIG / "weights.json"
    if not path.exists():
        return DEFAULT_METHODOLOGY_VERSION
    payload = json.loads(path.read_text(encoding="utf-8"))
    return str(payload.get("methodology_version") or DEFAULT_METHODOLOGY_VERSION)


def choose_model_variant(merged: dict[str, dict], key: str) -> str | None:
    """Pick one configuration for the whole model, not one per benchmark.

    Choosing per benchmark lets a model take its max-effort score in Math and its xhigh
    score in Coding - a configuration nobody actually runs, which is the same objection
    that rules out averaging. One label across every benchmark always describes a real,
    reproducible setup.

    The label that covers the most benchmarks wins, so the choice costs as little
    coverage as possible. Ties prefer the plainly published variant, then the stronger
    average score.
    """
    coverage: dict[str, set[str]] = {}
    totals: dict[str, list[float]] = {}
    for benchmark_id, slot in merged.items():
        for entry in slot["entries"]:
            label = effort_label(entry.get("variant") or "", key)
            coverage.setdefault(label, set()).add(benchmark_id)
            totals.setdefault(label, []).append(entry["value"])

    if not coverage:
        return None

    def score(label: str) -> tuple[int, int, float]:
        values = totals[label]
        return (
            len(coverage[label]),
            1 if label == "plain" else 0,
            sum(values) / len(values),
        )

    return max(coverage, key=score)


def pick_variant(entries: list[dict], key: str, policy: str) -> tuple[float, str]:
    """Collapse one benchmark's variants into a single value. Returns (value, note)."""
    if len(entries) == 1:
        return entries[0]["value"], ""

    values = [entry["value"] for entry in entries]

    if policy == "average":
        return (
            round(sum(values) / len(values), 2),
            f"mean of {len(entries)} published variants",
        )

    if policy == "best":
        winner = max(entries, key=lambda entry: entry["value"])
        return winner["value"], (
            f"best of {len(entries)} variants ({winner.get('variant') or 'unlabelled'})"
        )

    # "default": prefer the variant the vendor shipped without an effort qualifier, i.e.
    # the one whose raw name already normalises to the canonical key.
    from .common import norm  # local import keeps this module free of a cycle

    plain = [
        entry for entry in entries
        if (entry.get("variant") or "").strip().lower().replace("_", "-") == key
    ]
    if plain:
        winner = plain[0]
        return winner["value"], (
            f"default variant ({winner.get('variant')}) of {len(entries)} published"
        )

    winner = max(entries, key=lambda entry: entry["value"])
    return winner["value"], (
        f"no plain variant published; best of {len(entries)} "
        f"({winner.get('variant') or 'unlabelled'})"
    )


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
    weights, min_coverage, variant_policy = load_weights()

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
                "entries": [],
                "source_type": entry["source_type"],
                "source_url": entry["source_url"],
                "measured_at": entry["measured_at"],
            })
            slot["entries"].append(entry)
            latest = slot["measured_at"]
            if entry["measured_at"] and (not latest or entry["measured_at"] > latest):
                slot["measured_at"] = entry["measured_at"]

        chosen_label = (
            choose_model_variant(merged, key) if variant_policy == "model" else None
        )

        for benchmark_id, slot in merged.items():
            if variant_policy == "model":
                matching = [
                    entry for entry in slot["entries"]
                    if effort_label(entry.get("variant") or "", key) == chosen_label
                ]
                if not matching:
                    # This benchmark never measured the chosen configuration. Substituting
                    # another one would rebuild the Frankenstein this policy exists to
                    # avoid, so the cell is left missing and coverage reflects that.
                    continue
                value = matching[0]["value"]
                note = (
                    f"variant {chosen_label} ({matching[0].get('variant')})"
                    if len(slot["entries"]) > 1 else None
                )
            else:
                value, note = pick_variant(slot["entries"], key, variant_policy)

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
                "notes": note or None,
                "variant": chosen_label if variant_policy == "model" else None,
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
