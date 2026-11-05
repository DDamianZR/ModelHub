"""Which strings identify which provider.

One table, shared by the static check on the scoring path and the copy-skew report, so
the two can never disagree about what counts as naming a vendor.

Tokens are matched case-insensitively and must not be glued to other letters, so "gpt"
matches "gpt-5" and "GPT-6 Sol" but not "gptq". Digits may follow ("qwen3", "glm5").
Generic words that happen to be product names ("seed", "nova", "phi", "meta") are left out
on purpose: a check that fires on every dict key called "meta" gets ignored, and an ignored
check is worse than none.
"""
from __future__ import annotations

import re

# provider_id (as data/providers.json spells it) -> identifying tokens.
VENDOR_TOKENS: dict[str, tuple[str, ...]] = {
    "anthropic": ("anthropic", "claude", "opus", "sonnet", "haiku", "fable", "mythos"),
    "openai": ("openai", "chatgpt", "gpt"),
    "google-deepmind": ("google deepmind", "google-deepmind", "deepmind", "gemini", "gemma"),
    "google": ("google",),
    "alibaba": ("alibaba", "qwen"),
    "deepseek": ("deepseek",),
    "moonshot": ("moonshot", "kimi"),
    "xai": ("xai", "grok"),
    "z-ai-zhipu-ai": ("zhipu", "z.ai", "glm"),
    "meta-ai": ("meta ai", "meta-ai", "muse spark", "muse-spark"),
    "minimax": ("minimax",),
    "thinking-machines": ("thinking machines", "thinking-machines", "inkling"),
    "mistral": ("mistral", "magistral", "codestral"),
}


# Names that are also ordinary words need a version number to count. "llama" is the
# Spanish for "calls" ("cada fuente llama distinto al mismo modelo") before it is a model.
VERSIONED_ONLY: dict[str, tuple[str, ...]] = {
    "meta-ai": ("llama",),
}

# Text that may sit between two tokens of one name: "claude-opus-5" is one mention.
_JOINER = re.compile(r"[\s\-_.]*\Z")


def _pattern(token: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![a-z]){re.escape(token)}(?![a-z])", re.IGNORECASE)


def _versioned(token: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![a-z]){re.escape(token)}[\s\-]?\d", re.IGNORECASE)


_COMPILED = {
    vendor: [_pattern(token) for token in tokens] for vendor, tokens in VENDOR_TOKENS.items()
}
for _vendor, _tokens in VERSIONED_ONLY.items():
    _COMPILED.setdefault(_vendor, []).extend(_versioned(token) for token in _tokens)


def vendors_in(text: str) -> dict[str, int]:
    """Count mentions per provider in `text`.

    "Google DeepMind" names one provider, not two: once a longer token has claimed a span,
    shorter tokens cannot count it again. And "claude-opus-5" is one mention, not two:
    adjacent tokens of the same provider joined only by separators are merged.
    """
    claimed: list[tuple[int, int, str]] = []
    ordered = sorted(
        ((vendor, pattern) for vendor, patterns in _COMPILED.items() for pattern in patterns),
        key=lambda item: -len(item[1].pattern),
    )
    for vendor, pattern in ordered:
        for match in pattern.finditer(text):
            start, end = match.span()
            if any(start < e and s < end for s, e, _ in claimed):
                continue
            claimed.append((start, end, vendor))

    counts: dict[str, int] = {}
    previous: tuple[int, int, str] | None = None
    for start, end, vendor in sorted(claimed):
        joined = (
            previous is not None
            and previous[2] == vendor
            and _JOINER.match(text[previous[1]:start]) is not None
        )
        if not joined:
            counts[vendor] = counts.get(vendor, 0) + 1
        previous = (start, end, vendor)
    return counts
