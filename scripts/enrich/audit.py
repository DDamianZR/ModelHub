"""Audit every committed description against the publishing rules.

Runs the same checks.problems() the generator runs, over data/i18n/descriptions.json.
Exits non-zero on any defect, so CI blocks a description that should never have shipped.

This exists because the generator once passed a full pass that a later, stricter audit
found 55 defects in. The two are now the same code; this entry point is what stops them
diverging again.

Usage: python -m scripts.enrich.audit
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from .checks import problems
from ..ingest.composite import load_methodology_version

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"


def main() -> int:
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

    current_version = load_methodology_version()

    kinds: Counter[str] = Counter()
    failing = 0
    orphans = 0
    stale = 0

    for model_id, entry in sorted(descriptions.items()):
        model = models.get(model_id)
        if model is None:
            # A description for a model the catalogue no longer carries is dead weight.
            orphans += 1
            print(f"ORPHAN  {model_id}: no such model in models.json")
            continue

        # A description names which categories a model is relatively stronger at, so it is
        # only true under the formula that ordered them. One written under an earlier
        # methodology is withheld by the site rather than shown, and counted here so the
        # backlog is visible instead of silently growing.
        if entry.get("methodology_version") != current_version:
            stale += 1
            continue

        found = problems(entry.get("es", ""), entry.get("en", ""), model)
        if found:
            failing += 1
            print(f"FAIL    {model_id}")
            for problem in found:
                print(f"          {problem}")
                kinds[problem.split(":")[0].split("(")[0].strip()] += 1

    total = len(descriptions)
    print(
        f"\n{total} description(s) audited · {total - failing - orphans - stale} clean · "
        f"{failing} failing · {orphans} orphaned · {stale} stale"
    )
    if kinds:
        print("\nby kind:")
        for kind, count in kinds.most_common():
            print(f"  {count:>3}  {kind}")
    if stale:
        print(
            f"\n{stale} description(s) predate methodology {current_version} and are "
            f"withheld from the site. Regenerate with `npm run enrich -- --force`."
        )

    # Stale is not a failure: it is the correct, safe state after a methodology change, and
    # failing CI over it would block the very commit that raised the version.
    return 1 if (failing or orphans) else 0


if __name__ == "__main__":
    sys.exit(main())
