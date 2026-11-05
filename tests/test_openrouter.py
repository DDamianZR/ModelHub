"""Catalogue parsing and matching, from fixtures: no network, no provider names in logic."""
import unittest

from scripts.ingest import catalogue
from scripts.ingest.sources import openrouter

PAYLOAD = {"data": [
    {"id": "labx/alpha-2.1", "name": "Alpha 2.1", "context_length": 200000,
     "hugging_face_id": "labx/alpha",
     "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]},
     "pricing": {"prompt": "0.000003", "completion": "0.000015"}},
    {"id": "labx/alpha-2.1:batch", "name": "Alpha 2.1 batch", "context_length": 200000,
     "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
     "pricing": {"prompt": "0.0000015", "completion": "0.0000075"}},
    {"id": "laby/beta-preview", "name": "Beta", "context_length": 8000,
     "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
     "pricing": {"prompt": "-1", "completion": "-1"}},
    {"id": "laby/beta", "name": "Beta final", "context_length": 16000,
     "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
     "pricing": {"prompt": "0", "completion": "0"}},
    {"id": "labz/gamma-9", "name": "Gamma", "context_length": 32000,
     "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
     "pricing": {"prompt": "0.000001", "completion": "0.000002"}},
    {"id": "no-namespace", "name": "skipped"},
]}


class PriceTests(unittest.TestCase):
    def test_per_token_becomes_per_million(self):
        self.assertEqual(openrouter._price_per_million("0.000003"), 3.0)

    def test_variable_and_missing_price_are_unknown_not_free(self):
        self.assertIsNone(openrouter._price_per_million("-1"))
        self.assertIsNone(openrouter._price_per_million(None))
        self.assertIsNone(openrouter._price_per_million("n/a"))

    def test_zero_stays_zero(self):
        self.assertEqual(openrouter._price_per_million("0"), 0.0)


class KeyTests(unittest.TestCase):
    def test_namespace_is_ignored(self):
        self.assertEqual(openrouter.catalogue_key("one/model-x"),
                         openrouter.catalogue_key("two/model-x"))

    def test_decimal_point_equals_hyphen(self):
        self.assertEqual(openrouter.catalogue_key("a/m-5.1"),
                         openrouter.catalogue_key("m-5-1"))

    def test_variant_suffix_is_dropped(self):
        self.assertEqual(openrouter.catalogue_key("a/m-5:free"),
                         openrouter.catalogue_key("a/m-5"))


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.entries = openrouter.parse(PAYLOAD)

    def test_entries_without_namespace_are_skipped(self):
        self.assertNotIn("no-namespace", self.entries)
        self.assertEqual(len(self.entries), 5)

    def test_open_weights_follows_repo_id(self):
        self.assertTrue(self.entries["labx/alpha-2.1"]["open_weights"])
        self.assertFalse(self.entries["labz/gamma-9"]["open_weights"])

    def test_no_prose_is_stored(self):
        for entry in self.entries.values():
            self.assertNotIn("description", entry)


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.entries = openrouter.parse(PAYLOAD)
        self.keys = {"m1": "alpha-2.1", "m2": "beta", "m3": "unknown-model"}

    def test_plain_listing_beats_batch_variant(self):
        matches = catalogue.match_models(self.keys, self.entries)
        self.assertEqual(matches["m1"]["slug"], "labx/alpha-2.1")
        self.assertEqual(matches["m1"]["price_input_usd_per_m"], 3.0)

    def test_shorter_slug_beats_suffixed_one(self):
        matches = catalogue.match_models(self.keys, self.entries)
        self.assertEqual(matches["m2"]["slug"], "laby/beta")

    def test_no_fuzzy_matching(self):
        matches = catalogue.match_models(self.keys, self.entries)
        self.assertNotIn("m3", matches)

    def test_apply_fills_metadata_and_leaves_scores_alone(self):
        model = {"id": "m1", "modalities": ["text"], "pricing": None,
                 "context_window": None, "composite": 61.5, "rank": 3,
                 "is_open_weights": False}
        before = {k: model[k] for k in ("composite", "rank", "is_open_weights")}
        matches = catalogue.match_models(self.keys, self.entries)
        self.assertEqual(catalogue.apply_metadata([model], matches, "2026-11-05"), 1)
        self.assertEqual(model["pricing"]["output_usd_per_m"], 15.0)
        self.assertEqual(model["context_window"], 200000)
        self.assertIn("vision", model["modalities"])
        for key, value in before.items():
            self.assertEqual(model[key], value)

    def test_unmatched_model_is_untouched(self):
        model = {"id": "m3", "modalities": ["text"], "pricing": None, "context_window": None}
        catalogue.apply_metadata([model], {}, "2026-11-05")
        self.assertIsNone(model["pricing"])

    def test_unranked_excludes_matched_and_is_marked(self):
        matches = catalogue.match_models(self.keys, self.entries)
        rows = catalogue.build_unranked(self.entries, matches, "2026-11-05")
        slugs = [r["slug"] for r in rows]
        self.assertEqual(slugs, ["labz/gamma-9"])
        self.assertEqual(rows[0]["status"], "unranked")
        self.assertNotIn("rank", rows[0])
        self.assertNotIn("composite", rows[0])


class BoardTests(unittest.TestCase):
    def test_board_rows_only_for_scored_models_and_outside_composite(self):
        boards = {"agentic": {"bench": {"name": "Bench", "rows": {
            "alpha-2.1": {"variant": "alpha-2.1_high", "value": 40.0, "stderr": 5.0,
                          "measured_at": "2026-10-01"},
            "stranger": {"variant": "stranger", "value": 90.0, "stderr": None,
                         "measured_at": None}}}}}
        out = catalogue.build_boards(boards, {"m1": "alpha-2.1"})
        agentic = next(b for b in out if b["id"] == "agentic")
        self.assertFalse(agentic["in_composite"])
        self.assertEqual([r["model_id"] for r in agentic["benchmarks"][0]["rows"]], ["m1"])
        knowledge = next(b for b in out if b["id"] == "knowledge")
        self.assertEqual(knowledge["benchmarks"], [])


if __name__ == "__main__":
    unittest.main()
