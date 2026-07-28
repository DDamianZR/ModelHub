"""Editorial ES/EN descriptions, written by the local model.

The model receives only facts already present in /data and is asked for prose. It is
explicitly barred from inventing numbers: the figures live in the table beside the text,
and a description that disagrees with them would undermine the whole point of the site.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .ollama import generate_json

# Structured output: the grammar is constrained to this shape, and the result is still
# validated afterwards, because a schema guarantees shape and not substance.
SCHEMA = {
    "type": "object",
    "properties": {
        "es": {"type": "string"},
        "en": {"type": "string"},
    },
    "required": ["es", "en"],
}

MIN_WORDS = 35
MAX_WORDS = 85

PROMPT = """You are writing a catalogue entry for an independent scoreboard of frontier \
language models, read by computer science students. Write like a reference work: dense, \
specific, no filler.

FACTS (the only ones you may use):
- Model: {display_name}
- Developer: {provider}
- Country of origin: {country}
- Released: {release_date}
- Availability, write it in Spanish as: {availability_es}
- Availability, write it in English as: {availability_en}
- Relative strengths, Spanish category names: {strengths_es}
- Relative weaknesses, Spanish category names: {weaknesses_es}
- Relative strengths, English category names: {strengths_en}
- Relative weaknesses, English category names: {weaknesses_en}

Write the SAME content twice, once in Spanish and once in English, 40-70 words each:
1. One sentence: what it is, who built it, when. Name the real category - a language
   model, a reasoning model - never the empty phrase "an artificial intelligence model".
   The reader is already on a page about models. Do NOT mention availability here;
   sentence 2 covers it and repeating it wastes half the description.
2. One sentence: how it is obtained. Use the availability wording given above for that
   language, verbatim or very close to it. The Spanish description must contain no
   English, and the English description no Spanish.
3. One or two sentences: which of its own measured categories it does relatively better
   and worse in, naming any category that was not measured.

HARD RULES:
- ONE IDEA PER SENTENCE. No sentence may exceed 20 words. If a sentence runs longer,
  split it. Do not chain clauses with "lo que permite", "debido a", "which allows".
- Use the category names given above EXACTLY as written. Do not translate or reword them.
- "Open weights" means the weights are published. It does NOT mean open source, which is a
  claim about a software licence we are not making. In Spanish write "open-weights" or
  "de pesos abiertos". Never "de código abierto", never "open source".
- Never state a benchmark score, percentage, rank or any other performance number. The
  numbers sit in a table beside your text.
- Never use marketing language. Banned: revolutionary, state-of-the-art, cutting-edge,
  groundbreaking, game-changing, powerful, amazing, best-in-class, unparalleled, leading,
  next-generation, and any Spanish equivalent.
- Never speculate about training data, architecture, parameter count or future releases.
- Do not claim the model is best at anything. Compare it only against its own categories,
  never against a named competitor.
- The strong/weak comparison is RELATIVE to this model's own other categories. It is not a
  verdict on quality. A model can rank lower in one of its categories and still be strong
  there in absolute terms. Write "relatively lower in X" / "algo por debajo en X", never
  judgements like "deja mucho que desear", "flojea", "disappointing" or "poor".
- ONLY assert what is in the facts above. Use cases are deliberately absent from them, so
  never state what the model is "used for". A shorter description beats an invented one.
- The Spanish must read as natural Spanish, not as a word-for-word translation.

LENGTH CHECK BEFORE YOU ANSWER: each description needs THREE OR FOUR complete sentences
covering all three points above, and 40 to 70 words in total. One sentence is not an
answer. Do not stop after introducing the model.

Reply with a JSON object with exactly two keys, "es" and "en". No markdown, no preamble.
"""

# If a phrase here survives, the model slipped into the register we are avoiding.
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

# The prompt asks for 20 words per sentence. The validator allows a little more before
# rejecting: Spanish runs longer than English, and burning a 57-second generation on a
# 22-word sentence would cost more than it fixes.
MAX_SENTENCE_WORDS = 26

MESSAGES = Path(__file__).resolve().parents[2] / "messages"


def _labels(locale: str) -> dict[str, str]:
    """Canonical category names, taken from the site's own i18n catalogue.

    The model is given these verbatim instead of translating category names itself.
    Left to its own devices it renders instruction_following as "instrucción" one run and
    something else the next, and the catalogue would drift model by model.
    """
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


def _profile(model: dict, locale: str) -> tuple[str, str]:
    """Which of the model's own categories are relatively strong or weak."""
    labels = _labels(locale)
    scores = {k: v for k, v in (model.get("category_scores") or {}).items() if v is not None}
    if not scores:
        return "sin mediciones suficientes", "sin mediciones suficientes"

    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)

    # Strengths and weaknesses must not overlap. With three or fewer measured categories
    # a naive top-2 / bottom-2 split returns the same category twice, and the model then
    # dutifully writes that it is both good and bad at Reasoning. Seen 24 times in one run.
    half = max(1, min(2, len(ordered) // 2))
    top = ordered[:half]
    bottom = [item for item in ordered[len(ordered) - half:] if item not in top]

    strengths = ", ".join(labels.get(k, k) for k, _ in top)
    weaknesses = (
        ", ".join(labels.get(k, k) for k, _ in reversed(bottom))
        if bottom
        else ("ninguna medida por debajo" if locale == "es" else "none measurably lower")
    )
    missing = model.get("coverage", {}).get("missing") or []
    if missing:
        joined = ", ".join(labels.get(k, k) for k in missing)
        weaknesses += (
            f"; sin medir en {joined}" if locale == "es" else f"; not measured in {joined}"
        )
    return strengths, weaknesses


def validate(text: str, language: str, display_name: str = "") -> str | None:
    """Return a rejection reason, or None when the text is usable.

    Numbers are policed narrowly: a release year or the version number inside a model's
    own name is fine, a percentage or a score is not. The table beside the text owns
    performance figures, and prose that restates them can drift out of sync with them.
    """
    if not text or not text.strip():
        return f"{language}: empty"

    words = len(text.split())
    if words < MIN_WORDS or words > MAX_WORDS:
        return f"{language}: {words} words, outside {MIN_WORDS}-{MAX_WORDS}"

    lowered = text.lower()
    for phrase in BANNED:
        if phrase in lowered:
            return f"{language}: marketing phrase {phrase!r}"

    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        length = len(sentence.split())
        if length > MAX_SENTENCE_WORDS:
            return f"{language}: {length}-word sentence, one idea per sentence"

    if "%" in text:
        return f"{language}: contains a percentage"

    residue = text
    for token in display_name.replace("(", " ").replace(")", " ").split():
        residue = residue.replace(token, " ")
    residue = re.sub(r"\b(19|20)\d{2}\b", " ", residue)      # release years
    residue = re.sub(r"\b\d{1,2}\s+de\s+\w+\b", " ", residue)  # Spanish dates

    if re.search(r"\d+[.,]\d+", residue):
        return f"{language}: contains a decimal figure"
    leftover = re.findall(r"\d+", residue)
    if len(leftover) > 1:
        return f"{language}: contains numeric claims ({', '.join(leftover[:3])})"

    if "```" in text or text.strip().startswith("{"):
        return f"{language}: contains markup"

    return None


_OPEN_CLAIM = ("pesos abiertos", "open-weights", "open weights")
_CLOSED_CLAIM = ("solo por api", "solo api", "api-only", "api only", "no publica sus pesos")

# Phrases from the English half that showed up untranslated inside the Spanish half.
_ENGLISH_IN_SPANISH = (
    "no weights are published", "cannot be run locally", "it is downloadable",
    "performs relatively", "built by", "api-only:", "so it cannot",
)


def cross_check(es: str, en: str, is_open_weights: bool) -> str | None:
    """Catch claims that contradict /data or each other.

    Style problems make a description worse; an availability claim that contradicts the
    catalogue makes it wrong. Both halves are checked against the flag and against one
    another, because a run produced five entries whose Spanish said "open weights" while
    the English said "API-only" for the same model.
    """
    es_l, en_l = es.lower(), en.lower()

    for phrase in _ENGLISH_IN_SPANISH:
        if phrase in es_l:
            return f"es: untranslated English ({phrase!r})"

    es_open = any(p in es_l for p in _OPEN_CLAIM)
    en_open = any(p in en_l for p in _OPEN_CLAIM)
    es_closed = any(p in es_l for p in _CLOSED_CLAIM)
    en_closed = any(p in en_l for p in _CLOSED_CLAIM)

    if es_open != en_open or es_closed != en_closed:
        return "es/en disagree about availability"

    if is_open_weights and (es_closed or en_closed):
        return "claims API-only for an open-weights model"
    if not is_open_weights and (es_open or en_open):
        return "claims open weights for an API-only model"

    return None


def describe(model: dict, ollama_model: str) -> tuple[dict, float]:
    """Generate and validate one model's descriptions. Raises ValueError if unusable."""
    strengths_es, weaknesses_es = _profile(model, "es")
    strengths_en, weaknesses_en = _profile(model, "en")
    # Written by us, not composed by the model. Getting this wrong is a factual error, and
    # in one run the Spanish claimed open weights for five API-only models.
    if model.get("is_open_weights"):
        availability_es = "Es de pesos abiertos: se descarga y corre localmente, sin API."
        availability_en = "It is open-weights: downloadable and runnable locally."
    else:
        availability_es = "Solo por API: no publica sus pesos, no se ejecuta localmente."
        availability_en = "API-only: its weights are not published, so it cannot be run locally."

    prompt = PROMPT.format(
        display_name=model["display_name"],
        provider=model.get("provider_name") or model.get("provider_id") or "unknown",
        country=model.get("country") or "unstated",
        release_date=model.get("release_date") or "unstated",
        availability_es=availability_es,
        availability_en=availability_en,
        strengths_es=strengths_es,
        weaknesses_es=weaknesses_es,
        strengths_en=strengths_en,
        weaknesses_en=weaknesses_en,
    )

    # One regeneration on a validation failure, mirroring the retry on a parse failure.
    # A rejection is usually the model being terse or slipping register, not a systematic
    # refusal, and a second draft recovers most of them. Failing twice is still a skip.
    total = 0.0
    last_problem = ""
    for attempt in (1, 2):
        parsed, elapsed = generate_json(ollama_model, prompt, SCHEMA)
        total += elapsed

        es = (parsed.get("es") or "").strip()
        en = (parsed.get("en") or "").strip()

        problem = next(
            (
                p
                for p in (
                    validate(es, "es", model["display_name"]),
                    validate(en, "en", model["display_name"]),
                    cross_check(es, en, bool(model.get("is_open_weights"))),
                )
                if p
            ),
            None,
        )
        if not problem:
            return {"es": es, "en": en}, total

        last_problem = problem
        if attempt == 1:
            print(f"    retrying: {problem}")

    raise ValueError(last_problem)
