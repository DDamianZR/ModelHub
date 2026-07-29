"""Extract what vendors claim about their own models, from their own posts.

Fills data/vendor_claims.json, the input to /gaps. Nothing here is scored: a vendor_claim is
stored and displayed and never enters the composite, which the anti-bias rules have required
since the beginning and a test now pins.

No model is involved on this path. Values are read out of the vendor's published HTML table
by scripts/enrich/tables.py, and a value is only accepted when it sits in the SAME ROW as the
benchmark label it is credited to and the SAME COLUMN as the model. Checking that "74.9"
appears somewhere in the post is a weaker test that a 74.9 in any paragraph would pass, and
the difference between those two checks is the difference between a finding and a libel.

Usage:
    python -m scripts.enrich.claims            # fetch, extract, write
    python -m scripts.enrich.claims --dry-run  # report what it would write
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date

from ..ingest.common import CONFIG, DATA, USER_AGENT, SourceError, write_json
from .tables import extract_tables, find_rows, normalise_label, parse_value

SCHEMA_VERSION = 1


CLAIM_CACHE = DATA / "cache" / "claims"


def fetch_post(url: str, refresh: bool = False) -> tuple[str, str]:
    """Fetch a vendor post as HTML. Returns (markup, how_it_was_fetched).

    Cached on disk, because these pages are announcements: they do not change, and the cached
    copy is the evidence a reader can diff the extracted rows against.

    Two clients are tried, and which one worked is recorded. urllib gets a 403 from some
    vendor sites even though robots.txt is `Allow: /` for every agent and the same URL under
    the same User-Agent returns 200 to curl - an edge protection layer objecting to the
    client, not the site withholding permission. curl is a plain HTTP client, present on the
    runners, and no attempt is made here to look like a browser: the agent string identifies
    the project either way. If both are refused, the post is reported as unreachable and goes
    through manual capture instead, which is what the plan already prescribes for vendors that
    publish their tables as images.
    """
    CLAIM_CACHE.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", url.lower()).strip("-")[:120]
    cached = CLAIM_CACHE / f"{slug}.html"
    if cached.exists() and not refresh:
        return cached.read_text(encoding="utf-8", errors="replace"), "cache"

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en",
    }
    errors = []
    try:
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            markup = response.read().decode("utf-8", errors="replace")
        cached.write_text(markup, encoding="utf-8")
        return markup, "urllib"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        errors.append(f"urllib: {exc}")

    if shutil.which("curl"):
        result = subprocess.run(
            ["curl", "-sL", "--max-time", "60", "-A", USER_AGENT, url],
            capture_output=True,
            check=False,
        )
        markup = result.stdout.decode("utf-8", errors="replace")
        if result.returncode == 0 and markup.strip():
            cached.write_text(markup, encoding="utf-8")
            return markup, "curl"
        errors.append(f"curl: exit {result.returncode}")
    else:
        errors.append("curl: not installed")

    raise SourceError(f"{url}: {'; '.join(errors)}")


def load_config() -> dict:
    path = CONFIG / "vendor_claims.json"
    if not path.exists():
        raise SystemExit(f"{path} not found")
    return json.loads(path.read_text(encoding="utf-8"))


def load_scores() -> dict[tuple[str, str], dict]:
    """Our third-party measurements, keyed by (model, benchmark), for the comparison."""
    payload = json.loads((DATA / "scores.json").read_text(encoding="utf-8"))
    return {(row["model_id"], row["benchmark_id"]): row for row in payload["scores"]}


def extract_post(post: dict, labels: dict, refresh: bool = False) -> tuple[list[dict], dict]:
    """Claims from one post, plus what was seen and deliberately not stored."""
    markup, fetched_via = fetch_post(post["url"], refresh=refresh)
    tables = extract_tables(markup)

    # Column headers are matched on a normalised form: vendors write GPT-5.6 with a
    # non-breaking hyphen, and the mapping file should not have to reproduce that.
    wanted = {normalise_label(name): model_id for name, model_id in post["columns"].items()}

    claims: list[dict] = []
    stats = {"rows_seen": 0, "other_vendor_cells": 0, "unmapped_labels": set(),
             "fetched_via": fetched_via}
    seen: set[tuple[str, str]] = set()

    for table in tables:
        for label, mapping in labels.items():
            for header, row in find_rows(table, label):
                stats["rows_seen"] += 1
                for index, cell in enumerate(row):
                    if index == 0 or index >= len(header):
                        continue
                    value = parse_value(cell)
                    if value is None:
                        continue
                    model_id = wanted.get(normalise_label(header[index]))
                    if model_id is None:
                        # A competitor's column. Counted so the report can say how much was
                        # left on the table, never stored: a number OpenAI publishes about a
                        # Claude model is not Anthropic's claim.
                        stats["other_vendor_cells"] += 1
                        continue

                    key = (model_id, label)
                    if key in seen:
                        continue
                    seen.add(key)
                    claims.append({
                        "model_id": model_id,
                        "benchmark_id": mapping["benchmark_id"],
                        "value": value,
                        "unit": "percent",
                        "source_type": "vendor_claim",
                        "claim_url": post["url"],
                        "claim_date": post["claim_date"],
                        "vendor_label": label,
                        "stated_configuration": header[index].replace("‑", "-"),
                        "comparable_label": bool(mapping.get("comparable")),
                        "not_comparable_reason": mapping.get("reason"),
                        "extracted_by": "deterministic_html_table",
                        # The evidence is the row it came from, stored verbatim. Anyone can
                        # open claim_url and check this against the page.
                        "evidence_row": row[: len(header)],
                        "evidence_header": header,
                    })

    # Labels present in the post that nobody has mapped yet. Reported, not guessed at.
    for table in tables:
        for row in table:
            if row and not any(parse_value(c) is not None for c in row[1:]):
                continue
            if row and row[0] and normalise_label(row[0]) not in {
                normalise_label(k) for k in labels
            }:
                stats["unmapped_labels"].add(row[0])

    stats["unmapped_labels"] = sorted(stats["unmapped_labels"])[:40]
    return claims, stats


def compare(claim: dict, scores: dict) -> dict:
    """Set the comparison fields: is this contrastable, and if so is there a gap?"""
    ours = scores.get((claim["model_id"], claim["benchmark_id"]))
    threshold = claim.pop("_threshold")

    claim["third_party_value"] = ours["value"] if ours else None
    claim["third_party_variant"] = ours.get("variant") if ours else None
    claim["third_party_measured_at"] = ours.get("measured_at") if ours else None
    claim["third_party_source_url"] = ours.get("source_url") if ours else None

    if ours is None:
        claim["comparison"] = "no_third_party_measurement"
        claim["gap"] = None
        return claim

    if not claim["comparable_label"]:
        claim["comparison"] = "different_measurement"
        claim["gap"] = None
        return claim

    # Configuration has to match too. Epoch measured a specific effort level; a vendor
    # reporting a different one published a different number, not a contradictory one.
    stated = normalise_label(claim["stated_configuration"])
    variant = (ours.get("variant") or "").lower()
    if variant and variant not in ("plain", "unlabelled") and variant not in stated:
        claim["comparison"] = "different_configuration"
        # Structured, not prose. A sentence composed here would be English inside a Spanish
        # page; the UI builds it from these two fields in whichever locale is rendering.
        claim["third_party_configuration"] = variant
        claim["gap"] = None
        return claim

    gap = abs(claim["value"] - ours["value"]) / ours["value"] if ours["value"] else None
    claim["comparison"] = "comparable"
    claim["gap"] = round(gap, 4) if gap is not None else None
    claim["gap_flagged"] = bool(gap is not None and gap > threshold)
    return claim


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--refresh", action="store_true", help="re-fetch instead of using the cached copy")
    args = parser.parse_args(argv)

    config = load_config()
    scores = load_scores()
    labels = config["benchmark_labels"]
    threshold = float(config.get("gap_threshold", 0.10))

    claims: list[dict] = []
    reports = []
    for post in config["posts"]:
        print(f"  {post['url']}")
        try:
            found, stats = extract_post(post, labels, refresh=args.refresh)
        except SourceError as exc:
            print(f"    FAILED: {exc}")
            reports.append({"url": post["url"], "error": str(exc)[:200]})
            continue
        for claim in found:
            claim["_threshold"] = threshold
            claims.append(compare(claim, scores))
        print(f"    via {stats['fetched_via']}; {len(found)} claim(s) for own models; "
              f"{stats['other_vendor_cells']} competitor cells ignored; "
              f"{len(stats['unmapped_labels'])} unmapped label(s)")
        reports.append({
            "url": post["url"],
            "claims": len(found),
            "fetched_via": stats["fetched_via"],
            "other_vendor_cells_ignored": stats["other_vendor_cells"],
            "unmapped_labels": stats["unmapped_labels"],
        })

    # A later post restating an earlier claim is not a second claim. Deduplicated on
    # (model, benchmark, label) keeping the EARLIEST date, because the announcement that
    # first made the claim is the primary source and the one worth citing.
    unique: dict[tuple[str, str, str], dict] = {}
    for claim in sorted(claims, key=lambda c: c["claim_date"]):
        unique.setdefault(
            (claim["model_id"], claim["benchmark_id"], claim["vendor_label"]), claim
        )
    claims = list(unique.values())

    comparable = [c for c in claims if c["comparison"] == "comparable"]
    gaps = [c for c in comparable if c.get("gap_flagged")]

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": date.today().isoformat(),
        "gap_threshold": threshold,
        "counts": {
            "claims": len(claims),
            "comparable": len(comparable),
            "gaps": len(gaps),
            "not_comparable": len(claims) - len(comparable),
        },
        "note": (
            "Vendor claims are stored and displayed, never scored. A gap is only computed "
            "where the benchmark and the configuration both match; everything else is shown "
            "side by side with the reason it is not a comparison. Publishing zero gaps is a "
            "result, not a failure to find one."
        ),
        "extraction_report": reports,
        "claims": sorted(claims, key=lambda c: (c["model_id"], c["benchmark_id"])),
    }

    print(f"\n{len(claims)} claim(s) contrasted · {len(comparable)} comparable · "
          f"{len(gaps)} gap(s) beyond {threshold:.0%}")

    if args.dry_run:
        print(json.dumps(payload["counts"], indent=2))
        return 0

    write_json(DATA / "vendor_claims.json", payload)
    print("wrote data/vendor_claims.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
