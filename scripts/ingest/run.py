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

from .common import DATA, SourceError, read_cache, write_cache, write_json
from .composite import build_models, load_weights
from .sources import epoch, livebench, lmarena

# Beyond this a cached payload is no longer "recent enough to stand in".
STALE_AFTER_DAYS = 7

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

    merged: dict[tuple[str, str, str], dict] = {}
    for row in existing + incoming:
        if row["date"] in bad:
            continue
        merged[(row["model_id"], row["benchmark_id"], row["date"])] = row

    return sorted(
        merged.values(), key=lambda r: (r["model_id"], r["benchmark_id"], r["date"])
    )


def main() -> int:
    print("ModelHub ingest")
    weights, min_coverage = load_weights()

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
        for model in models:
            name = model.get("arena_name")
            if not name:
                continue
            try:
                for row in lmarena.history_for(name):
                    incoming_history.append({
                        "model_id": model["id"],
                        "benchmark_id": "lmarena_text_overall",
                        "value": round(row["rating"], 1),
                        "date": row["leaderboard_publish_date"],
                        "source_type": "human_eval",
                    })
            except SourceError as exc:
                print(f"  history: skipped {name} ({exc})")

    rejected = arena_payload.get("rejected_snapshots") or []
    rejected_dates = {item["date"] for item in rejected if isinstance(item, dict)}
    history = merge_history(load_history(), incoming_history, rejected_dates)

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
    write_json(DATA / "status.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ok": True,
        "sources": statuses,
        "rejected_snapshots": rejected,
    })

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
