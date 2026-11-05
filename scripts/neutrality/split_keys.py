"""List canonical keys that differ only by the separator between two digits.

Reads the cached normalised payloads, never the network. A key such as ``x-5-1`` and
``x-5.1`` are the same model spelled by two sources; before the key fold they were two
models. The listing is provider-blind on purpose: it prints every group found, so a split
that hurts one provider cannot be fixed without showing the others.

    python -m scripts.neutrality.split_keys
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

CACHE = Path(__file__).resolve().parents[2] / "data" / "cache"
_DIGIT_SEP = re.compile(r"(?<=\d)[._-](?=\d)")


def fold(key: str) -> str:
    return _DIGIT_SEP.sub(".", key)


def _keys_of(name: str, payload: dict) -> set[str]:
    if name == "epoch":
        return set(payload.get("registry", {})) | set(payload.get("scores", {}))
    if name == "livebench":
        return set(payload.get("scores", {}))
    if name == "lmarena":
        return set(payload.get("text", {})) | set(payload.get("vision", {}))
    return set()


def find_splits() -> dict[str, dict[str, set[str]]]:
    """folded key -> {spelling: sources that use it}, only where spellings differ."""
    seen: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for path in sorted(CACHE.glob("*.json")):
        if path.stem.endswith("_rows"):
            continue
        payload = json.loads(path.read_text(encoding="utf-8")).get("payload") or {}
        for key in _keys_of(path.stem, payload):
            seen[fold(key)][key].add(path.stem)
    return {f: dict(s) for f, s in seen.items() if len(s) > 1}


def main() -> None:
    splits = find_splits()
    for folded, spellings in sorted(splits.items()):
        print(folded)
        for spelling, sources in sorted(spellings.items()):
            print(f"  {spelling:40s} {', '.join(sorted(sources))}")
    print(f"\n{len(splits)} split group(s)")


if __name__ == "__main__":
    main()
