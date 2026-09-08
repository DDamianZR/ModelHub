"""Confirm the production site is serving the enrichment that was just pushed.

A push is not a deploy. Vercel builds from the commit and the public page only changes
when that build lands, so the daily Layer B run is not finished until the new prose is
actually readable at the public URL. Checking it here turns "I pushed" into "it shipped".

Everything compared is a string this repo wrote. No build API, no token, no service that
bills: the page is fetched and the text is looked for, which is the same check a reader
would do by hand.

The needle is chosen in the order the run actually changes things:
  1. a description generated today, matched on its own first words;
  2. failing that, the acquisition line, whose rendered date is bumped by every run;
  3. failing that, nothing changed today and only reachability is asserted.

Usage:
    python -m scripts.enrich.verify_deploy
    python -m scripts.enrich.verify_deploy --model alibaba-qwen3   # force one target
    python -m scripts.enrich.verify_deploy --timeout 900 --interval 20
"""
from __future__ import annotations

import argparse
import html
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
MESSAGES = ROOT / "messages"

BASE_URL = "https://model-hub-indol.vercel.app"
USER_AGENT = "modelhub-verify/1.0"

# Long enough for a cold Vercel build, short enough that a stuck deploy is reported the
# same day rather than held open.
DEFAULT_TIMEOUT = 600
DEFAULT_INTERVAL = 20

# Enough words to be unique to one model, few enough to survive a trailing edit.
NEEDLE_WORDS = 8


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def fetch(url: str, timeout: int = 30) -> tuple[int, str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, ""


def needle_from(text: str) -> str:
    return " ".join(text.split()[:NEEDLE_WORDS])


def acquisition_needle(checked_at: str) -> str | None:
    """The rendered "links checked on <date>" line, read from the message catalogue.

    Read rather than hardcoded so a reworded message does not silently turn this check
    into one that can never pass.
    """
    messages = load_json(MESSAGES / "es.json", {})
    template = messages.get("model", {}).get("acquisitionChecked")
    if not template or "{date}" not in template:
        return None
    return template.replace("{date}", checked_at)


def page_contains(page: str, needle: str) -> bool:
    """Match raw and entity-escaped, since the page is HTML and the needle is not."""
    return needle in page or html.escape(needle, quote=False) in page


def collect_targets(forced: str) -> tuple[list[tuple[str, str, str]], str]:
    """(model_id, needle, what) triples to confirm, plus a one-line reason."""
    models = {m["id"] for m in load_json(DATA / "models.json", {}).get("models", [])}
    descriptions = load_json(DATA / "i18n" / "descriptions.json", {})
    acquisition = load_json(DATA / "acquisition.json", {})
    today = date.today().isoformat()

    if forced:
        entry = descriptions.get(forced, {})
        if not entry.get("es"):
            print(f"no Spanish description for {forced!r} to match on")
            return [], "forced target has no description"
        return [(forced, needle_from(entry["es"]), "description")], "forced target"

    fresh = [
        (model_id, needle_from(entry["es"]), "description")
        for model_id, entry in sorted(descriptions.items())
        if entry.get("generated_at") == today and entry.get("es") and model_id in models
    ]
    if fresh:
        # Two is enough to prove the build landed; more only lengthens the poll.
        return fresh[:2], f"{len(fresh)} description(s) generated today"

    bumped = [
        model_id
        for model_id, entry in sorted(acquisition.items())
        if entry.get("checked_at") == today and model_id in models
    ]
    if bumped:
        needle = acquisition_needle(today)
        if needle:
            return [(bumped[0], needle, "acquisition date")], "acquisition links rechecked today"
        return [], "acquisition message template not found; cannot build a needle"

    return [], "nothing was written today"


def poll(url: str, needle: str, timeout: int, interval: int) -> bool:
    deadline = time.monotonic() + timeout
    attempt = 0
    while True:
        attempt += 1
        status, page = fetch(url)
        if status == 200 and page_contains(page, needle):
            print(f"    confirmed on attempt {attempt}")
            return True
        remaining = deadline - time.monotonic()
        reason = f"HTTP {status}" if status != 200 else "text not there yet"
        if remaining <= 0:
            print(f"    gave up after {attempt} attempt(s): {reason}")
            return False
        print(f"    {reason}; retrying in {interval}s ({remaining:.0f}s left)")
        time.sleep(min(interval, max(remaining, 1)))


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the production deploy")
    parser.add_argument("--base-url", default=BASE_URL)
    parser.add_argument("--model", default="", help="force a single model id")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    targets, reason = collect_targets(args.model)
    print(f"target: {reason}")

    if not targets:
        # Nothing shipped today, so there is no new string to look for. Reachability is
        # still worth asserting: a site that 500s is a failure whether or not this run
        # changed anything.
        status, _ = fetch(f"{base}/es")
        if status == 200:
            print(f"{base}/es responds 200; nothing new to confirm")
            return 0
        print(f"FAIL: {base}/es responds {status}")
        return 1

    ok = True
    for model_id, needle, what in targets:
        url = f"{base}/es/model/{model_id}"
        print(f"  {url}")
        print(f"    looking for the {what}: {needle!r}")
        if not poll(url, needle, args.timeout, args.interval):
            ok = False

    if ok:
        print("\nDEPLOY VERIFIED: the pushed content is live.")
        return 0
    print("\nDEPLOY NOT VERIFIED: the push landed but the site is not serving it yet.")
    print("Check the deployment log at https://vercel.com before rerunning.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
