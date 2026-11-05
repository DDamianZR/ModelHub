"""OpenRouter public model catalogue: metadata only, never a score.

https://openrouter.ai/api/v1/models answers without a key, which is what R1 requires.
It supplies price, context window, modalities and a Hugging Face repo id per model. It
supplies no measurement of quality, so nothing read here can reach the composite: models
with no benchmarks stay unranked and are published in a separate catalogue.

"Open weights" is derived mechanically from the presence of a Hugging Face repo id. That
is a proxy, not a licence statement, and it is stored beside the catalogue entry instead
of overwriting the accessibility Epoch reports.
"""
from __future__ import annotations

import re

from ..common import SourceError, fetch_json, norm

URL = "https://openrouter.ai/api/v1/models"
ATTRIBUTION = "https://openrouter.ai/models"

PER_MILLION = 1_000_000


def _price_per_million(raw) -> float | None:
    """USD per million tokens from OpenRouter's USD-per-token string.

    Negative values mean "variable price" on the router, and a missing or malformed one
    means unknown. Both come back as None rather than 0, so unknown never reads as free.
    """
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    return round(value * PER_MILLION, 4)


def catalogue_key(slug: str) -> str:
    """Comparable key for a router slug: the part after the namespace, normalised.

    Pattern rules only. The namespace before the slash is never read, so no provider is
    singled out; a decimal point is treated like a hyphen because the router writes
    "x-5.1" where other registries write "x-5-1".
    """
    name = slug.split("/", 1)[-1]
    name = name.split(":", 1)[0]
    name = re.sub(r"(?<=\d)\.(?=\d)", "-", name)
    return norm(name)


def _entry(item: dict) -> dict | None:
    slug = item.get("id")
    if not isinstance(slug, str) or "/" not in slug:
        return None
    architecture = item.get("architecture") or {}
    pricing = item.get("pricing") or {}
    return {
        "slug": slug,
        "name": item.get("name") or slug,
        "key": catalogue_key(slug),
        "context_length": item.get("context_length") or None,
        "input_modalities": sorted(architecture.get("input_modalities") or []),
        "output_modalities": sorted(architecture.get("output_modalities") or []),
        "price_input_usd_per_m": _price_per_million(pricing.get("prompt")),
        "price_output_usd_per_m": _price_per_million(pricing.get("completion")),
        "hugging_face_id": item.get("hugging_face_id") or None,
        "open_weights": bool(item.get("hugging_face_id")),
        "free_tier": slug.endswith(":free"),
        "created": item.get("created"),
    }


def parse(payload: dict) -> dict[str, dict]:
    """Catalogue keyed by slug. The paid listing wins over its ':free' twin for pricing."""
    entries: dict[str, dict] = {}
    for item in payload.get("data") or []:
        entry = _entry(item) if isinstance(item, dict) else None
        if entry:
            entries[entry["slug"]] = entry
    return entries


def collect() -> dict:
    payload = fetch_json(URL, timeout=60)
    if not isinstance(payload, dict) or not payload.get("data"):
        raise SourceError("openrouter: catalogue came back empty")
    return {"catalogue": parse(payload)}
