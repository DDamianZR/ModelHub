"""composite.py: variant selection, uncertainty combination, and the significance rank.
Each test fixes a rule CLAUDE.md documents as having been wrong once already.
"""
import unittest

from scripts.ingest.composite import (
    assign_significance_ranks,
    combine_mean,
    combine_weighted,
    effort_label,
    choose_model_variant,
    pick_arena_variant,
)


class EffortLabelTests(unittest.TestCase):
    def test_xhigh_is_not_swallowed_by_high(self):
        self.assertEqual(effort_label("gpt-5-xhigh", "gpt-5"), "xhigh")
        self.assertNotEqual(effort_label("gpt-5-xhigh", "gpt-5"), "high")

    def test_bare_thinking_suffix_is_plain(self):
        self.assertEqual(effort_label("claude-opus-4-6-thinking", "claude-opus-4-6"), "plain")

    def test_no_qualifier_is_plain(self):
        self.assertEqual(effort_label("claude-opus-4-6", "claude-opus-4-6"), "plain")

    def test_effort_suffix_survives_thinking_prefix_stripping(self):
        self.assertEqual(effort_label("model-thinking-high", "model"), "high")


def _slot(category, entries):
    return {"category": category, "entries": entries}


class ChooseModelVariantTests(unittest.TestCase):
    def test_more_coverage_wins(self):
        merged = {
            "bench-a": _slot("reasoning", [{"variant": "model-high", "value": 80.0}]),
            "bench-b": _slot("coding", [{"variant": "model-high", "value": 70.0}]),
            "bench-c": _slot("math", [{"variant": "model-max", "value": 95.0}]),
        }
        self.assertEqual(choose_model_variant(merged, "model"), "high")

    def test_arena_breaks_a_coverage_tie_without_voting_on_value(self):
        """Regression case: Claude Opus 4.6 lost every LiveBench score once Arena's single
        row was allowed to outvote four benchmarks that already agreed on a label, because
        "-thinking" normalises to "plain" the same as the bare name. Arena may only break
        an existing tie by matching a label, never win on the size of its own rating.
        """
        merged = {
            "bench-a": _slot("reasoning", [{"variant": "opus-4-6", "value": 70.0}]),
            "bench-b": _slot("coding", [{"variant": "opus-4-6", "value": 72.0}]),
            "bench-c": _slot("math", [{"variant": "opus-4-6-max", "value": 95.0}]),
            "bench-d": _slot("instruction_following",
                              [{"variant": "opus-4-6-max", "value": 96.0}]),
        }
        # "opus-4-6-thinking" normalises to "plain", same label as the bare "opus-4-6"
        # entries above - it must not be read as a vote for a third, separate label.
        arena_variants = [{"model_name": "opus-4-6-thinking"}]
        label = choose_model_variant(merged, "opus-4-6", arena_variants)
        self.assertEqual(label, "plain")

    def test_no_arena_row_falls_back_to_coverage_then_average_value(self):
        merged = {
            "bench-a": _slot("reasoning", [{"variant": "model-high", "value": 80.0}]),
            "bench-b": _slot("coding", [{"variant": "model-max", "value": 99.0}]),
        }
        # Both labels cover exactly one benchmark and neither is Arena-measured, so the
        # highest average value should decide.
        self.assertEqual(choose_model_variant(merged, "model", []), "max")

    def test_no_entries_returns_none(self):
        self.assertIsNone(choose_model_variant({}, "model"))


class PickArenaVariantTests(unittest.TestCase):
    def test_no_rows_returns_nothing(self):
        self.assertEqual(pick_arena_variant([], "model", "high"), (None, None))

    def test_no_chosen_label_picks_the_highest_rating(self):
        rows = [
            {"model_name": "model-high", "rating": 1500, "vote_count": 200},
            {"model_name": "model-max", "rating": 1600, "vote_count": 10},
        ]
        row, mismatch = pick_arena_variant(rows, "model", None)
        self.assertEqual(row["model_name"], "model-max")
        self.assertIsNone(mismatch)

    def test_matching_variant_wins_by_vote_count_among_matches(self):
        rows = [
            {"model_name": "model-high", "rating": 1500, "vote_count": 200},
            {"model_name": "model-high-thinking", "rating": 1495, "vote_count": 9000},
            {"model_name": "model-max", "rating": 1600, "vote_count": 50000},
        ]
        row, mismatch = pick_arena_variant(rows, "model", "high")
        self.assertEqual(row["model_name"], "model-high-thinking")
        self.assertIsNone(mismatch)

    def test_no_matching_variant_picks_highest_vote_count_and_reports_the_mismatch(self):
        rows = [
            {"model_name": "model-high", "rating": 1500, "vote_count": 200},
            {"model_name": "model-max", "rating": 1490, "vote_count": 9000},
        ]
        row, mismatch = pick_arena_variant(rows, "model", "medium")
        self.assertEqual(row["model_name"], "model-max")
        self.assertEqual(mismatch, "max")


class CombineUncertaintyTests(unittest.TestCase):
    def test_combine_mean_all_unknown_is_none_not_zero(self):
        self.assertIsNone(combine_mean([None, None], 2))
        self.assertIsNone(combine_mean([], 0))

    def test_combine_mean_known_values(self):
        # sqrt(3^2 + 4^2) / 3 = 5/3
        self.assertAlmostEqual(combine_mean([3.0, None, 4.0], 3), 5.0 / 3)

    def test_combine_weighted_all_unknown_is_none_not_zero(self):
        self.assertIsNone(combine_weighted([(0.5, None), (0.5, None)]))
        self.assertIsNone(combine_weighted([]))

    def test_combine_weighted_known_values(self):
        # weight 0.5 of total 1.0, half-width 2.0: (0.5/1.0)^2 * 2.0^2 = 1.0, sqrt = 1.0
        self.assertAlmostEqual(combine_weighted([(0.5, 2.0), (0.5, None)]), 1.0)


class AssignSignificanceRanksTests(unittest.TestCase):
    def test_overlapping_intervals_share_a_rank(self):
        models = [
            {"provisional": False, "composite": 85.0, "composite_error": 1.0},
            {"provisional": False, "composite": 84.5, "composite_error": 1.0},
        ]
        assign_significance_ranks(models)
        self.assertEqual(models[0]["rank"], models[1]["rank"])
        self.assertEqual(models[0]["tied_with"], 1)

    def test_cleanly_separated_models_get_different_ranks(self):
        models = [
            {"provisional": False, "composite": 90.0, "composite_error": 0.5},
            {"provisional": False, "composite": 70.0, "composite_error": 0.5},
        ]
        assign_significance_ranks(models)
        self.assertEqual(models[0]["rank"], 1)
        self.assertEqual(models[1]["rank"], 2)
        self.assertEqual(models[0]["tied_with"], 0)

    def test_overlap_does_not_chain_transitively(self):
        """A overlaps B and B overlaps C, but A and C are cleanly separated. A chain rule
        that grouped runs of overlapping neighbours would rank all three the same; the
        actual rule counts strictly-better models per model instead."""
        models = [
            {"provisional": False, "composite": 90.0, "composite_error": 3.0},  # A: 87-93
            {"provisional": False, "composite": 85.0, "composite_error": 3.0},  # B: 82-88
            {"provisional": False, "composite": 80.0, "composite_error": 3.0},  # C: 77-83
        ]
        assign_significance_ranks(models)
        a, b, c = models
        self.assertEqual(a["rank"], 1)
        self.assertEqual(b["rank"], 1)  # overlaps A
        self.assertEqual(c["rank"], 2)  # A is cleanly ahead of C, despite B sitting between

    def test_missing_error_is_compared_as_a_point_value(self):
        models = [
            {"provisional": False, "composite": 90.0, "composite_error": None},
            {"provisional": False, "composite": 80.0, "composite_error": None},
        ]
        assign_significance_ranks(models)
        self.assertEqual(models[0]["rank"], 1)
        self.assertEqual(models[1]["rank"], 2)

    def test_provisional_models_get_no_rank(self):
        models = [{"provisional": True, "composite": 50.0, "composite_error": None}]
        assign_significance_ranks(models)
        self.assertIsNone(models[0]["rank"])
        self.assertEqual(models[0]["tied_with"], 0)


if __name__ == "__main__":
    unittest.main()
