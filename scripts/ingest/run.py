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

from . import local_models
from .common import CONFIG, DATA, SourceError, read_cache, write_cache, write_json
from .composite import build_models, load_methodology_version, load_weights
from .normalize import ReferenceError, load_reference
from .sources import epoch, hf, livebench, lmarena
from .weight_audit import audit as audit_weights

# Beyond this a cached payload is no longer "recent enough to stand in".
STALE_AFTER_DAYS = 7

# Shape of a history.jsonl row. Rows written before this existed carry no version and are
# read as version 0; readers treat every field beyond model/benchmark/value/date as optional.
HISTORY_SCHEMA_VERSION = 1

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
    existing: list[dict], incoming: list[dict], rejected_dates: set[str]
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

    The ratio is counted per (date, benchmark), not per (date, model). While the file held
    only Arena ratings those were the same measurement; once a run records ten benchmarks,
    five categories and the composite, a model legitimately has sixteen rows on one date
    and a per-model count would read every single day as duplicated and reject the lot.
    Per benchmark the original invariant holds unchanged: one model, one reading, one date.
    """
    per_date: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(int))
    )
    for row in incoming:
        per_date[row["date"]][row["benchmark_id"]][row["model_id"]] += 1
    duplicated = {
        day
        for day, benchmarks in per_date.items()
        if any(
            models and sum(models.values()) / len(models) > lmarena.DUPLICATE_RATIO_LIMIT
            for models in benchmarks.values()
        )
    }

    bad = duplicated | rejected_dates
    if bad:
        print(f"  history: excluding {len(bad)} suspect snapshot(s): {sorted(bad)}")

    merged: dict[tuple[str, str, str], dict] = {}
    for row in existing + incoming:
        if row["date"] in bad:
            continue
        merged[(row["model_id"], row["benchmark_id"], row["date"])] = row

    return sorted(
        merged.values(), key=lambda r: (r["model_id"], r["benchmark_id"], r["date"])
    )


def previously_published() -> set[str]:
    """Model ids in the models.json this run is about to overwrite."""
    path = DATA / "models.json"
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    return {m["id"] for m in payload.get("models", []) if m.get("id")}


def main() -> int:
    print("ModelHub ingest")
    weights, min_coverage, variant_policy = load_weights()
    published_before = previously_published()

    epoch_payload, epoch_status = gather("epoch", epoch.collect)
    livebench_payload, livebench_status = gather("livebench", livebench.collect)
    arena_payload, arena_status = gather("lmarena", lmarena.collect)

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

    try:
        reference = load_reference()
    except ReferenceError as exc:
        # Without a usable reference nothing can be normalised, and guessing a scale is the
        # one thing that must never happen silently. Leave /data alone and say why.
        print(f"FATAL: {exc}")
        write_json(DATA / "status.json", {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "ok": False,
            "reason": f"normalisation reference unusable: {exc}",
            "sources": statuses,
        })
        return 1

    models, score_rows, providers, aliases = build_models(
        reference=reference,
        registry=registry,
        epoch_scores=epoch_payload.get("scores") or {},
        livebench_scores=livebench_payload.get("scores") or {},
        arena_text=arena_payload.get("text") or {},
        arena_vision=arena_payload.get("vision") or {},
        arena_snapshot=arena_payload.get("snapshot"),
        vision_snapshot=arena_payload.get("vision_snapshot"),
    )

    today = date.today().isoformat()
    methodology_version = load_methodology_version()

    def history_row(model_id: str, benchmark_id: str, value: float, when: str, **extra):
        return {
            "model_id": model_id,
            "benchmark_id": benchmark_id,
            "value": value,
            "date": when,
            "schema_version": HISTORY_SCHEMA_VERSION,
            "methodology_version": methodology_version,
            **extra,
        }

    incoming_history: list[dict] = []

    # LMArena is the only source that publishes its own back catalogue, so its series is
    # backfilled from upstream rather than accumulated a day at a time.
    if arena_status["state"] == "ok":
        for model in models:
            name = model.get("arena_name")
            if not name:
                continue
            try:
                for row in lmarena.history_for(name):
                    incoming_history.append(history_row(
                        model["id"], "lmarena_text_overall", round(row["rating"], 1),
                        row["leaderboard_publish_date"], source_type="human_eval",
                    ))
            except SourceError as exc:
                print(f"  history: skipped {name} ({exc})")

    # Every other benchmark, dated by when it was MEASURED rather than by when this run
    # happened to read it. A benchmark that has not been re-measured produces the same row
    # every day and deduplicates away, so the series records measurements, not runs.
    undated = 0
    for row in score_rows:
        if row["benchmark_id"] == "lmarena_text_overall":
            continue  # already covered above, with its full history
        if not row["measured_at"]:
            # No date means no place on a time axis, and inventing one is not an option.
            undated += 1
            continue
        incoming_history.append(history_row(
            row["model_id"], row["benchmark_id"], row["value"],
            row["measured_at"][:10], source_type=row["source_type"],
        ))
    if undated:
        print(f"  history: {undated} score(s) carry no measured_at and are not recorded")

    # Category scores and the composite are ours, computed today from the readings above,
    # so they are dated by the run. They are stored as computed and tagged with the
    # methodology version that produced them: without the tag a snapshot from before a
    # formula change would be read under the formula after it, which is the one way a
    # stored series can lie. The stored value is never a normalised one - normalisation is
    # derived from a reference that is expected to be recomputed, and a derivative stored
    # under one reference and read under the next cannot be recomputed by anyone.
    for model in models:
        for category, value in model["category_scores"].items():
            incoming_history.append(
                history_row(model["id"], f"category:{category}", value, today)
            )
        incoming_history.append(history_row(
            model["id"], "composite", model["composite"], today,
            rank=model["rank"], provisional=model["provisional"],
        ))

    rejected = arena_payload.get("rejected_snapshots") or []
    rejected_dates = {item["date"] for item in rejected if isinstance(item, dict)}
    history = merge_history(load_history(), incoming_history, rejected_dates)

    for model in models:
        model.pop("arena_name", None)

    # The registry has a single upstream. The failure policy covers Epoch being unreachable;
    # it does not cover Epoch quietly dropping a model, which today would remove it from the
    # site with no trace anywhere. Reported, never treated as an error: a model legitimately
    # leaves when a vendor retires it, and a run that died over that would be worse.
    vanished = sorted(published_before - {m["id"] for m in models})
    if vanished:
        print(f"  registry: {len(vanished)} model(s) present last run and absent now: "
              f"{', '.join(vanished)}")

    # Values falling outside the reference's range are clipped, and clipping is counted
    # rather than smoothed over: a run where it starts happening often is a run where the
    # frozen reference has aged and needs regenerating under a new methodology version.
    clipped = sum(
        1 for row in score_rows if (row.get("normalization") or {}).get("clipped")
    )
    if clipped:
        print(f"  normalisation: {clipped} score(s) clipped to the 0-100 range")

    provisional = sum(1 for m in models if m["provisional"])
    meta = {
        "generated_at": date.today().isoformat(),
        "methodology_version": methodology_version,
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
        "normalization": {
            "method": "per-benchmark z-score against a frozen reference",
            "reference_computed_at": reference.computed_at,
            "scale_factor": reference.scale_factor,
            "min_n": reference.min_n,
            "scored_benchmarks": sorted(reference.benchmarks),
            "excluded_benchmarks": reference.excluded,
            "clipped_scores": clipped,
        },
    }

    # The local view. Cache-first and budgeted: model metadata never changes, so the steady
    # state costs nothing and only genuinely new models spend requests. A failure here is
    # reported and skipped - the ranking does not depend on it.
    local_stats: dict = {}
    try:
        ranked_by_key = {
            model["id"].split("-", 1)[1] if "-" in model["id"] else model["id"]: model
            for model in models
        }
        local_payload, local_stats = local_models.build(
            arena_payload.get("text") or {}, ranked_by_key
        )
        local_models.write(local_payload, local_models.calibrate(hf.load_local_cache()))
        print(f"  local models: {len(local_payload['models'])} published "
              f"({local_stats['fetched']} new, {local_stats['cached']} cached, "
              f"{local_stats['failed']} unresolved, {local_stats['skipped']} queued)")
    except Exception as exc:  # noqa: BLE001 - the ranking must not die over the local view
        print(f"  local models: skipped ({exc})")
        traceback.print_exc()

    write_json(DATA / "models.json", {"meta": meta, "models": models})
    write_json(DATA / "scores.json", {"meta": meta, "scores": score_rows})
    write_json(DATA / "weight_audit.json", {
        "generated_at": date.today().isoformat(),
        **audit_weights(models, weights, methodology_version),
    })
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

    write_json(DATA / "status.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ok": True,
        "methodology_version": methodology_version,
        "sources": statuses,
        "snapshot_ages": snapshot_ages,
        "thresholds": {
            "warn_cadence_multiple": WARN_CADENCE_MULTIPLE,
            "degraded_cadence_multiple": DEGRADED_CADENCE_MULTIPLE,
        },
        "rejected_snapshots": rejected,
        "vanished_models": vanished,
    })

    aged = [
        f"{name} {info['age_days']}d ({info['freshness']})"
        for name, info in snapshot_ages.items()
        if info["freshness"] in ("aging", "degraded")
    ]
    if aged:
        print(f"  snapshot age warnings: {', '.join(aged)}")

    kinds = defaultdict(int)
    for row in history:
        bid = row["benchmark_id"]
        kinds["composite" if bid == "composite"
              else "category" if bid.startswith("category:")
              else "benchmark"] += 1

    degraded = [n for n, s in statuses.items() if s["state"] != "ok"]
    print(
        f"\nWrote {len(models)} models ({len(models) - provisional} ranked, "
        f"{provisional} provisional), {len(score_rows)} scores, "
        f"{len(history)} history points "
        f"({kinds['benchmark']} benchmark, {kinds['category']} category, "
        f"{kinds['composite']} composite)."
    )
    if degraded:
        print(f"Degraded sources: {', '.join(degraded)} (site still builds)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
