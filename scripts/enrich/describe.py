"""Editorial ES/EN descriptions, written by the local model.

The model receives only facts already present in /data and is asked for prose. Every
publishing rule lives in checks.py, which is also what the audit runs, so the generator
and the audit cannot drift apart.
"""
from __future__ import annotations

from .checks import (
    MIN_COVERAGE_FOR_COMPARISON,
    category_labels,
    problems,
    profile,
)
from .ollama import generate_json

SCHEMA = {
    "type": "object",
    "properties": {"es": {"type": "string"}, "en": {"type": "string"}},
    "required": ["es", "en"],
}

_HEAD = """You are writing a catalogue entry for an independent scoreboard of frontier \
language models, read by computer science students. Write like a reference work: dense, \
specific, no filler.

FACTS (the only ones you may use):
- Model: {display_name}
- Developer: {provider}
- Country of origin: {country}
- Released: {release_date}
- Availability, write it in Spanish as: {availability_es}
- Availability, write it in English as: {availability_en}
{coverage_facts}
Write the SAME content twice, once in Spanish and once in English, 40-70 words each:
1. One sentence: what it is, who built it, when. Name the real category - a language
   model, a reasoning model - never the empty phrase "an artificial intelligence model".
   The reader is already on a page about models. Do NOT mention availability here;
   sentence 2 covers it and repeating it wastes half the description.
2. One sentence: how it is obtained. Use the availability wording given above for that
   language, verbatim or very close to it. The Spanish description must contain no
   English, and the English description no Spanish.
{third_point}
HARD RULES:
- ONE IDEA PER SENTENCE. No sentence may exceed 20 words. If a sentence runs longer,
  split it. Do not chain clauses with "lo que permite", "debido a", "which allows".
- Use the category names given above EXACTLY as written. Do not translate or reword them.
- Name any category at most ONCE in each description.
- "Open weights" means the weights are published. It does NOT mean open source, which is a
  claim about a software licence we are not making. In Spanish write "open-weights" or
  "de pesos abiertos". Never "de código abierto", never "open source".
- Never state a benchmark score, percentage, rank or any other performance number. The
  numbers sit in a table beside your text.
- Never use marketing language. Banned: revolutionary, state-of-the-art, cutting-edge,
  groundbreaking, game-changing, powerful, amazing, best-in-class, unparalleled, leading,
  next-generation, and any Spanish equivalent.
- Never speculate about training data, architecture, parameter count or future releases.
- ONLY assert what is in the facts above. Use cases are deliberately absent from them, so
  never state what the model is "used for". A shorter description beats an invented one.
- The Spanish must read as natural Spanish, not as a word-for-word translation.

LENGTH CHECK BEFORE YOU ANSWER: each description needs THREE OR FOUR complete sentences
covering all the points above, and 40 to 70 words in total. One sentence is not an answer.

Reply with a JSON object with exactly two keys, "es" and "en". No markdown, no preamble.
"""

# Enough measurements to say where a model is relatively stronger and weaker.
_RANKED_THIRD = """3. One or two sentences: which of its own measured categories it does relatively
   better and worse in, naming any category that was not measured.
   The strong/weak comparison is RELATIVE to this model's own other categories. It is not
   a verdict on quality. Write "relatively lower in X" / "algo por debajo en X", never
   judgements like "deja mucho que desear", "flojea", "disappointing" or "poor".
   For categories with no measurement, use "sin datos en X" and "no data for X". Do not
   write "no se midió X" or "X was not measured": several category names are plural
   ("Instrucciones", "Matemáticas") and those constructions then disagree in number.
"""

# Too few measurements for that comparison to mean anything.
_PROVISIONAL_THIRD = """3. One sentence: state plainly WHICH categories have been measured, and that the
   others have not. Example shape: "Medido en Código y Preferencia humana; sin datos en
   Matemáticas, Razonamiento ni Instrucciones."
   ABSOLUTELY NO COMPARISON between its categories. Do not say it is better, stronger,
   weaker or worse at any of them, and do not say it stands out anywhere. With this few
   measurements such a ranking would be noise, and asserting it would overstate what is
   known. State coverage, pass no judgement.
"""


def _coverage_facts(model: dict) -> str:
    labels_es, labels_en = category_labels("es"), category_labels("en")
    missing = model.get("coverage", {}).get("missing") or []
    ranked = int(model.get("coverage", {}).get("covered", 0)) >= MIN_COVERAGE_FOR_COMPARISON

    s_es, w_es, m_es = profile(model, "es")
    s_en, w_en, m_en = profile(model, "en")

    lines = [
        f"- Categories measured, Spanish names: {m_es}",
        f"- Categories measured, English names: {m_en}",
        f"- Categories NOT measured, Spanish names: "
        f"{', '.join(labels_es.get(k, k) for k in missing) or 'none'}",
        f"- Categories NOT measured, English names: "
        f"{', '.join(labels_en.get(k, k) for k in missing) or 'none'}",
    ]
    if ranked:
        lines += [
            f"- Relatively stronger, Spanish names: {s_es}",
            f"- Relatively weaker, Spanish names: {w_es}",
            f"- Relatively stronger, English names: {s_en}",
            f"- Relatively weaker, English names: {w_en}",
        ]
    else:
        lines.append(
            "- This model is measured in too few categories for a strong/weak comparison. "
            "Do not rank its categories against each other."
        )
    return "\n".join(lines) + "\n"


def build_prompt(model: dict) -> str:
    if model.get("is_open_weights"):
        availability_es = "Es de pesos abiertos: se descarga y corre localmente, sin API."
        availability_en = "It is open-weights: downloadable and runnable locally."
    else:
        availability_es = "Solo por API: sus pesos no se publican, no se ejecuta localmente."
        availability_en = (
            "API-only: its weights are not published, so it cannot be run locally."
        )

    ranked = int(model.get("coverage", {}).get("covered", 0)) >= MIN_COVERAGE_FOR_COMPARISON

    return _HEAD.format(
        display_name=model["display_name"],
        provider=model.get("provider_name") or model.get("provider_id") or "unknown",
        country=model.get("country") or "unstated",
        release_date=model.get("release_date") or "unstated",
        availability_es=availability_es,
        availability_en=availability_en,
        coverage_facts=_coverage_facts(model),
        third_point=_RANKED_THIRD if ranked else _PROVISIONAL_THIRD,
    )


def describe(model: dict, ollama_model: str) -> tuple[dict, float]:
    """Generate and validate one model's descriptions. Raises ValueError if unusable."""
    prompt = build_prompt(model)

    # One regeneration on a validation failure, mirroring the retry on a parse failure.
    # A rejection is usually terseness or a slipped register, not a systematic refusal.
    total = 0.0
    last: list[str] = []
    for attempt in (1, 2):
        parsed, elapsed = generate_json(ollama_model, prompt, SCHEMA)
        total += elapsed

        es = (parsed.get("es") or "").strip()
        en = (parsed.get("en") or "").strip()

        found = problems(es, en, model)
        if not found:
            return {"es": es, "en": en}, total

        last = found
        if attempt == 1:
            print(f"    retrying: {found[0]}")

    raise ValueError("; ".join(last[:3]))
