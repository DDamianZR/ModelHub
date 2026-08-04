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


def _resolve_snapshots() -> list[str]:
    """Every published snapshot date, oldest first.

    The snapshot list lives in a JS array inside a hash-named bundle, which makes this the
    most fragile step in the pipeline. Failure here is a SourceError, so the run falls back
    to the cached payload rather than dying.

    The whole list is returned, not just the newest, so the run can compare the cadence
    this source actually keeps against the one config/sources.json declares for it.
    """
    html = fetch(f"{SITE}/").decode("utf-8", "replace")
    bundle = re.search(r'src="\.?/?(static/js/main\.[0-9a-f]+\.js)"', html)
    if not bundle:
        raise SourceError("livebench: could not locate the JS bundle")

    script = fetch(f"{SITE}/{bundle.group(1)}", timeout=180).decode("utf-8", "replace")
    array = re.search(r'\[((?:"20\d{2}-\d{2}-\d{2}",?)+)\]', script)
    if not array:
        raise SourceError("livebench: could not locate the snapshot list")

    dates = sorted(set(re.findall(r"20\d{2}-\d{2}-\d{2}", array.group(1))))
    if not dates:
        raise SourceError("livebench: snapshot list was empty")
    return dates


def collect() -> dict:
    published = _resolve_snapshots()
    snapshot = published[-1]
    slug = snapshot.replace("-", "_")

    table = fetch(f"{SITE}/table_{slug}.csv").decode("utf-8", "replace")
    categories = json.loads(fetch(f"{SITE}/categories_{slug}.json").decode())

    task_category = {
        task: CATEGORY_MAP[group]
        for group, tasks in categories.items()
        if group in CATEGORY_MAP
        for task in tasks
    }

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

    return {"snapshot": snapshot, "published_snapshots": published, "scores": scores}
