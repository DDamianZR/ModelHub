"""Editorial ES/EN descriptions, written by the local model.

The model receives only facts already present in /data and is asked for prose. It is
explicitly barred from inventing numbers: the figures live in the table beside the text,
and a description that disagrees with them would undermine the whole point of the site.
"""
from __future__ import annotations

import re

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

PROMPT = """You are writing a factual catalogue entry for an independent AI model \
scoreboard read by computer science students. Write in a technical register, the way a \
reference work is written.

FACTS (the only ones you may use):
- Model: {display_name}
- Developer: {provider}
- Country of origin: {country}
- Released: {release_date}
- Availability: {availability}
- Relative strengths across measured categories: {strengths}
- Relative weaknesses: {weaknesses}

Write two descriptions of the SAME content, one in Spanish and one in English.
Each must be 40-70 words and follow this structure:
1. One sentence stating what the model is, who built it and when.
2. One sentence on how someone actually obtains and runs it, and what that availability
   means in practice: open weights can be downloaded and run locally, API-only cannot.
3. One or two sentences on which of its own measured categories it does relatively better
   and worse in, naming any category that was not measured at all.

Every sentence must rest on a fact from the list above. If you find yourself writing that
a model is "used for a variety of tasks" or anything equally unspecific, delete it: the
facts do not include use cases, and inventing them is worse than a shorter description.

HARD RULES:
- Never state a benchmark score, percentage, rank or any other number. The numbers appear
  in a table next to your text.
- Never use marketing language. Banned: revolutionary, state-of-the-art, cutting-edge,
  groundbreaking, game-changing, powerful, amazing, best-in-class, unparalleled, leading,
  next-generation, and any equivalent in Spanish.
- Never speculate about training data, architecture, parameter count or future releases.
- Do not claim the model is the best at anything. Compare it only against its own
  categories, never against named competitors.
- The Spanish must be natural Spanish, not translated word for word from the English.

Reply with a JSON object with exactly two keys, "es" and "en". No markdown, no preamble.
"""

# If a phrase here survives, the model slipped into the register we are avoiding.
BANNED = (
    "revolutionary", "state-of-the-art", "cutting-edge", "groundbreaking", "game-changing",
    "best-in-class", "unparalleled", "next-generation", "world-class", "seamless",
    "revolucionario", "de última generación", "vanguardia", "puntero", "sin precedentes",
    "líder del mercado", "inigualable", "de primer nivel",
)

CATEGORY_LABELS = {
    "reasoning": "reasoning",
    "coding": "coding",
    "math": "mathematics",
    "human_preference": "human preference voting",
    "instruction_following": "instruction following",
}


def _profile(model: dict) -> tuple[str, str]:
    """Which of the model's own categories are relatively strong or weak."""
    scores = {k: v for k, v in (model.get("category_scores") or {}).items() if v is not None}
    if not scores:
        return "not enough measurements", "not enough measurements"

    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    strengths = ", ".join(CATEGORY_LABELS.get(k, k) for k, _ in ordered[:2])
    weaknesses = ", ".join(CATEGORY_LABELS.get(k, k) for k, _ in ordered[-2:][::-1])
    missing = model.get("coverage", {}).get("missing") or []
    if missing:
        weaknesses += "; not measured in " + ", ".join(
            CATEGORY_LABELS.get(k, k) for k in missing
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


def describe(model: dict, ollama_model: str) -> tuple[dict, float]:
    """Generate and validate one model's descriptions. Raises ValueError if unusable."""
    strengths, weaknesses = _profile(model)
    availability = (
        "open weights, downloadable" if model.get("is_open_weights") else "API access only"
    )

    prompt = PROMPT.format(
        display_name=model["display_name"],
        provider=model.get("provider_name") or model.get("provider_id") or "unknown",
        country=model.get("country") or "unstated",
        release_date=model.get("release_date") or "unstated",
        availability=availability,
        strengths=strengths,
        weaknesses=weaknesses,
    )

    parsed, elapsed = generate_json(ollama_model, prompt, SCHEMA)

    es = (parsed.get("es") or "").strip()
    en = (parsed.get("en") or "").strip()
    for text, language in ((es, "es"), (en, "en")):
        problem = validate(text, language, model["display_name"])
        if problem:
            raise ValueError(problem)

    return {"es": es, "en": en}, elapsed
