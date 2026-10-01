"""composite.py: variant selection, uncertainty combination, and the significance rank.
Each test fixes a rule the project notes document as having been wrong once already.
"""
import unittest

from scripts.ingest.composite import (
    assign_significance_ranks,
    combine_mean,
    combine_weighted,
    effort_label,
    choose_model_variant,
    correlation_is_significant,
    display_name_for,
    fit_equating,
    pick_arena_variant,
    resolve_same_configuration,
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

    def test_label_does_not_depend_on_the_key_spelling(self):
        """An aliased or protected name does not start with its key; subtracting the key
        used to return the whole name as a configuration."""
        self.assertEqual(effort_label("qwen3.8-max_xhigh", "qwen3.8-max"), "xhigh")
        self.assertEqual(effort_label("qwen3.8-max", "qwen3.8-max"), "plain")
        self.assertEqual(effort_label("mistral-small-2506", "mistral-small-3.2"), "plain")

    def test_dates_are_not_configurations(self):
        self.assertEqual(effort_label("claude-haiku-4-5-20251001"), "plain")
        self.assertEqual(effort_label("claude-haiku-4-5-20251001_32K"), "32k")

    def test_non_reasoning_is_effort_none(self):
        self.assertEqual(effort_label("grok-4-1-fast-non-reasoning"), "none")


class DisplayNameTests(unittest.TestCase):
    META = {
        "display_name": "Muse Spark 1.3 (high)",
        "versions": [
            {"version": "muse-spark-1.3_high", "display_name": "Muse Spark 1.3 (high)"},
            {"version": "muse-spark-1.3_minimal", "display_name": "Muse Spark 1.3 (minimal)"},
        ],
    }

    def test_the_scored_versions_own_name_is_used(self):
        self.assertEqual(display_name_for(self.META, "minimal"), "Muse Spark 1.3 (minimal)")

    def test_a_label_no_version_carries_is_appended_to_the_bare_name(self):
        """Regression: the page said "(high)" over scores LiveBench measured at xhigh."""
        self.assertEqual(display_name_for(self.META, "xhigh"), "Muse Spark 1.3 (xhigh)")

    def test_non_effort_labels_are_not_shown_as_effort(self):
        self.assertEqual(display_name_for(self.META, "plain"), "Muse Spark 1.3")


class SameConfigurationTests(unittest.TestCase):
    def test_reruns_are_averaged_not_first_row_wins(self):
        """Regression: GPT-5.1 has two SWE-bench runs at high; CSV order picked one."""
        row, note = resolve_same_configuration([
            {"variant": "gpt-5.1_high", "value": 67.98, "stderr": 2.0, "measured_at": "2026-02-18"},
            {"variant": "gpt-5.1_high", "value": 65.91, "stderr": 2.0, "measured_at": "2026-02-17"},
        ])
        self.assertAlmostEqual(row["value"], 66.94, places=2)
        self.assertIn("mean of 2", note)

    def test_vendor_run_beats_a_hosted_run(self):
        row, _ = resolve_same_configuration([
            {"variant": "chutes/gpt-oss-120b", "value": 60.0, "measured_at": "2026-05-01"},
            {"variant": "gpt-oss-120b", "value": 55.0, "measured_at": "2026-01-01"},
        ])
        self.assertEqual(row["value"], 55.0)

    def test_release_beats_pre_release(self):
        row, _ = resolve_same_configuration([
            {"variant": "gpt-5.5-pre-release_xhigh", "value": 90.0, "measured_at": "2026-04-01"},
            {"variant": "gpt-5.5_xhigh", "value": 88.0, "measured_at": "2026-04-20"},
        ])
        self.assertEqual(row["value"], 88.0)


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


def _sel(**benchmarks):
    return {b: {"value": v, "category": "math"} for b, v in benchmarks.items()}


class EquatingTests(unittest.TestCase):
    CONFIG = {"anchors": {"math": "anchor"}, "min_overlap": 5, "display_only": {}}

    def test_a_harder_benchmark_lands_on_the_anchor_scale(self):
        """Regression: FrontierMath (~32) and LiveBench Math (~89) were averaged as-is,
        so a model scored on FrontierMath alone looked 57 points worse at Math."""
        selected = {
            f"m{i}": _sel(anchor=80 + i, hard=20 + 2 * i) for i in range(8)
        }
        params = fit_equating(selected, [], self.CONFIG)["hard"]
        self.assertTrue(params["scored"])
        equated = params["intercept"] + params["slope"] * 26  # model m3's hard score
        self.assertAlmostEqual(equated, 83, places=6)

    def test_too_few_shared_models_is_shown_not_scored(self):
        selected = {f"m{i}": _sel(anchor=80 + i, hard=20 + i) for i in range(4)}
        params = fit_equating(selected, [], self.CONFIG)["hard"]
        self.assertFalse(params["scored"])
        self.assertEqual(params["reason"], "overlap")

    def test_uncorrelated_benchmark_is_not_equated(self):
        """SWE-bench Verified shared 6 models with LiveBench Coding at r = 0.14 on
        2026-10-01; equating it would have manufactured a coding score."""
        values = [(80, 50), (81, 70), (82, 40), (83, 65), (84, 45), (85, 55)]
        selected = {f"m{i}": _sel(anchor=a, hard=h) for i, (a, h) in enumerate(values)}
        params = fit_equating(selected, [], self.CONFIG)["hard"]
        self.assertFalse(params["scored"])
        self.assertEqual(params["reason"], "weak_correlation")

    def test_display_only_benchmarks_are_never_scored(self):
        config = {**self.CONFIG, "display_only": {"hard": "superseded"}}
        selected = {f"m{i}": _sel(anchor=80 + i, hard=20 + i) for i in range(8)}
        self.assertFalse(fit_equating(selected, [], config)["hard"]["scored"])

    def test_the_configured_anchor_wins_over_coverage(self):
        selected = {f"m{i}": _sel(anchor=80 + i, wide=50 + i) for i in range(6)}
        selected.update({f"x{i}": _sel(wide=40 + i) for i in range(6)})
        params = fit_equating(selected, [], self.CONFIG)
        self.assertEqual(params["wide"]["anchor"], "anchor")


class CorrelationGateTests(unittest.TestCase):
    def test_threshold_scales_with_the_overlap(self):
        self.assertFalse(correlation_is_significant(0.6, 6))
        self.assertTrue(correlation_is_significant(0.75, 6))
        self.assertTrue(correlation_is_significant(0.3, 50))
        self.assertFalse(correlation_is_significant(-0.9, 50))
