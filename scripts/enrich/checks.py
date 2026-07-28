"""The single standard for whether a description may be published.

This module exists because there were briefly two standards. The generator ran a lenient
check and a full 53-model pass shipped 55 defects; a stricter audit written afterwards
caught every one of them. A check that only runs during the post-mortem is not a check.

Everything here runs in BOTH places:
  - scripts/enrich/describe.py, before a description is written
  - scripts/enrich/audit.py, over the committed file, in CI

Adding a rule here therefore closes it in both directions at once. Never add a check to
one and not the other.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

MESSAGES = Path(__file__).resolve().parents[2] / "messages"

MIN_WORDS = 35
MAX_WORDS = 85

# The prompt asks for 20 words per sentence. A little slack before rejecting: Spanish runs
# longer than English, and burning a generation on a 22-word sentence costs more than it fixes.
MAX_SENTENCE_WORDS = 26

# Below this many measured categories, a strong/weak comparison is noise dressed as signal.
MIN_COVERAGE_FOR_COMPARISON = 4

BANNED = (
    "revolutionary", "state-of-the-art", "cutting-edge", "groundbreaking", "game-changing",
    "best-in-class", "unparalleled", "next-generation", "world-class", "seamless",
    "revolucionario", "de última generación", "vanguardia", "puntero", "sin precedentes",
    "líder del mercado", "inigualable", "de primer nivel",
    # Contentless openers. On a page about models, "this is a model" says nothing.
    "artificial intelligence model", "an ai model", "modelo de inteligencia artificial",
    "un modelo de ia", "used for a variety", "para una variedad de",
    "diversas aplicaciones", "various applications", "wide range of tasks",
    # Open weights is not open source. Conflating them overstates the licence.
    "código abierto", "open source", "open-source",
    # Verdicts. The comparison is relative to the model's own categories, not a judgement.
    "deja mucho que desear", "flojea", "decepciona", "pobre desempeño", "mal desempeño",
    "disappointing", "poor performance", "falls short", "struggles badly",
)

_OPEN_CLAIM = ("pesos abiertos", "open-weights", "open weights")
_CLOSED_CLAIM = ("solo por api", "solo api", "api-only", "api only", "no publica sus pesos")

# Phrases from the English half that turned up untranslated inside the Spanish half.
_ENGLISH_IN_SPANISH = (
    "no weights are published", "cannot be run locally", "it is downloadable",
    "performs relatively", "built by", "api-only:", "so it cannot", "its weights are not",
    "released on", "developed by",
)

# Comparative language, which a thinly measured model must not receive.
_COMPARATIVE = (
    "destaca", "relativamente mejor", "relativamente peor", "muestra debilidad",
    "ventaja relativa", "desventaja relativa", "por debajo", "sobresale", "más fuerte",
    "más débil", "excels", "performs relatively", "relatively better", "relatively lower",
    "relatively stronger", "shows weakness", "stronger in", "weaker in", "better in",
    "worse in", "somewhat lower",
)


def category_labels(locale: str) -> dict[str, str]:
    """Canonical category names from the site's own i18n catalogue."""
    try:
        payload = json.loads((MESSAGES / f"{locale}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    table = payload.get("table", {})
    return {
        key: table[key]
        for key in (
            "reasoning", "coding", "math", "human_preference", "instruction_following"
        )
        if key in table
    }


def _one_language(text: str, locale: str, display_name: str, coverage: int) -> list[str]:
    problems: list[str] = []
    if not text or not text.strip():
        return [f"{locale}: empty"]

    words = len(text.split())
    if words < MIN_WORDS or words > MAX_WORDS:
        problems.append(f"{locale}: {words} words, outside {MIN_WORDS}-{MAX_WORDS}")

    lowered = text.lower()
    for phrase in BANNED:
        if phrase in lowered:
            problems.append(f"{locale}: banned phrase {phrase!r}")
            break

    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        length = len(sentence.split())
        if length > MAX_SENTENCE_WORDS:
            problems.append(f"{locale}: {length}-word sentence, one idea per sentence")
            break

    if "%" in text:
        problems.append(f"{locale}: contains a percentage")

    residue = text
    for token in display_name.replace("(", " ").replace(")", " ").split():
        residue = residue.replace(token, " ")
    residue = re.sub(r"\b(19|20)\d{2}\b", " ", residue)
    residue = re.sub(r"\b\d{1,2}\s+de\s+\w+\b", " ", residue)
    if re.search(r"\d+[.,]\d+", residue):
        problems.append(f"{locale}: contains a decimal figure")
    elif len(re.findall(r"\d+", residue)) > 1:
        problems.append(f"{locale}: contains numeric claims")

    if "```" in text or text.strip().startswith("{"):
        problems.append(f"{locale}: contains markup")

    # A category named twice is either a contradiction (strong and weak at once) or
    # redundancy. Both were produced by the first full pass.
    labels = category_labels(locale)
    for label in labels.values():
        if len(re.findall(re.escape(label.lower()), lowered)) > 1:
            problems.append(f"{locale}: category {label!r} named more than once")
            break

    # Thinly measured models get no ranking of their own categories. With two measured
    # categories, "better at X than Y" only says one number is larger than the other.
    if coverage < MIN_COVERAGE_FOR_COMPARISON:
        for phrase in _COMPARATIVE:
            if phrase in lowered:
                problems.append(
                    f"{locale}: comparative language ({phrase!r}) with only "
                    f"{coverage} measured categories"
                )
                break

    return problems


def problems(es: str, en: str, model: dict) -> list[str]:
    """Every reason this pair may not be published. Empty list means publishable."""
    display_name = model.get("display_name", "")
    coverage = int((model.get("coverage") or {}).get("covered", 0))

    found = _one_language(es, "es", display_name, coverage)
    found += _one_language(en, "en", display_name, coverage)

    es_l, en_l = es.lower(), en.lower()

    for phrase in _ENGLISH_IN_SPANISH:
        if phrase in es_l:
            found.append(f"es: untranslated English ({phrase!r})")
            break

    es_open = any(p in es_l for p in _OPEN_CLAIM)
    en_open = any(p in en_l for p in _OPEN_CLAIM)
    es_closed = any(p in es_l for p in _CLOSED_CLAIM)
    en_closed = any(p in en_l for p in _CLOSED_CLAIM)

    if es_open != en_open or es_closed != en_closed:
        found.append("es/en disagree about availability")

    is_open = bool(model.get("is_open_weights"))
    if is_open and (es_closed or en_closed):
        found.append("claims API-only for an open-weights model")
    if not is_open and (es_open or en_open):
        found.append("claims open weights for an API-only model")

    return found
