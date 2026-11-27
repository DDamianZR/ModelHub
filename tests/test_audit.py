"""audit.py --baseline: which failing entries block a change and which are inherited.

The rule is "no worse than the base": an entry whose text is unchanged since the baseline
is reported, never fatal; anything added or rewritten is held to the full standard.
"""
import unittest

from scripts.enrich.audit import load_baseline, unchanged_since

_ENTRY = {"es": "Texto en español.", "en": "English text.", "generated_at": "2026-10-01"}


class UnchangedSinceTests(unittest.TestCase):
    def test_same_text_is_inherited_even_if_metadata_moved(self):
        baseline = {"m": {**_ENTRY, "generated_at": "2026-09-01"}}
        self.assertTrue(unchanged_since(_ENTRY, baseline, "m"))

    def test_rewritten_spanish_is_held_to_the_standard(self):
        baseline = {"m": {**_ENTRY, "es": "Otro texto."}}
        self.assertFalse(unchanged_since(_ENTRY, baseline, "m"))

    def test_rewritten_english_is_held_to_the_standard(self):
        baseline = {"m": {**_ENTRY, "en": "Other text."}}
        self.assertFalse(unchanged_since(_ENTRY, baseline, "m"))

    def test_new_entry_is_held_to_the_standard(self):
        self.assertFalse(unchanged_since(_ENTRY, {}, "m"))

    def test_no_baseline_means_nothing_is_inherited(self):
        self.assertFalse(unchanged_since(_ENTRY, None, "m"))


class LoadBaselineTests(unittest.TestCase):
    def test_unreadable_ref_falls_back_to_strict(self):
        """None makes main() audit without a baseline: failing on everything, not passing."""
        self.assertIsNone(load_baseline("no-such-ref-anywhere"))


if __name__ == "__main__":
    unittest.main()
