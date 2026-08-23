"""Daily ingest entry point (Layer A).

Reads the confirmed sources, recomputes the composite, appends to the time series and
writes /data. Runs in GitHub Actions on a cron; the resulting commit is what redeploys
the site.

Failure policy: a source that cannot be read does not stop the run. Its last good payload
is reused from /data/cache, it is reported as stale in /data/status.json, and the site keeps
working with the age of every source stated on the page.

Usage: python -m scripts.ingest.run
"""
from __future__ import annotations

import json
import sys
import traceback
from collections import defaultdict
from datetime import date, datetime, timezone

from .common import (
    CONFIG,
    DATA,
    DIGESTS,
    SourceError,
    digest_bytes,
    read_cache,
    write_cache,
    write_json,
)
from .composite import ARENA_BENCHMARK, build_models, load_weights
from .sources import epoch, livebench, lmarena

# Beyond this a cached payload is no longer "recent enough to stand in".
STALE_AFTER_DAYS = 7

# A source can fetch perfectly and still be serving old numbers, because the upstream
# snapshot itself is old. That is the failure mode that ages in silence.
#
# Thresholds are relative to each source's own publishing rhythm, declared as
# expected_cadence_days in config/sources.json. A fixed global threshold would paint
# LiveBench permanently red for publishing monthly, exactly as designed, and a warning
# that is always on stops being a signal. Red must mean "this source is actually dead",
# not "it is Monday".
WARN_CADENCE_MULTIPLE = 2
DEGRADED_CADENCE_MULTIPLE = 4
FALLBACK_CADENCE_DAYS = 7


def load_cadences() -> dict[str, int]:
    """Expected publishing rhythm per source id, from config/sources.json."""
    path = CONFIG / "sources.json"
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    out: dict[str, int] = {}
    for source in payload.get("sources", []):
        cadence = source.get("expected_cadence_days")
        if isinstance(cadence, int) and cadence > 0:
            out[source["id"]] = cadence
    return out


def observed_cadence(dates: list[str] | None) -> dict | None:
    """The rhythm a source actually keeps, measured from its own published dates.

    A declared cadence is what the source says it does; this is what it did. They can
    disagree badly - LiveBench declares 30 days and went 168 between two snapshots - and
    a warning threshold derived from the declared number is asleep for that whole gap.
    Measuring it means the calibration checks itself instead of waiting to be noticed.

    The median is used rather than the mean because one long outage would drag the mean
    up and make the source look slower than it normally is, hiding the next outage.
    """
    if not dates or len(dates) < 2:
        return None
    try:
        parsed = sorted(date.fromisoformat(value[:10]) for value in dates)
    except ValueError:
        return None
    gaps = [(b - a).days for a, b in zip(parsed, parsed[1:]) if (b - a).days > 0]
    if not gaps:
        return None
    ordered = sorted(gaps)
    middle = len(ordered) // 2
    median = (
        ordered[middle] if len(ordered) % 2
        else (ordered[middle - 1] + ordered[middle]) / 2
    )
    return {
        "snapshots": len(parsed),
        "median_gap_days": round(median, 1),
        "longest_gap_days": max(gaps),
        "first": parsed[0].isoformat(),
        "last": parsed[-1].isoformat(),
    }


def snapshot_age(snapshot: str | None, cadence_days: int | None) -> dict:
    """Age of the upstream measurement, independent of whether today's fetch worked."""
    cadence = cadence_days or FALLBACK_CADENCE_DAYS
    warn = cadence * WARN_CADENCE_MULTIPLE
    degraded = cadence * DEGRADED_CADENCE_MULTIPLE

    if not snapshot:
        return {"date": None, "age_days": None, "freshness": "unknown",
                "cadence_days": cadence, "warn_days": warn, "degraded_days": degraded}
    try:
        age = (date.today() - date.fromisoformat(snapshot[:10])).days
    except ValueError:
        return {"date": snapshot, "age_days": None, "freshness": "unknown",
                "cadence_days": cadence, "warn_days": warn, "degraded_days": degraded}

    if age >= degraded:
        freshness = "degraded"
    elif age >= warn:
        freshness = "aging"
    else:
        freshness = "fresh"
    return {
        "date": snapshot[:10], "age_days": age, "freshness": freshness,
        "cadence_days": cadence, "warn_days": warn, "degraded_days": degraded,
    }


BENCHMARK_CATALOGUE = [
    ("gpqa_diamond", "GPQA Diamond", "reasoning", "Epoch AI", "third_party_benchmark",
     "https://epoch.ai/benchmarks", None),
    ("simpleqa_verified", "SimpleQA Verified", "reasoning", "Epoch AI",
     "third_party_benchmark", "https://epoch.ai/benchmarks", None),
    ("math_level_5", "MATH Level 5", "math", "Epoch AI", "third_party_benchmark",
     "https://epoch.ai/benchmarks", None),
    ("frontiermath", "FrontierMath", "math", "Epoch AI", "third_party_benchmark",
     "https://epoch.ai/benchmarks", None),
    ("swe_bench_verified", "SWE-bench Verified", "coding", "Epoch AI",
     "third_party_benchmark", "https://epoch.ai/benchmarks",
     "Epoch's own run. swebench.com's leaderboard is CC-BY-NC and is not ingested."),
    ("livebench_reasoning", "LiveBench Reasoning", "reasoning", "LiveBench",
     "third_party_benchmark", "https://livebench.ai/", None),
    ("livebench_coding", "LiveBench Coding", "coding", "LiveBench",
     "third_party_benchmark", "https://livebench.ai/", None),
    ("livebench_math", "LiveBench Mathematics", "math", "LiveBench",
     "third_party_benchmark", "https://livebench.ai/", None),
    ("livebench_instruction_following", "LiveBench IF", "instruction_following",
     "LiveBench", "third_party_benchmark", "https://livebench.ai/", None),
    ("lmarena_text_overall", "LMArena (text, overall)", "human_preference", "LMArena",
     "human_eval", "https://lmarena.ai/leaderboard", None),
]


# Above this many requests a source is paginated, and a per-URL digest list would be
# pages of noise nobody can check by hand. Those sources publish the payload digest only.
MAX_LISTED_ARTIFACTS = 4


def integrity_for(before: set[str], payload: dict) -> dict:
    """What this source downloaded, hashed, so a reader can repeat the check.

    Two different guarantees, kept apart because they are not the same promise:
    `upstream` is the bytes the publisher served - anyone can curl the URL and compare -
    while `normalised` covers what the ingest made of them, which is what /data is built
    from. A matching upstream digest with a changed normalised one means we changed.
    """
    artifacts = [
        {"url": url, **digest}
        for url, digest in DIGESTS.items() if url not in before
    ]
    payload_bytes = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return {
        "normalised_sha256": digest_bytes(payload_bytes),
        "requests": len(artifacts),
        "upstream": (
            sorted(artifacts, key=lambda item: item["url"])
            if len(artifacts) <= MAX_LISTED_ARTIFACTS else []
        ),
    }


def gather(name: str, collector) -> tuple[dict, dict]:
    """Run one source, falling back to its cache. Returns (payload, status)."""
    today = date.today().isoformat()
    try:
        payload = collector()
    except SourceError as exc:
        message = str(exc)
    except Exception as exc:  # noqa: BLE001 - an unexpected bug in one source is survivable
        message = f"unexpected error: {exc}"
        traceback.print_exc()
    else:
        write_cache(name, {"fetched_at": today, "payload": payload})
        print(f"  {name}: ok")
        return payload, {"state": "ok", "last_success": today, "error": None}

    cached = read_cache(name)
    if cached is None:
        print(f"  {name}: FAILED with no cache to fall back on - {message}")
        return {}, {"state": "failed", "last_success": None, "error": message}

    fetched_at = cached.get("fetched_at")
    age = None
    if fetched_at:
        age = (date.today() - date.fromisoformat(fetched_at)).days
    state = "stale" if age is not None and age > STALE_AFTER_DAYS else "cached"
    print(f"  {name}: {state} - reusing cache from {fetched_at} ({message})")
    return cached.get("payload", {}), {
        "state": state,
        "last_success": fetched_at,
        "age_days": age,
        "error": message,
    }


# A model can lose composite points without its rating having moved, because the Arena
# ratings are min-max normalised against the cohort present in each build. When a model
# with an extreme rating joins, everyone else's normalised value shifts.
#
# Measured on the 2026-08-03 cohort: a new model 60 rating points above the current best
# moves every normalised value by 16.03 points on average and 24.29 in the worst case,
# which is 2.40 and 3.64 composite points against a median gap between neighbours of 0.39.
# So this is not a rounding artefact - it is enough to reorder the table on its own.
#
# "The rating barely moved" is 0.5 Arena rating points, and that number comes from the
# series itself rather than from taste: across 2147 consecutive transitions in
# history.jsonl the median movement is 0.10 points and the 75th percentile is 0.40, so
# 0.5 covers three quarters of ordinary day-to-day drift without swallowing a real move.
RECALIBRATION_RAW_STILL = 0.5

# "The normalised value moved enough to matter" is not a fixed number at all: it is the
# median gap between neighbours in this build. That is precisely the size at which a shift
# can reorder the table, so it is what deserves saying out loud - and it retunes itself as
# the cohort tightens or spreads instead of freezing one day's judgement into the code.
MIN_RECALIBRATION_EFFECT = 0.05    # composite points, floor for a degenerate cohort


def previous_build() -> tuple[dict[str, dict], dict[str, float]]:
    """Last build's models and raw Arena ratings, read before /data is overwritten."""
    models_path, scores_path = DATA / "models.json", DATA / "scores.json"
    if not models_path.exists() or not scores_path.exists():
        return {}, {}
    try:
        models = json.loads(models_path.read_text(encoding="utf-8")).get("models", [])
        scores = json.loads(scores_path.read_text(encoding="utf-8")).get("scores", [])
    except json.JSONDecodeError:
        return {}, {}
    ratings = {
        row["model_id"]: row["value"]
        for row in scores if row.get("benchmark_id") == ARENA_BENCHMARK
    }
    return {model["id"]: model for model in models}, ratings


def median_adjacent_gap(models: list[dict]) -> float:
    """Median composite distance between neighbours in the ranked table."""
    ranked = sorted(
        (m["composite"] for m in models if not m["provisional"]), reverse=True
    )
    gaps = sorted(a - b for a, b in zip(ranked, ranked[1:]))
    if not gaps:
        return MIN_RECALIBRATION_EFFECT
    middle = len(gaps) // 2
    median = gaps[middle] if len(gaps) % 2 else (gaps[middle - 1] + gaps[middle]) / 2
    return max(median, MIN_RECALIBRATION_EFFECT)


def flag_recalibration(
    models: list[dict],
    score_rows: list[dict],
    weights: dict[str, float],
    previous: dict[str, dict],
    previous_ratings: dict[str, float],
) -> int:
    """Mark models whose normalised Arena value moved while their rating did not.

    Attributing that shift to the model would be wrong: nobody voted differently, the
    scale moved underneath it. Recording the raw and the normalised delta separately is
    what makes the difference visible at all.
    """
    ratings = {
        row["model_id"]: row["value"]
        for row in score_rows if row["benchmark_id"] == "lmarena_text_overall"
    }
    threshold = median_adjacent_gap(models)
    flagged = 0
    for model in models:
        model["cohort_recalibration"] = None
        before, raw_before = previous.get(model["id"]), previous_ratings.get(model["id"])
        raw_now = ratings.get(model["id"])
        if not before or raw_before is None or raw_now is None:
            continue

        norm_before = (before.get("category_scores") or {}).get("human_preference")
        norm_now = model["category_scores"].get("human_preference")
        if norm_before is None or norm_now is None:
            continue

        raw_delta = raw_now - raw_before
        norm_delta = norm_now - norm_before
        if abs(raw_delta) >= RECALIBRATION_RAW_STILL:
            continue

        available = sum(w for c, w in weights.items() if c in model["category_scores"])
        if not available:
            continue
        effect = norm_delta * weights["human_preference"] / available
        if abs(effect) < threshold:
            continue

        model["cohort_recalibration"] = {
            "raw_delta": round(raw_delta, 2),
            "normalized_delta": round(norm_delta, 2),
            "composite_effect": round(effect, 2),
            # Stated so the reader can see what the flag was measured against rather
            # than trusting that some threshold existed.
            "threshold": round(threshold, 2),
        }
        flagged += 1
    return flagged


def load_history() -> list[dict]:
    path = DATA / "history.jsonl"
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def merge_history(
    existing: list[dict],
    incoming: list[dict],
    rejected_dates: set[str],
    active_series: set[tuple[str, str]] | None = None,
) -> list[dict]:
    """Append-only time series, deduplicated on (model, benchmark, date).

    Re-running the ingest on the same day must be idempotent: the site is rebuilt from a
    commit, and a run that duplicated rows would corrupt every sparkline downstream.

    Two separate defences against duplicated upstream snapshots, because deduplication
    alone silently hides the problem rather than catching it:

    1. Measure the duplication ratio on the RAW incoming rows, before deduplication.
       Deduplicating first would collapse every date to one row per model, making the
       ratio structurally 1.0 and the check unable to ever fire.
    2. Drop any date the source itself already rejected, which also purges rows that
       earlier runs let through.

    Third defence, on a different axis: a series belongs to one published variant. When
    the configuration a model is reported under changes, the stored points describe a
    different configuration, and splicing the two would draw a trend that never happened
    - the same objection that keeps the sparklines behind the last methodology break.
    The old points are dropped and the series restarts, short and true.

    `active_series` closes the gap that leaves open. Comparing variants only catches a
    model that still HAS incoming points; a model that lost its Arena row entirely gets
    none, so its stored points survive and its sparkline keeps drawing a series the
    composite no longer reports. Passing the series that exist in this build purges those
    too. Pass None when the source failed - then there is nothing to compare against and
    keeping stale points beats deleting good ones.
    """
    per_date: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in incoming:
        per_date[row["date"]][row["model_id"]] += 1
    duplicated = {
        day for day, models in per_date.items()
        if models and sum(models.values()) / len(models) > lmarena.DUPLICATE_RATIO_LIMIT
    }

    bad = duplicated | rejected_dates
    if bad:
        print(f"  history: excluding {len(bad)} suspect snapshot(s): {sorted(bad)}")

    current_variant = {
        (row["model_id"], row["benchmark_id"]): row.get("variant") for row in incoming
    }
    restarted = 0
    orphaned = 0
    merged: dict[tuple[str, str, str], dict] = {}
    for row in existing + incoming:
        if row["date"] in bad:
            continue
        series = (row["model_id"], row["benchmark_id"])
        if series in current_variant:
            if row.get("variant") != current_variant[series]:
                restarted += 1
                continue
        elif active_series is not None and series not in active_series:
            orphaned += 1
            continue
        merged[(*series, row["date"])] = row

    if restarted:
        print(f"  history: dropped {restarted} point(s) measuring a superseded variant")
    if orphaned:
        print(f"  history: dropped {orphaned} point(s) whose series is no longer measured")

    return sorted(
        merged.values(), key=lambda r: (r["model_id"], r["benchmark_id"], r["date"])
    )


def main() -> int:
    print("ModelHub ingest")
    weights, min_coverage, variant_policy = load_weights()

    integrity: dict[str, dict] = {}

    seen = set(DIGESTS)
    epoch_payload, epoch_status = gather("epoch", epoch.collect)
    integrity["epoch"] = integrity_for(seen, epoch_payload)

    seen = set(DIGESTS)
    livebench_payload, livebench_status = gather("livebench", livebench.collect)
    integrity["livebench"] = integrity_for(seen, livebench_payload)

    seen = set(DIGESTS)
    arena_payload, arena_status = gather("lmarena", lmarena.collect)
    integrity["lmarena"] = integrity_for(seen, arena_payload)
    # A cache written before variants were kept holds one row per model instead of a
    # list. Widen it here so a failed fetch degrades to old numbers, not to a crash.
    arena_payload = lmarena.upgrade_payload(arena_payload)
    if arena_status["state"] == "ok":
        # Which endpoint answered today - "filter" or "rows-latest". Surfaced so a silent
        # path change (e.g. HuggingFace repairing /filter) shows up in status.json instead
        # of only changing behaviour no one is watching for.
        arena_status["served_by"] = arena_payload.get("served_by")

    statuses = {
        "epoch": epoch_status,
        "livebench": livebench_status,
        "lmarena": arena_status,
    }

    registry = epoch_payload.get("registry") or {}
    if not registry:
        # Without the registry there is no canonical model list and nothing can be keyed.
        print("FATAL: no model registry available, leaving /data untouched")
        write_json(DATA / "status.json", {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "ok": False,
            "reason": "epoch registry unavailable and no cache",
            "sources": statuses,
        })
        return 1

    # Read before anything is written: these are last build's numbers, and the point of
    # keeping them is to tell a rating that moved from a scale that moved.
    previous_models, previous_ratings = previous_build()

    models, score_rows, providers, aliases, (arena_low, arena_high) = build_models(
        registry=registry,
        epoch_scores=epoch_payload.get("scores") or {},
        livebench_scores=livebench_payload.get("scores") or {},
        arena_text=arena_payload.get("text") or {},
        arena_vision=arena_payload.get("vision") or {},
        arena_snapshot=arena_payload.get("snapshot"),
        vision_snapshot=arena_payload.get("vision_snapshot"),
    )

    incoming_history: list[dict] = []
    if arena_status["state"] == "ok":
        # served_by "filter" still has history_for's full per-model backfill available.
        # "rows-latest" does not - /rows cannot query by date - so each model gains only
        # today's point, taken from the same fetch collect() already made.
        served_by = arena_payload.get("served_by")
        history_points = arena_payload.get("history_points") or {}
        for model in models:
            name = model.get("arena_name")
            if not name:
                continue
            if served_by == "filter":
                try:
                    points = [
                        (row["rating"], row["leaderboard_publish_date"])
                        for row in lmarena.history_for(name)
                    ]
                except SourceError as exc:
                    print(f"  history: skipped {name} ({exc})")
                    continue
            else:
                point = history_points.get(name)
                points = [(point["rating"], point["date"])] if point else []
            for rating, day in points:
                incoming_history.append({
                    "model_id": model["id"],
                    "benchmark_id": ARENA_BENCHMARK,
                    "value": round(rating, 1),
                    "date": day,
                    "source_type": "human_eval",
                    # Which published variant this series describes, so a change of
                    # configuration restarts it instead of splicing two.
                    "variant": name,
                })

    recalibrated = flag_recalibration(
        models, score_rows, weights, previous_models, previous_ratings
    )
    if recalibrated:
        print(f"  cohort: {recalibrated} model(s) moved on renormalisation, not on votes")

    rejected = arena_payload.get("rejected_snapshots") or []
    rejected_dates = {item["date"] for item in rejected if isinstance(item, dict)}

    # Which series this build actually measures. Only meaningful when the source answered:
    # if it failed, every series would look retired and the whole history would be purged.
    active_series = None
    if arena_status["state"] == "ok":
        active_series = {
            (row["model_id"], row["benchmark_id"])
            for row in score_rows if row["benchmark_id"] == ARENA_BENCHMARK
        }
    history = merge_history(
        load_history(), incoming_history, rejected_dates, active_series
    )

    for model in models:
        model.pop("arena_name", None)

    provisional = sum(1 for m in models if m["provisional"])
    meta = {
        "generated_at": date.today().isoformat(),
        "model_count": len(models),
        "ranked_count": len(models) - provisional,
        "provisional_count": provisional,
        "min_coverage_for_ranking": min_coverage,
        "snapshots": {
            "epoch": epoch_status.get("last_success"),
            "livebench": livebench_payload.get("snapshot"),
            "lmarena_text": arena_payload.get("snapshot"),
            "lmarena_vision": arena_payload.get("vision_snapshot"),
        },
        "arena_normalization": {
            "method": "min-max across the cohort in this build",
            "min": round(arena_low, 2),
            "max": round(arena_high, 2),
        },
    }

    write_json(DATA / "models.json", {"meta": meta, "models": models})
    write_json(DATA / "scores.json", {"meta": meta, "scores": score_rows})
    write_json(DATA / "providers.json", {
        "providers": sorted(providers.values(), key=lambda p: p["display_name"])
    })
    write_json(DATA / "aliases.json", aliases)
    write_json(DATA / "benchmarks.json", {
        "benchmarks": [
            {
                "id": bid, "name": name, "category": category, "source": source,
                "source_type": source_type, "url": url,
                **({"notes": notes} if notes else {}),
            }
            for bid, name, category, source, source_type, url, notes in BENCHMARK_CATALOGUE
        ]
    })
    (DATA / "history.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in history),
        encoding="utf-8",
    )
    cadences = load_cadences()
    snapshot_ages = {
        # Epoch publishes no snapshot date of its own, so its age is days since we last
        # fetched it successfully - which is the right staleness signal for a daily source.
        "epoch": snapshot_age(epoch_status.get("last_success"), cadences.get("epoch_ai")),
        "livebench": snapshot_age(
            livebench_payload.get("snapshot"), cadences.get("livebench")
        ),
        "lmarena": snapshot_age(arena_payload.get("snapshot"), cadences.get("lmarena")),
    }
    # The composite category each source feeds, so the table can flag the affected column
    # rather than only showing a page-level banner.
    snapshot_ages["lmarena"]["category"] = "human_preference"
    snapshot_ages["livebench"]["category"] = "instruction_following"

    # Declared versus observed, checked rather than assumed.
    #
    # The declaration is disputed only when the source's typical rhythm contradicts it by
    # more than a factor of two in either direction, because that is what makes the warn
    # and degraded thresholds wrong. A single long outage does not: the thresholds are
    # meant to fire during those, and marking them as a mis-declaration would train the
    # calibration to accept whatever the worst month looked like.
    livebench_observed = observed_cadence(livebench_payload.get("published_snapshots"))
    if livebench_observed:
        snapshot_ages["livebench"]["observed"] = livebench_observed
        declared = snapshot_ages["livebench"]["cadence_days"]
        median = livebench_observed["median_gap_days"]
        if median > declared * 2 or median < declared / 2:
            snapshot_ages["livebench"]["cadence_disputed"] = True
            print(
                f"  livebench: declared cadence {declared}d against an observed median "
                f"of {median}d over {livebench_observed['snapshots']} snapshots"
            )

    write_json(DATA / "status.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ok": True,
        "sources": statuses,
        "snapshot_ages": snapshot_ages,
        "thresholds": {
            "warn_cadence_multiple": WARN_CADENCE_MULTIPLE,
            "degraded_cadence_multiple": DEGRADED_CADENCE_MULTIPLE,
            # Published rather than restated in the frontend: a constant quoted in two
            # places is a constant that will disagree with itself.
            "recalibration_raw_still": RECALIBRATION_RAW_STILL,
        },
        "rejected_snapshots": rejected,
        "integrity": integrity,
    })

    aged = [
        f"{name} {info['age_days']}d ({info['freshness']})"
        for name, info in snapshot_ages.items()
        if info["freshness"] in ("aging", "degraded")
    ]
    if aged:
        print(f"  snapshot age warnings: {', '.join(aged)}")

    degraded = [n for n, s in statuses.items() if s["state"] != "ok"]
    print(
        f"\nWrote {len(models)} models ({len(models) - provisional} ranked, "
        f"{provisional} provisional), {len(score_rows)} scores, "
        f"{len(history)} history points."
    )
    if degraded:
        print(f"Degraded sources: {', '.join(degraded)} (site still builds)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
