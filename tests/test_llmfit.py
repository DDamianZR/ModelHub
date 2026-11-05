"""The llmfit sizing source and its join onto the cohort. No network: fixtures only."""
from __future__ import annotations

import unittest
from unittest import mock

from scripts.ingest import local
from scripts.ingest.common import SourceError
from scripts.ingest.sources import llmfit


def row(name: str, params: int, downloads: int = 0, **extra) -> dict:
    base = {
        "name": name, "parameters_raw": params, "context_length": 32768, "min_ram_gb": 8.0,
        "quantization": "Q4_K_M", "hf_downloads": downloads, "is_moe": False,
    }
    return {**base, **extra}


class ParseTests(unittest.TestCase):
    def test_most_downloaded_candidate_wins(self):
        rows = [
            row("a/Model-7B", 7_000_000_000, 10),
            row("b/Model-7B", 7_000_000_000, 5000),
            row("c/Model-7B", 7_000_000_000, 40),
        ]
        out = llmfit.parse(rows, {"model-7b"})
        self.assertEqual(out["model-7b"]["hf_repo"], "b/Model-7B")
        self.assertEqual(out["model-7b"]["candidates"], 3)

    def test_ties_break_by_repo_name_whatever_the_input_order(self):
        rows = [row("z/Model-7B", 7_000_000_000, 5), row("a/Model-7B", 7_000_000_000, 5)]
        forward = llmfit.parse(rows, {"model-7b"})
        backward = llmfit.parse(list(reversed(rows)), {"model-7b"})
        self.assertEqual(forward["model-7b"]["hf_repo"], "a/Model-7B")
        self.assertEqual(forward, backward)

    def test_size_disagreement_counts_candidates_beyond_tolerance(self):
        rows = [
            row("a/Model-7B", 7_000_000_000, 100),
            row("b/Model-7B", 7_300_000_000, 50),    # 4.3% away: within tolerance
            row("c/Model-7B", 3_900_000_000, 40),    # 44% away: a repack that lost tensors
        ]
        out = llmfit.parse(rows, {"model-7b"})["model-7b"]
        self.assertEqual(out["size_disagreement"], 1)
        self.assertEqual(out["parameters_raw"], 7_000_000_000)

    def test_only_wanted_keys_survive(self):
        rows = [row("a/Model-7B", 7_000_000_000), row("a/Other-3B", 3_000_000_000)]
        self.assertEqual(set(llmfit.parse(rows, {"model-7b"})), {"model-7b"})

    def test_rows_without_a_size_are_skipped(self):
        broken = [
            {"name": "a/Model-7B", "context_length": 8192, "min_ram_gb": 4.0},
            row("b/Model-7B", 0),
            "not a row",
        ]
        self.assertEqual(llmfit.parse(broken, {"model-7b"}), {})

    def test_namespace_is_ignored_when_matching(self):
        rows = [row("one-org/Model-7B", 7_000_000_000, 1), row("other-org/model-7b", 7_000_000_000, 2)]
        out = llmfit.parse(rows, {"model-7b"})
        self.assertEqual(out["model-7b"]["candidates"], 2)

    def test_empty_catalogue_is_a_source_error(self):
        with mock.patch.object(llmfit, "fetch_json", return_value=[]):
            with self.assertRaises(SourceError):
                llmfit.collect({"model-7b"})


CATALOGUE = {
    "pipeline_tags": ["text-generation", "image-text-to-text"],
    "min_parameters": 400_000_000, "min_context_length": 2048, "min_downloads": 1000,
    "min_likes": 10, "max_rows": 3, "exclude_name_tokens": ["awq", "base", "uncensored"],
    "exclude_name_suffixes": ["ocr"],
}


def pop_row(name: str, downloads: int = 5000, **extra) -> dict:
    return row(name, 7_000_000_000, downloads, hf_likes=50, pipeline_tag="text-generation", **extra)


class PopularTests(unittest.TestCase):
    def test_orders_by_downloads_then_name_and_cuts_at_max_rows(self):
        rows = [pop_row("o/D-7B", 5000), pop_row("o/B-7B", 9000), pop_row("o/A-7B", 9000),
                pop_row("o/C-7B", 8000)]
        names = [e["hf_repo"] for e in llmfit.popular(rows, set(), CATALOGUE)]
        self.assertEqual(names, ["o/A-7B", "o/B-7B", "o/C-7B"])

    def test_scored_models_are_never_repeated_as_unmeasured(self):
        rows = [pop_row("o/Model-7B"), pop_row("o/Other-7B")]
        out = llmfit.popular(rows, {"model-7b"}, CATALOGUE)
        self.assertEqual([e["hf_repo"] for e in out], ["o/Other-7B"])

    def test_repacks_bases_and_ocr_readers_are_left_out_by_whole_word(self):
        rows = [pop_row("o/M-7B-AWQ"), pop_row("o/M-7B-Base"), pop_row("o/LightOnOCR-1B"),
                pop_row("o/dots.ocr"), pop_row("o/M-7B-uncensored"),
                pop_row("o/Database-7B"), pop_row("o/Keeper-7B")]
        names = {e["hf_repo"] for e in llmfit.popular(rows, set(), CATALOGUE)}
        self.assertEqual(names, {"o/Database-7B", "o/Keeper-7B"})

    def test_thresholds_and_pipeline_tag_gate_entries(self):
        rows = [
            pop_row("o/Few-Downloads-7B", 10),
            {**pop_row("o/Few-Likes-7B"), "hf_likes": 1},
            {**pop_row("o/Wrong-Tag-7B"), "pipeline_tag": "text-to-speech"},
            {**pop_row("o/Tiny-7B"), "parameters_raw": 100_000_000},
            {**pop_row("o/Short-Window-7B"), "context_length": 1024},
            pop_row("o/Passes-7B"),
        ]
        self.assertEqual([e["hf_repo"] for e in llmfit.popular(rows, set(), CATALOGUE)], ["o/Passes-7B"])

    def test_publisher_never_changes_the_outcome(self):
        a = llmfit.popular([pop_row("lab-a/Model-7B")], set(), CATALOGUE)
        b = llmfit.popular([pop_row("lab-b/Model-7B")], set(), CATALOGUE)
        self.assertEqual([e["parameters_raw"] for e in a], [e["parameters_raw"] for e in b])

    def test_no_rules_means_no_catalogue(self):
        self.assertEqual(llmfit.popular([pop_row("o/Model-7B")], set(), {}), [])

    def test_shipped_rules_load_with_every_threshold_present(self):
        rules = local.load_catalogue_rules()
        for key in ("pipeline_tags", "min_parameters", "min_downloads", "min_likes", "max_rows"):
            self.assertIn(key, rules)


RULES = [
    {"all_of": [["next-family"]], "full": 10, "linear": 30},
    {"all_of": [["hybrid-"], ["-moe-tag"]], "full": 10, "linear": 30},
    {"all_of": [["hybrid-"]], "full": 16, "linear": 48},
]


class LayoutTests(unittest.TestCase):
    def test_first_matching_rule_wins(self):
        self.assertEqual(local.attention_layout("o/Hybrid-9B-moe-tag", RULES), {"full": 10, "linear": 30})
        self.assertEqual(local.attention_layout("o/Hybrid-9B", RULES), {"full": 16, "linear": 48})

    def test_every_group_must_match(self):
        self.assertIsNone(local.attention_layout("o/other-moe-tag", RULES))

    def test_no_match_means_unknown_not_zero(self):
        self.assertIsNone(local.attention_layout("o/Plain-7B", RULES))

    def test_shipped_config_loads_and_every_rule_is_well_formed(self):
        rules = local.load_layout_rules()
        self.assertGreaterEqual(len(rules), 1)
        for rule in rules:
            self.assertGreater(rule["full"] + rule["linear"], 0)
            self.assertTrue(all(isinstance(group, list) and group for group in rule["all_of"]))


def model(mid: str, *, open_weights: bool, provider: str = "p") -> dict:
    return {"id": mid, "is_open_weights": open_weights, "provider_id": provider,
            "organization": provider, "display_name": mid}


ENTRY = {
    "hf_repo": "a/Model-7B", "parameters_raw": 7_000_000_000, "active_parameters": None,
    "is_moe": False, "num_experts": None, "active_experts": None, "context_length": 8192,
    "num_hidden_layers": 32, "num_attention_heads": 32, "num_key_value_heads": 8,
    "head_dim": 128, "architecture": "llama", "quantization": "Q4_K_M", "min_ram_gb": 4.0,
    "min_vram_gb": 4.0, "license": "mit", "candidates": 2, "size_disagreement": 0,
}


class BuildTests(unittest.TestCase):
    keys = {"open-one": "model-7b", "closed-one": "model-7b", "open-two": "absent-model"}

    def test_closed_models_are_never_sized_even_when_a_repo_shares_the_name(self):
        """A third-party repo can be named after a closed model; it must not be read as it."""
        models = [model("open-one", open_weights=True), model("closed-one", open_weights=False)]
        rows = local.build(models, self.keys, {"model-7b": ENTRY}, [])
        self.assertEqual([r["model_id"] for r in rows], ["open-one"])

    def test_models_with_no_catalogue_entry_are_left_out_not_guessed(self):
        models = [model("open-two", open_weights=True)]
        self.assertEqual(local.build(models, self.keys, {"model-7b": ENTRY}, []), [])

    def test_active_parameters_only_for_mixture_models(self):
        dense = {**ENTRY, "active_parameters": 123}
        moe = {**ENTRY, "is_moe": True, "active_parameters": 123}
        models = [model("open-one", open_weights=True)]
        self.assertIsNone(local.build(models, self.keys, {"model-7b": dense}, [])[0]["active_parameters"])
        self.assertEqual(local.build(models, self.keys, {"model-7b": moe}, [])[0]["active_parameters"], 123)

    def test_publisher_never_changes_a_row(self):
        """Renaming whoever made a model leaves its sizing untouched."""
        a = local.build([model("open-one", open_weights=True, provider="lab-a")],
                        self.keys, {"model-7b": ENTRY}, RULES)
        b = local.build([model("open-one", open_weights=True, provider="lab-b")],
                        self.keys, {"model-7b": ENTRY}, RULES)
        self.assertEqual(a, b)

    def test_wanted_keys_cover_only_open_weights_models(self):
        models = [model("open-one", open_weights=True), model("closed-one", open_weights=False),
                  model("open-two", open_weights=True)]
        self.assertEqual(local.wanted_keys(models, self.keys), {"model-7b", "absent-model"})

    def test_catalogue_rows_carry_a_link_and_no_score(self):
        rows = local.build_catalogue(
            [{**ENTRY, "hf_repo": "o/Free-7B", "hf_downloads": 9, "hf_likes": 3,
              "pipeline_tag": "image-text-to-text"}], [])
        self.assertEqual(rows[0]["model_id"], "hf:o/Free-7B")
        self.assertEqual(rows[0]["display_name"], "Free-7B")
        self.assertEqual(rows[0]["source_url"], "https://huggingface.co/o/Free-7B")
        self.assertEqual(rows[0]["modality"], "vision")
        for forbidden in ("composite", "rank", "score"):
            self.assertNotIn(forbidden, rows[0])

    def test_scored_keys_include_closed_models(self):
        models = [model("open-one", open_weights=True), model("closed-one", open_weights=False)]
        self.assertEqual(local.scored_keys(models, self.keys), {"model-7b"})

    def test_document_lists_the_catalogue_and_its_rules(self):
        extra = local.build_catalogue([{**ENTRY, "hf_repo": "o/Free-7B"}], [])
        doc = local.document([], 0, "2026-11-05T00:00:00+00:00", extra, {"max_rows": 3})
        self.assertEqual(doc["meta"]["catalogue_rows"], 1)
        self.assertEqual(doc["meta"]["catalogue_rules"], {"max_rows": 3})
        self.assertEqual(len(doc["catalogue"]), 1)

    def test_document_states_it_is_outside_the_composite(self):
        rows = local.build([model("open-one", open_weights=True)], self.keys, {"model-7b": ENTRY}, [])
        doc = local.document(rows, 3, "2026-11-05T00:00:00+00:00")
        self.assertIs(doc["meta"]["in_composite"], False)
        self.assertEqual(doc["meta"]["matched"], 1)
        self.assertEqual(doc["meta"]["open_weights_scored"], 3)


if __name__ == "__main__":
    unittest.main()
