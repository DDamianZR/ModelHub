"""LiveBench (Apache-2.0).

Ships raw per-task scores with no precomputed aggregate, so the category averages are
computed here from the published task-to-category map. That keeps the whole chain
reproducible by hand from public files.
"""
from __future__ import annotations

import csv
import json
import pathlib
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


CONFIG = pathlib.Path(__file__).resolve().parents[3] / "config" / "sources.json"


def _livebench_config(path: pathlib.Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    for source in payload.get("sources", []):
        if source.get("id") == "livebench":
            return source
    raise ValueError("livebench: no entry in config/sources.json")


def load_max_drift(path: pathlib.Path = CONFIG) -> float:
    """Largest mean absolute gap between two releases for which their scales count as one.

    Declared in config/sources.json so it is debatable by PR, not buried in code.
    """
    return float(_livebench_config(path)["max_cross_release_drift"])


def load_min_common(path: pathlib.Path = CONFIG) -> int:
    """Fewest models two releases must share before their gap says anything about the scale."""
    return int(_livebench_config(path)["min_common_models"])


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


def load_releases(releases: list[dict], fetcher) -> tuple[list[dict], list[dict]]:
    """Readable releases newest first, each with its task map and rows, plus those passed over.

    Per category the rule compares the newest release that publishes its suite with the
    nearest earlier one that publishes a different suite (see `comparison_release`), so
    loading stops once every scored category has both. A release is passed over when its
    files are gone or when it publishes no suite for any scored category.
    """
    wanted = set(CATEGORY_MAP.values())
    loaded: list[dict] = []
    skipped: list[dict] = []
    for release in releases:
        if all(comparison_release(loaded, c) for c in wanted):
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
        loaded.append({"date": release["date"], "tasks": task_category,
                       "rows": list(csv.DictReader(table.splitlines()))})
    if not loaded:
        raise SourceError(
            "livebench: no scoreable release among "
            + ", ".join(f"{s['date']} ({s['reason']})" for s in skipped[:4])
        )
    return loaded, skipped


def _suite(release: dict, category: str) -> frozenset[str]:
    return frozenset(t for t, c in release["tasks"].items() if c == category)


def comparison_release(loaded: list[dict], category: str) -> tuple[dict, dict] | None:
    """(newest release publishing the category, nearest earlier one with a different suite).

    A release that re-publishes the same task set measures on the same scale as the newest,
    so it says nothing about whether the scales moved; the comparison has to cross a change
    of suite. None while no such earlier release is known.
    """
    publishing = [r for r in loaded if _suite(r, category)]
    if not publishing:
        return None
    newest = publishing[0]
    for other in publishing[1:]:
        if _suite(other, category) != _suite(newest, category):
            return newest, other
    return None


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


def _category_values(release: dict, category: str) -> dict[str, tuple[str, float]]:
    """norm(model) -> (name as published, value) for one category of one release."""
    out: dict[str, tuple[str, float]] = {}
    for row in release["rows"]:
        raw_name = (row.get("model") or "").strip()
        key = norm(raw_name)
        if not key or key in out:
            continue
        value = _row_scores(row, release["tasks"]).get(category)
        if value is not None:
            out[key] = (raw_name, value)
    return out


def decide_category(newest: dict, older: dict | None, category: str, max_drift: float,
                    min_common: int) -> dict:
    """Which release(s) supply one category, derived from how the two releases compare.

    Comparable (mean absolute drift on common models within `max_drift`): the newest release
    counts and a model it lacks keeps its value from the older one, dated with that release.
    Not comparable: the scales differ, so the whole category comes from a single release -
    the one covering more models, the newest on a tie. Only one release: that one.
    """
    new_values = _category_values(newest, category)
    decision = {"category": category, "release": newest["date"], "fallback": False,
                "drift": None, "common_models": 0, "reason": "single_release",
                "sources": [(newest["date"], new_values)]}
    if older is None:
        return decision
    old_values = _category_values(older, category)
    common = sorted(set(new_values) & set(old_values))
    decision["common_models"] = len(common)
    if len(common) < min_common:
        # A mean over a handful of models cannot license mixing scales.
        decision["reason"] = "too_few_common_models"
        return decision
    drift = sum(abs(new_values[k][1] - old_values[k][1]) for k in common) / len(common)
    decision["drift"] = round(drift, 2)
    if drift <= max_drift:
        decision.update(fallback=True, reason="comparable",
                        sources=[(newest["date"], new_values), (older["date"], old_values)])
    elif len(old_values) > len(new_values):
        decision.update(release=older["date"], reason="not_comparable_more_coverage_older",
                        sources=[(older["date"], old_values)])
    else:
        decision["reason"] = "not_comparable_more_coverage_newest"
    return decision


def collect(fetcher=fetch, max_drift: float | None = None, min_common: int | None = None) -> dict:
    max_drift = load_max_drift() if max_drift is None else max_drift
    min_common = load_min_common() if min_common is None else min_common
    releases = _resolve_releases(fetcher)
    loaded, skipped = load_releases(releases, fetcher)

    by_category: dict[str, list[dict]] = {}
    for release in loaded:
        for category in sorted(set(release["tasks"].values())):
            by_category.setdefault(category, []).append(release)

    decisions = {}
    for category, cands in sorted(by_category.items()):
        pair = comparison_release(loaded, category)
        newest, older = pair if pair else (cands[0], None)
        decisions[category] = decide_category(newest, older, category, max_drift, min_common)

    scores: dict[str, list[dict]] = {}
    for category, decision in decisions.items():
        taken: set[str] = set()
        for date, values in decision["sources"]:
            for key, (name, value) in values.items():
                if key in taken:
                    continue
                taken.add(key)
                scores.setdefault(key, []).append({
                    "benchmark_id": f"livebench_{category}",
                    "category": category,
                    "variant": name,
                    "value": value,
                    "source_type": "third_party_benchmark",
                    "source_url": ATTRIBUTION,
                    "measured_at": date,
                })

    if not scores:
        raise SourceError("livebench: no rows parsed")

    used = sorted({s["measured_at"] for rows in scores.values() for s in rows}, reverse=True)
    payload = {
        "snapshot": used[0],
        "releases_used": {c: d["release"] for c, d in decisions.items()},
        "category_rule": {
            c: {"release": d["release"], "fallback": d["fallback"], "drift": d["drift"],
                "common_models": d["common_models"], "reason": d["reason"],
                "max_drift": max_drift, "min_common_models": min_common}
            for c, d in decisions.items()
        },
        "published_snapshots": sorted(r["date"] for r in releases),
        "scores": scores,
    }
    # Only releases newer than the oldest one in use can be "newer but not scored".
    newest_unreadable = [s for s in skipped if s["date"] > used[-1]]
    if newest_unreadable:
        payload["skipped_releases"] = newest_unreadable
    return payload
