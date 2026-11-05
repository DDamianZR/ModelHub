"""LiveBench (Apache-2.0).

Ships raw per-task scores with no precomputed aggregate, so the category averages are
computed here from the published task-to-category map. That keeps the whole chain
reproducible by hand from public files.
"""
from __future__ import annotations

import csv
import json
import re

from ..common import SourceError, fetch, norm

SITE = "https://livebench.ai"
ATTRIBUTION = "https://livebench.ai/"

# "Agentic Coding" folds into coding; Data Analysis and Language have no weighted slot.
CATEGORY_MAP = {
    "Reasoning": "reasoning",
    "Coding": "coding",
    "Agentic Coding": "coding",
    "Mathematics": "math",
    "IF": "instruction_following",
}


# Categories a release must publish to be scoreable. None: the newest readable release is
# used even when it drops a suite (instruction following has no LiveBench source in the
# newest versions); the category is then simply unmeasured, never carried from an older one.
REQUIRED_CATEGORIES: frozenset[str] = frozenset()

_V1_LIST = re.compile(r'\[((?:"20\d{2}-\d{2}-\d{2}",?)+)\]')
_V2_LIST = re.compile(r'\[((?:"20\d{6}",?)+)\]')


def parse_releases(script: str) -> list[dict]:
    """Every release the site's bundle lists, newest first.

    Two generations coexist in the bundle: dated v1 snapshots, now served under /v1/, and
    compact-dated 2.0 releases served under /data/<id>/. Both lists live in minified
    JavaScript, which makes this the most fragile step in the pipeline; a miss is a
    SourceError, so the run falls back to the cached payload rather than dying.
    """
    v1 = _V1_LIST.search(script)
    if not v1:
        raise SourceError("livebench: could not locate the snapshot list")

    releases: list[dict] = []
    for date in sorted(set(re.findall(r"20\d{2}-\d{2}-\d{2}", v1.group(1)))):
        slug = date.replace("-", "_")
        releases.append({
            "date": date, "generation": "v1",
            "table": f"{SITE}/v1/table_{slug}.csv",
            "categories": f"{SITE}/v1/categories_{slug}.json",
        })
    for match in _V2_LIST.finditer(script):
        for compact in sorted(set(re.findall(r"20\d{6}", match.group(1)))):
            date = f"{compact[:4]}-{compact[4:6]}-{compact[6:]}"
            releases.append({
                "date": date, "generation": "v2",
                "table": f"{SITE}/data/{compact}/table.csv",
                "categories": f"{SITE}/data/{compact}/categories.json",
            })
    if not releases:
        raise SourceError("livebench: snapshot list was empty")
    return sorted({r["date"]: r for r in releases}.values(), key=lambda r: r["date"], reverse=True)


def _task_categories(categories: dict) -> dict[str, str]:
    return {
        task: CATEGORY_MAP[group]
        for group, tasks in categories.items()
        if group in CATEGORY_MAP and isinstance(tasks, list)
        for task in tasks
    }


def _resolve_releases(fetcher) -> list[dict]:
    html = fetcher(f"{SITE}/").decode("utf-8", "replace")
    bundle = re.search(r'src="\.?/?(static/js/main\.[0-9a-f]+\.js)"', html)
    if not bundle:
        raise SourceError("livebench: could not locate the JS bundle")
    script = fetcher(f"{SITE}/{bundle.group(1)}", timeout=180).decode("utf-8", "replace")
    return parse_releases(script)


def select_release(releases: list[dict], fetcher) -> tuple[dict, str, dict[str, str], list[dict]]:
    """The newest release that can be scored, with the ones passed over and why.

    Newest first. A release is passed over when its files are gone (404) or when it
    publishes no suite for a required category. Passed-over releases are returned so the
    status file can say a newer release exists and is not being scored.
    """
    skipped: list[dict] = []
    for release in releases:
        try:
            table = fetcher(release["table"]).decode("utf-8", "replace")
            categories = json.loads(fetcher(release["categories"]).decode())
        except (SourceError, json.JSONDecodeError) as exc:
            skipped.append({"date": release["date"], "reason": f"unreadable: {exc}"[:160]})
            continue
        task_category = _task_categories(categories)
        missing = REQUIRED_CATEGORIES - set(task_category.values())
        if missing:
            skipped.append({"date": release["date"],
                            "reason": "no suite for " + ", ".join(sorted(missing))})
            continue
        return release, table, task_category, skipped
    raise SourceError(
        "livebench: no scoreable release among "
        + ", ".join(f"{s['date']} ({s['reason']})" for s in skipped[:4])
    )


def collect(fetcher=fetch) -> dict:
    releases = _resolve_releases(fetcher)
    release, table, task_category, skipped = select_release(releases, fetcher)
    snapshot = release["date"]

    scores: dict[str, list[dict]] = {}
    for row in csv.DictReader(table.splitlines()):
        raw_name = (row.get("model") or "").strip()
        key = norm(raw_name)
        if not key:
            continue
        buckets: dict[str, list[float]] = {}
        for task, category in task_category.items():
            raw = row.get(task)
            if not raw:
                continue
            try:
                buckets.setdefault(category, []).append(float(raw))
            except ValueError:
                continue
        for category, values in buckets.items():
            scores.setdefault(key, []).append({
                "benchmark_id": f"livebench_{category}",
                "category": category,
                "variant": raw_name,
                "value": round(sum(values) / len(values), 2),
                "source_type": "third_party_benchmark",
                "source_url": ATTRIBUTION,
                "measured_at": snapshot,
            })

    if not scores:
        raise SourceError("livebench: no rows parsed")

    payload = {
        "snapshot": snapshot,
        "published_snapshots": sorted(r["date"] for r in releases),
        "scores": scores,
    }
    if skipped:
        payload["skipped_releases"] = skipped
    return payload
