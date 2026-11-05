"""Metrics derived from the published composite and the router price. No source, no LLM.

Everything here is a pure function of numbers already in the models list, so it can be
recomputed from data/ alone and checked by hand. The rules that pick a "best by" live in
config/weights.json under `boards`; this module only executes them. A rule names a metric
and a filter, never a model or a provider.

None of this feeds back into the composite. A model's price cannot move its score, its
rank or whether it clears the coverage gate.
"""
from __future__ import annotations

import json
from typing import Callable

from .common import CONFIG

DEFAULT_BLEND = {"input": 3.0, "output": 1.0}


def load_boards_config() -> dict:
    payload = json.loads((CONFIG / "weights.json").read_text(encoding="utf-8"))
    return payload.get("boards") or {}


def blended_price(pricing: dict | None, blend: dict | None = None) -> float | None:
    """USD per million tokens at a fixed input:output ratio, or None when unpriced."""
    if not pricing:
        return None
    price_in = pricing.get("input_usd_per_m")
    price_out = pricing.get("output_usd_per_m")
    if price_in is None or price_out is None:
        return None
    blend = blend or DEFAULT_BLEND
    total = blend["input"] + blend["output"]
    return (blend["input"] * price_in + blend["output"] * price_out) / total


def _eligible(model: dict, ranked_only: bool) -> bool:
    if ranked_only and model.get("provisional"):
        return False
    return model.get("composite") is not None


def pareto_frontier(points: dict[str, tuple[float, float]]) -> set[str]:
    """ids not dominated on (price, composite): lower price is better, higher composite too.

    B dominates A when B is no more expensive and no lower, and strictly better on at
    least one. Two models with identical price and composite dominate neither.
    """
    frontier = set()
    for mid, (price, score) in points.items():
        dominated = any(
            other_price <= price and other_score >= score
            and (other_price < price or other_score > score)
            for oid, (other_price, other_score) in points.items() if oid != mid
        )
        if not dominated:
            frontier.add(mid)
    return frontier


def annotate(models: list[dict], config: dict | None = None) -> None:
    """Set blended price, price per composite point and the Pareto flag, in place.

    Provisional models and unpriced ones get None rather than False: "not evaluated" is
    different from "evaluated and dominated". A model priced at zero has a ratio of zero,
    which is accurate and not comparable to a paid one on that column alone.
    """
    config = config if config is not None else load_boards_config()
    blend = config.get("price_blend") or DEFAULT_BLEND
    ranked_only = config.get("ranked_only", True)
    points: dict[str, tuple[float, float]] = {}
    for model in models:
        price = blended_price(model.get("pricing"), blend)
        model["blended_price_usd_per_m"] = round(price, 4) if price is not None else None
        model["price_per_composite_point"] = None
        model["pareto_frontier"] = None
        if price is None or not _eligible(model, ranked_only) or not model["composite"]:
            continue
        model["price_per_composite_point"] = round(price / model["composite"], 5)
        points[model["id"]] = (price, model["composite"])
    frontier = pareto_frontier(points)
    for model in models:
        if model["id"] in points:
            model["pareto_frontier"] = model["id"] in frontier


def _metric(spec: str) -> tuple[Callable[[dict], float | None],
                                Callable[[dict], float], str]:
    """(value, error, order) for a metric spec: composite, category:<name> or price."""
    if spec == "composite":
        return (lambda m: m.get("composite"),
                lambda m: m.get("composite_error") or 0.0, "max")
    if spec == "price":
        return lambda m: m.get("blended_price_usd_per_m"), lambda m: 0.0, "min"
    if spec.startswith("category:"):
        name = spec.split(":", 1)[1]
        return (lambda m: (m.get("category_scores") or {}).get(name),
                lambda m: (m.get("category_errors") or {}).get(name) or 0.0, "max")
    raise ValueError(f"unknown board metric {spec!r}")


def _passes(model: dict, filt: dict) -> bool:
    if "is_open_weights" in filt and bool(model.get("is_open_weights")) != filt["is_open_weights"]:
        return False
    if "max_blended_price" in filt:
        price = model.get("blended_price_usd_per_m")
        if price is None or price > filt["max_blended_price"]:
            return False
    if "min_coverage" in filt:
        if (model.get("coverage") or {}).get("covered", 0) < filt["min_coverage"]:
            return False
    return True


def build_boards(models: list[dict], config: dict | None = None) -> list[dict]:
    """One entry per rule: the models nobody in the subset is measurably ahead of.

    "Measurably ahead" is the same test the ranking uses: B is ahead of A when B's value
    minus its error exceeds A's value plus its error. Models the measurement cannot
    separate are all reported, never one picked arbitrarily. A metric with no error
    (price) separates only on exact equality.
    """
    config = config if config is not None else load_boards_config()
    ranked_only = config.get("ranked_only", True)
    out = []
    for rule in config.get("rules") or []:
        value, error, order = _metric(rule["metric"])
        filt = rule.get("filter") or {}
        pool = [
            m for m in models
            if _eligible(m, ranked_only) and value(m) is not None and _passes(m, filt)
        ]
        entry = {
            "id": rule["id"], "metric": rule["metric"], "order": order,
            "filter": filt, "candidates": len(pool),
            "value": None, "winners": [], "indistinguishable": False,
        }
        if pool:
            sign = 1 if order == "max" else -1

            def behind(a: dict, b: dict) -> bool:
                """b measurably ahead of a."""
                return sign * (value(b) - value(a)) > error(a) + error(b)

            top = [a for a in pool if not any(behind(a, b) for b in pool if b is not a)]
            top.sort(key=lambda m: (-sign * value(m), m["id"]))
            best = top[0]
            entry["value"] = round(value(best), 4)
            entry["winners"] = [m["id"] for m in top]
            entry["indistinguishable"] = len(top) > 1
        out.append(entry)
    return out
