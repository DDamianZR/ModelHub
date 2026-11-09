"""Subscription plans that include a model: human-curated, sourced, never scored.

There is no machine-readable source for which consumer plan carries which model, so this
file is maintained by pull request in config/plans.json. The price of using a model through
the API comes from the router catalogue; a plan is a different product (a flat monthly
fee for a chat app) and is never converted into, or compared with, a per-token price.

Every entry has to carry its own evidence: a URL on the vendor's or the plan's own page and
the date someone last read it. An entry that does not is withheld, not shown with a caveat.
The validator is the single standard: the ingest calls it, and CI runs it over the
committed file, so a rule cannot exist on one side only.

Rules are written for every provider. Nothing here reads a model's provider, name or
country, and an empty file is valid: absence means "nobody has recorded one", which the
page words that way and never as "this model has no plan".
"""
from __future__ import annotations

import json
from datetime import date
from urllib.parse import urlparse

from .common import CONFIG

CONFIG_PATH = CONFIG / "plans.json"


def load(path=CONFIG_PATH) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"plans": []}


def _is_date(value: object) -> bool:
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def validate(document: dict, model_ids: set[str]) -> tuple[list[dict], list[str]]:
    """(valid plans, problems). A plan with any problem is left out of the first list."""
    plans = document.get("plans")
    if not isinstance(plans, list):
        return [], ["plans must be a list"]
    valid: list[dict] = []
    problems: list[str] = []
    seen: set[str] = set()
    for index, plan in enumerate(plans):
        label = f"plans[{index}]"
        if not isinstance(plan, dict):
            problems.append(f"{label}: not an object")
            continue
        plan_id = plan.get("id")
        label = f"plan {plan_id!r}" if isinstance(plan_id, str) and plan_id else label
        issues: list[str] = []
        if not isinstance(plan_id, str) or not plan_id.strip():
            issues.append("missing id")
        elif plan_id in seen:
            issues.append("duplicate id")
        if not isinstance(plan.get("name"), str) or not plan["name"].strip():
            issues.append("missing name")
        fee = plan.get("price_usd_per_month")
        if fee is not None and (isinstance(fee, bool) or not isinstance(fee, (int, float))
                                or fee < 0):
            issues.append("price_usd_per_month must be a non-negative number or null")
        url = plan.get("source_url")
        if not isinstance(url, str) or urlparse(url).scheme != "https" \
                or not urlparse(url).netloc:
            issues.append("source_url must be an https URL")
        if not _is_date(plan.get("verified_at")):
            issues.append("verified_at must be an ISO date")
        ids = plan.get("model_ids")
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
            issues.append("model_ids must be a non-empty list of ids")
        else:
            unknown = sorted(set(ids) - model_ids)
            if unknown:
                issues.append(f"unknown model ids {unknown}")
            if len(set(ids)) != len(ids):
                issues.append("repeated model id")
        if issues:
            problems.extend(f"{label}: {issue}" for issue in issues)
            continue
        seen.add(plan_id)
        valid.append({
            "id": plan_id,
            "name": plan["name"].strip(),
            "price_usd_per_month": fee,
            "model_ids": list(ids),
            "source_url": url,
            "verified_at": plan["verified_at"],
        })
    return valid, problems


def document(valid: list[dict], generated_at: str) -> dict:
    return {
        "meta": {"generated_at": generated_at, "in_composite": False,
                 "source": "config/plans.json"},
        "plans": valid,
    }
