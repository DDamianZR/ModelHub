"""LMArena Arena Leaderboard Dataset (CC-BY-4.0).

Blind human voting, read through the HuggingFace datasets-server REST API so the ingest
needs no Python dependencies.

Two endpoints, tried in order. `/filter` over the `full` split is preferred: it carries
complete history and lets the duplication guard below walk back through several
candidate snapshots. But `/filter` has answered 500 to any `where` clause on this
dataset since at least 2026-08-13 (verified 2026-08-23) - the query string itself is
fine, the endpoint is broken for this dataset specifically. `/rows` over the `latest`
split is the fallback: it holds exactly one snapshot (every category, one publish date)
so there is nothing to walk back through, only the same duplication guard as a backstop.
If HuggingFace repairs `/filter`, the first path recovers automatically and so does the
deeper per-model backfill in `history_for`.
"""
from __future__ import annotations

import time
import urllib.parse

from ..common import SourceError, fetch_json, norm

FILTER_ENDPOINT = "https://datasets-server.huggingface.co/filter"
ROWS_ENDPOINT = "https://datasets-server.huggingface.co/rows"
DATASET = "lmarena-ai/leaderboard-dataset"
ATTRIBUTION = "https://lmarena.ai/leaderboard"

# The server rejects length > 100 for this dataset with a 422.
ROWS_PAGE = 100

# /rows has no `where` clause, so a `latest`-split fetch pulls every category. Observed
# 2026-08-23: 10,383 rows for `text`. Capped well above that so a growing dataset doesn't
# silently truncate; raised again if it ever gets close.
ROWS_CAP = 20000

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
    return fetch_json(f"{FILTER_ENDPOINT}?{params}")


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


ROWS_RETRIES = 4
ROWS_RETRY_BASE_SECONDS = 3.0

# Transient - worth a backoff and retry, unlike the /filter 500 (see below).
_TRANSIENT_STATUSES = ("429", "502", "503", "504")


def _fetch_rows_page(url: str) -> dict:
    """fetch_json, but a transient status gets a short exponential backoff instead of
    failing the whole snapshot.

    This is unlike the /filter 500: that is the endpoint refusing this dataset outright,
    where retrying only waits for a non-weather problem to clear (rejected in the audit
    for that reason). 429/502/503/504 are rate-limiting and gateway hiccups, which is what
    backoff exists for - observed 2026-08-23 when paginated fetches against this
    unauthenticated endpoint hit both a 429 and, on a later run, a 502. Anything else
    still raises immediately.
    """
    delay = ROWS_RETRY_BASE_SECONDS
    for attempt in range(ROWS_RETRIES + 1):
        try:
            return fetch_json(url)
        except SourceError as exc:
            message = str(exc)
            transient = any(f"HTTP Error {code}" in message for code in _TRANSIENT_STATUSES)
            if not transient or attempt == ROWS_RETRIES:
                raise
            time.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")  # loop always returns or raises above


def _rows_all(
    config: str,
    split: str,
    cap: int = ROWS_CAP,
    stop_after_category: str | None = None,
) -> list[dict]:
    """Every row of one config/split via /rows. No `where` clause exists on this
    endpoint, so the caller filters in Python.

    A full `text/latest` fetch is ~104 requests, paced with a small delay between pages -
    an unpaced run tripped this same unauthenticated endpoint's rate limit at request 97
    during testing (verified 2026-08-23), and the 2026-08-28 production failure hit a 429
    at request 47. Four retries with backoff cannot ride out a limit reached mid-run.

    `stop_after_category` cuts that down for a caller that only wants one contiguous
    category block. Verified 2026-08-29: in `latest`, rows are ordered by category and
    'overall' is the first block - offsets 0-394 of 10424. Once a row of that category has
    been seen, pagination stops at the first later page that also contains a row of a
    different category, since the boundary must fall inside it. That is 4 requests instead
    of ~104.

    This never stops on a guess: if the target category never appears, or the split (or
    `cap`) runs out before any other category follows it, pagination falls through to a
    full traversal exactly like `stop_after_category=None` - the same request count as
    today, not a truncation. It is the caller's job to check the boundary was actually
    reached before trusting a short result; this function returns what it fetched either
    way and never raises for that reason.
    """
    rows: list[dict] = []
    offset = 0
    total: int | None = None
    seen_target = False
    while offset < cap:
        params = urllib.parse.urlencode({
            "dataset": DATASET, "config": config, "split": split,
            "offset": offset, "length": ROWS_PAGE,
        })
        page = _fetch_rows_page(f"{ROWS_ENDPOINT}?{params}")
        if total is None:
            total = page["num_rows_total"]
        batch = [item["row"] for item in page["rows"]]
        if not batch:
            break
        rows.extend(batch)
        if stop_after_category is not None:
            if any(row["category"] == stop_after_category for row in batch):
                seen_target = True
            if seen_target and any(row["category"] != stop_after_category for row in batch):
                break
        offset += ROWS_PAGE
        if offset >= total:
            break
        time.sleep(0.2)
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


def _clean_snapshot_via_filter(config: str) -> tuple[list[dict], str, list[dict]]:
    """Newest snapshot that survives the duplication guard, plus the ones rejected.

    Walks back through the last few published dates over /filter, so it recovers even
    when the very newest snapshot is duplicated.
    """
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


def _clean_snapshot_via_latest(config: str) -> tuple[list[dict], str, list[dict]]:
    """The one snapshot the `latest` split holds, filtered to category='overall'.

    There is only ever one leaderboard_publish_date in this split, so there is no older
    snapshot to walk back to if this one fails the guard - only the guard itself, kept as
    a backstop rather than a search.
    """
    rows = _rows_all(config, "latest", stop_after_category="overall")
    if not rows:
        raise SourceError(f"lmarena/{config}: latest split returned no rows")

    overall = [row for row in rows if row["category"] == "overall"]
    if not overall:
        raise SourceError(f"lmarena/{config}: latest split has no 'overall' rows")

    if not any(row["category"] != "overall" for row in rows):
        raise SourceError(
            f"lmarena/{config}: fetched {len(rows)} rows and all were 'overall' - never "
            f"saw the category boundary the early-stop fetch depends on, so this result "
            f"cannot be trusted as complete"
        )

    snapshot = overall[0]["leaderboard_publish_date"]
    raw_ratio = len(overall) / len({row["model_name"] for row in overall})
    collapsed = collapse_slices(overall)

    residual = len(collapsed) / len({row["model_name"] for row in collapsed})
    if residual > DUPLICATE_RATIO_LIMIT:
        raise SourceError(
            f"lmarena/{config}: latest snapshot {snapshot} failed the duplication guard "
            f"({residual:.2f}x after slice collapse)"
        )
    if raw_ratio > DUPLICATE_RATIO_LIMIT:
        print(f"  lmarena/{config}: collapsed {len(overall)} rows to {len(collapsed)} "
              f"for {snapshot} ({raw_ratio:.2f}x mislabelled slices filtered)")
    return collapsed, snapshot, []


def _clean_snapshot(config: str) -> tuple[list[dict], str, list[dict], str]:
    """Newest snapshot that survives the duplication guard, however it had to be reached.

    Returns (rows, snapshot_date, rejected_snapshots, served_by), where served_by is
    "filter" or "rows-latest" - recorded in status.json so a silent path change is
    visible rather than assumed.
    """
    try:
        rows, snapshot, rejected = _clean_snapshot_via_filter(config)
        return rows, snapshot, rejected, "filter"
    except SourceError as exc:
        filter_error = str(exc)
    try:
        rows, snapshot, rejected = _clean_snapshot_via_latest(config)
        return rows, snapshot, rejected, "rows-latest"
    except SourceError as exc:
        raise SourceError(
            f"{filter_error}; rows-latest fallback also failed: {exc}"
        ) from exc


def variants_by_key(rows: list[dict]) -> dict[str, list[dict]]:
    """Every published variant per canonical key, strongest rating first.

    This deliberately does NOT collapse to the highest-rated variant. Picking the best
    rating is the "best" variant policy, which config/weights.json did not choose: it
    would hand a model its human preference from one configuration and its benchmark
    scores from another, which is the mixed-configuration result the policy in
    composite.py exists to prevent. The choice belongs there, with the benchmark
    coverage in view, so every variant published on the same day is passed through.
    """
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(norm(row["model_name"]), []).append({
            "model_name": row["model_name"],
            "rating": row["rating"],
            "rating_lower": row.get("rating_lower"),
            "rating_upper": row.get("rating_upper"),
            "variance": row.get("variance"),
            "rank": row["rank"],
            "vote_count": row["vote_count"],
            "license": row.get("license"),
        })
    for entries in grouped.values():
        entries.sort(key=lambda entry: entry["rating"], reverse=True)
    return grouped


def upgrade_payload(payload: dict) -> dict:
    """Bring a cached payload written before variants were kept up to the current shape.

    The cache is only read when today's fetch failed, which is exactly when a shape
    mismatch would be hardest to notice, so an old single-row entry is widened into a
    one-element list rather than left to fail an index further down.
    """
    for config in ("text", "vision"):
        section = payload.get(config)
        if not isinstance(section, dict):
            continue
        payload[config] = {
            key: value if isinstance(value, list) else [value]
            for key, value in section.items()
        }
    return payload


def collect() -> dict:
    text_rows, text_snapshot, text_rejected, served_by = _clean_snapshot("text")

    # Vision is optional: it feeds the separate vision score, never the composite.
    try:
        vision_rows, vision_snapshot, vision_rejected, _ = _clean_snapshot("vision")
    except SourceError:
        vision_rows, vision_snapshot, vision_rejected = [], None, []

    return {
        "snapshot": text_snapshot,
        "vision_snapshot": vision_snapshot,
        "rejected_snapshots": text_rejected + vision_rejected,
        "served_by": served_by,
        "text": variants_by_key(text_rows),
        "vision": variants_by_key(vision_rows),
        # One point per model from this same fetch, so run.py can add today's rating to
        # the history series when served_by is "rows-latest" and history_for (which needs
        # /filter) is not available. This cannot backfill - only history_for can - so a
        # model's series only gains today's point this way.
        "history_points": {
            row["model_name"]: {
                "rating": row["rating"],
                "date": row["leaderboard_publish_date"],
            }
            for row in text_rows
        },
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
