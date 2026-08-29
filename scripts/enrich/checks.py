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

# The floor exists to catch a truncated answer, not a concise one. It was originally 35
# words, which rejected four fully-measured models whose English said everything in 30-32.
# English is more compact than Spanish, and a floor calibrated on Spanish punishes it.
#
# Completeness is measured by sentence count instead, which is what "it stopped after
# introducing the model" actually looks like: the truncation this guards against was one
# sentence of 22 words, while a complete but terse answer is three or four sentences.
MIN_WORDS = 28
MAX_WORDS = 85
MIN_SENTENCES = 3

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
_CLOSED_CLAIM = (
    "solo por api", "solo api", "api-only", "api only", "no publica sus pesos",
    "via api", "by api", "through api", "mediante api", "por api"
)

# Phrases from the English half that turned up untranslated inside the Spanish half.
_ENGLISH_IN_SPANISH = (
    "no weights are published", "cannot be run locally", "it is downloadable",
    "performs relatively", "built by", "api-only:", "so it cannot", "its weights are not",
    "released on", "developed by",
)

# Phrasings that assert a category is absent. If any of these appears next to a category
# that IS in category_scores, the model invented a coverage gap. Verified on the 2026-08-02
# pass: Inkling had 5/5 measured and the model wrote "No data for Instructions"; four older
# entries in the committed file had the same defect. The prior audit missed all of them
# because it only checked structural rules.
#
# PRE-markers come before the category name ("no data for X"); POST-markers come after
# ("X was not measured"). Both directions occur in generated text; catch both.
_ABSENT_PRE_ES = (
    "sin datos en", "sin datos para", "sin medir en",
    "no hay datos en", "no hay datos para", "no hay datos sobre",
    "no se midió", "no se midio", "no se ha medido",
)
_ABSENT_PRE_EN = (
    "no data for", "no data in", "no data on",
    "not measured in", "not measured for",
    "no measurement for", "no measurement in",
)
_ABSENT_POST_EN = ("was not measured", "were not measured", "is not measured")
_ABSENT_POST_ES = ()  # Spanish "X no se midió" is rare; the pre-form covers it.

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


def profile(model: dict, locale: str) -> tuple[str, str, str]:
    """Return (strengths, weaknesses, measured list) using canonical category names.

    Lives here rather than in describe.py so contradicts_data() below can recompute
    today's profile with the exact function the generator was fed, instead of a second
    implementation that could quietly drift from it.
    """
    labels = category_labels(locale)
    scores = {k: v for k, v in (model.get("category_scores") or {}).items() if v is not None}
    measured = ", ".join(labels.get(k, k) for k in scores)

    if not scores:
        return "", "", measured

    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    # Strengths and weaknesses must not overlap. A naive top-2 / bottom-2 split returns the
    # same category twice when there are three or fewer, and the model then writes that it
    # is both good and bad at it. That happened 24 times in one pass.
    half = max(1, min(2, len(ordered) // 2))
    top = ordered[:half]
    bottom = [item for item in ordered[len(ordered) - half:] if item not in top]

    strengths = ", ".join(labels.get(k, k) for k, _ in top)
    weaknesses = ", ".join(labels.get(k, k) for k, _ in reversed(bottom))
    return strengths, weaknesses, measured


# Stems, not full phrases: describe.py's prompt asks for "relatively stronger in X", but
# the model doesn't always comply verbatim - "destaca relativamente en X" was observed in
# the committed corpus, which a marker ending in "en"/"in" would miss entirely because
# "relativamente" sits between the verb and the preposition. A category name found after
# one of these, before the next marker or the sentence's end, is what the text claims
# about that category. Blunt on purpose: a paraphrase using none of these slips through.
_STRONG_MARKERS = (
    "más fuerte", "destaca", "relativamente mejor", "sobresale", "ventaja relativa",
    "relatively stronger", "excels", "stronger in", "better in",
)
_WEAK_MARKERS = (
    "algo por debajo", "por debajo", "relativamente peor", "muestra debilidad",
    "más débil", "desventaja relativa",
    "relatively lower", "shows weakness", "weaker in", "worse in", "somewhat lower",
)
# The prompt explicitly asks for "sin datos en X" / "no data for X" and explicitly asks
# the model NOT to write "no se midió X" / "X was not measured" - and the model writes
# the forbidden form anyway often enough that both are covered here.
_NO_DATA_MARKERS = (
    "sin datos en", "no hay datos en", "no se midió", "no se midieron",
    "no data for", "no data on", "not measured",
)

_STRONG_WEAK_MARKERS = (
    [(m, "strong") for m in _STRONG_MARKERS] + [(m, "weak") for m in _WEAK_MARKERS]
)


def _claims(text: str, labels: dict[str, str]) -> dict[str, set[str]]:
    """Category keys the text claims as strong/weak/no_data.

    Processed one sentence at a time, so a marker's clause never bleeds into a later,
    unrelated sentence - the bug that first version of this had: "...somewhat lower in
    Math. Instructions were not measured." attributed "Instructions" to the "lower"
    marker in the PREVIOUS sentence, because nothing stopped that marker's clause at the
    period. Within one sentence, a marker's clause runs from right after it to right
    before the next marker (or the sentence's end), which is what lets one marker govern
    a conjunction like "stronger in Reasoning and Coding".

    A no-data marker claims every category named anywhere in its clause rather than just
    what follows it, since the model's own "X were not measured" phrasing puts the
    category BEFORE the marker - and a clause built entirely around one no-data marker
    doesn't also carry a strong/weak claim to disentangle it from. Split on ";" as well as
    sentence endings: the provisional-model shape is one sentence with the measured list
    and the unmeasured list on either side of a semicolon ("Medido en X, Y; sin datos en
    Z"), and without that split every category in the measured half reads as unmeasured.
    """
    claims: dict[str, set[str]] = {"strong": set(), "weak": set(), "no_data": set()}
    sentences = [s for s in re.split(r"(?<=[.!?;])\s+", text.strip()) if s.strip()]

    for sentence in sentences:
        lowered = sentence.lower()

        if any(marker in lowered for marker in _NO_DATA_MARKERS):
            for key, label in labels.items():
                if re.search(re.escape(label.lower()), lowered):
                    claims["no_data"].add(key)
            continue

        hits: list[tuple[int, int, str]] = []
        for marker, polarity in _STRONG_WEAK_MARKERS:
            start = 0
            while True:
                idx = lowered.find(marker, start)
                if idx == -1:
                    break
                hits.append((idx, idx + len(marker), polarity))
                start = idx + 1
        hits.sort()

        for i, (_, m_end, polarity) in enumerate(hits):
            segment_end = hits[i + 1][0] if i + 1 < len(hits) else len(lowered)
            segment = lowered[m_end:segment_end]
            for key, label in labels.items():
                if re.search(re.escape(label.lower()), segment):
                    claims[polarity].add(key)

    return claims


def contradicts_data(es: str, en: str, model: dict) -> list[str]:
    """Where the text asserts a strength, weakness or "not measured" that today's scores
    no longer support.

    Recomputes today's profile with profile() above - the exact function the generator
    was fed - so "today" means the same thing it meant when the text was written; only
    the scores underneath may have moved since.

    The no-data claim is checked at any coverage, since a stale "not measured" is wrong
    regardless. Strong/weak claims are only checked when the model is ranked today
    (coverage >= MIN_COVERAGE_FOR_COMPARISON): below that, checks._COMPARATIVE above
    already rejects any comparison outright, so re-checking it here would be redundant,
    not stricter.
    """
    problems: list[str] = []
    scores = {k: v for k, v in (model.get("category_scores") or {}).items() if v is not None}
    coverage = int((model.get("coverage") or {}).get("covered", 0))
    measured_keys = set(scores)

    for locale, text in (("es", es), ("en", en)):
        if not text:
            continue
        labels = category_labels(locale)
        claims = _claims(text, labels)

        for key in claims["no_data"]:
            if key in measured_keys:
                problems.append(
                    f"{locale}: claims no data for {labels.get(key, key)!r}, which is "
                    f"measured today"
                )

        if coverage < MIN_COVERAGE_FOR_COMPARISON:
            continue

        strengths, weaknesses, _ = profile(model, locale)
        strong_today = set(strengths.split(", ")) if strengths else set()
        weak_today = set(weaknesses.split(", ")) if weaknesses else set()

        for key in claims["strong"]:
            label = labels.get(key, key)
            if label not in strong_today:
                where = "a weakness" if label in weak_today else "not among its strengths"
                problems.append(f"{locale}: claims strength in {label!r}, today {where}")
        for key in claims["weak"]:
            label = labels.get(key, key)
            if label not in weak_today:
                where = "a strength" if label in strong_today else "not among its weaknesses"
                problems.append(f"{locale}: claims weakness in {label!r}, today {where}")

    return problems


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

    sentences = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]
    if len(sentences) < MIN_SENTENCES:
        problems.append(
            f"{locale}: {len(sentences)} sentence(s), needs {MIN_SENTENCES} - truncated"
        )
    for sentence in sentences:
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


def _hallucinated_gaps(text: str, locale: str, measured_labels: list[str]) -> list[str]:
    """Text claims a measured category is absent — the model invented a coverage gap."""
    lowered = text.lower()
    pre = _ABSENT_PRE_ES if locale == "es" else _ABSENT_PRE_EN
    post = _ABSENT_POST_ES if locale == "es" else _ABSENT_POST_EN
    for label in measured_labels:
        label_l = label.lower()
        for marker in pre:
            if f"{marker} {label_l}" in lowered:
                return [f"{locale}: claims {label!r} is unmeasured, but it is measured"]
        for marker in post:
            if f"{label_l} {marker}" in lowered:
                return [f"{locale}: claims {label!r} is unmeasured, but it is measured"]
    return []


def problems(es: str, en: str, model: dict) -> list[str]:
    """Every reason this pair may not be published. Empty list means publishable."""
    display_name = model.get("display_name", "")
    coverage = int((model.get("coverage") or {}).get("covered", 0))

    found = _one_language(es, "es", display_name, coverage)
    found += _one_language(en, "en", display_name, coverage)

    scores = model.get("category_scores") or {}
    measured_keys = [k for k, v in scores.items() if v is not None]
    labels_es = category_labels("es")
    labels_en = category_labels("en")
    found += _hallucinated_gaps(
        es, "es", [labels_es[k] for k in measured_keys if k in labels_es]
    )
    found += _hallucinated_gaps(
        en, "en", [labels_en[k] for k in measured_keys if k in labels_en]
    )

    es_l, en_l = es.lower(), en.lower()

    for phrase in _ENGLISH_IN_SPANISH:
        if phrase in es_l:
            found.append(f"es: untranslated English ({phrase!r})")
            break

    es_open = any(p in es_l for p in _OPEN_CLAIM)
    en_open = any(p in en_l for p in _OPEN_CLAIM)
    es_closed = any(p in es_l for p in _CLOSED_CLAIM)
    en_closed = any(p in en_l for p in _CLOSED_CLAIM)

    # A genuine contradiction is one side unambiguously claiming open and the other
    # unambiguously claiming closed - not one side simply not using a phrase from either
    # list. "Se descarga y corre localmente, sin API" reads as open (matches neither list
    # verbatim) paired with an English "open-weights" is a looser paraphrase, not a
    # disagreement; the old `es_open != en_open` treated "used no recognised phrase" the
    # same as "actively said the opposite", rejecting correct pairs. Verified against
    # moonshot-kimi-k2.5's 2026-08-29 regeneration, which failed this exact way four times.
    if (es_open and en_closed) or (es_closed and en_open):
        found.append("es/en disagree about availability")

    is_open = bool(model.get("is_open_weights"))
    if is_open and (es_closed or en_closed):
        found.append("claims API-only for an open-weights model")
    if not is_open and (es_open or en_open):
        found.append("claims open weights for an API-only model")

    found += contradicts_data(es, en, model)

    return found
