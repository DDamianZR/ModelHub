"""Build the v1 seed dataset from real, licensed sources.

Sources (all verified in SOURCES.md, all CC-BY-4.0 or Apache-2.0):
  - Epoch AI      benchmark_data.zip     -> canonical registry + Reasoning/Coding/Math scores
  - LiveBench     table_{date}.csv       -> Reasoning/Coding/Math/IF category averages
  - LMArena       HF leaderboard-dataset -> Human preference (and a separate vision score)

Deliberately absent: swebench.com. Its data is CC-BY-NC-4.0 and this repo is MIT.

Standing rules enforced here:
  - LMArena snapshots are rejected when rows/distinct_models > ARENA_DUPLICATE_RATIO_LIMIT.
  - No vendor_claim value ever reaches the composite.
  - Multimodal is scored and displayed, but never folded into the composite.

Stdlib only, by design: the ingest must run on a free GitHub Actions runner with no
dependency footprint to maintain.

Usage: python scripts/seed/build_seed.py
"""
from __future__ import annotations

import csv
import io
import json
import re
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
CONFIG = ROOT / "config"

EPOCH_ZIP = "https://epoch.ai/data/benchmark_data.zip"
LIVEBENCH_INDEX = "https://livebench.ai/"
ARENA_ENDPOINT = "https://datasets-server.huggingface.co/filter"

# A snapshot with materially more rows than distinct models is duplicated and untrustworthy.
# Verified 2026-07-27: the 2026-07-21 snapshot sits near 2.9; clean snapshots sit at 1.0.
ARENA_DUPLICATE_RATIO_LIMIT = 1.2

MIN_RELEASE_DATE = "2025-06-01"
HISTORY_FROM = "2026-01-01"

WEIGHTS = {
    "reasoning": 0.25,
    "coding": 0.25,
    "math": 0.20,
    "human_preference": 0.15,
    "instruction_following": 0.15,
}

# Categories a model must have data in to compete in the main ranking.
#
# Renormalising over available weight means a thin model can rank high on what it is
# MISSING rather than on being better - the exact bias this project exists to fight.
# Models below the bar stay visible in a provisional section instead of being hidden.
# Four of five is deliberate: a brand-new model with all four benchmarks but no Arena
# votes yet still qualifies, flagged as awaiting human votes rather than penalised.
MIN_COVERAGE_FOR_RANKING = 4

# Epoch files we trust as first-hand third-party evaluations (no "_external" suffix).
EPOCH_BENCHMARKS = {
    "gpqa_diamond.csv": ("gpqa_diamond", "reasoning"),
    "math_level_5.csv": ("math_level_5", "math"),
    "swe_bench_verified.csv": ("swe_bench_verified", "coding"),
    "frontiermath.csv": ("frontiermath", "math"),
    "simpleqa_verified.csv": ("simpleqa_verified", "reasoning"),
}

# LiveBench task groups -> our categories. "Agentic Coding" folds into coding.
LIVEBENCH_CATEGORY_MAP = {
    "Reasoning": "reasoning",
    "Coding": "coding",
    "Agentic Coding": "coding",
    "Mathematics": "math",
    "IF": "instruction_following",
}

_SUFFIXES = (
    "-max-effort", "-xhigh-effort", "-high-effort", "-medium-effort", "-low-effort",
    "-promax", "-pro-unknown", "-prounknown", "-pre-release", "-unknown", "-none",
    "-thinking-auto", "-thinking", "-reasoning", "-max", "-xhigh", "-high", "-medium",
    "-low", "-64k", "-32k", "-128k", "-preview", "-exp", "-latest", "-instruct",
    "-chat", "-it",
)


def fetch(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "modelhub-seed/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def norm(name: str) -> str:
    """Collapse a vendor model string into a comparable key.

    Effort levels and thinking modes are stripped because the same underlying model is
    published under many of them; keeping them apart would fragment the ranking.
    """
    s = name.lower().strip()
    s = re.sub(r"[_\s]+", "-", s)
    s = re.sub(r"[-(]\d{8}\)?", "", s)
    s = re.sub(r"-\d{4}-\d{2}-\d{2}", "", s)
    changed = True
    while changed:
        changed = False
        for suf in _SUFFIXES:
            if s.endswith(suf):
                s, changed = s[: -len(suf)], True
    return re.sub(r"-+", "-", s).strip("-")


def slugify(org: str, key: str) -> str:
    org_slug = re.sub(r"[^a-z0-9]+", "-", org.lower()).strip("-")
    return f"{org_slug}-{key}"


# --------------------------------------------------------------------------- Epoch


def load_epoch() -> tuple[dict, dict]:
    """Return (registry keyed by normalized name, raw benchmark scores)."""
    blob = fetch(EPOCH_ZIP)
    zf = zipfile.ZipFile(io.BytesIO(blob))

    def read(name: str) -> list[dict]:
        with zf.open(name) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")))

    registry: dict[str, dict] = {}
    for row in read("epoch_capabilities_index.csv"):
        if (row.get("Release date") or "") < MIN_RELEASE_DATE:
            continue
        key = norm(row["Model version"])
        if not key:
            continue
        prev = registry.get(key)
        # Prefer the row with the richest display name, then the highest ECI.
        score = float(row["ECI Score"] or 0)
        if prev is None or score > prev["_eci"]:
            registry[key] = {
                "_eci": score,
                "display_name": (row.get("Display name") or row.get("Model name")
                                 or row["Model version"]).strip(),
                "organization": (row.get("Organization") or "Unknown").strip(),
                "country": (row.get("Country") or "").strip(),
                "release_date": row.get("Release date") or None,
                "accessibility": (row.get("Model accessibility") or "").strip(),
                "training_compute_flop": row.get("Training compute (FLOP)") or None,
            }

    scores: dict[str, list[dict]] = defaultdict(list)
    for filename, (bench_id, category) in EPOCH_BENCHMARKS.items():
        try:
            rows = read(filename)
        except KeyError:
            print(f"  ! Epoch file missing, skipping: {filename}")
            continue
        for row in rows:
            raw = row.get("mean_score") or row.get("Best score (across scorers)")
            if not raw:
                continue
            key = norm(row["Model version"])
            if key not in registry:
                continue
            try:
                value = float(raw) * 100.0
            except ValueError:
                continue
            scores[key].append({
                "benchmark_id": bench_id,
                "category": category,
                "value": round(value, 2),
                "source_type": "third_party_benchmark",
                "source_url": "https://epoch.ai/benchmarks",
                "measured_at": (row.get("Started at") or "")[:10] or None,
                "stderr": float(row["stderr"]) * 100 if row.get("stderr") else None,
            })
    print(f"  Epoch: {len(registry)} canonical models, "
          f"{sum(len(v) for v in scores.values())} scores")
    return registry, scores


# ----------------------------------------------------------------------- LiveBench


def resolve_livebench_snapshot() -> str:
    """Find the newest published snapshot date.

    The list lives in a JS array inside a hash-named bundle, so this walk is the fragile
    part of the pipeline. The caller falls back to the last known-good snapshot.
    """
    html = fetch(LIVEBENCH_INDEX).decode("utf-8", "replace")
    m = re.search(r'src="\.?/?(static/js/main\.[0-9a-f]+\.js)"', html)
    if not m:
        raise RuntimeError("could not locate the LiveBench JS bundle")
    bundle = fetch(f"https://livebench.ai/{m.group(1)}").decode("utf-8", "replace")
    arr = re.search(r'\[((?:"20\d{2}-\d{2}-\d{2}",?)+)\]', bundle)
    if not arr:
        raise RuntimeError("could not locate the LiveBench snapshot list")
    dates = re.findall(r"20\d{2}-\d{2}-\d{2}", arr.group(1))
    return max(dates)


def load_livebench(registry: dict) -> tuple[dict, str]:
    try:
        snapshot = resolve_livebench_snapshot()
    except Exception as exc:  # noqa: BLE001 - a broken walk must not kill the run
        snapshot = "2026-06-25"
        print(f"  ! LiveBench snapshot discovery failed ({exc}); using {snapshot}")
    slug = snapshot.replace("-", "_")

    table = fetch(f"https://livebench.ai/table_{slug}.csv").decode("utf-8", "replace")
    cats = json.loads(fetch(f"https://livebench.ai/categories_{slug}.json").decode())

    task_to_category = {
        task: LIVEBENCH_CATEGORY_MAP[group]
        for group, tasks in cats.items()
        if group in LIVEBENCH_CATEGORY_MAP
        for task in tasks
    }

    out: dict[str, list[dict]] = defaultdict(list)
    matched = 0
    for row in csv.DictReader(table.splitlines()):
        key = norm(row["model"])
        if key not in registry:
            continue
        matched += 1
        buckets: dict[str, list[float]] = defaultdict(list)
        for task, category in task_to_category.items():
            raw = row.get(task)
            if raw:
                try:
                    buckets[category].append(float(raw))
                except ValueError:
                    pass
        for category, values in buckets.items():
            out[key].append({
                "benchmark_id": f"livebench_{category}",
                "category": category,
                "value": round(sum(values) / len(values), 2),
                "source_type": "third_party_benchmark",
                "source_url": "https://livebench.ai/",
                "measured_at": snapshot,
                "stderr": None,
            })
    print(f"  LiveBench: snapshot {snapshot}, {matched} models matched")
    return out, snapshot


# -------------------------------------------------------------------------- LMArena


def arena_query(config: str, where: str, offset: int = 0, length: int = 100) -> dict:
    q = urllib.parse.urlencode({
        "dataset": "lmarena-ai/leaderboard-dataset",
        "config": config, "split": "full", "where": where,
        "offset": offset, "length": length,
    })
    return json.loads(fetch(f"{ARENA_ENDPOINT}?{q}", timeout=120).decode())


def arena_all(config: str, where: str, cap: int = 2000) -> list[dict]:
    rows, offset = [], 0
    while offset < cap:
        page = arena_query(config, where, offset, 100)
        batch = [x["row"] for x in page["rows"]]
        if not batch:
            break
        rows.extend(batch)
        offset += 100
        if offset >= page["num_rows_total"]:
            break
    return rows


def arena_snapshot_dates(config: str) -> list[str]:
    """Recent publish dates, newest first.

    Rows come back in insertion order, so paging from offset 0 would only ever surface the
    oldest snapshot in the window. Read the tail of the result set instead.
    """
    where = (f"\"category\"='overall' AND "
             f"\"leaderboard_publish_date\">='{HISTORY_FROM}'")
    total = arena_query(config, where, 0, 1)["num_rows_total"]
    if not total:
        return []
    # Walk backwards through the tail until several distinct snapshots are in hand. A single
    # snapshot can be 1100+ rows when duplicated, so small steps would never escape it.
    dates: set[str] = set()
    back = 100
    while back <= 8000:
        offset = max(0, total - back)
        for item in arena_query(config, where, offset, 100)["rows"]:
            dates.add(item["row"]["leaderboard_publish_date"])
        if offset == 0 or len(dates) >= 5:
            break
        back += 600
    return sorted(dates, reverse=True)


def load_arena_clean(config: str, label: str) -> tuple[list[dict], str | None]:
    """Newest snapshot that survives the duplication guard.

    A snapshot with ~3 rows per model produces three different "rank 1" models. That must
    never reach the home page, so a failing snapshot is skipped in favour of an older
    clean one rather than repaired by guesswork.
    """
    candidates = arena_snapshot_dates(config)
    if not candidates:
        print(f"  ! {label}: no snapshots found")
        return [], None

    # Probe newest-first, walking back until one passes.
    seen: set[str] = set()
    for snapshot in candidates:
        if snapshot in seen:
            continue
        seen.add(snapshot)
        rows = arena_all(config, f"\"category\"='overall' AND "
                                 f"\"leaderboard_publish_date\"='{snapshot}'", cap=1500)
        if not rows:
            continue
        distinct = len({r["model_name"] for r in rows})
        ratio = len(rows) / distinct if distinct else float("inf")
        if ratio > ARENA_DUPLICATE_RATIO_LIMIT:
            print(f"  ! {label}: REJECTED snapshot {snapshot} "
                  f"({len(rows)} rows / {distinct} models = {ratio:.2f}x duplicated)")
            continue
        print(f"  {label}: accepted snapshot {snapshot} "
              f"({len(rows)} rows / {distinct} models = {ratio:.2f}x)")
        return rows, snapshot

    print(f"  ! {label}: every recent snapshot failed the duplication guard")
    return [], None


def minmax(values: list[float]) -> tuple[float, float]:
    lo, hi = min(values), max(values)
    return (lo, hi) if hi > lo else (lo, lo + 1.0)


# ----------------------------------------------------------------------------- main


def main() -> None:
    print("Building seed dataset...")
    DATA.mkdir(exist_ok=True)
    (DATA / "i18n").mkdir(exist_ok=True)
    CONFIG.mkdir(exist_ok=True)

    registry, epoch_scores = load_epoch()
    livebench_scores, lb_snapshot = load_livebench(registry)

    arena_rows, arena_snapshot = load_arena_clean("text", "LMArena text")
    vision_rows, vision_snapshot = load_arena_clean("vision", "LMArena vision")

    # Arena ratings are Bradley-Terry, not a 0-100 scale, so they are min-max normalized
    # across the cohort actually present in this build. Documented in /methodology.
    arena_by_key = {}
    for row in arena_rows:
        key = norm(row["model_name"])
        if key in registry and (key not in arena_by_key
                                or row["rating"] > arena_by_key[key]["rating"]):
            arena_by_key[key] = row
    vision_by_key = {}
    for row in vision_rows:
        key = norm(row["model_name"])
        if key in registry and (key not in vision_by_key
                                or row["rating"] > vision_by_key[key]["rating"]):
            vision_by_key[key] = row
    print(f"  LMArena: {len(arena_by_key)} text / {len(vision_by_key)} vision matched")

    # Keep models with evidence from at least two independent sources.
    keys = sorted(
        k for k in registry
        if sum([bool(epoch_scores.get(k)), bool(livebench_scores.get(k)),
                k in arena_by_key]) >= 2
    )
    print(f"  Cohort: {len(keys)} models with >=2 independent sources")

    if arena_by_key:
        pool = [arena_by_key[k]["rating"] for k in keys if k in arena_by_key]
        a_lo, a_hi = minmax(pool) if pool else (0.0, 1.0)
    else:
        a_lo, a_hi = 0.0, 1.0

    models, scores, providers, history = [], [], {}, []
    aliases: dict[str, list[str]] = {}
    arena_name_by_model: dict[str, str] = {}

    for key in keys:
        meta = registry[key]
        org = meta["organization"]
        model_id = slugify(org, key)
        providers.setdefault(org, {
            "id": re.sub(r"[^a-z0-9]+", "-", org.lower()).strip("-"),
            "display_name": org,
            "country": meta["country"],
        })

        access = meta["accessibility"].lower()
        is_open = "open weights" in access

        rows_for_model: list[dict] = []
        rows_for_model += epoch_scores.get(key, [])
        rows_for_model += livebench_scores.get(key, [])

        seen_alias = {key}
        by_category: dict[str, list[float]] = defaultdict(list)
        for entry in rows_for_model:
            by_category[entry["category"]].append(entry["value"])
            scores.append({
                "model_id": model_id,
                "benchmark_id": entry["benchmark_id"],
                "value": entry["value"],
                "unit": "percent",
                "source_type": entry["source_type"],
                "source_url": entry["source_url"],
                "measured_at": entry["measured_at"],
                "contamination_flag": False,
                "notes": None,
            })

        if key in arena_by_key:
            row = arena_by_key[key]
            seen_alias.add(row["model_name"])
            arena_name_by_model[model_id] = row["model_name"]
            normalized = (row["rating"] - a_lo) / (a_hi - a_lo) * 100.0
            by_category["human_preference"].append(round(normalized, 2))
            scores.append({
                "model_id": model_id,
                "benchmark_id": "lmarena_text_overall",
                "value": round(row["rating"], 1),
                "unit": "bradley_terry_rating",
                "source_type": "human_eval",
                "source_url": "https://arena.ai/leaderboard",
                "measured_at": arena_snapshot,
                "contamination_flag": False,
                "notes": f"{int(row['vote_count'])} votes; rank {int(row['rank'])}",
            })

        category_scores = {c: round(sum(v) / len(v), 2) for c, v in by_category.items()}
        available = {c: w for c, w in WEIGHTS.items() if c in category_scores}
        if not available:
            continue
        total_weight = sum(available.values())
        composite = sum(category_scores[c] * w for c, w in available.items()) / total_weight

        vision = None
        if key in vision_by_key:
            vision = {
                "rating": round(vision_by_key[key]["rating"], 1),
                "rank": int(vision_by_key[key]["rank"]),
                "measured_at": vision_snapshot,
                "source_url": "https://arena.ai/leaderboard",
            }

        models.append({
            "id": model_id,
            "display_name": meta["display_name"],
            "provider_id": providers[org]["id"],
            "is_open_weights": is_open,
            "license": meta["accessibility"] or None,
            "api_only": not is_open,
            "release_date": meta["release_date"],
            "country": meta["country"],
            "context_window": None,
            "modalities": ["text"] + (["vision"] if vision else []),
            "pricing": None,
            "acquisition": {"hf_repo": None, "provider_page": None,
                            "api_docs": None, "ollama_tag": None},
            "status": "verified",
            "category_scores": category_scores,
            "composite": round(composite, 2),
            "coverage": {
                "covered": len(available),
                "total": len(WEIGHTS),
                "missing": sorted(set(WEIGHTS) - set(available)),
            },
            "provisional": len(available) < MIN_COVERAGE_FOR_RANKING,
            "awaiting_human_votes": "human_preference" not in available,
            "vision": vision,
        })
        aliases[model_id] = sorted(seen_alias)

    # Ranked and provisional are sorted independently; only the ranked set gets numbers,
    # so a thin model can never occupy a top-N slot.
    models.sort(key=lambda m: m["composite"], reverse=True)
    rank = 0
    for m in models:
        if m["provisional"]:
            m["rank"] = None
        else:
            rank += 1
            m["rank"] = rank
    models.sort(key=lambda m: (m["provisional"], -m["composite"]))
    provisional_count = sum(1 for m in models if m["provisional"])

    # Real history from the Arena full split, for the sparklines.
    # One query per Arena model name: an IN (...) list of this size is rejected with a 422.
    for model in models:
        name = arena_name_by_model.get(model["id"])
        if not name:
            continue
        escaped = name.replace("'", "''")
        where = (f"\"category\"='overall' AND \"model_name\"='{escaped}' AND "
                 f"\"leaderboard_publish_date\">='{HISTORY_FROM}'")
        try:
            for row in arena_all("text", where, cap=200):
                history.append({
                    "model_id": model["id"],
                    "benchmark_id": "lmarena_text_overall",
                    "value": round(row["rating"], 1),
                    "date": row["leaderboard_publish_date"],
                    "source_type": "human_eval",
                })
        except Exception as exc:  # noqa: BLE001 - one bad model must not kill the run
            print(f"  ! history fetch failed for {name}: {exc}")
    history.sort(key=lambda h: (h["model_id"], h["date"]))
    # Drop the duplicated-snapshot dates from history too.
    counts = defaultdict(lambda: defaultdict(int))
    for h in history:
        counts[h["date"]][h["model_id"]] += 1
    bad_dates = {d for d, per in counts.items()
                 if sum(per.values()) / max(len(per), 1) > ARENA_DUPLICATE_RATIO_LIMIT}
    if bad_dates:
        print(f"  ! dropping {len(bad_dates)} duplicated history snapshot(s): "
              f"{sorted(bad_dates)}")
        history = [h for h in history if h["date"] not in bad_dates]

    benchmarks = [
        {"id": "gpqa_diamond", "name": "GPQA Diamond", "category": "reasoning",
         "source": "Epoch AI", "source_type": "third_party_benchmark",
         "url": "https://epoch.ai/benchmarks"},
        {"id": "simpleqa_verified", "name": "SimpleQA Verified", "category": "reasoning",
         "source": "Epoch AI", "source_type": "third_party_benchmark",
         "url": "https://epoch.ai/benchmarks"},
        {"id": "math_level_5", "name": "MATH Level 5", "category": "math",
         "source": "Epoch AI", "source_type": "third_party_benchmark",
         "url": "https://epoch.ai/benchmarks"},
        {"id": "frontiermath", "name": "FrontierMath", "category": "math",
         "source": "Epoch AI", "source_type": "third_party_benchmark",
         "url": "https://epoch.ai/benchmarks"},
        {"id": "swe_bench_verified", "name": "SWE-bench Verified", "category": "coding",
         "source": "Epoch AI", "source_type": "third_party_benchmark",
         "url": "https://epoch.ai/benchmarks",
         "notes": "Epoch's own run. swebench.com's leaderboard is CC-BY-NC and is not ingested."},
        {"id": "livebench_reasoning", "name": "LiveBench Reasoning", "category": "reasoning",
         "source": "LiveBench", "source_type": "third_party_benchmark",
         "url": "https://livebench.ai/"},
        {"id": "livebench_coding", "name": "LiveBench Coding", "category": "coding",
         "source": "LiveBench", "source_type": "third_party_benchmark",
         "url": "https://livebench.ai/"},
        {"id": "livebench_math", "name": "LiveBench Mathematics", "category": "math",
         "source": "LiveBench", "source_type": "third_party_benchmark",
         "url": "https://livebench.ai/"},
        {"id": "livebench_instruction_following", "name": "LiveBench IF",
         "category": "instruction_following", "source": "LiveBench",
         "source_type": "third_party_benchmark", "url": "https://livebench.ai/"},
        {"id": "lmarena_text_overall", "name": "LMArena (text, overall)",
         "category": "human_preference", "source": "LMArena", "source_type": "human_eval",
         "url": "https://arena.ai/leaderboard"},
    ]

    meta = {
        "generated_at": date.today().isoformat(),
        "model_count": len(models),
        "ranked_count": len(models) - provisional_count,
        "provisional_count": provisional_count,
        "min_coverage_for_ranking": MIN_COVERAGE_FOR_RANKING,
        "snapshots": {
            "epoch": date.today().isoformat(),
            "livebench": lb_snapshot,
            "lmarena_text": arena_snapshot,
            "lmarena_vision": vision_snapshot,
        },
        "arena_normalization": {"method": "min-max across the cohort in this build",
                                "min": round(a_lo, 2), "max": round(a_hi, 2)},
    }

    def dump(name: str, payload: object) -> None:
        (DATA / name).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    dump("models.json", {"meta": meta, "models": models})
    dump("scores.json", {"meta": meta, "scores": scores})
    dump("benchmarks.json", {"benchmarks": benchmarks})
    dump("providers.json", {"providers": sorted(providers.values(),
                                                key=lambda p: p["display_name"])})
    dump("aliases.json", aliases)
    (DATA / "history.jsonl").write_text(
        "".join(json.dumps(h, ensure_ascii=False) + "\n" for h in history), encoding="utf-8")

    (CONFIG / "weights.json").write_text(json.dumps({
        "schema_version": 1,
        "decided_at": "2026-07-27",
        "note": ("Multimodal is deliberately excluded from the composite and shown as a "
                 "separate vision score, so that text-only models are never ranked against "
                 "a category they do not compete in."),
        "weights": WEIGHTS,
        "min_coverage_for_ranking": MIN_COVERAGE_FOR_RANKING,
        "min_coverage_rationale": (
            "Renormalising over available weight lets a thinly measured model rank high on "
            "what it is missing rather than on being better. Models below the bar are shown "
            "in a provisional section instead of competing for a top-N slot. The bar is 4 of "
            "5 so that a new model with all four benchmarks but no Arena votes yet still "
            "ranks, flagged as awaiting human votes."
        ),
        "normalization": {
            "percent_benchmarks": "used as-is on a 0-100 scale",
            "lmarena": "min-max normalized across the cohort present in each build",
        },
        "rules": [
            "Only human_eval and third_party_benchmark feed the composite.",
            "vendor_claim values are stored and displayed, never scored.",
            "Models missing a category are scored on available weight and marked partial.",
            "Models below min_coverage_for_ranking are provisional, never ranked.",
            "SWE-bench scaffold results never count as a bare-model score.",
        ],
    }, indent=2) + "\n", encoding="utf-8")

    print(f"\nWrote {len(models)} models "
          f"({len(models) - provisional_count} ranked, {provisional_count} provisional), "
          f"{len(scores)} scores, {len(history)} history points.")
    ranked = [m for m in models if not m["provisional"]]
    print("Top 5: " + ", ".join(f"{m['display_name']} ({m['composite']})"
                                for m in ranked[:5]))
    if provisional_count:
        print("Provisional: " + ", ".join(
            f"{m['display_name']} ({m['coverage']['covered']}/5)"
            for m in models if m["provisional"]))


if __name__ == "__main__":
    main()
