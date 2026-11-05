"""Which providers the visitor-facing copy keeps naming.

Methodology pages need examples, and an example has to be some model. But when every
illustration of how the pipeline works happens to use the same lab's models, the page
reads as that lab's case study - a framing effect no number on the site would reveal.
The usual cause is mundane: whoever writes the copy reaches for the names most familiar
to them, and the most familiar names are rarely a neutral sample.

This only counts and points. It never fails: a real incident should be told with the
model it actually happened to, and only a human can tell an incident from an illustration.

    python -m scripts.neutrality.copy_skew
    python -m scripts.neutrality.copy_skew --share 0.4
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scripts.neutrality.vendors import vendors_in

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FILES = ("messages/es.json", "messages/en.json")
DEFAULT_SHARE = 0.5
MIN_MENTIONS = 4


def _strings(payload, prefix: str = ""):
    if isinstance(payload, dict):
        for key, value in payload.items():
            yield from _strings(value, f"{prefix}.{key}" if prefix else key)
    elif isinstance(payload, list):
        for index, value in enumerate(payload):
            yield from _strings(value, f"{prefix}[{index}]")
    elif isinstance(payload, str):
        yield prefix, payload


def scan(path: Path) -> tuple[dict[str, int], list[tuple[str, dict[str, int]]]]:
    totals: dict[str, int] = {}
    where: list[tuple[str, dict[str, int]]] = []
    for key, text in _strings(json.loads(path.read_text(encoding="utf-8"))):
        found = vendors_in(text)
        if found:
            where.append((key, found))
            for vendor, count in found.items():
                totals[vendor] = totals.get(vendor, 0) + count
    return totals, where


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="*", default=list(DEFAULT_FILES))
    parser.add_argument("--share", type=float, default=DEFAULT_SHARE,
                        help="flag a provider above this share of all mentions")
    args = parser.parse_args(argv)
    # The report prints × and ⚠; a Windows pipe defaults to cp1252 and cannot encode ⚠.
    sys.stdout.reconfigure(encoding="utf-8")

    for name in args.files:
        totals, where = scan(ROOT / name)
        total = sum(totals.values())
        print(f"## {name}: {total} provider mentions")
        if not total:
            continue
        for vendor, count in sorted(totals.items(), key=lambda item: -item[1]):
            share = count / total
            flag = " ⚠" if share > args.share and total >= MIN_MENTIONS else ""
            print(f"  {vendor:<20} {count:>3}  {share:5.0%}{flag}")
        print("  where:")
        for key, found in where:
            print(f"    {key}: {', '.join(f'{v}×{c}' for v, c in sorted(found.items()))}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
