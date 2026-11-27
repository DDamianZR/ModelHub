"""What changed between two builds, as a list of dated events.

Every daily run is already an auditable commit, but a commit is a 4 000-line diff of JSON.
This module states the same difference in the terms the site uses: which models entered or
left, which crossed the coverage gate, which moved relative to the others, and which of a
model's own measurements changed that day. It reads two finished builds and writes text;
it never feeds a score, a rank or the gate.

Two rules do the work, and both were chosen by measuring the 110 day-to-day transitions
from 2026-08-04 (the first build with significance ranks) to 2026-11-12:

1. Movement is measured among the models ranked on BOTH days. A rank is one plus the
   number of models measurably ahead, so one newcomer near the top lowers everyone below
   it by a place. Comparing published ranks called that 920 rank changes, 55 of 56 models
   on a day when a single model was added and no composite moved. Recomputing both days'
   ranks over the common cohort leaves 258 moves, and 83 of the 110 transitions move
   nobody. The newcomer is reported once, as an arrival.

2. When more than `cohort_share` of that common cohort moves in one transition, the day is
   reported as one event with counts instead of one line per model. The threshold lives in
   config/changes.json with the distribution it was read from.

An event says what is deterministically true and stops there. A move lists the model's own
score rows that changed; an empty list means it moved while its own measurements stood
still, and the page says exactly that. No cause is inferred beyond the rows.

Nothing here reads who made a model.
"""
from __future__ import annotations

import json
from pathlib import Path

from scripts.ingest.common import CONFIG, DATA
from scripts.ingest.composite import assign_significance_ranks

CHANGES = DATA / "changes.jsonl"
DEFAULT_COHORT_SHARE = 0.5


def load_cohort_share() -> float:
    path = CONFIG / "changes.json"
    if not path.exists():
        return DEFAULT_COHORT_SHARE
    return float(json.loads(path.read_text(encoding="utf-8")).get(
        "cohort_share", DEFAULT_COHORT_SHARE
    ))


def build_state(models: list[dict], scores: list[dict], meta: dict | None = None) -> dict:
    """The parts of one build this module compares, keyed for lookup."""
    scale = (meta or {}).get("arena_normalization") or {}
    return {
        "models": {model["id"]: model for model in models},
        "scores": {(row["model_id"], row["benchmark_id"]): row for row in scores},
        "scale": (
            {"min": scale["min"], "max": scale["max"]}
            if "min" in scale and "max" in scale else None
        ),
    }


def read_state(directory: Path = DATA) -> dict | None:
    """The build currently on disk, or None when there is not a complete one to compare."""
    models_path, scores_path = directory / "models.json", directory / "scores.json"
    if not models_path.exists() or not scores_path.exists():
        return None
    try:
        models = json.loads(models_path.read_text(encoding="utf-8"))
        scores = json.loads(scores_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return build_state(models.get("models", []), scores.get("scores", []), models.get("meta"))


def ranks_among(models: dict[str, dict], ids: list[str]) -> dict[str, tuple[int, int]]:
    """(rank, tied_with) of each id, counting only the models in `ids`.

    Uses the ranking's own function on copies, so "ahead" means here exactly what it means
    on the page. Over the full ranked set this returns the published rank: checked on all
    110 historical builds, 0 mismatches.
    """
    subset = [
        {
            "id": model_id,
            "composite": models[model_id]["composite"],
            "composite_error": models[model_id].get("composite_error"),
            "provisional": False,
        }
        for model_id in ids
    ]
    assign_significance_ranks(subset)
    return {entry["id"]: (entry["rank"], entry["tied_with"]) for entry in subset}


def _ranked(model: dict) -> bool:
    return not model.get("provisional")


def _placing(model: dict) -> dict:
    """Published rank fields of one model, for an arrival or a departure."""
    return {
        "ranked": _ranked(model),
        "rank": model.get("rank"),
        "tied": bool(model.get("tied_with")),
        "composite": model.get("composite"),
    }


def _own_inputs(prev: dict, new: dict, model_id: str) -> list[dict]:
    """Score rows of one model whose value differs between the builds, None when absent."""
    benchmarks = sorted(
        {bid for mid, bid in prev["scores"] if mid == model_id}
        | {bid for mid, bid in new["scores"] if mid == model_id}
    )
    changed = []
    for benchmark_id in benchmarks:
        before = prev["scores"].get((model_id, benchmark_id), {}).get("value")
        after = new["scores"].get((model_id, benchmark_id), {}).get("value")
        if before != after:
            changed.append({"benchmark_id": benchmark_id, "value": [before, after]})
    return changed


def diff_states(prev: dict, new: dict, day: str, cohort_share: float | None = None) -> list[dict]:
    """Events describing how `new` differs from `prev`, in a stable order."""
    share = load_cohort_share() if cohort_share is None else cohort_share
    events: list[dict] = []
    before, after = prev["models"], new["models"]

    if prev["scale"] and new["scale"] and prev["scale"] != new["scale"]:
        events.append({
            "type": "arena_scale",
            "min": [prev["scale"]["min"], new["scale"]["min"]],
            "max": [prev["scale"]["max"], new["scale"]["max"]],
        })

    for benchmark_id in sorted({bid for _, bid in prev["scores"]} | {bid for _, bid in new["scores"]}):
        old_rows = {mid: row["value"] for (mid, bid), row in prev["scores"].items() if bid == benchmark_id}
        new_rows = {mid: row["value"] for (mid, bid), row in new["scores"].items() if bid == benchmark_id}
        counts = {
            "changed": sum(1 for mid in old_rows.keys() & new_rows.keys() if old_rows[mid] != new_rows[mid]),
            "added": len(new_rows.keys() - old_rows.keys()),
            "removed": len(old_rows.keys() - new_rows.keys()),
        }
        if any(counts.values()):
            events.append({"type": "benchmark_updated", "benchmark_id": benchmark_id, **counts})

    def by_placing(model_id: str, models: dict) -> tuple:
        model = models[model_id]
        return (not _ranked(model), model.get("rank") or 0, model_id)

    for model_id in sorted(after.keys() - before.keys(), key=lambda mid: by_placing(mid, after)):
        events.append({"type": "model_added", "model_id": model_id, **_placing(after[model_id])})
    for model_id in sorted(before.keys() - after.keys(), key=lambda mid: by_placing(mid, before)):
        events.append({"type": "model_removed", "model_id": model_id, **_placing(before[model_id])})

    common = sorted(before.keys() & after.keys())
    for model_id in common:
        was, now = before[model_id], after[model_id]
        if _ranked(was) != _ranked(now):
            events.append({
                "type": "gate_crossed",
                "model_id": model_id,
                "entered": _ranked(now),
                "covered": [was["coverage"]["covered"], now["coverage"]["covered"]],
                "total": now["coverage"]["total"],
            })

    cohort = [mid for mid in common if _ranked(before[mid]) and _ranked(after[mid])]
    if cohort:
        was_among, now_among = ranks_among(before, cohort), ranks_among(after, cohort)
        moved = [mid for mid in cohort if was_among[mid][0] != now_among[mid][0]]
        if len(moved) / len(cohort) > share:
            events.append({"type": "cohort_shift", "compared": len(cohort), "moved": len(moved)})
        else:
            for model_id in sorted(moved, key=lambda mid: (now_among[mid][0], mid)):
                was, now = before[model_id], after[model_id]
                events.append({
                    "type": "moved",
                    "model_id": model_id,
                    # Place among the models ranked on both days: the comparison that is
                    # not disturbed by a model arriving or leaving.
                    "among": len(cohort),
                    "position": [was_among[model_id][0], now_among[model_id][0]],
                    # The published rank, which is what the reader sees on the site.
                    "rank": [was.get("rank"), now.get("rank")],
                    "tied": [bool(was.get("tied_with")), bool(now.get("tied_with"))],
                    "composite": [was["composite"], now["composite"]],
                    "inputs": _own_inputs(prev, new, model_id),
                })

    for model_id in common:
        old_price = before[model_id].get("blended_price_usd_per_m")
        new_price = after[model_id].get("blended_price_usd_per_m")
        if old_price != new_price:
            events.append({
                "type": "price_changed",
                "model_id": model_id,
                "blended_usd_per_m": [old_price, new_price],
            })

    return [{"date": day, **event} for event in events]


def append(events: list[dict], path: Path = CHANGES) -> None:
    """Add events to the log. Append-only: a past day is never rewritten."""
    if not events:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
