"""Fail the workflow if any source has missed too many runs in a row.

Run as the last step, after the data commit: R8 says no daily human maintenance, not no
one ever finding out. A source stuck on cache for one run is normal upstream noise: sites
have blips. Three in a row is not noise, and GitHub emails the repo on a failed scheduled
workflow, which is the free (R1) channel that actually reaches someone.

Deliberately separate from report_status.py, which must keep exiting 0: it runs before the
commit step and a non-zero exit there would stop the workflow before today's degraded-but-
still-correct data ever reaches /data.
"""
from __future__ import annotations

import json
import pathlib
import sys

STATUS = pathlib.Path(__file__).resolve().parents[2] / "data" / "status.json"

CONSECUTIVE_FAILURE_LIMIT = 3


def main() -> int:
    if not STATUS.exists():
        print("no status.json written")
        return 0

    payload = json.loads(STATUS.read_text(encoding="utf-8"))
    offenders = [
        (name, status.get("consecutive_failures", 0))
        for name, status in payload.get("sources", {}).items()
        if status.get("consecutive_failures", 0) >= CONSECUTIVE_FAILURE_LIMIT
    ]
    if not offenders:
        return 0

    for name, streak in offenders:
        print(f"::error::{name} has not fetched fresh data in {streak} consecutive runs")
    return 1


if __name__ == "__main__":
    sys.exit(main())
