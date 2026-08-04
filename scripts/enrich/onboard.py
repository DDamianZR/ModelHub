"""Detect open-weights models that are trending but absent from the catalogue.

Detection is deterministic: the HuggingFace Hub says what is trending, and a set
difference says what is missing. The language model is consulted for one thing only -
deciding whether an unfamiliar name is really a new model or another spelling of one we
already track - and even then its answer only chooses between candidates we supply.

Output is a draft entry marked unverified, written to data/onboarding.json. Nothing
reaches models.json without a human reading the diff.

Usage: python -m scripts.enrich.onboard [--fast] [--limit N]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

from .ollama import OllamaError, generate_json, pick_model

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
DRAFTS = DATA / "onboarding.json"

TRENDING = (
    "https://huggingface.co/api/models"
    "?sort=trendingScore&direction=-1&limit=40&filter=text-generation"
    # Without this the listing omits parameter counts and the size floor cannot fire.
    "&expand[]=safetensors&expand[]=tags&expand[]=downloads&expand[]=likes"
    "&expand[]=trendingScore"
)

MATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["same", "new"]},
        "matches": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
    "required": ["verdict", "confidence"],
}

MATCH_PROMPT = """You are reconciling AI model names for a catalogue.

Candidate name from HuggingFace: "{candidate}"

Models already in the catalogue that look closest:
{shortlist}

Decide whether the candidate is one of the listed models under a different name, or a
model the catalogue does not have yet.

Rules:
- "same" only if it is the SAME underlying model. A different size (8B vs 70B), a
  different generation (v2 vs v3) or a fine-tune by another organisation is "new".
- If you answer "same", set "matches" to the exact catalogue name from the list.
- You may only choose from the list. Never invent a name.
- If the shortlist is empty, the answer is "new".

Reply with JSON: {{"verdict": "same"|"new", "matches": "...", "confidence": "high"|"medium"|"low"}}
"""


# Quantised or reformatted re-uploads of a model that already exists. These are packaging,
# not new models, and detecting them needs no language model.
_FORMAT_SUFFIXES = (
    "gguf", "awq", "gptq", "mlx", "bnb-4bit", "bnb-8bit", "int4", "int8", "fp8",
    "w4a16", "w8a8", "exl2", "onnx", "safetensors",
)


# --------------------------------------------------------------- deterministic filters
#
# These run BEFORE anything is written, so the weekly list only contains candidates that
# need a human judgement. Every rule here is deliberately mechanical and debatable by PR;
# see CONTRIBUTING.md. None of them is a judgement about model quality, which we cannot
# know before a source measures it.

# Pre-release names. Ingesting a preview repeats the mistake that made Aider's leaderboard
# useless: data published before it settles, which then changes underneath us.
_PRERELEASE = ("-dev", "-preview", "-rc", "-beta", ".dev", "-alpha", "-test")

# This project tracks frontier models. Smaller ones are out of scope, not out of favour.
MIN_PARAMETERS = 7_000_000_000


def normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def parameter_count(entry: dict) -> int | None:
    """Parameters reported by the Hub, or None when it does not say.

    Returning None matters: an unknown size goes to review, never to the bin. Discarding
    what we merely fail to measure is the same error the coverage gate exists to avoid.
    """
    # Signals disagree in practice: one 35B repo reports a safetensors total three orders
    # of magnitude too small, which would have filtered it out as tiny. Take the largest
    # signal, because the rule is to discard what we KNOW is small, not what one field
    # happens to under-report.
    signals: list[int] = []

    safetensors = entry.get("safetensors") or {}
    total = safetensors.get("total")
    if isinstance(total, int) and total > 0:
        signals.append(total)

    for tag in entry.get("tags") or []:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([bBmM])", str(tag).strip())
        if match:
            value = float(match.group(1))
            signals.append(int(value * (1e9 if match.group(2).lower() == "b" else 1e6)))

    # Size stated in the repo name, e.g. "Nanbeige4.2-3B" or "antares-1b". This reads a
    # fact the publisher wrote down; it does not infer one. Only a token that is purely a
    # number followed by B or M counts, so "Qwen3.6-14B-A3B" yields 14B and not 3B.
    name = (entry.get("id") or "").split("/")[-1]
    sizes = [
        float(m.group(1)) * (1e9 if m.group(2).lower() == "b" else 1e6)
        for m in re.finditer(r"(?:^|[-_.])(\d+(?:\.\d+)?)([bBmM])(?=$|[-_.])", name)
    ]
    signals.extend(int(s) for s in sizes)
    return max(signals) if signals else None


def screen(entry: dict, name: str, known_norms: set[str], batch_bases: set[str]) -> str | None:
    """Return why this candidate is filtered out, or None to keep it for review."""
    base, fmt = strip_format(name)
    if fmt and (normalise(base) in known_norms or normalise(base) in batch_bases):
        return f"{fmt} repackaging of {base}"
    if fmt:
        return f"{fmt} repackaging"

    lowered = name.lower()
    for marker in _PRERELEASE:
        if lowered.endswith(marker) or f"{marker}-" in lowered:
            return f"pre-release name ({marker.strip('-.')})"

    size = parameter_count(entry)
    if size is not None and size < MIN_PARAMETERS:
        return f"{size / 1e9:.1f}B, below the {MIN_PARAMETERS / 1e9:.0f}B frontier floor"

    return None


def strip_format(name: str) -> tuple[str, str | None]:
    """Return (base name, format tag) for a repackaged upload."""
    lowered = name.lower()
    for suffix in _FORMAT_SUFFIXES:
        for pattern in (f"-{suffix}", f".{suffix}", f"_{suffix}"):
            if lowered.endswith(pattern):
                return name[: -len(pattern)], suffix
    return name, None


def fetch_trending() -> list[dict]:
    request = urllib.request.Request(
        TRENDING, headers={"User-Agent": "modelhub-onboard/1.0"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def shortlist_for(candidate: str, known: dict[str, str], limit: int = 6) -> list[str]:
    """Catalogue names sharing a token with the candidate. Deterministic prefilter."""
    tokens = {t for t in re.split(r"[^a-z0-9]+", candidate.lower()) if len(t) > 2}
    scored: list[tuple[int, str]] = []
    for key, display in known.items():
        other = {t for t in re.split(r"[^a-z0-9]+", key) if len(t) > 2}
        overlap = len(tokens & other)
        if overlap:
            scored.append((overlap, display))
    scored.sort(reverse=True)
    return [display for _, display in scored[:limit]]


def main() -> int:
    parser = argparse.ArgumentParser(description="Draft entries for new models")
    parser.add_argument("--fast", action="store_true")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    catalogue = json.loads((DATA / "models.json").read_text(encoding="utf-8"))["models"]
    aliases = json.loads((DATA / "aliases.json").read_text(encoding="utf-8"))

    # Everything we already answer to, including every alias a source has used.
    known_norms = set()
    known: dict[str, str] = {}
    for model in catalogue:
        known[model["id"]] = model["display_name"]
        known_norms.add(normalise(model["display_name"]))
        known_norms.add(normalise(model["id"]))
    for entry in aliases.values():
        # Entries carry per-source provenance since the /aliases audit was added; older
        # files stored a bare list.
        names = entry["names"] if isinstance(entry, dict) else entry
        for name in names:
            known_norms.add(normalise(name))

    # Already approved and waiting for a measurement. Re-drafting them every week would
    # be exactly the noise this screening exists to remove.
    watchlist = DATA / "watchlist.json"
    if watchlist.exists():
        for entry in json.loads(watchlist.read_text(encoding="utf-8")).get("models", []):
            known_norms.add(normalise(entry["hf_id"].split("/")[-1]))

    try:
        trending = fetch_trending()
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: could not read the Hub: {exc}")
        return 1

    # Deterministic first pass: anything whose name we already know is not new.
    unknown = []
    for entry in trending:
        repo_id = entry.get("id") or ""
        _, _, name = repo_id.partition("/")
        if not name or normalise(name) in known_norms:
            continue
        unknown.append((entry, name, repo_id))

    batch_bases = {normalise(strip_format(name)[0]) for _, name, _ in unknown}

    # Screen before writing anything, so the file only holds what needs a human.
    candidates, filtered = [], []
    for entry, name, repo_id in unknown:
        reason = screen(entry, name, known_norms, batch_bases)
        if reason:
            filtered.append((name, reason))
            continue
        size = parameter_count(entry)
        candidates.append({
            "hf_id": repo_id,
            "name": name,
            "parameters": size,
            "size_known": size is not None,
            "downloads": entry.get("downloads"),
            "likes": entry.get("likes"),
            "trending_score": entry.get("trendingScore"),
        })

    print(f"{len(trending)} trending · {len(unknown)} unrecognised · "
          f"{len(filtered)} filtered out · {len(candidates)} for review")
    for name, reason in filtered:
        print(f"    filtered: {name} - {reason}")
    if not candidates:
        return 0

    try:
        model_name = pick_model(fast=args.fast)
    except OllamaError as exc:
        print(f"FATAL: {exc}")
        return 1
    print(f"Using {model_name} for ambiguous names only")

    drafts = {}
    if DRAFTS.exists():
        drafts = json.loads(DRAFTS.read_text(encoding="utf-8"))

    for candidate in candidates[: args.limit]:
        shortlist = shortlist_for(candidate["name"], known)
        verdict, matches, confidence = "new", "", "high"

        if shortlist:
            prompt = MATCH_PROMPT.format(
                candidate=candidate["name"],
                shortlist="\n".join(f"- {name}" for name in shortlist),
            )
            try:
                parsed, _ = generate_json(model_name, prompt, MATCH_SCHEMA)
            except (ValueError, OllamaError) as exc:
                print(f"  {candidate['name']}: reconciliation failed ({exc}); "
                      f"drafting as new for manual review")
            else:
                verdict = parsed.get("verdict", "new")
                matches = parsed.get("matches", "")
                confidence = parsed.get("confidence", "low")
                # The model may only pick from the shortlist we supplied.
                if verdict == "same" and matches not in shortlist:
                    print(f"  {candidate['name']}: proposed match {matches!r} was not "
                          f"on the shortlist; treating as new")
                    verdict, matches = "new", ""

        if verdict == "same":
            print(f"  {candidate['name']}: alias of {matches} ({confidence})")
            drafts[candidate["hf_id"]] = {
                "kind": "alias_suggestion",
                "hf_id": candidate["hf_id"],
                "suggested_alias_of": matches,
                "confidence": confidence,
                "status": "unverified",
                "drafted_at": date.today().isoformat(),
            }
            continue

        print(f"  {candidate['name']}: draft new entry")
        drafts[candidate["hf_id"]] = {
            "kind": "new_model_draft",
            "hf_id": candidate["hf_id"],
            "display_name": candidate["name"],
            "hf_url": f"https://huggingface.co/{candidate['hf_id']}",
            "downloads": candidate["downloads"],
            "likes": candidate["likes"],
            "trending_score": candidate["trending_score"],
            "parameters": candidate["parameters"],
            "size_known": candidate["size_known"],
            # Deliberately absent: scores, provider mapping, release date. Those are
            # Layer A's job and must never be guessed here.
            "status": "unverified",
            "drafted_at": date.today().isoformat(),
        }

    DRAFTS.write_text(
        json.dumps(drafts, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"\n{len(drafts)} draft(s) in {DRAFTS.relative_to(ROOT)}. "
          f"All marked unverified; nothing was written to models.json.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
