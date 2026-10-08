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
       python -m scripts.enrich.audit --baseline HEAD^1
                                               # fail only on entries added or changed
                                               # since that commit; used by CI

Why --baseline: the daily ingest keeps moving scores under committed prose, so the
committed file always carries some entries that today's numbers contradict. Failing every
change on those meant CI stayed red for weeks and stopped saying anything. Against a
baseline, an entry whose text is unchanged is reported as inherited and does not fail; any
entry this change wrote or rewrote is held to the full standard. If the baseline cannot be
read the audit falls back to failing on everything, never to passing.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from .checks import problems

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"


DESCRIPTIONS_PATH = "data/i18n/descriptions.json"


def unchanged_since(entry: dict, baseline: dict | None, model_id: str) -> bool:
    """True when the baseline carries this entry with the same text in both languages."""
    if baseline is None:
        return False
    before = baseline.get(model_id)
    return bool(before) and all(before.get(k) == entry.get(k) for k in ("es", "en"))


def load_baseline(ref: str) -> dict | None:
    """descriptions.json as of `ref`, or None if git cannot produce it."""
    try:
        shown = subprocess.run(
            ["git", "show", f"{ref}:{DESCRIPTIONS_PATH}"],
            cwd=ROOT, capture_output=True, check=True,
        )
        return json.loads(shown.stdout.decode("utf-8"))
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit committed descriptions")
    parser.add_argument("--warn", action="store_true",
                        help="report via ::warning:: annotations but always exit 0")
    parser.add_argument("--baseline", default="", metavar="REF",
                        help="fail only on entries added or changed since this git ref")
    args = parser.parse_args()

    baseline = None
    if args.baseline:
        baseline = load_baseline(args.baseline)
        if baseline is None:
            print(f"baseline {args.baseline!r} unreadable; auditing without it")

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
    inherited = 0

    for model_id, entry in sorted(descriptions.items()):
        model = models.get(model_id)
        if model is None:
            # A description for a model the catalogue no longer carries is dead weight.
            if unchanged_since(entry, baseline, model_id):
                inherited += 1
                print(f"KNOWN   {model_id}: orphaned, unchanged since {args.baseline}")
                continue
            orphans += 1
            print(f"ORPHAN  {model_id}: no such model in models.json")
            if args.warn:
                print(f"::warning::{model_id}: description orphaned, no such model")
            continue

        found = problems(entry.get("es", ""), entry.get("en", ""), model)
        if found and unchanged_since(entry, baseline, model_id):
            inherited += 1
            print(f"KNOWN   {model_id}: unchanged since {args.baseline}")
            for problem in found:
                print(f"          {problem}")
            continue
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
        f"\n{total} description(s) audited · {total - failing - orphans - inherited} clean · "
        f"{failing} failing · {orphans} orphaned"
    )
    if baseline is not None:
        print(f"{inherited} failing unchanged since {args.baseline} (reported, not fatal)")
    if kinds:
        print("\nby kind:")
        for kind, count in kinds.most_common():
            print(f"  {count:>3}  {kind}")

    if args.warn:
        return 0
    return 1 if (failing or orphans) else 0


if __name__ == "__main__":
    sys.exit(main())
