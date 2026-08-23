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

# Human preference is one benchmark among the others as far as the variant policy is
# concerned, so it needs an id to be counted with them.
ARENA_BENCHMARK = "lmarena_text_overall"

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


def choose_model_variant(
    merged: dict[str, dict], key: str, arena_variants: list[dict] | None = None
) -> str | None:
    """Pick one configuration for the whole model, not one per benchmark.

    Choosing per benchmark lets a model take its max-effort score in Math and its xhigh
    score in Coding - a configuration nobody actually runs, which is the same objection
    that rules out averaging. One label across every benchmark always describes a real,
    reproducible setup.

    The label that covers the most benchmarks wins, so the choice costs as little
    coverage as possible. Ties prefer the plainly published variant, then the stronger
    average score.

    Human preference breaks ties in that count. Leaving Arena out of the choice entirely
    was the original mistake: the label was settled over the benchmarks alone and Arena
    then contributed whichever variant scored highest, so 27 of 56 models carried a
    rating from a configuration their benchmark scores did not describe.

    Arena breaks ties rather than casting a full vote, and the difference was measured.
    As a full vote its single row flips labels that four benchmarks already agreed on -
    Claude Opus 4.6 lost every LiveBench score and 17.88 composite points that way,
    because `-thinking` normalises to the same label as the plain name and tipped a 4-4
    tie. As a tie-breaker it still fixes the case it exists for: GPT-5 mini's `medium`
    and `high` cover four benchmarks each, and Arena only measured `high`, so `high` is
    the configuration that can be reported end to end.
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

    measured_by_arena = {
        effort_label(row["model_name"], key) for row in arena_variants or []
    }

    def score(label: str) -> tuple[int, int, int, float]:
        values = totals[label]
        return (
            len(coverage[label]),
            1 if label in measured_by_arena else 0,
            1 if label == "plain" else 0,
            # Arena ratings never reach this average: a Bradley-Terry rating sits near
            # 1400 while the benchmarks are percentages near 80, so including it would
            # decide every remaining tie on scale alone.
            sum(values) / len(values) if values else 0.0,
        )

    return max(coverage, key=score)


def pick_arena_variant(
    rows: list[dict], key: str, chosen_label: str | None
) -> tuple[dict | None, str | None]:
    """The Arena row for the configuration the rest of the model describes, if there is one.

    Returns (row, mismatch_label). A mismatch_label means Arena never published the chosen
    configuration and this rating describes a different one.

    Dropping those was measured first and costs too much to be the honest option: it
    removes human preference from 21 of 43 models, because Epoch labels effort levels
    (`_max`, `_high`) while Arena mostly publishes a plain name and a thinking variant.
    The two vocabularies are not commensurable, so a missing match is usually a naming
    difference rather than evidence that the configurations differ. Throwing away real
    human votes over that trades a known measurement for an unknown one.

    So the rating is kept and the discrepancy is disclosed per model instead. What does
    NOT survive is picking by highest rating: that is the "best" policy config/weights.json
    rejected, and it silently flattered every model with a strong variant. Where no match
    exists, the best-determined row wins - the freshest vote tally, the same rule that
    resolves mislabelled slices upstream.
    """
    if not rows:
        return None, None
    if chosen_label is None:
        # The other variant policies never made a model-wide choice, so there is no label
        # to honour and the historical behaviour stands.
        return max(rows, key=lambda row: row["rating"]), None

    matching = [row for row in rows if effort_label(row["model_name"], key) == chosen_label]
    if matching:
        return max(matching, key=lambda row: row.get("vote_count") or 0), None

    winner = max(rows, key=lambda row: row.get("vote_count") or 0)
    return winner, effort_label(winner["model_name"], key)


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


# Uncertainty is carried as the half-width of a 95% interval, in composite points, all
# the way through. Mixing a standard error from one source with a published interval from
# another is the easiest way to produce a number that means nothing, so both are converted
# to the same thing at the edge and never mixed again.
#
# 1.96 standard errors is the 95% half-width for Epoch's per-row stderr. LMArena publishes
# the interval directly and it only needs rescaling with the rating.
CONFIDENCE_Z = 1.96


def combine_mean(half_widths: list[float | None], count: int) -> float | None:
    """Half-width of the mean of `count` values, of which some are known.

    Inputs without a published uncertainty contribute zero, which is why every interval
    this module produces is a LOWER BOUND and is labelled as one. LiveBench publishes no
    per-row error, so treating its silence as precision would be an invention; treating it
    as a floor is merely incomplete, and it stays sound in one direction: an interval that
    can only widen still supports "these two overlap", never "these two differ".

    None when nothing at all is known, which is a different statement from zero. Returning
    0.0 there would print "+-0.00" next to a score whose precision was never measured -
    the most confident-looking cell in the table sitting on the least evidence.
    """
    known = [hw for hw in half_widths if hw is not None]
    if not count or not known:
        return None
    return (sum(hw * hw for hw in known) ** 0.5) / count


def combine_weighted(parts: list[tuple[float, float | None]]) -> float | None:
    """Half-width of a weighted mean, given (weight, half_width) pairs.

    Assumes the categories are independent. They are not entirely - a model good at maths
    tends to be good at reasoning, and Epoch measures several of these on overlapping
    skills - and correlated inputs make the true interval wider than this. Another reason
    the published figure is a floor. Stated in /methodology rather than left implicit.
    """
    total = sum(weight for weight, _ in parts)
    known = [(weight, hw) for weight, hw in parts if hw is not None]
    if not total or not known:
        return None
    return (sum((weight / total) ** 2 * hw * hw for weight, hw in known) ** 0.5)


def minmax(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 1.0
    low, high = min(values), max(values)
    return (low, high) if high > low else (low, low + 1.0)


def assign_significance_ranks(models: list[dict]) -> None:
    """Set `rank` and `tied_with` on every model, in place.

    Ranked and provisional are ordered independently; only the ranked set gets numbers,
    so a thinly measured model can never occupy a top-N slot.

    The number itself is a significance rank, not a position in a sorted list: a model
    sits at one plus the count of models measurably ahead of it, so anything the
    measurement cannot separate shares a rank. Ordinal ranking was making a promise the
    data does not support - the median gap between neighbours was 0.43 composite points
    against a median Epoch stderr of 1.51 to 2.59, and two pairs sat at exactly 0.00 and
    still received different numbers.

    Overlap is not transitive, which is why this counts strictly-better models instead
    of grouping runs of neighbours: A can overlap B and B overlap C while A and C are
    cleanly separated, and a chain rule would merge all three.

    A model whose inputs published no uncertainty is compared as a point value. That is
    zero-filling, and it is the one place here that does it, so it is flagged per model
    rather than hidden: `composite_error` is null and the page says the precision was
    never measured. The alternative - refusing to separate it from anyone - reads worse,
    because it would lift a model 5 points behind the leader into a tie for first on the
    strength of knowing less about it.
    """
    ranked = [m for m in models if not m["provisional"]]
    for model in models:
        if model["provisional"]:
            model["rank"] = None
            model["tied_with"] = 0
            continue
        floor = model["composite"] + (model["composite_error"] or 0.0)
        model["rank"] = 1 + sum(
            1 for other in ranked
            if other is not model
            and other["composite"] - (other["composite_error"] or 0.0) > floor
        )
    shared: dict[int, int] = {}
    for model in ranked:
        shared[model["rank"]] = shared.get(model["rank"], 0) + 1
    for model in ranked:
        model["tied_with"] = shared[model["rank"]] - 1


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

    # First pass: settle which configuration each model is being reported under.
    #
    # This has to finish before anything is normalised. The chosen configuration decides
    # which Arena row the model contributes, and the Arena cohort decides the min-max
    # bounds, so computing the bounds first would scale the ratings against a cohort that
    # includes variants no model ends up using.
    merged_by_key: dict[str, dict[str, dict]] = {}
    chosen_by_key: dict[str, str | None] = {}
    arena_by_key: dict[str, dict] = {}
    arena_notes: dict[str, str] = {}

    for key in keys:
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
        merged_by_key[key] = merged

        arena_rows = arena_text.get(key) or []
        chosen = (
            choose_model_variant(merged, key, arena_rows)
            if variant_policy == "model" else None
        )
        chosen_by_key[key] = chosen

        row, mismatch = pick_arena_variant(arena_rows, key, chosen)
        if row is not None:
            arena_by_key[key] = row
        if mismatch:
            arena_notes[key] = mismatch

    # Arena ratings are Bradley-Terry, not a percentage, so they are min-max normalised
    # across the cohort actually present in this build. Documented in /methodology.
    arena_low, arena_high = minmax([row["rating"] for row in arena_by_key.values()])

    models: list[dict] = []
    score_rows: list[dict] = []
    providers: dict[str, dict] = {}
    aliases: dict[str, dict] = {}

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

        # Which raw name each source matched, kept per source rather than as one flat
        # list. A wrong match attributes another model's scores to this one, which is the
        # worst failure this pipeline can have and the only one it cannot detect itself;
        # the least it can do is show its work.
        matched: dict[str, set[str]] = {"epoch": set(), "livebench": set(), "lmarena": set()}
        seen_alias = {key}
        by_category: dict[str, list[float]] = {}
        error_by_category: dict[str, list[float | None]] = {}
        measured_errors = 0
        total_inputs = 0
        merged = merged_by_key[key]
        chosen_label = chosen_by_key[key]

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
                chosen_entry = matching[0]
                value = chosen_entry["value"]
                note = (
                    f"variant {chosen_label} ({chosen_entry.get('variant')})"
                    if len(slot["entries"]) > 1 else None
                )
            else:
                value, note = pick_variant(slot["entries"], key, variant_policy)
                chosen_entry = next(
                    (e for e in slot["entries"] if e["value"] == value), slot["entries"][0]
                )

            stderr = chosen_entry.get("stderr")
            half_width = round(stderr * CONFIDENCE_Z, 3) if stderr is not None else None

            by_category.setdefault(slot["category"], []).append(value)
            error_by_category.setdefault(slot["category"], []).append(half_width)
            total_inputs += 1
            if half_width is not None:
                measured_errors += 1

            score_rows.append({
                "model_id": model_id,
                "benchmark_id": benchmark_id,
                "value": value,
                "unit": "percent",
                "stderr": stderr,
                "half_width_95": half_width,
                "source_type": slot["source_type"],
                "source_url": slot["source_url"],
                "measured_at": slot["measured_at"],
                "contamination_flag": False,
                "notes": note or None,
                "variant": chosen_label if variant_policy == "model" else None,
            })

        for entry in epoch_scores.get(key, []):
            if entry.get("variant"):
                matched["epoch"].add(entry["variant"])
        for entry in livebench_scores.get(key, []):
            if entry.get("variant"):
                matched["livebench"].add(entry["variant"])

        # Every variant Arena published is an alias of this model, whether or not it is
        # the one being scored, so the alias table shows the full set that matched.
        for published in arena_text.get(key) or []:
            seen_alias.add(published["model_name"])
            matched["lmarena"].add(published["model_name"])

        if key in arena_by_key:
            row = arena_by_key[key]
            span = arena_high - arena_low
            scaled = (row["rating"] - arena_low) / span * 100.0
            by_category.setdefault("human_preference", []).append(round(scaled, 2))

            # Arena publishes the interval itself, so it only needs the same rescaling the
            # rating gets. No z multiplier: it is already a 95% interval.
            lower, upper = row.get("rating_lower"), row.get("rating_upper")
            arena_hw = (
                round((upper - lower) / 2.0 / span * 100.0, 3)
                if lower is not None and upper is not None else None
            )
            error_by_category.setdefault("human_preference", []).append(arena_hw)
            total_inputs += 1
            if arena_hw is not None:
                measured_errors += 1

            notes = f"{int(row['vote_count'])} votes; rank {int(row['rank'])}"
            score_rows.append({
                "model_id": model_id,
                "benchmark_id": ARENA_BENCHMARK,
                "value": round(row["rating"], 1),
                "unit": "bradley_terry_rating",
                "stderr": None,
                # In rating points, not composite points: this row displays the raw
                # rating, so its interval has to be on the same scale the reader sees.
                "half_width_95": (
                    round((upper - lower) / 2.0, 1)
                    if lower is not None and upper is not None else None
                ),
                "source_type": "human_eval",
                "source_url": "https://lmarena.ai/leaderboard",
                "measured_at": arena_snapshot,
                "contamination_flag": False,
                "notes": notes,
                "variant": chosen_label if variant_policy == "model" else None,
                # Structured, not prose: the page is bilingual, so the sentence belongs
                # in messages/*.json and only the fact belongs here.
                "variant_mismatch": arena_notes.get(key),
                "measured_name": row["model_name"],
            })

        category_scores = {
            category: round(sum(values) / len(values), 2)
            for category, values in by_category.items()
        }
        category_errors = {}
        for category, values in by_category.items():
            combined = combine_mean(error_by_category.get(category, []), len(values))
            category_errors[category] = round(combined, 3) if combined is not None else None
        available = {c: w for c, w in weights.items() if c in category_scores}
        if not available:
            continue

        composite = sum(
            category_scores[c] * w for c, w in available.items()
        ) / sum(available.values())
        composite_error = combine_weighted(
            [(w, category_errors[c]) for c, w in available.items()]
        )

        accessibility = meta["accessibility"].lower()
        is_open = "open weights" in accessibility

        vision = None
        vision_rows = arena_vision.get(key) or []
        if vision_rows:
            # Vision sits outside the composite, so no configuration has been settled for
            # it. The strongest published variant stands, labelled with which one it is.
            best_vision = max(vision_rows, key=lambda row: row["rating"])
            vision = {
                "rating": round(best_vision["rating"], 1),
                "rank": int(best_vision["rank"]),
                "variant": best_vision["model_name"],
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
            "category_errors": category_errors,
            "composite": round(composite, 2),
            # Half-width of a 95% interval, in composite points, and a floor rather than
            # an estimate: inputs that publish no uncertainty contribute zero to it.
            # null when no input published one at all - unknown, not zero.
            "composite_error": (
                round(composite_error, 2) if composite_error is not None else None
            ),
            "uncertainty": {
                "measured_inputs": measured_errors,
                "total_inputs": total_inputs,
                "is_lower_bound": True,
            },
            "coverage": {
                "covered": len(available),
                "total": len(weights),
                "missing": sorted(set(weights) - set(available)),
            },
            # How much independent evidence stands behind the composite, which is a
            # different question from how many categories it covers. Two models can hold
            # the same score with six benchmarks behind one and four behind the other.
            #
            # The source count carries little information on its own - a model needs two
            # sources to appear at all, so it only ever reads 2 or 3 - which is why the
            # benchmark count sits beside it. That one runs 4 to 9 across the table.
            "evidence": {
                "sources": sum(1 for names in matched.values() if names),
                "max_sources": len(matched),
                "benchmarks": len(merged) + (1 if key in arena_by_key else 0),
            },
            "provisional": len(available) < min_coverage,
            "awaiting_human_votes": "human_preference" not in available,
            # The single configuration this model is reported under, and - only when they
            # disagree - the one Arena actually measured. Stated rather than smoothed
            # over: the reader can see that two axes describe two setups.
            "variant": chosen_label,
            "human_preference_variant": arena_notes.get(key),
            "vision": vision,
            # The variant actually scored, so the history series follows the same
            # configuration the composite reports rather than the best-rated sibling.
            "arena_name": arena_by_key[key]["model_name"] if key in arena_by_key else None,
        })
        aliases[model_id] = {
            "canonical_key": key,
            "display_name": meta["display_name"],
            "variant": chosen_label,
            "scored_arena_name": (
                arena_by_key[key]["model_name"] if key in arena_by_key else None
            ),
            "names": sorted(seen_alias),
            "matched": {source: sorted(names) for source, names in matched.items()},
        }

    models.sort(key=lambda m: m["composite"], reverse=True)
    assign_significance_ranks(models)

    # Ordered by rank, then by score inside a rank. Sorting by score alone would print a
    # rank column that runs 13, 17, 16 downward and read as a bug: a significance rank is
    # not monotonic in the score, because a model with a narrow interval is more easily
    # excluded by the ones above it than a model with a wide one sitting at the same
    # number. The statistic is right; the order has to follow it rather than the score.
    models.sort(
        key=lambda m: (m["provisional"], m["rank"] if m["rank"] else 0, -m["composite"])
    )

    return models, score_rows, providers, aliases, (arena_low, arena_high)
