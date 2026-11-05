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


# When a model is missing from the newest release that publishes a category's suite, may it
# carry its value from an older release that has the suite? Decided by measured drift between
# releases (see NOTES-REVIVE.md), not by assumption.
FALLBACK_TO_OLDER = False

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


def load_releases(releases: list[dict], fetcher, *, need_all: bool) -> tuple[list[dict], list[dict]]:
    """Readable releases newest first, each with its task map and rows, plus those passed over.

    Per category, the newest release that publishes a suite for it is the one that counts, so
    loading stops once every scored category has one - unless `need_all`, which also loads the
    older releases a model may fall back to. A release is passed over when its files are gone
    or when it publishes no suite for any scored category.
    """
    wanted = set(CATEGORY_MAP.values())
    loaded: list[dict] = []
    skipped: list[dict] = []
    covered: set[str] = set()
    for release in releases:
        if covered >= wanted and not need_all:
            break
        try:
            table = fetcher(release["table"]).decode("utf-8", "replace")
            categories = json.loads(fetcher(release["categories"]).decode())
        except (SourceError, json.JSONDecodeError) as exc:
            skipped.append({"date": release["date"], "reason": f"unreadable: {exc}"[:160]})
            continue
        task_category = _task_categories(categories)
        if not task_category:
            skipped.append({"date": release["date"], "reason": "no suite for a scored category"})
            continue
        covered |= set(task_category.values())
        loaded.append({"date": release["date"], "tasks": task_category,
                       "rows": list(csv.DictReader(table.splitlines()))})
    if not loaded:
        raise SourceError(
            "livebench: no scoreable release among "
            + ", ".join(f"{s['date']} ({s['reason']})" for s in skipped[:4])
        )
    return loaded, skipped


def _row_scores(row: dict, tasks: dict[str, str]) -> dict[str, float]:
    buckets: dict[str, list[float]] = {}
    for task, category in tasks.items():
        raw = row.get(task)
        if not raw:
            continue
        try:
            buckets.setdefault(category, []).append(float(raw))
        except ValueError:
            continue
    return {c: round(sum(v) / len(v), 2) for c, v in buckets.items()}


def collect(fetcher=fetch, fallback: bool | None = None) -> dict:
    fallback = FALLBACK_TO_OLDER if fallback is None else fallback
    releases = _resolve_releases(fetcher)
    loaded, skipped = load_releases(releases, fetcher, need_all=fallback)

    # Newest release publishing each category; the rest are only consulted under `fallback`.
    by_category: dict[str, list[dict]] = {}
    for release in loaded:
        for category in set(release["tasks"].values()):
            by_category.setdefault(category, []).append(release)

    per_model: dict[str, dict[str, dict]] = {}   # key -> category -> {value, date, name}
    for category, candidates in by_category.items():
        for release in candidates if fallback else candidates[:1]:
            for row in release["rows"]:
                raw_name = (row.get("model") or "").strip()
                key = norm(raw_name)
                if not key:
                    continue
                value = _row_scores(row, release["tasks"]).get(category)
                if value is None or category in per_model.get(key, {}):
                    continue
                per_model.setdefault(key, {})[category] = {
                    "value": value, "date": release["date"], "name": raw_name}

    scores: dict[str, list[dict]] = {}
    for key, cats in per_model.items():
        for category, hit in sorted(cats.items()):
            scores.setdefault(key, []).append({
                "benchmark_id": f"livebench_{category}",
                "category": category,
                "variant": hit["name"],
                "value": hit["value"],
                "source_type": "third_party_benchmark",
                "source_url": ATTRIBUTION,
                "measured_at": hit["date"],
            })

    if not scores:
        raise SourceError("livebench: no rows parsed")

    used = sorted({h["date"] for cats in per_model.values() for h in cats.values()}, reverse=True)
    payload = {
        "snapshot": used[0],
        "releases_used": {c: cands[0]["date"] for c, cands in sorted(by_category.items())},
        "published_snapshots": sorted(r["date"] for r in releases),
        "scores": scores,
    }
    # Only releases newer than the oldest one in use can be "newer but not scored".
    newest_unreadable = [s for s in skipped if s["date"] > used[-1]]
    if newest_unreadable:
        payload["skipped_releases"] = newest_unreadable
    return payload
