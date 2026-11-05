"""common.norm - the vendor-string-to-canonical-key collapse every source is matched
through. If two sources spell the same model differently and norm() stops treating them
as the same key, that model quietly splits into two rows.
"""
import unittest

from scripts.ingest.common import norm


class NormTests(unittest.TestCase):
    def test_effort_and_thinking_variants_collapse_to_the_same_key(self):
        variants = [
            "claude-opus-5_max",
            "claude-opus-5-max-effort",
            "claude-opus-5-thinking",
        ]
        keys = {norm(v) for v in variants}
        self.assertEqual(keys, {"claude-opus-5"})

    def test_dated_suffix_is_stripped(self):
        self.assertEqual(norm("gpt-5-2026-08-01"), norm("gpt-5"))
        self.assertEqual(norm("gemini-3-pro(20260801)"), norm("gemini-3-pro"))

    def test_underscores_and_spaces_normalise_to_hyphens(self):
        self.assertEqual(norm("Claude Opus 5_Max"), norm("claude-opus-5-max"))

    def test_distinct_models_stay_distinct(self):
        self.assertNotEqual(norm("claude-opus-5"), norm("claude-opus-4-6"))
        self.assertNotEqual(norm("gpt-5-mini"), norm("gpt-5-nano"))

    def test_digit_separators_are_equivalent(self):
        # Pattern rule, any provider: the separator between two digits is not identity.
        for stem in ("alpha", "beta-mini", "gamma"):
            self.assertEqual(norm(f"{stem}-5-1"), norm(f"{stem}-5.1"))
            self.assertEqual(norm(f"{stem}-5_1"), norm(f"{stem}-5.1"))
        self.assertEqual(norm("alpha-5-1-max-effort"), norm("alpha-5.1"))

    def test_digit_separator_does_not_join_different_versions(self):
        self.assertNotEqual(norm("x-5"), norm("x-51"))
        self.assertNotEqual(norm("x-5-1"), norm("x-51"))
        self.assertNotEqual(norm("x-5-mini"), norm("x-5-1-mini"))

    def test_published_spelling_is_available_unfolded(self):
        self.assertEqual(norm("alpha-5-1", fold_versions=False), "alpha-5-1")
        self.assertEqual(norm("alpha-5.1", fold_versions=False), "alpha-5.1")


if __name__ == "__main__":
    unittest.main()
