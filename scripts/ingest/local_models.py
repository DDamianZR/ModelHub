"""Build data/local_models.json: what a person can actually run on their own card.

Answers the question no leaderboard answers - which open-weights model fits the VRAM I have,
and how far is it from the best that exists - and answers it with measured numbers rather
than the parameter-count-times-a-constant that most VRAM calculators stop at.

Two registry paths, and every row says which one it came from:

  epoch    the model is already in the main ranking and carries a real composite
  hf_api   Arena has a rating for it but Epoch has never heard of it

The second path is not a lower evidence bar for the same claim, it is a different claim, and
it exists because Epoch's registry is a FRONTIER registry. Measured over Arena's
non-proprietary rows: of the candidates that plausibly fit 8 GB, 0 of 43 have an Epoch entry;
at 12 GB, 0 of 18; at 24 GB, 4 of 29. Without a second path there is no local view below
24 GB at all. Rows from this path are labelled per row and never called a composite.

Budget policy: model metadata is immutable, so this is cache-first and spends a small fixed
budget per run on models it has never seen. A cold start fills in over several days rather
than being throttled into failure on day one.
"""
from __future__ import annotations

import json
from datetime import date

from .common import DATA, SourceError, norm, slugify
from .sources import hf

SCHEMA_VERSION = 1

# Arena licence strings that mean "you cannot download the weights". Everything else is
# treated as open enough to be worth looking up, and the real licence is then read from the
# model's own repository rather than from Arena's label.
CLOSED_LICENCES = {"proprietary", ""}

# Above this there is no consumer card to run it on, and every request spent on one is a
# request not spent on something a student could actually use.
MAX_PARAMS_HINT_B = 140.0

# Fits a 48 GB card at Q4 or better. Models at or under this are looked up first.
CONSUMER_PARAMS_HINT_B = 80.0


def candidates(arena_text: dict, limit: int) -> list[tuple[str, dict]]:
    """Arena's open-weights rows, in the order the budget should be spent on them.

    Rating order alone spends the whole budget on the top of the leaderboard, which for open
    weights means 700B-to-1.6T models: correct for a frontier ranking, useless for a page
    about what runs on a student's card. So models whose name suggests they fit a consumer
    card come first, and within each group the best-rated win.

    The size parse is a hint for choosing which repositories to spend requests on. It is
    never written to a field - config.json wins every time they disagree.
    """
    rows = []
    for key, row in arena_text.items():
        if (row.get("license") or "").strip().lower() in CLOSED_LICENCES:
            continue
        hint = hf.size_hint(key)
        if hint is not None and hint > MAX_PARAMS_HINT_B:
            continue
        plausibly_local = hint is not None and hint <= CONSUMER_PARAMS_HINT_B
        rows.append((0 if plausibly_local else 1, -row["rating"], key, row))
    rows.sort(key=lambda item: item[:2])
    return [(key, row) for _, _, key, row in rows[:limit]]


def resolve_repo(key: str, arena_row: dict) -> str | None:
    """Find the HuggingFace repository behind an Arena model name.

    The fragile step in the whole pipeline, and treated as such: the name is a search hint,
    and a candidate only counts once the Hub confirms a repository exists that actually
    carries parameter counts. Nothing about the name is trusted as data.
    """
    organization = (arena_row.get("organization") or "").strip()
    queries = [f"{organization} {key}".strip(), key]
    for query in queries:
        try:
            results = hf._get(f"{hf.API}?search={query}&limit=20&filter=text-generation")
        except SourceError:
            continue
        if not isinstance(results, list):
            continue
        for item in results:
            repo = item.get("id") or ""
            if not repo:
                continue
            # The repository name has to normalise to the same key Arena used, otherwise a
            # search for "qwen3-32b" happily returns somebody's fine-tune of it.
            _, _, name = repo.partition("/")
            if norm(name) == norm(key):
                return repo
    return None


def collect(arena_text: dict, existing: dict, budget: int) -> tuple[dict, dict]:
    """Fill in metadata for models not already cached. Returns (cache, stats)."""
    cache = dict(existing)
    stats = {"cached": 0, "fetched": 0, "failed": 0, "rate_limited": False, "skipped": 0}

    for key, row in candidates(arena_text, limit=400):
        if key in cache:
            stats["cached"] += 1
            continue
        if stats["fetched"] + stats["failed"] >= budget:
            stats["skipped"] += 1
            continue

        try:
            repo = resolve_repo(key, row)
            if not repo:
                # Recorded as a miss so the next run does not spend the budget again on a
                # model whose repository simply cannot be found by name.
                cache[key] = {"resolved": False, "reason": "no matching HF repository"}
                stats["failed"] += 1
                continue

            info = hf.model_info(repo)
            if not info.get("params_total"):
                cache[key] = {"resolved": False, "reason": "no safetensors parameter count"}
                stats["failed"] += 1
                continue

            gguf_repo = hf.find_gguf_repo(repo)
            architecture = hf.architecture(repo, mirror=gguf_repo)

            # A GGUF repository that fails the plausibility check is dropped, not the model:
            # the parameter count and architecture are still sound, so the row survives with
            # its size estimated from the calibrated table and marked as estimated.
            sizes: dict[str, int] = {}
            if gguf_repo:
                try:
                    sizes = hf.gguf_sizes(gguf_repo, info["params_total"])
                except hf.RateLimited:
                    raise
                except SourceError as exc:
                    print(f"    {key}: rejected {gguf_repo} ({exc})")
                    gguf_repo = None

            cache[key] = {
                "resolved": True,
                "hf_repo": repo,
                "params_total": info["params_total"],
                "params_source": "hf_safetensors",
                "license": info["license"],
                "license_source": "hf_api",
                "gguf_repo": gguf_repo,
                "gguf_sizes": sizes,
                "bytes_source": "hf_gguf_tree" if sizes else None,
                **architecture,
                "fetched_at": date.today().isoformat(),
            }
            stats["fetched"] += 1
            print(f"    {key} -> {repo} ({info['params_total']:,} params, "
                  f"{len(sizes)} quantisations)")
        except hf.RateLimited as exc:
            # The window is spent. Stop asking and keep what is already cached; the next run
            # picks up where this one stopped.
            print(f"    {exc}; stopping this pass")
            stats["rate_limited"] = True
            break
        except SourceError as exc:
            cache[key] = {"resolved": False, "reason": str(exc)[:200]}
            stats["failed"] += 1

    return cache, stats


def calibrate(cache: dict) -> dict:
    """Derive bytes-per-weight per quantisation from every model observed.

    Self-calibrating on purpose. A constant copied from a blog post is unauditable and ages
    silently; this table states its own n and the date it was computed, and any model
    without a measured GGUF is estimated from it and marked as estimated.
    """
    observations: dict[str, list[float]] = {}
    for entry in cache.values():
        if not entry.get("resolved") or not entry.get("params_total"):
            continue
        for quant, size in (entry.get("gguf_sizes") or {}).items():
            observations.setdefault(quant, []).append(size / entry["params_total"])

    table = {}
    for quant, values in sorted(observations.items()):
        values.sort()
        middle = len(values) // 2
        median = (
            values[middle] if len(values) % 2
            else (values[middle - 1] + values[middle]) / 2
        )
        table[quant] = {
            "bytes_per_weight": round(median, 4),
            "n": len(values),
            "observed_min": round(values[0], 4),
            "observed_max": round(values[-1], 4),
        }
    return table


def build(arena_text: dict, ranked: dict, budget: int = hf.DEFAULT_BUDGET) -> tuple[dict, dict]:
    """Return (local_models payload, stats)."""
    cache, stats = collect(arena_text, hf.load_local_cache(), budget)
    hf.save_local_cache(cache)

    models = []
    for key, entry in sorted(cache.items()):
        if not entry.get("resolved"):
            continue

        published = ranked.get(key)
        # A composite and an Arena rating are different claims and are never merged into one
        # column. Which one a row carries is stated on the row.
        if published:
            score = {
                "kind": "composite",
                "value": published["composite"],
                "coverage": f"{published['coverage']['covered']}/{published['coverage']['total']}",
                "model_id": published["id"],
                "provisional": published["provisional"],
            }
        else:
            score = {
                "kind": "arena_only",
                "value": round(arena_text[key]["rating"], 1),
                "coverage": None,
                "votes": int(arena_text[key]["vote_count"]),
            }

        # Without the attention shape there is no KV term, and without a KV term any verdict
        # about fitting would be a guess dressed as a calculation.
        complete = all(
            entry.get(field) for field in ("n_layers", "n_kv_heads", "head_dim")
        )
        models.append({
            "key": key,
            "display_name": (published or {}).get("display_name") or key,
            # Carried separately from `score` and always present, because the frontier chart
            # has to plot one scale. A composite runs 0-100 and an Arena rating runs past
            # 1400; putting both on one axis would rank a model by which score it happens to
            # have rather than by how good it is. `score` says what claim the row carries;
            # this says where it sits on the axis everything shares.
            "arena_rating": round(arena_text[key]["rating"], 1),
            "hf_repo": entry["hf_repo"],
            "registry_source": "epoch" if published else "hf_api",
            "architecture": "moe" if entry.get("n_experts") else "dense",
            "params_total": entry["params_total"],
            "params_source": entry["params_source"],
            "n_experts": entry.get("n_experts"),
            "n_experts_active": entry.get("n_experts_active"),
            "n_layers": entry.get("n_layers"),
            "n_kv_heads": entry.get("n_kv_heads"),
            "head_dim": entry.get("head_dim"),
            "max_context": entry.get("max_context"),
            "config_source": entry.get("config_source"),
            "quantizations": [
                {
                    "quant": quant,
                    "bytes_on_disk": size,
                    "bytes_source": "hf_gguf_tree",
                    "bytes_per_weight": round(size / entry["params_total"], 4),
                }
                for quant, size in sorted((entry.get("gguf_sizes") or {}).items())
            ],
            "gguf_repo": entry.get("gguf_repo"),
            "license": entry.get("license"),
            "license_source": "hf_api",
            "score": score,
            "status": "verified" if complete else "unverified",
        })

    # The ceiling line on the chart: the best Arena rating that exists at all, including
    # models nobody runs at home. On the same axis as everything else, so the distance
    # between "what you can run" and "what exists" is visible rather than implied.
    ceiling = max(
        ((row["model_name"], row["rating"]) for row in arena_text.values()),
        key=lambda item: item[1],
        default=(None, None),
    )

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": date.today().isoformat(),
        "scale": (
            "arena_rating is LMArena's Bradley-Terry rating and is the axis the frontier "
            "chart plots, because every row has one. score is the richest claim a row can "
            "make and its kind is stated per row; the two scales are never compared."
        ),
        "ceiling": {"model_name": ceiling[0], "arena_rating": round(ceiling[1], 1)}
        if ceiling[1] else None,
        "models": models,
    }, stats


def write(payload: dict, calibration: dict) -> None:
    from .common import CONFIG, write_json

    write_json(DATA / "local_models.json", payload)
    write_json(CONFIG / "vram.json", {
        "schema_version": 1,
        "computed_at": payload["generated_at"],
        "note": (
            "bytes_per_weight is the median of the measured ratio bytes_on_disk / "
            "params_total over every model with a published GGUF, not a constant copied "
            "from anywhere. Models without a measured GGUF are estimated from this table "
            "and marked estimated in the UI."
        ),
        "bytes_per_weight": calibration,
        "kv_bytes_per_element": {"fp16": 2, "q8": 1, "q4": 0.5},
        "overhead_bytes": None,
        "overhead_status": "unmeasured",
        "overhead_note": (
            "Runtime context, activations and allocator fragmentation. Measured, never "
            "guessed: run two or three models of known size, record the VRAM actually "
            "occupied, and the difference against W + KV is the overhead. Until somebody "
            "does that on declared hardware this stays null and the UI says the estimate "
            "is missing it."
        ),
    })
