"""Diff two models.json snapshots: who moved, by how much, and how far the order shifted.

Every change that alters a published number has to be measured against the previous clean
state rather than argued as plausible. This is the instrument that does the measuring, and
its output is what a methodology changelog entry quotes.

Usage:
    python -m scripts.analysis.compare_rankings BEFORE.json AFTER.json
    python -m scripts.analysis.compare_rankings BEFORE.json AFTER.json --top 20
    python -m scripts.analysis.compare_rankings BEFORE.json AFTER.json --json

Exit code is 0 whether or not anything moved: a movement is a finding to read, not a
failure. It is 2 only when a file cannot be read, so a broken invocation is never mistaken
for "nothing changed".
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Composites are published rounded to two decimals, so anything below half a unit in the
# last place is a float artefact rather than a movement worth reporting.
EPSILON = 0.005


def load(path: Path) -> dict[str, dict]:
    """Index one models.json by model id."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"no such file: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON ({exc})")
    models = payload.get("models")
    if not isinstance(models, list):
        raise SystemExit(f"{path}: expected a top-level 'models' array")
    return {m["id"]: m for m in models}


def compare(before: dict[str, dict], after: dict[str, dict]) -> dict:
    """Movement of every model present in both snapshots, plus arrivals and departures."""
    shared = sorted(set(before) & set(after))

    moves = []
    for model_id in shared:
        b, a = before[model_id], after[model_id]
        delta = a["composite"] - b["composite"]
        moves.append({
            "id": model_id,
            "display_name": a.get("display_name") or b.get("display_name") or model_id,
            "composite_before": b["composite"],
            "composite_after": a["composite"],
            "composite_delta": round(delta, 4),
            "rank_before": b.get("rank"),
            "rank_after": a.get("rank"),
            "rank_delta": (
                b["rank"] - a["rank"]
                if isinstance(b.get("rank"), int) and isinstance(a.get("rank"), int)
                else None
            ),
            "provisional_before": b.get("provisional"),
            "provisional_after": a.get("provisional"),
        })

    changed = [m for m in moves if abs(m["composite_delta"]) > EPSILON]
    shifts = [abs(m["composite_delta"]) for m in changed]

    # Order is compared over the models common to both snapshots, so a model that simply
    # arrived or left does not register as everyone else having moved.
    order_before = sorted(shared, key=lambda i: -before[i]["composite"])
    order_after = sorted(shared, key=lambda i: -after[i]["composite"])
    position_changes = sum(1 for x, y in zip(order_before, order_after) if x != y)

    return {
        "summary": {
            "models_before": len(before),
            "models_after": len(after),
            "compared": len(shared),
            "moved": len(changed),
            "mean_abs_shift": round(sum(shifts) / len(shifts), 4) if shifts else 0.0,
            "max_abs_shift": round(max(shifts), 4) if shifts else 0.0,
            "position_changes": position_changes,
            "entered_top_10": [
                m["id"] for m in moves
                if _in_top(m["rank_after"], 10) and not _in_top(m["rank_before"], 10)
            ],
            "left_top_10": [
                m["id"] for m in moves
                if _in_top(m["rank_before"], 10) and not _in_top(m["rank_after"], 10)
            ],
            "became_provisional": [
                m["id"] for m in moves
                if m["provisional_after"] and not m["provisional_before"]
            ],
            "left_provisional": [
                m["id"] for m in moves
                if m["provisional_before"] and not m["provisional_after"]
            ],
        },
        "added": sorted(set(after) - set(before)),
        "removed": sorted(set(before) - set(after)),
        "moved": sorted(changed, key=lambda m: -abs(m["composite_delta"])),
    }


def _in_top(rank: object, n: int) -> bool:
    return isinstance(rank, int) and rank <= n


def render(result: dict, top: int) -> str:
    s = result["summary"]
    lines = [
        f"compared {s['compared']} models "
        f"({s['models_before']} before, {s['models_after']} after)",
        f"moved            : {s['moved']}",
        f"mean |shift|     : {s['mean_abs_shift']:.2f}",
        f"max  |shift|     : {s['max_abs_shift']:.2f}",
        f"position changes : {s['position_changes']}",
    ]
    for label, key in (
        ("added", "added"),
        ("removed", "removed"),
    ):
        if result[key]:
            lines.append(f"{label:17s}: {', '.join(result[key])}")
    for label, key in (
        ("entered top 10", "entered_top_10"),
        ("left top 10", "left_top_10"),
        ("became provisional", "became_provisional"),
        ("left provisional", "left_provisional"),
    ):
        if s[key]:
            lines.append(f"{label:17s}: {', '.join(s[key])}")

    if not result["moved"]:
        lines.append("\nNo composite changed.")
        return "\n".join(lines)

    lines.append(f"\nlargest {min(top, len(result['moved']))} movements:")
    lines.append(
        f"  {'model':44s} {'before':>8s} {'after':>8s} {'delta':>8s} {'rank':>12s}"
    )
    for m in result["moved"][:top]:
        rank = f"{_fmt_rank(m['rank_before'])}->{_fmt_rank(m['rank_after'])}"
        lines.append(
            f"  {m['id'][:44]:44s} {m['composite_before']:8.2f} "
            f"{m['composite_after']:8.2f} {m['composite_delta']:+8.2f} {rank:>12s}"
        )
    return "\n".join(lines)


def _fmt_rank(rank: object) -> str:
    return str(rank) if isinstance(rank, int) else "-"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("before", type=Path, help="baseline models.json")
    parser.add_argument("after", type=Path, help="models.json to compare against it")
    parser.add_argument("--top", type=int, default=15, help="movements to print")
    parser.add_argument("--json", action="store_true", help="emit the full result as JSON")
    args = parser.parse_args(argv)

    result = compare(load(args.before), load(args.after))
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(render(result, args.top))
    return 0


if __name__ == "__main__":
    sys.exit(main())
