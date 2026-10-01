"""Score normalisation, the weighted composite, and the coverage gate."""
from __future__ import annotations

import json
import math
import re

from .common import CONFIG, canonical_organization, is_hosted, slugify, split_name

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


def effort_label(variant: str, key: str | None = None) -> str:
    """Reduce a published variant name to the configuration it represents.

    Sources spell the same configuration differently - Epoch writes "claude-opus-5_max",
    LiveBench "claude-opus-5-max-effort" - so comparing raw strings would treat one
    configuration as several. This maps both onto "max".

    The label is read from the qualifiers the normaliser actually cut, not from what is
    left after subtracting the key. Subtraction broke whenever a name reached its key
    through an alias or a protected product tier: "mistral-small-2506" does not start
    with "mistral-small-3.2", so the whole name came back as a configuration. `key` is
    kept for callers that pass it and no longer changes the result.
    """
    if not (variant or "").strip():
        return "unlabelled"

    _, qualifiers = split_name(variant)
    words = {
        word
        for qualifier in qualifiers
        for word in qualifier.replace("-effort", "").split("-")
    }
    if "non" in words and "reasoning" in words:
        return "none"
    for token in _EFFORT_TOKENS:
        if token in words:
            return token
    rest = [q for q in qualifiers if q not in ("thinking", "reasoning", "thinking-auto")]
    if not rest:
        return "plain"
    # Qualifiers outermost first; reversed so "it-32k" reads in the published order.
    return "-".join(reversed(rest))


# Trailing parentheticals that name a configuration or a host rather than the model:
# "(high)", "(no thinking)", "(16k thinking)", "(Fireworks)".
_CONFIG_PAREN = re.compile(
    r"\s*\((?:no thinking|unknown thinking|unknown|none|minimal|low|medium|high|xhigh|max"
    r"|\d+k thinking|thinking|together|fireworks|novita|openrouter|chutes)\)\s*$",
    re.IGNORECASE,
)

# Labels that read as an effort setting when appended to a name.
_SHOWN_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")


def display_name_for(meta: dict, label: str | None) -> str:
    """The name of the configuration actually scored.

    Epoch's own display names agree with their versions (one exception in 300+ rows
    checked 2026-10-01), so the name of a version that matches the scored label is used
    as published. When no version matches - the label came from LiveBench or Arena - the
    configuration parenthetical is stripped from a vendor-run version's name and the
    scored label appended, so "Muse Spark 1.3 (high)" can no longer front xhigh scores.
    """
    versions = [v for v in meta.get("versions") or [] if not is_hosted(v["version"])]
    if label is not None:
        for version in versions:
            if effort_label(version["version"]) == label and version["display_name"]:
                return version["display_name"]

    # The model-level name, not the shortest version name: Epoch files deepseek-v4-flash's
    # unknown-effort run as "DeepSeek v4 (unknown)", which would drop "Flash".
    base = _CONFIG_PAREN.sub("", meta["display_name"]).strip()
    if label in _SHOWN_EFFORTS:
        return f"{base} ({label})"
    return base


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


def load_contamination_registry() -> dict[str, list[dict]]:
    """Public evidence of training-set contamination, by benchmark_id.

    Never used to attenuate a score - that was rejected during Fase 5 as fabricating a
    number from an estimate. This is the registry side that decision kept: the flag and
    its evidence are shown next to the score, and the reader judges. Starts empty rather
    than with an invented entry; /methodology states the date it was last checked, which
    is itself a real claim - "nothing logged yet" - not a promise with nothing behind it.
    """
    path = CONFIG / "contamination.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("benchmarks") or {}


def contamination_reviewed_at() -> str | None:
    """When the registry above was last checked, published so an empty registry reads
    as "nothing logged as of this date" rather than an unstated promise."""
    path = CONFIG / "contamination.json"
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("reviewed_at")


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

    def score(label: str) -> tuple[int, int, int, int, float]:
        values = totals[label]
        return (
            # Categories first: coverage is what the ranking gate counts. Counting
            # benchmarks alone let a source that runs six benchmarks in two categories
            # outvote one that runs five across four, and the model lost its only
            # Instruction-following result for it.
            len({merged[b]["category"] for b in coverage[label]}),
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


def resolve_same_configuration(entries: list[dict]) -> tuple[dict, str | None]:
    """One row from several that describe the same configuration of one benchmark.

    Returns (row, note). This used to be `entries[0]`, so CSV order decided: GPT-5.1 has two
    SWE-bench Verified runs at `high` (67.98 and 65.91) and whichever Epoch listed first
    was published. The rule, in order:

    1. The vendor's own endpoint beats a third-party host (chutes/, fireworks/), whose
       serving stack - quantisation, context limits - is not the vendor's.
    2. A released model beats its pre-release checkpoint.
    3. Repeated runs of the identical configuration are averaged: they are repeated
       measurements of one thing, which is exactly when averaging is honest. The interval
       is combined as for any mean.
    4. Otherwise the most recent run.
    """
    if len(entries) == 1:
        return entries[0], None

    def rank(entry: dict) -> tuple[int, int]:
        name = entry.get("variant") or ""
        return (int(is_hosted(name)), int("pre-release" in split_name(name)[1]))

    best = min(rank(entry) for entry in entries)
    pool = [entry for entry in entries if rank(entry) == best]
    note = None
    if len(pool) < len(entries):
        note = f"{len(entries) - len(pool)} hosted or pre-release run(s) set aside"
    if len(pool) == 1:
        return pool[0], note

    names = {entry.get("variant") for entry in pool}
    if len(names) == 1:
        values = [entry["value"] for entry in pool]
        errors = [entry.get("stderr") for entry in pool]
        merged = dict(pool[0])
        merged["value"] = round(sum(values) / len(values), 2)
        merged["stderr"] = (
            round((sum(e * e for e in errors) ** 0.5) / len(errors), 3)
            if all(e is not None for e in errors) else None
        )
        merged["measured_at"] = max(
            (entry.get("measured_at") or "" for entry in pool), default=""
        ) or None
        return merged, f"mean of {len(pool)} runs of the same configuration"

    latest = max(pool, key=lambda entry: entry.get("measured_at") or "")
    return latest, f"most recent of {len(pool)} runs"


def select_benchmarks(
    merged: dict[str, dict], key: str, chosen_label: str | None, policy: str
) -> dict[str, dict]:
    """One value per benchmark for one model, under its chosen configuration.

    Returns {benchmark_id: {value, stderr, half_width, entry, note, slot, category}}. A
    benchmark that never measured the chosen configuration is absent: substituting
    another configuration would rebuild the Frankenstein the model-wide policy exists to
    avoid, so the cell stays missing and coverage reflects that.
    """
    out: dict[str, dict] = {}
    for benchmark_id, slot in merged.items():
        if policy == "model":
            matching = [
                entry for entry in slot["entries"]
                if effort_label(entry.get("variant") or "", key) == chosen_label
            ]
            if not matching:
                continue
            chosen_entry, duplicate_note = resolve_same_configuration(matching)
            value = chosen_entry["value"]
            note = (
                f"variant {chosen_label} ({chosen_entry.get('variant')})"
                if len(slot["entries"]) > 1 else None
            )
            if duplicate_note:
                note = f"{note}; {duplicate_note}" if note else duplicate_note
        else:
            value, note = pick_variant(slot["entries"], key, policy)
            chosen_entry = next(
                (e for e in slot["entries"] if e["value"] == value), slot["entries"][0]
            )
        stderr = chosen_entry.get("stderr")
        out[benchmark_id] = {
            "value": value,
            "stderr": stderr,
            "half_width": round(stderr * CONFIDENCE_Z, 3) if stderr is not None else None,
            "entry": chosen_entry,
            "note": note,
            "slot": slot,
            "category": slot["category"],
        }
    return out


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


# Below this many models measured on both a benchmark and its category anchor, the scale
# relation between them is not estimated and the benchmark is shown but not scored.
DEFAULT_MIN_EQUATING_OVERLAP = 5

# One-sided 5% critical values of Student's t, df 1..30. Stdlib has no t distribution and
# the ingest takes no dependencies; past 30 the Cornish-Fisher correction below is within
# 0.002 of the exact value.
_T95 = (
    6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812,
    1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734, 1.729, 1.725,
    1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697,
)


def t_critical_95(df: int) -> float:
    if df < 1:
        return float("inf")
    if df <= len(_T95):
        return _T95[df - 1]
    z = 1.6449
    return z + (z ** 3 + z) / (4 * df)


def correlation_is_significant(r: float, n: int) -> bool:
    """One-sided test that a paired correlation is above zero at 5%."""
    if n < 3 or r <= 0:
        return False
    if r >= 1:
        return True
    t = r * ((n - 2) / (1 - r * r)) ** 0.5
    return t > t_critical_95(n - 2)


def load_equating_config() -> dict:
    """Anchors, overlap floor and display-only benchmarks from config/weights.json."""
    path = CONFIG / "weights.json"
    payload = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    equating = payload.get("equating") or {}
    return {
        "anchors": dict(equating.get("anchors") or {}),
        "min_overlap": int(equating.get("min_overlap", DEFAULT_MIN_EQUATING_OVERLAP)),
        "display_only": dict(equating.get("display_only") or {}),
    }


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _pstdev(values: list[float]) -> float:
    mu = _mean(values)
    return (sum((v - mu) ** 2 for v in values) / len(values)) ** 0.5


def fit_equating(
    selected: dict[str, dict[str, dict]],
    order: list[str],
    config: dict,
) -> dict[str, dict]:
    """Put every benchmark of a category on the scale of that category's anchor.

    The problem this solves was measured on the 2026-09-29 cohort: a category was the plain
    mean of whichever benchmarks a model happened to be run on, and those benchmarks sit
    at very different levels - FrontierMath averaged 31.9 against LiveBench Math's 89.5,
    both "Math". A model's category score depended more on which benchmark it was given
    than on how good it was: Gemini 3 Pro's Math was 37.6 because FrontierMath was its only
    maths result, and 41 of 62 ranked models moved 5+ places under a per-benchmark rescale.

    Linear (mean-sigma) equating, the standard test-equating method: for benchmark B and
    anchor A, over the models measured on both, B' = mean_A + sd_A / sd_B * (B - mean_B).
    Fitted on paired models, so the two benchmarks are compared on the same population
    instead of on two different sets of models.

    Chosen against two alternatives by leave-one-model-out substitution drift - the mean
    gap between a model's anchor score and its equated score on B, fitted without it,
    which is exactly "how much does the category move if this model had only been given
    B". On 2026-10-01: SimpleQA 31.52 raw / 10.94 shift-only / 3.55 mean-sigma,
    FrontierMath v2 19.17 / 12.14 / 2.37, Chess Puzzles 46.85 / 9.96 / 5.12, SWE-bench
    Verified 14.57 / 5.68 / 5.90. A shift-only rule wins narrowly on GPQA, OTIS and SWE-bench
    and loses badly everywhere else; one rule for every benchmark beats a rule per case.

    The anchor per category is fixed in config/weights.json. Picking it by count each build
    let GPQA, near its ceiling, take over Reasoning the day Epoch out-covered LiveBench.
    A category without a configured anchor falls back to its best-covered benchmark.

    Two gates, each leaving the benchmark visible but unscored: fewer than `min_overlap`
    shared models, or a paired correlation that is not significantly positive - equating
    two benchmarks that do not move together would manufacture a score.

    Returns {benchmark_id: parameters}; unscored ones carry the reason.
    """
    min_overlap = config["min_overlap"]
    display_only = config["display_only"]
    by_category: dict[str, list[str]] = {}
    category_of: dict[str, str] = {}
    for slots in selected.values():
        for benchmark_id, pick in slots.items():
            category_of[benchmark_id] = pick["category"]
    for benchmark_id in sorted(category_of, key=lambda b: order.index(b) if b in order else len(order)):
        by_category.setdefault(category_of[benchmark_id], []).append(benchmark_id)

    params: dict[str, dict] = {}
    for category, benchmarks in by_category.items():
        counts = {
            b: sum(1 for slots in selected.values() if b in slots) for b in benchmarks
        }
        configured = config["anchors"].get(category)
        if configured in benchmarks:
            anchor = configured
        else:
            scorable = [b for b in benchmarks if b not in display_only] or benchmarks
            anchor = max(scorable, key=lambda b: (counts[b], -benchmarks.index(b)))
        params[anchor] = {
            "category": category, "anchor": anchor, "scored": True,
            "slope": 1.0, "intercept": 0.0, "overlap": counts[anchor],
            "r": 1.0, "residual_sd": 0.0, "equating_se": 0.0,
        }
        for benchmark in benchmarks:
            if benchmark == anchor:
                continue
            pairs = [
                (slots[anchor]["value"], slots[benchmark]["value"])
                for slots in selected.values()
                if anchor in slots and benchmark in slots
            ]
            entry = {"category": category, "anchor": anchor, "overlap": len(pairs)}
            if benchmark in display_only:
                params[benchmark] = {**entry, "scored": False, "reason": "display_only"}
                continue
            if len(pairs) < min_overlap:
                params[benchmark] = {**entry, "scored": False, "reason": "overlap"}
                continue
            a = [p[0] for p in pairs]
            b = [p[1] for p in pairs]
            sd_a, sd_b = _pstdev(a), _pstdev(b)
            if sd_b == 0 or sd_a == 0:
                params[benchmark] = {**entry, "scored": False, "reason": "no_spread"}
                continue
            slope = sd_a / sd_b
            intercept = _mean(a) - slope * _mean(b)
            residuals = [x - (intercept + slope * y) for x, y in zip(a, b)]
            residual_sd = _pstdev(residuals)
            mu_a, mu_b = _mean(a), _mean(b)
            r = sum((x - mu_a) * (y - mu_b) for x, y in pairs) / (len(pairs) * sd_a * sd_b)
            if not correlation_is_significant(r, len(pairs)):
                params[benchmark] = {
                    **entry, "scored": False, "reason": "weak_correlation", "r": round(r, 3),
                }
                continue
            params[benchmark] = {
                **entry, "scored": True,
                "slope": round(slope, 4), "intercept": round(intercept, 3),
                "r": round(r, 3), "residual_sd": round(residual_sd, 3),
                # Standard error of the fitted offset at the centre of the data: what the
                # finite overlap adds to every equated score's interval.
                "equating_se": round(residual_sd / len(pairs) ** 0.5, 3),
            }
    return params


# LMArena's Bradley-Terry ratings use the Elo convention: base 10, 400 points.
ARENA_BASE = 10.0
ARENA_SCALE = 400.0


def arena_win_rate(rating: float, cohort: list[float]) -> tuple[float, float]:
    """(expected % of head-to-heads won against the rest of the cohort, d% / d rating).

    Replaces min-max, measured on the 2026-10-01 cohort (45 models with all five
    categories). Min-max stretched whatever range the cohort spans to 0-100: human
    preference carried 31.3% of the composite's variance against its nominal 15%, and
    removing a single model from the Arena cohort - whichever set the minimum or maximum -
    moved other composites by up to 7.10 points. As a win rate it carries 9.0% and the
    worst single removal moves anyone 0.26 points. It undershoots the nominal weight
    because the frontier is genuinely close in head-to-head terms; that is disclosed, not
    corrected, since inflating it back would be min-max's distortion under another name.

    `cohort` includes this model's own rating once; its self-match (0.5) is removed.
    """
    others = len(cohort) - 1
    if others < 1:
        return 50.0, 0.0
    probabilities = [
        1.0 / (1.0 + ARENA_BASE ** ((other - rating) / ARENA_SCALE)) for other in cohort
    ]
    share = (sum(probabilities) - 0.5) / others
    # d p / d rating = p (1 - p) ln(base) / scale; the self term (0.25) is removed.
    slope = sum(p * (1 - p) for p in probabilities) - 0.25
    slope *= math.log(ARENA_BASE) / ARENA_SCALE / others
    return share * 100.0, slope * 100.0


def minmax(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 1.0
    low, high = min(values), max(values)
    return (low, high) if high > low else (low, low + 1.0)


def apply_composites(models: list[dict], weights: dict[str, float]) -> dict:
    """Set each model's composite and add the missing-category term to its interval.

    A model missing a category used to be scored on the weighted mean of the categories it
    has. That silently assumed the missing category sat at the model's own average, and
    categories sit at different levels: on 2026-09-29 a model missing Coding (the lowest
    category) gained 3.85 points on average just for not having it. With human preference
    expressed as a win rate (level ~50 against ~80 elsewhere) the same rule would have put
    every model still awaiting Arena votes at the top of the table.

    So deviations are renormalised, not levels:

        composite = sum_all w_c * mean_c + sum_avail w_c (s_c - mean_c) / sum_avail w_c

    where mean_c is the cohort mean of category c. With every category present this is
    exactly the weighted mean. With one missing, the model is assumed to be as far above
    or below the cohort there as it is elsewhere - no level bias in either direction.

    That assumption is still a guess about an unmeasured number, so it widens the
    interval instead of hiding: for each category, the RMS gap between the full composite
    and the composite recomputed without that category, over every model that has all of
    them, is how wrong the guess typically is. 1.96 times that joins the half-width.
    """
    present = [m for m in models if m["category_scores"]]
    full = [m for m in present if all(c in m["category_scores"] for c in weights)]
    # Means over the models measured on everything, so "average" means the same population
    # in every category. Over all models it drifted with whoever happened to be partial:
    # a residual bias of up to 1.06 points on 2026-10-01, against 0.0 this way.
    reference = full or present
    means = {}
    for category in weights:
        values = [
            m["category_scores"][category] for m in reference if category in m["category_scores"]
        ]
        if values:
            means[category] = sum(values) / len(values)
    level = sum(weights[c] * means[c] for c in weights if c in means)

    def composite_of(scores: dict[str, float], skip: str | None = None) -> float | None:
        available = {
            c: w for c, w in weights.items() if c in scores and c in means and c != skip
        }
        if not available:
            return None
        deviation = sum(w * (scores[c] - means[c]) for c, w in available.items())
        return level + deviation / sum(available.values())

    sigma: dict[str, float] = {}
    for category in weights:
        gaps = [
            composite_of(m["category_scores"], skip=category) - composite_of(m["category_scores"])
            for m in full
        ]
        if gaps:
            sigma[category] = (sum(g * g for g in gaps) / len(gaps)) ** 0.5

    for model in present:
        value = composite_of(model["category_scores"])
        if value is None:
            continue
        model["composite"] = round(value, 2)
        missing = [c for c in weights if c not in model["category_scores"]]
        missing_hw = CONFIDENCE_Z * sum(sigma.get(c, 0.0) ** 2 for c in missing) ** 0.5
        model["uncertainty"]["missing_categories_hw"] = round(missing_hw, 2)
        measured = model["composite_error"]
        if measured is not None:
            model["composite_error"] = round((measured ** 2 + missing_hw ** 2) ** 0.5, 2)

    return {
        "method": "deviations from the cohort mean renormalised over available weight",
        "category_means": {c: round(v, 2) for c, v in means.items()},
        "missing_category_sigma": {c: round(v, 3) for c, v in sigma.items()},
        "models_with_all_categories": len(full),
    }


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

    # Monotone in the score. Counting strictly-better models rewards a wide interval: on
    # 2026-09-29 Gemini 3 Pro (73.06 +- 2.02) sat at 24 above GPT-5.6 Terra (74.57 +- 0.47)
    # at 25, and 13 pairs were inverted like that - the less precisely measured model
    # printed ahead of the better-scoring one. A model is now never placed ahead of one
    # with a higher composite: it takes the worse of its own rank and the rank above it,
    # which reads as a tie with that model rather than a win over it.
    worst_so_far = 0
    for model in sorted(ranked, key=lambda m: -m["composite"]):
        model["rank"] = max(model["rank"], worst_so_far)
        worst_so_far = model["rank"]
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
    benchmark_order: list[str] | None = None,
) -> tuple[list[dict], list[dict], dict, dict, dict]:
    """Return (models, score rows, providers, aliases, scales used).

    `scales` carries what this build normalised against - the Arena bounds and the
    per-benchmark equating - so /methodology can publish the numbers it actually used.
    """
    weights, min_coverage, variant_policy = load_weights()
    equating_config = load_equating_config()
    contamination = load_contamination_registry()

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

    # Arena ratings are Bradley-Terry, not a percentage. They become one through the model
    # that produced them: the expected share of head-to-head votes won against the rest
    # of the cohort. Min-max is kept only to publish the cohort's bounds.
    cohort_ratings = [row["rating"] for row in arena_by_key.values()]
    arena_low, arena_high = minmax(cohort_ratings)

    # Second pass: one value per benchmark per model, under the chosen configuration.
    # Settled for every model before anything is scaled, because the equating below is
    # fitted on the whole cohort's paired results.
    selected_by_key = {
        key: select_benchmarks(merged_by_key[key], key, chosen_by_key[key], variant_policy)
        for key in keys
    }
    equating = fit_equating(selected_by_key, benchmark_order or [], equating_config)

    models: list[dict] = []
    score_rows: list[dict] = []
    providers: dict[str, dict] = {}
    aliases: dict[str, dict] = {}

    for key in keys:
        meta = registry[key]
        organization = canonical_organization(meta["organization"])
        display_name = display_name_for(meta, chosen_by_key[key])
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
        scored_benchmarks = 0
        merged = merged_by_key[key]
        chosen_label = chosen_by_key[key]

        for benchmark_id, pick in selected_by_key[key].items():
            slot, chosen_entry = pick["slot"], pick["entry"]
            value, stderr, half_width = pick["value"], pick["stderr"], pick["half_width"]
            scale = equating.get(benchmark_id) or {"scored": False, "reason": "overlap"}

            scaled = None
            if scale["scored"]:
                scaled = scale["intercept"] + scale["slope"] * value
                scaled_hw = None
                if half_width is not None:
                    # The benchmark's own error rescaled, plus what fitting the scale on a
                    # finite overlap adds. Both are 95% half-widths in category points.
                    scaled_hw = (
                        (scale["slope"] * half_width) ** 2
                        + (CONFIDENCE_Z * scale["equating_se"]) ** 2
                    ) ** 0.5
                by_category.setdefault(slot["category"], []).append(scaled)
                error_by_category.setdefault(slot["category"], []).append(scaled_hw)
                total_inputs += 1
                if scaled_hw is not None:
                    measured_errors += 1
                scored_benchmarks += 1

            evidence = contamination.get(benchmark_id) or []
            score_rows.append({
                "model_id": model_id,
                "benchmark_id": benchmark_id,
                "value": value,
                "unit": "percent",
                "stderr": stderr,
                "half_width_95": half_width,
                # The same result on its category's common scale - what the composite
                # actually averaged. None when the benchmark is shown but not scored.
                "scaled_value": round(scaled, 2) if scaled is not None else None,
                "scored": scale["scored"],
                "source_type": slot["source_type"],
                "source_url": slot["source_url"],
                # The run actually scored, not the newest run of any configuration.
                "measured_at": chosen_entry.get("measured_at") or slot["measured_at"],
                "contamination_flag": bool(evidence),
                "contamination_evidence": evidence,
                "notes": pick["note"] or None,
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
            scaled, slope = arena_win_rate(row["rating"], cohort_ratings)
            by_category.setdefault("human_preference", []).append(round(scaled, 2))

            # Arena publishes the interval itself, so it only needs the same transform the
            # rating gets - to first order, the slope of the win rate at this rating. No z
            # multiplier: it is already a 95% interval.
            lower, upper = row.get("rating_lower"), row.get("rating_upper")
            arena_hw = (
                round((upper - lower) / 2.0 * slope, 3)
                if lower is not None and upper is not None else None
            )
            error_by_category.setdefault("human_preference", []).append(arena_hw)
            total_inputs += 1
            if arena_hw is not None:
                measured_errors += 1

            notes = f"{int(row['vote_count'])} votes; rank {int(row['rank'])}"
            arena_evidence = contamination.get(ARENA_BENCHMARK) or []
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
                "contamination_flag": bool(arena_evidence),
                "contamination_evidence": arena_evidence,
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
            "display_name": display_name,
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
                "benchmarks": scored_benchmarks + (1 if key in arena_by_key else 0),
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
            "display_name": display_name,
            "variant": chosen_label,
            "scored_arena_name": (
                arena_by_key[key]["model_name"] if key in arena_by_key else None
            ),
            "names": sorted(seen_alias),
            "matched": {source: sorted(names) for source, names in matched.items()},
        }

    renormalisation = apply_composites(models, weights)

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

    scales = {
        "arena": {"low": arena_low, "high": arena_high, "cohort_size": len(cohort_ratings)},
        "equating": equating,
        "renormalisation": renormalisation,
    }
    return models, score_rows, providers, aliases, scales
