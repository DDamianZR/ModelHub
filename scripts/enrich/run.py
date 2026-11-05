"""Layer B: local enrichment (llama.cpp). Run on demand, never on a schedule.

Writes editorial ES/EN descriptions and acquisition links into /data, then stops. A human
reviews the diff and commits. Nothing here runs in CI and nothing here touches a number.

Usage:
    python -m scripts.enrich.run                 # fill in what is missing
    python -m scripts.enrich.run --fast          # qwen3-8b instead of qwen3-coder-30b
    python -m scripts.enrich.run --limit 5       # stop after five models
    python -m scripts.enrich.run --only <id>     # a single model
    python -m scripts.enrich.run --force         # regenerate, still skipping manual edits
    python -m scripts.enrich.run --restale       # regenerate only entries checks.contradicts_data flags
    python -m scripts.enrich.run --links-only    # acquisition links, no model calls
    python -m scripts.enrich.run --unlock <id>   # drop the manual flag so --only <id> regenerates it
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

from . import acquisition
from .checks import contradicts_data
from .describe import describe
from .llama_server import LlamaServerError, pick_model

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


def prune_orphans(model_ids: set[str]) -> int:
    """Drop descriptions of models the ingest no longer publishes.

    An orphan is never shown on the site, but the audit counts it as a failure, so a
    retired or renamed model would otherwise keep CI red until someone edits the file by
    hand. Entries marked manual are kept: they are human work and a human removes them.
    """
    if not model_ids:
        print("No models found. Run the ingest first.")
        return 1
    descriptions = load_json(DESCRIPTIONS, {})
    orphans = sorted(mid for mid in descriptions if mid not in model_ids)
    kept = [mid for mid in orphans if descriptions[mid].get("manual")]
    removed = [mid for mid in orphans if mid not in kept]
    for mid in removed:
        del descriptions[mid]
        print(f"  pruned {mid}")
    for mid in kept:
        print(f"  kept {mid} (manual)")
    write_json(DESCRIPTIONS, descriptions)
    print(f"\npruned {len(removed)} · kept manual {len(kept)}")
    return 0


def unlock(model_id: str) -> int:
    """Hand one hand-written entry back to the generator.

    A manual entry is never overwritten, so when its text contradicts today's data the
    audit fails until a human acts. This is that action, made explicit: the text stays
    in place until a regeneration replaces it.
    """
    descriptions = load_json(DESCRIPTIONS, {})
    entry = descriptions.get(model_id)
    if not entry:
        print(f"No description for {model_id!r}")
        return 1
    if not entry.pop("manual", False):
        print(f"{model_id} is not marked manual; nothing to unlock")
        return 0
    write_json(DESCRIPTIONS, descriptions)
    print(f"unlocked {model_id}; regenerate it with --only {model_id} --force")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="ModelHub Layer B enrichment")
    parser.add_argument("--fast", action="store_true", help="use qwen3-8b")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--only", type=str, default="")
    parser.add_argument("--force", action="store_true",
                        help="regenerate even when a description exists")
    parser.add_argument("--restale", action="store_true",
                        help="regenerate only entries checks.contradicts_data flags "
                             "against today's scores; ignores --force")
    parser.add_argument("--links-only", action="store_true",
                        help="rebuild acquisition links without calling the model")
    parser.add_argument("--prune-orphans", action="store_true",
                        help="drop descriptions whose model is no longer in models.json, "
                             "keeping hand-written entries; does not call the model")
    parser.add_argument("--unlock", type=str, default="",
                        help="drop the manual flag of one entry so it can be regenerated")
    args = parser.parse_args()
    if args.unlock:
        return unlock(args.unlock)

    models = load_json(DATA / "models.json", {}).get("models", [])
    if args.prune_orphans:
        return prune_orphans({m["id"] for m in models})
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

    model_name = ""
    if not args.links_only:
        try:
            model_name = pick_model(fast=args.fast)
        except LlamaServerError as exc:
            print(f"FATAL: {exc}")
            return 1
        print(f"Using {model_name}")

    written = skipped = failed = locked = 0
    durations: list[float] = []
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

        if args.restale:
            stale = existing and contradicts_data(
                existing.get("es", ""), existing.get("en", ""), model
            )
            if not stale:
                skipped += 1
                continue
        elif existing and not args.force:
            skipped += 1
            continue

        print(f"  {model_id}")
        try:
            text, elapsed = describe(model, model_name)
        except ValueError as exc:
            # Rejected output is a gap, never a partial write.
            print(f"    SKIPPED: {exc}")
            failed += 1
            continue
        except LlamaServerError as exc:
            print(f"FATAL: {exc}")
            break

        durations.append(elapsed)
        descriptions[model_id] = {
            **text,
            "generated_by": model_name,
            "generated_at": date.today().isoformat(),
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
