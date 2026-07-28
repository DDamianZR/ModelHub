"""LMArena Arena Leaderboard Dataset (CC-BY-4.0).

Blind human voting, read through the HuggingFace datasets-server REST API so the ingest
needs no Python dependencies.

The `full` split is used rather than `latest`: it carries the complete history the
sparklines need, and it lets the duplication guard below pick which snapshot to trust.
"""
from __future__ import annotations

import urllib.parse

from ..common import SourceError, fetch_json, norm

ENDPOINT = "https://datasets-server.huggingface.co/filter"
DATASET = "lmarena-ai/leaderboard-dataset"
ATTRIBUTION = "https://lmarena.ai/leaderboard"

# A snapshot with materially more rows than distinct models is duplicated and untrustworthy.
# Observed 2026-07-27: the 2026-07-20 and 2026-07-21 snapshots sat near 2.9, which would have
# rendered three different rank-1 models; clean snapshots sit at 1.00.
DUPLICATE_RATIO_LIMIT = 1.2

# Do NOT move this earlier without handling methodology breaks first.
#
# LMArena has changed how the rating is computed three times: Elo to Bradley-Terry on
# 2024-01-09, style control by default on 2025-05-16, and frequency re-weighting on
# 2025-07-23. Ratings either side of a break are not comparable, so drawing them as one
# continuous sparkline would invent a trend that never happened.
#
# This window starts after the most recent break, which is why the current series is safe
# to plot unannotated. Lowering it means annotating the breaks or cutting at the last one.
HISTORY_FROM = "2026-01-01"


def _query(config: str, where: str, offset: int = 0, length: int = 100) -> dict:
    params = urllib.parse.urlencode({
        "dataset": DATASET, "config": config, "split": "full",
        "where": where, "offset": offset, "length": length,
    })
    return fetch_json(f"{ENDPOINT}?{params}")


def _all(config: str, where: str, cap: int = 2000) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while offset < cap:
        page = _query(config, where, offset, 100)
        batch = [item["row"] for item in page["rows"]]
        if not batch:
            break
        rows.extend(batch)
        offset += 100
        if offset >= page["num_rows_total"]:
            break
    return rows


def _recent_snapshots(config: str) -> list[str]:
    """Publish dates, newest first.

    Rows come back in insertion order, so reading from offset 0 would only ever surface the
    oldest snapshot in the window. Walk the tail instead, in steps large enough to escape a
    single duplicated snapshot of 1100+ rows.
    """
    where = f"\"category\"='overall' AND \"leaderboard_publish_date\">='{HISTORY_FROM}'"
    total = _query(config, where, 0, 1)["num_rows_total"]
    if not total:
        return []

    dates: set[str] = set()
    back = 100
    while back <= 8000:
        offset = max(0, total - back)
        for item in _query(config, where, offset, 100)["rows"]:
            dates.add(item["row"]["leaderboard_publish_date"])
        if offset == 0 or len(dates) >= 5:
            break
        back += 600
    return sorted(dates, reverse=True)


def collapse_slices(rows: list[dict]) -> list[dict]:
    """Keep one row per model: the one with the freshest vote tally.

    From 2026-06-10 onward, snapshots carry up to six rows per model under
    category='overall'. Investigated 2026-07-28: no exposed column labels them. They are
    distinguishable only by vote_count — the genuine overall row carries the highest,
    freshest tally, while the extras share an older tally and belong to other leaderboard
    slices published under the wrong category.

    Measured against the last clean snapshot 11 days earlier, picking max vote_count gives
    a mean absolute drift of 0.80 rating points. Taking the first row or the highest rating
    gives 11.94, with 100 of 374 models moving more than 10 points. So this is a filter
    that recovers the real series, not a heuristic.

    Ties break toward the lower variance, which is the better-determined fit.
    """
    best: dict[str, dict] = {}
    for row in rows:
        current = best.get(row["model_name"])
        if current is None or (row["vote_count"], -row["variance"]) > (
            current["vote_count"], -current["variance"]
        ):
            best[row["model_name"]] = row
    return list(best.values())


def _clean_snapshot(config: str) -> tuple[list[dict], str, list[dict]]:
    """Newest snapshot that survives the duplication guard, plus the ones rejected."""
    rejected: list[dict] = []
    for snapshot in _recent_snapshots(config):
        rows = _all(
            config,
            f"\"category\"='overall' AND \"leaderboard_publish_date\"='{snapshot}'",
            cap=1500,
        )
        if not rows:
            continue

        raw_ratio = len(rows) / len({row["model_name"] for row in rows})
        collapsed = collapse_slices(rows)

        # The guard stays as a backstop. Collapsing should make this ratio exactly 1.0;
        # if it ever doesn't, the upstream shape has changed again in a way this filter
        # does not understand, and stale-but-correct beats fresh-but-wrong.
        residual = len(collapsed) / len({row["model_name"] for row in collapsed})
        if residual > DUPLICATE_RATIO_LIMIT:
            rejected.append({
                "date": snapshot, "ratio": round(residual, 2), "config": config,
                "reason": "still duplicated after slice collapse",
            })
            continue

        if raw_ratio > DUPLICATE_RATIO_LIMIT:
            print(f"  lmarena/{config}: collapsed {len(rows)} rows to {len(collapsed)} "
                  f"for {snapshot} ({raw_ratio:.2f}x mislabelled slices filtered)")
        return collapsed, snapshot, rejected

    summary = ", ".join(f"{item['date']} ({item['ratio']}x)" for item in rejected)
    raise SourceError(
        f"lmarena/{config}: every recent snapshot failed the duplication guard "
        f"({summary or 'no snapshots found'})"
    )


def collect() -> dict:
    text_rows, text_snapshot, text_rejected = _clean_snapshot("text")

    # Vision is optional: it feeds the separate vision score, never the composite.
    try:
        vision_rows, vision_snapshot, vision_rejected = _clean_snapshot("vision")
    except SourceError:
        vision_rows, vision_snapshot, vision_rejected = [], None, []

    def best_by_key(rows: list[dict]) -> dict[str, dict]:
        best: dict[str, dict] = {}
        for row in rows:
            key = norm(row["model_name"])
            if key not in best or row["rating"] > best[key]["rating"]:
                best[key] = {
                    "model_name": row["model_name"],
                    "rating": row["rating"],
                    "rank": row["rank"],
                    "vote_count": row["vote_count"],
                    "license": row.get("license"),
                }
        return best

    return {
        "snapshot": text_snapshot,
        "vision_snapshot": vision_snapshot,
        "rejected_snapshots": text_rejected + vision_rejected,
        "text": best_by_key(text_rows),
        "vision": best_by_key(vision_rows),
    }


def history_for(model_name: str) -> list[dict]:
    """Full rating history for one Arena model name.

    Queried one model at a time: an IN (...) list covering the whole cohort is rejected by
    the API with a 422.
    """
    escaped = model_name.replace("'", "''")
    where = (
        f"\"category\"='overall' AND \"model_name\"='{escaped}' AND "
        f"\"leaderboard_publish_date\">='{HISTORY_FROM}'"
    )
    rows = _all("text", where, cap=400)

    # Same mislabelled-slice problem, one date at a time: keep the freshest tally per day.
    by_date: dict[str, dict] = {}
    for row in rows:
        day = row["leaderboard_publish_date"]
        current = by_date.get(day)
        if current is None or (row["vote_count"], -row["variance"]) > (
            current["vote_count"], -current["variance"]
        ):
            by_date[day] = row
    return [by_date[day] for day in sorted(by_date)]
