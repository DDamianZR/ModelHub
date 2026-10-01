"""When each LiveBench row was published, for a snapshot that grows in place.

LiveBench releases a dated question set and then keeps adding models to that same table
for months without changing its date: the 2026-06-25 table gained 26 models between
2026-08-04 and 2026-09-23. Stamping every score with the snapshot date dated a model
released in September as measured in June, and aged the whole source by its question set
instead of by the last number it published.

Each row is dated instead by the first ingest that saw it, never earlier than the
snapshot. Rows are keyed by model, not by value: a change in how the ingest averages a
row must not pass for LiveBench publishing it, so a re-scored row keeps its date. That
errs towards calling data older than it is, never newer.

Usage: python -m scripts.ingest.row_dates --rebuild
"""
from __future__ import annotations

import json
import subprocess
import sys

from .common import ROOT, read_cache, write_cache

STATE = "livebench_rows"
CACHED_PAYLOAD = "data/cache/livebench.json"


def stamp(
    scores: dict[str, list[dict]], snapshot: str, previous: dict | None, today: str
) -> dict:
    """Set measured_at on every score and return the state for the next run.

    A row already seen under this snapshot keeps its date; a new row takes `today`. With no
    previous state, or once the snapshot itself changes, every row was published with the
    snapshot and takes its date.
    """
    previous = previous or {}
    known = previous.get("rows", {}) if previous.get("snapshot") == snapshot else {}
    rows = {}
    for key, entries in scores.items():
        for entry in entries:
            # Keyed by the name LiveBench published, not by our canonical key: correcting
            # the normaliser renames keys (qwen3.8 -> qwen3.8-max), and a renamed key
            # would otherwise read as a row first seen today.
            name = entry.get("variant") or key
            since = known.get(name) or known.get(key) or (today if known else snapshot)
            since = max(since, snapshot)
            entry["measured_at"] = since
            rows[name] = since
    return {"snapshot": snapshot, "rows": rows}


def latest(state: dict) -> str | None:
    """The last day the source published a number: what its age is measured from."""
    return max(state.get("rows", {}).values(), default=None) or state.get("snapshot")


def apply(payload: dict, today: str) -> dict | None:
    """Date the rows of today's payload and persist the state. None if there is nothing to date.

    A payload with no scores leaves the stored state alone: forgetting when rows were first
    seen would re-date all of them the next time the source answers.
    """
    scores, snapshot = payload.get("scores"), payload.get("snapshot")
    if not scores or not snapshot:
        return None
    state = stamp(scores, snapshot, read_cache(STATE), today)
    write_cache(STATE, state)
    return state


def rebuild() -> dict:
    """Replay every LiveBench payload the daily ingest committed, oldest first.

    Each ingest commits the payload it fetched, so git history already records which rows
    LiveBench published and when. Replaying it through stamp() gives the dates the ingest
    would have assigned had it dated rows from the start.
    """
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
            check=True,
        ).stdout

    state: dict = {}
    for commit in git("log", "--reverse", "--format=%H", "--", CACHED_PAYLOAD).split():
        cached = json.loads(git("show", f"{commit}:{CACHED_PAYLOAD}"))
        payload = cached["payload"]
        state = stamp(payload["scores"], payload["snapshot"], state, cached["fetched_at"])
    return state


if __name__ == "__main__":
    if sys.argv[1:] != ["--rebuild"]:
        sys.exit(__doc__)
    rebuilt = rebuild()
    write_cache(STATE, rebuilt)
    print(f"{len(rebuilt['rows'])} rows under snapshot {rebuilt['snapshot']}, "
          f"last published {latest(rebuilt)}")
