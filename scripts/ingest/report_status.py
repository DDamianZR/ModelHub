"""Print per-source health from the last ingest, for the Actions log.

Kept as a file rather than an inline `python -c` in the workflow: quoting JSON access
inside YAML inside bash is how workflows quietly break.

Also emits GitHub Actions annotations (`::warning::` / `::error::`), which is what
surfaces a degraded source anywhere a human might see it - the job summary, the
checks tab, the annotation banner on the commit - instead of only in a log nobody
opens on a green run. A source stuck on cache is a warning; one that failed outright,
or has failed for 3 or more runs in a row, is an error. The `fail_stale.py` step run
after this one turns the second case into a workflow failure, which is what actually
emails someone.
"""
from __future__ import annotations

import json
import pathlib
import sys

STATUS = pathlib.Path(__file__).resolve().parents[2] / "data" / "status.json"

CONSECUTIVE_FAILURE_ERROR = 3


def main() -> int:
    if not STATUS.exists():
        print("no status.json written")
        return 0

    payload = json.loads(STATUS.read_text(encoding="utf-8"))
    for name, status in payload.get("sources", {}).items():
        state = status["state"]
        streak = status.get("consecutive_failures", 0)
        line = f"{name}: {state}"
        if status.get("last_success"):
            line += f" (last success {status['last_success']})"
        if status.get("error"):
            line += f" - {status['error']}"
        print(line)

        if state == "failed" or streak >= CONSECUTIVE_FAILURE_ERROR:
            print(f"::error::{name} has failed {streak} run(s) in a row - {line}")
        elif state in ("cached", "stale"):
            print(f"::warning::{name} is serving cached data ({streak} run(s) in a row) - {line}")

    for rejected in payload.get("rejected_snapshots", []):
        if isinstance(rejected, dict):
            line = (
                f"rejected snapshot: {rejected.get('config', '?')} "
                f"{rejected['date']} ({rejected['ratio']}x duplicated)"
            )
            print(line)
            print(f"::warning::{line}")
        else:
            print(f"rejected snapshot: {rejected}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
