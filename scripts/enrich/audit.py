"""Audit every committed description against the publishing rules.

Runs the same checks.problems() the generator runs, over data/i18n/descriptions.json.
Exits non-zero on any defect, so CI blocks a description that should never have shipped.

This exists because the generator once passed a full pass that a later, stricter audit
found 55 defects in. The two are now the same code; this entry point is what stops them
diverging again.

Usage: python -m scripts.enrich.audit
       python -m scripts.enrich.audit --warn   # always exit 0; used from the daily
                                                 # ingest, which moves the scores that can
                                                 # make a description stale and must not
                                                 # block today's data commit over it
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from .checks import problems

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit committed descriptions")
    parser.add_argument("--warn", action="store_true",
                        help="report via ::warning:: annotations but always exit 0")
    args = parser.parse_args()

    descriptions_path = DATA / "i18n" / "descriptions.json"
    models_path = DATA / "models.json"

    if not descriptions_path.exists():
        print("no descriptions.json; nothing to audit")
        return 0

    descriptions = json.loads(descriptions_path.read_text(encoding="utf-8"))
    if not descriptions:
        print("descriptions.json is empty; nothing to audit")
        return 0

    models = {
        m["id"]: m
        for m in json.loads(models_path.read_text(encoding="utf-8"))["models"]
    }

    kinds: Counter[str] = Counter()
    failing = 0
    orphans = 0

    for model_id, entry in sorted(descriptions.items()):
        model = models.get(model_id)
        if model is None:
            # A description for a model the catalogue no longer carries is dead weight.
            orphans += 1
            print(f"ORPHAN  {model_id}: no such model in models.json")
            if args.warn:
                print(f"::warning::{model_id}: description orphaned, no such model")
            continue

        found = problems(entry.get("es", ""), entry.get("en", ""), model)
        if found:
            failing += 1
            print(f"FAIL    {model_id}")
            for problem in found:
                print(f"          {problem}")
                kinds[problem.split(":")[0].split("(")[0].strip()] += 1
            if args.warn:
                print(f"::warning::{model_id}: {'; '.join(found)}")

    total = len(descriptions)
    print(
        f"\n{total} description(s) audited · {total - failing - orphans} clean · "
        f"{failing} failing · {orphans} orphaned"
    )
    if kinds:
        print("\nby kind:")
        for kind, count in kinds.most_common():
            print(f"  {count:>3}  {kind}")

    if args.warn:
        return 0
    return 1 if (failing or orphans) else 0


if __name__ == "__main__":
    sys.exit(main())
