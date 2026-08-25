"""messages/*.json: the same checks.BANNED list the enrichment model is held to, pointed
at hand-written copy too - masthead.blurb once said "open source" for an open-weights
site, which the generator itself is forbidden from writing. Also: every {count}/{days}/
{points} interpolation must carry an ICU plural, and both locales must declare the same
keys.
"""
import json
import re
import unittest
from pathlib import Path

from scripts.enrich.checks import BANNED

MESSAGES = Path(__file__).resolve().parents[1] / "messages"
_BARE_COUNT = re.compile(r"\{(count|days|points)\}")


def _flatten(payload: dict, prefix: str = "") -> dict[str, object]:
    out: dict[str, object] = {}
    for key, value in payload.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(_flatten(value, full_key))
        else:
            out[full_key] = value
    return out


def _load(locale: str) -> dict[str, object]:
    path = MESSAGES / f"{locale}.json"
    return _flatten(json.loads(path.read_text(encoding="utf-8")))


class MessageCatalogueTests(unittest.TestCase):
    def test_es_and_en_declare_the_same_keys(self):
        es, en = _load("es"), _load("en")
        self.assertEqual(set(es), set(en))

    def test_no_banned_phrase_in_hand_written_copy(self):
        for locale in ("es", "en"):
            for key, value in _load(locale).items():
                if not isinstance(value, str):
                    continue
                lowered = value.lower()
                for phrase in BANNED:
                    with self.subTest(locale=locale, key=key, phrase=phrase):
                        self.assertNotIn(phrase, lowered)

    def test_count_days_points_interpolations_carry_an_icu_plural(self):
        """A bare interpolation produced "otros 1 modelos" on production. This checks the
        substring pattern only - it cannot tell a genuinely bare {count} from one that is
        already inside a {count, plural, ...} block elsewhere in a longer string, so a
        key that mixes both would slip through. None currently do."""
        for locale in ("es", "en"):
            for key, value in _load(locale).items():
                if not isinstance(value, str):
                    continue
                with self.subTest(locale=locale, key=key):
                    match = _BARE_COUNT.search(value)
                    self.assertIsNone(
                        match, f"{key!r} interpolates {match.group(0) if match else ''} "
                               f"without an ICU plural"
                    )


if __name__ == "__main__":
    unittest.main()
