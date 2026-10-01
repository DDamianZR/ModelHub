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

    def test_pro_tier_is_a_different_model(self):
        """Regression: "-pro-unknown" was stripped as a qualifier, so GPT-5.5 Pro and
        GPT-5.5 shared a key and the base model's scores were published as "GPT-5.5 Pro".
        Same for GPT-5, GPT-5.4 and o3."""
        self.assertEqual(norm("gpt-5.5-pro_unknown"), "gpt-5.5-pro")
        self.assertEqual(norm("o3-pro-2025-06-10_unknown"), "o3-pro")
        self.assertNotEqual(norm("gpt-5.5-pro_unknown"), norm("gpt-5.5_xhigh"))

    def test_fused_pro_effort_token_keeps_pro_in_the_name(self):
        self.assertEqual(norm("gpt-5.6-sol_promax"), "gpt-5.6-sol-pro")
        self.assertEqual(norm("gpt-5.6-sol_prounknown"), "gpt-5.6-sol-pro")

    def test_qwen_max_is_a_product_tier_not_an_effort(self):
        self.assertEqual(norm("qwen3.8-max"), "qwen3.8-max")
        self.assertEqual(norm("qwen3.8-max_xhigh"), "qwen3.8-max")
        self.assertEqual(norm("qwen3.6-max-preview"), "qwen3.6-max")
        # Max as an effort level is still stripped everywhere else.
        self.assertEqual(norm("deepseek-v4.1-flash-max"), "deepseek-v4.1-flash")

    def test_chat_models_are_not_folded_into_the_reasoning_model(self):
        self.assertNotEqual(norm("gpt-5-chat"), norm("gpt-5-2025-08-07_high"))

    def test_minimal_and_thinking_budget_variants_collapse(self):
        self.assertEqual(norm("gemini-3.5-flash_minimal"), "gemini-3.5-flash")
        self.assertEqual(norm("claude-opus-4-1-16k"), "claude-opus-4-1")
        self.assertEqual(norm("gemma-4-26b-a4b-it_minimal"), "gemma-4-26b-a4b")

    def test_hosted_runs_merge_only_through_a_listed_alias(self):
        """moonshotai/kimi-k2 is Epoch's id for Kimi K2 Thinking served by Together; a
        generic prefix strip would have credited it to Kimi K2 Instruct."""
        self.assertEqual(norm("openai/gpt-oss-120b"), "gpt-oss-120b")
        self.assertEqual(norm("zai-org/glm-4.6"), "glm-4.6")
        self.assertNotEqual(norm("moonshotai/kimi-k2"), norm("kimi-k2"))

    def test_cross_source_spellings_meet_through_aliases(self):
        self.assertEqual(norm("mistral-small-2506"), norm("mistral-small-3.2-2506"))


class OrganizationTests(unittest.TestCase):
    def test_google_spellings_are_one_provider(self):
        from scripts.ingest.common import canonical_organization
        self.assertEqual(canonical_organization("Google"), "Google DeepMind")
        self.assertEqual(canonical_organization("Google DeepMind"), "Google DeepMind")
        self.assertEqual(canonical_organization(" OpenAI "), "OpenAI")


if __name__ == "__main__":
    unittest.main()
