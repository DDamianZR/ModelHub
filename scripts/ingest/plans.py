"""Subscription plans that include a model: human-curated, sourced, never scored.

There is no machine-readable source for which consumer plan carries which model, so this
file is maintained by pull request in config/plans.json. The price of using a model through
the API comes from the router catalogue; a plan is a different product (a flat monthly
fee for a chat app) and is never converted into, or compared with, a per-token price.

Every entry has to carry its own evidence: a URL on the vendor's or the plan's own page and
the date someone last read it. An entry that does not is withheld, not shown with a caveat.
The validator is the single standard: the ingest calls it, and CI runs it over the
committed file, so a rule cannot exist on one side only.

A fee is recorded as it is charged: the amount, the currency it is billed in and the
country it was read from. The same plan costs different amounts in different countries, so
a figure without its country is not a price, and converting a peso fee to dollars at the
day's rate would publish a number nobody is charged.

Evidence goes stale. A plan page read four months ago says nothing reliable about today's
price, and this file is kept by hand, so it will be neglected at some point. An entry
whose `verified_at` is older than `max_age_days` is therefore set aside on its own, with
no one having to notice: it leaves the published list and is named as expired, with the
date it was last read. Neglect makes the table shorter. It never leaves an old price
standing as a current one.

Rules are written for every provider. Nothing here reads a model's provider, name or
country, and an empty file is valid: absence means "nobody has recorded one", which the
page words that way and never as "this model has no plan".
"""
from __future__ import annotations

import json
from datetime import date
from typing import NamedTuple
from urllib.parse import urlparse

from .common import CONFIG

CONFIG_PATH = CONFIG / "plans.json"

# Three months: long enough to be kept up by one person once a quarter, short enough that a
# price change is not shown as current for long. Overridden by `max_age_days` in the file.
DEFAULT_MAX_AGE_DAYS = 90

# The currencies the site can print (lib/currency.ts). A fee in any other would be shown
# with a sign the page does not have.
CURRENCIES = ("MXN", "USD")


class Checked(NamedTuple):
    """Entries fit to publish, entries set aside for age, and what is wrong with the rest."""

    valid: list[dict]
    expired: list[dict]
    problems: list[str]


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


def max_age_days(document: dict) -> int:
    """The file's own limit when it states a usable one, the default otherwise."""
    value = document.get("max_age_days")
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return DEFAULT_MAX_AGE_DAYS
    return value


def validate(document: dict, model_ids: set[str], today: date | None = None) -> Checked:
    """Sort the entries into publishable, expired and faulty.

    `today` is a parameter so the rule can be tested on a fixed day, and so CI can check
    the committed output against the day it was generated rather than the day CI runs.
    """
    today = today or date.today()
    limit = max_age_days(document)
    plans = document.get("plans")
    if not isinstance(plans, list):
        return Checked([], [], ["plans must be a list"])
    valid: list[dict] = []
    expired: list[dict] = []
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
        fee = plan.get("price_per_month")
        if fee is not None and (isinstance(fee, bool) or not isinstance(fee, (int, float))
                                or fee < 0):
            issues.append("price_per_month must be a non-negative number or null")
        currency = plan.get("currency")
        if fee is not None and currency not in CURRENCIES:
            issues.append(f"currency must be one of {list(CURRENCIES)} when a fee is given")
        if fee is None and currency is not None:
            issues.append("currency given without a fee")
        region = plan.get("region")
        if not isinstance(region, str) or len(region) != 2 or not region.isalpha() \
                or region != region.upper():
            issues.append("region must be a two-letter country code in capitals")
        url = plan.get("source_url")
        if not isinstance(url, str) or urlparse(url).scheme != "https" \
                or not urlparse(url).netloc:
            issues.append("source_url must be an https URL")
        verified = plan.get("verified_at")
        if not _is_date(verified):
            issues.append("verified_at must be an ISO date")
        elif date.fromisoformat(verified) > today:
            # A date typed a year ahead would otherwise never expire.
            issues.append("verified_at is in the future")
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
        if (today - date.fromisoformat(verified)).days > limit:
            # Named, never priced: the stale figure is exactly what must not be repeated.
            expired.append({
                "id": plan_id,
                "name": plan["name"].strip(),
                "region": region,
                "source_url": url,
                "verified_at": verified,
            })
            continue
        valid.append({
            "id": plan_id,
            "name": plan["name"].strip(),
            "price_per_month": fee,
            "currency": currency,
            "region": region,
            "model_ids": list(ids),
            "source_url": url,
            "verified_at": verified,
        })
    return Checked(valid, expired, problems)


def document(checked: Checked, generated_at: str, limit: int = DEFAULT_MAX_AGE_DAYS) -> dict:
    return {
        "meta": {"generated_at": generated_at, "in_composite": False,
                 "source": "config/plans.json", "max_age_days": limit},
        "plans": checked.valid,
        "expired": checked.expired,
    }
