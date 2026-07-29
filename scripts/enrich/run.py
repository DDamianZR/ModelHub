"""Layer B: local enrichment (Ollama). Run on demand, never on a schedule.

Writes editorial ES/EN descriptions and acquisition links into /data, then stops. A human
reviews the diff and commits. Nothing here runs in CI and nothing here touches a number.

Usage:
    python -m scripts.enrich.run                 # fill in what is missing
    python -m scripts.enrich.run --fast          # qwen3:8b instead of qwen3-coder:30b
    python -m scripts.enrich.run --limit 5       # stop after five models
    python -m scripts.enrich.run --only <id>     # a single model
    python -m scripts.enrich.run --force         # regenerate, still skipping manual edits
    python -m scripts.enrich.run --links-only    # acquisition links, no model calls
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

from . import acquisition
from .describe import describe
from .ollama import OllamaError, pick_model
from ..ingest.composite import load_methodology_version

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
DESCRIPTIONS = DATA / "i18n" / "descriptions.json"
ACQUISITION = DATA / "acquisition.json"


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"  ! {path.name} is not valid JSON; refusing to overwrite it")
        raise


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def is_locked(entry: dict | None) -> bool:
    """A human edited this entry, so the model does not get to overwrite it.

    Set "manual": true on any entry to hand-write it permanently.
    """
    return bool(entry and entry.get("manual"))


def main() -> int:
    parser = argparse.ArgumentParser(description="ModelHub Layer B enrichment")
    parser.add_argument("--fast", action="store_true", help="use qwen3:8b")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--only", type=str, default="")
    parser.add_argument("--force", action="store_true",
                        help="regenerate even when a description exists")
    parser.add_argument("--links-only", action="store_true",
                        help="rebuild acquisition links without calling the model")
    args = parser.parse_args()

    models = load_json(DATA / "models.json", {}).get("models", [])
    providers = {
        p["id"]: p["display_name"]
        for p in load_json(DATA / "providers.json", {}).get("providers", [])
    }
    if not models:
        print("No models found. Run the ingest first.")
        return 1

    if args.only:
        models = [m for m in models if m["id"] == args.only]
        if not models:
            print(f"No model with id {args.only!r}")
            return 1

    descriptions = load_json(DESCRIPTIONS, {})
    links = load_json(ACQUISITION, {})

    ollama_model = ""
    if not args.links_only:
        try:
            ollama_model = pick_model(fast=args.fast)
        except OllamaError as exc:
            print(f"FATAL: {exc}")
            return 1
        print(f"Using {ollama_model}")

    written = skipped = failed = locked = 0
    durations: list[float] = []
    methodology_version = load_methodology_version()
    started = time.monotonic()

    for model in models:
        if args.limit and written >= args.limit:
            break

        model_id = model["id"]
        model = {**model, "provider_name": providers.get(model.get("provider_id", ""))}
        existing = descriptions.get(model_id)

        if is_locked(existing):
            locked += 1
            continue

        # Acquisition links are deterministic, so they are refreshed every run.
        if links.get(model_id, {}).get("manual"):
            locked += 1
        else:
            built = acquisition.build(model)
            links[model_id] = {
                "acquisition": built["acquisition"],
                "verified": built["verified"],
                "checked_at": date.today().isoformat(),
            }

        if args.links_only:
            continue

        if existing and not args.force:
            skipped += 1
            continue

        print(f"  {model_id}")
        try:
            text, elapsed = describe(model, ollama_model)
        except ValueError as exc:
            # Rejected output is a gap, never a partial write.
            print(f"    SKIPPED: {exc}")
            failed += 1
            continue
        except OllamaError as exc:
            print(f"FATAL: {exc}")
            break

        durations.append(elapsed)
        descriptions[model_id] = {
            **text,
            "generated_by": ollama_model,
            "generated_at": date.today().isoformat(),
            # A description states which of a model's categories are relatively stronger,
            # so it is a derivative of the category scores and only true under the formula
            # that produced them. Stamping it lets the site withhold prose that a later
            # methodology has contradicted, instead of printing it next to bars that
            # disagree. This is R14 applied to sentences rather than to numbers.
            "methodology_version": methodology_version,
        }
        written += 1
        print(f"    ok in {elapsed:.1f}s")

    write_json(DESCRIPTIONS, descriptions)
    write_json(ACQUISITION, links)

    total = time.monotonic() - started
    print(
        f"\nwritten {written} · skipped {skipped} · rejected {failed} · "
        f"manual {locked}"
    )
    if durations:
        print(
            f"generation: {sum(durations) / len(durations):.1f}s mean, "
            f"{min(durations):.1f}-{max(durations):.1f}s range, "
            f"{total:.0f}s total wall time"
        )
    print("Review the diff before committing. Nothing here is auto-committed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
