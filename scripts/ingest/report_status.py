"""Print per-source health from the last ingest, for the Actions log.

Kept as a file rather than an inline `python -c` in the workflow: quoting JSON access
inside YAML inside bash is how workflows quietly break.
"""
from __future__ import annotations

import json
import pathlib
import sys

STATUS = pathlib.Path(__file__).resolve().parents[2] / "data" / "status.json"


def main() -> int:
    if not STATUS.exists():
        print("no status.json written")
        return 0

    payload = json.loads(STATUS.read_text(encoding="utf-8"))
    for name, status in payload.get("sources", {}).items():
        line = f"{name}: {status['state']}"
        if status.get("last_success"):
            line += f" (last success {status['last_success']})"
        if status.get("error"):
            line += f" - {status['error']}"
        print(line)

    for rejected in payload.get("rejected_snapshots", []):
        if isinstance(rejected, dict):
            print(
                f"rejected snapshot: {rejected.get('config', '?')} "
                f"{rejected['date']} ({rejected['ratio']}x duplicated)"
            )
        else:
            print(f"rejected snapshot: {rejected}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
