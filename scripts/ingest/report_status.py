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

Fetch failures and stale snapshots are different axes, checked separately: a source can
fetch perfectly every day (0 consecutive_failures, state "ok") while still serving a
snapshot that hasn't moved in weeks, because the upstream site itself hasn't published.
LiveBench's own declared cadence puts its warn threshold at 60 days; without this second
check that threshold had nothing wired to it and could be crossed silently.
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
STATUS = ROOT / "data" / "status.json"
SOURCES_CONFIG = ROOT / "config" / "sources.json"

CONSECUTIVE_FAILURE_ERROR = 3
DEFAULT_DEGRADE_AFTER_FAILURES = 3


def degrade_after_failures(config_path: pathlib.Path = SOURCES_CONFIG) -> int:
    """Failures in a row after which a source counts as degraded, from config/sources.json."""
    try:
        value = json.loads(config_path.read_text(encoding="utf-8")).get(
            "degrade_after_consecutive_failures")
    except (OSError, json.JSONDecodeError):
        return DEFAULT_DEGRADE_AFTER_FAILURES
    return value if isinstance(value, int) and value > 0 else DEFAULT_DEGRADE_AFTER_FAILURES


def apply_failure_rule(sources: dict, snapshot_ages: dict, threshold: int) -> list[str]:
    """Mark a source degraded once it has failed `threshold` runs in a row.

    Snapshot age alone cannot see this: a source that has been unreachable for weeks still
    holds a cached snapshot whose date is recent against a generous cadence, so it reads
    "fresh" while nothing has been fetched. Mutates `snapshot_ages` in place and returns
    the names changed. Idempotent, so running it on an already-adjusted file is harmless.
    """
    changed: list[str] = []
    for name, status in sources.items():
        streak = status.get("consecutive_failures", 0)
        age = snapshot_ages.get(name)
        if streak < threshold or age is None or age.get("freshness") == "degraded":
            continue
        age["freshness_by_age"] = age.get("freshness")
        age["freshness"] = "degraded"
        age["degraded_reason"] = f"{streak} consecutive failed fetches (limit {threshold})"
        changed.append(name)
    return changed


def explain_age(name: str, age: dict, status: dict) -> str:
    """Why a snapshot is old: the source published nothing, or published what we passed over.

    The two read the same on a date alone and mean opposite things. A source that is quiet is
    waiting on someone else; one that published releases we could not use is on us.
    """
    skipped = status.get("skipped_releases") or []
    if skipped:
        listed = ", ".join(f"{s['date']} ({s['reason']})" for s in skipped[:4])
        return f"{name} published newer releases that were passed over: {listed}"
    return f"{name} has published nothing newer than {age.get('date')}"


def describe_category_rule(name: str, status: dict) -> list[str]:
    """One line per category stating which release it was scored from, and why."""
    lines = []
    for category, rule in sorted((status.get("category_rule") or {}).items()):
        drift = "" if rule.get("drift") is None else f", drift {rule['drift']} over {rule['common_models']} models"
        lines.append(f"{name}: {category} from {rule['release']} ({rule['reason']}{drift})")
    return lines


def main() -> int:
    if not STATUS.exists():
        print("no status.json written")
        return 0

    payload = json.loads(STATUS.read_text(encoding="utf-8"))
    apply_failure_rule(
        payload.get("sources", {}), payload.get("snapshot_ages", {}), degrade_after_failures())
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

    for name, age in payload.get("snapshot_ages", {}).items():
        freshness = age.get("freshness")
        if freshness not in ("aging", "degraded"):
            continue
        reason = f" [{age['degraded_reason']}]" if age.get("degraded_reason") else ""
        detail = (
            f"{name}: snapshot from {age.get('date')} is {age.get('age_days')} day(s) "
            f"old (warn at {age.get('warn_days')}, degraded at {age.get('degraded_days')})"
        )
        print(detail)
        print("  " + explain_age(name, age, payload.get("sources", {}).get(name, {})))
        if freshness == "degraded":
            print(f"::error::{detail}")
        else:
            print(f"::warning::{detail}")

    for name, status in payload.get("sources", {}).items():
        for line in describe_category_rule(name, status):
            print(line)

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
