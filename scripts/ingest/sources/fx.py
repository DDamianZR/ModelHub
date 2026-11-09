"""USD to MXN reference rate: display metadata only, never a score.

Frankfurter republishes the European Central Bank's euro foreign exchange reference
rates. It answers without a key, which is what R1 requires. The ECB fixes those rates once
per working day, so a rate carries its own date and is not today's by construction.

It is a reference rate, not what a bank or a card network charges a person: the site shows
converted prices as an estimate and says so. Nothing read here reaches a score, a rank or
the coverage gate. Prices stay published in USD, which is what the catalogue reports; the
rate is applied by the reader's browser, so the data files never hold a converted price.
"""
from __future__ import annotations

import math
from datetime import date

from ..common import SourceError, fetch_json

TARGET = "MXN"
URL = f"https://api.frankfurter.dev/v1/latest?base=USD&symbols={TARGET}"
ATTRIBUTION = "https://frankfurter.dev"
PUBLISHER = "European Central Bank euro foreign exchange reference rates"


def parse(payload: object) -> dict:
    """Normalised {base, date, rates} from Frankfurter's answer, or a SourceError.

    Anything that is not a finite positive rate for the expected pair is refused rather
    than coerced: a zero or a missing rate would turn every converted price into zero or
    nothing, and unknown must never read as free.
    """
    if not isinstance(payload, dict):
        raise SourceError("fx: answer was not an object")
    if payload.get("base") != "USD":
        raise SourceError(f"fx: unexpected base {payload.get('base')!r}")
    rates = payload.get("rates")
    rate = rates.get(TARGET) if isinstance(rates, dict) else None
    if isinstance(rate, bool) or not isinstance(rate, (int, float)):
        raise SourceError(f"fx: no {TARGET} rate in the answer")
    if not math.isfinite(rate) or rate <= 0:
        raise SourceError(f"fx: {TARGET} rate {rate!r} is not a positive finite number")
    published = payload.get("date")
    try:
        date.fromisoformat(str(published))
    except ValueError as exc:
        raise SourceError(f"fx: bad rate date {published!r}") from exc
    return {"base": "USD", "date": str(published), "rates": {TARGET: float(rate)}}


def collect() -> dict:
    return parse(fetch_json(URL, timeout=30))


def document(payload: dict, fetched_on: str) -> dict:
    """The file the site reads. Carries the rate, its own date and what it is."""
    return {
        "meta": {
            "generated_at": fetched_on,
            "in_composite": False,
            "source": ATTRIBUTION,
            "publisher": PUBLISHER,
            "kind": "reference rate, not a bank or card rate",
        },
        "base": payload["base"],
        "date": payload["date"],
        "rates": payload["rates"],
    }
