"""Rebuild data/changes.jsonl from the git history of /data.

The daily ingest appends to the log from the day it started doing so. Everything before
that already exists as commits, so this walks them and applies the same diff_states() the
ingest uses to each consecutive pair of builds. The ingest calls seed() once, when the log
does not exist yet; the command line is kept for audit. Run it from a full clone:

    python -m scripts.ingest.backfill_changes               # print the summary only
    python -m scripts.ingest.backfill_changes --out FILE    # write the log somewhere else
    python -m scripts.ingest.backfill_changes --write       # write data/changes.jsonl

`--out` exists so the committed log can be checked against a fresh rebuild without
touching /data: every line up to the day of the backfill should be identical.

It starts at the first build that carries significance ranks. Before that the rank was a
position in a sorted list, a different statistic, and comparing across the change would
report the change of definition as movement.

An event is dated with the build's own `generated_at`, as the ingest dates it, falling
back to the commit date for a build that predates that field.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from scripts.ingest.changelog import CHANGES, build_state, diff_states, load_cohort_share
from scripts.ingest.common import ROOT


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout


def builds() -> list[tuple[str, str, dict]]:
    """(sha, date, state) for every commit that changed the published models, oldest first."""
    out = []
    for line in git("log", "--reverse", "--format=%H %cs", "--", "data/models.json").splitlines():
        sha, committed = line.split()
        try:
            models = json.loads(git("show", f"{sha}:data/models.json"))
            scores = json.loads(git("show", f"{sha}:data/scores.json"))
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            continue
        rows = models.get("models", [])
        if not any("tied_with" in model for model in rows):
            continue
        meta = models.get("meta") or {}
        day = str(meta.get("generated_at") or committed)[:10]
        out.append((sha, day, build_state(rows, scores.get("scores", []), meta)))
    return out


def rebuild() -> tuple[list[tuple[str, str, dict]], list[dict], int]:
    """(builds, events, quiet transitions) for the whole history this clone can see."""
    history = builds()
    share = load_cohort_share()
    events: list[dict] = []
    quiet = 0
    for (_, _, prev), (_, day, new) in zip(history, history[1:]):
        found = diff_states(prev, new, day, share)
        # A day on which only prices or raw benchmark rows changed still gets its lines;
        # "quiet" counts the transitions where no model arrived, left, crossed or moved.
        if not any(e["type"] in ("model_added", "model_removed", "gate_crossed", "moved", "cohort_shift") for e in found):
            quiet += 1
        events.extend(found)
    return history, events, quiet


def write(events: list[dict], target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events),
        encoding="utf-8", newline="\n",
    )


def seed(target: Path = CHANGES) -> int:
    """Create the log from history the first time the ingest runs with it. Returns events written.

    The ingest calls this before it appends the day's own changes, so a log that does not
    exist yet starts with every day git already holds instead of on the day this shipped.
    It does nothing once the log exists, and it never stops a run: with a shallow clone, no
    git, or a history it cannot read, it writes nothing and the log simply begins today.
    """
    if target.exists():
        return 0
    try:
        _, events, _ = rebuild()
    except (OSError, subprocess.SubprocessError, ValueError, KeyError) as error:
        print(f"  changes: history not readable, the log starts today ({type(error).__name__})")
        return 0
    if not events:
        print("  changes: no earlier builds in this clone, the log starts today")
        return 0
    write(events, target)
    print(f"  changes: seeded {len(events)} events from history, up to {events[-1]['date']}")
    return len(events)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true", help="write data/changes.jsonl")
    parser.add_argument("--force", action="store_true", help="overwrite an existing log")
    parser.add_argument("--out", type=Path, help="write the log to this path instead of /data")
    args = parser.parse_args(argv)

    history, events, quiet = rebuild()
    if len(history) < 2:
        print("Fewer than two comparable builds in this clone; is it a shallow one?", file=sys.stderr)
        return 1

    types = Counter(event["type"] for event in events)
    moved = [event for event in events if event["type"] == "moved"]
    print(f"builds compared: {len(history)} ({history[0][1]} to {history[-1][1]}), transitions: {len(history) - 1}")
    print(f"transitions with no arrival, departure, gate crossing or move: {quiet}")
    print("events by type: " + ", ".join(f"{name} {count}" for name, count in sorted(types.items())))
    print(f"moves with none of the model's own rows changed: {sum(1 for e in moved if not e['inputs'])} of {len(moved)}")
    same_day = Counter()
    for event in events:
        if event["type"] in ("model_added", "model_removed"):
            same_day[(event["date"], event["type"])] += 1
    renames = sorted(day for (day, kind) in same_day if kind == "model_added" and (day, "model_removed") in same_day)
    print(f"days with both an arrival and a departure (possible renamed ids): {renames}")

    if not args.write and args.out is None:
        return 0
    target = args.out if args.out is not None else CHANGES
    if target.exists() and not args.force:
        print(f"{target} exists; pass --force to replace it.", file=sys.stderr)
        return 1
    write(events, target)
    print(f"wrote {len(events)} events to {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
