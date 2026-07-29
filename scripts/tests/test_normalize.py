"""The guarantees per-benchmark normalisation exists to provide.

Each test here corresponds to a defect that was measured on the real dataset before the
rework, so a failure means the defect is back rather than that a number drifted.
"""
from __future__ import annotations

import json
import unittest

from scripts.ingest.common import CONFIG, DATA
from scripts.ingest.composite import build_models
from scripts.ingest.normalize import Reference, ReferenceError, load_reference, normalize


def reference_from(benchmarks: dict, min_n: int = 15, scale_factor: float = 12.5,
                   excluded: dict | None = None) -> Reference:
    return Reference({
        "methodology_version": "test",
        "min_n": min_n,
        "scale_factor": scale_factor,
        "benchmarks": benchmarks,
        "excluded": excluded or {},
    })


def cached(name: str) -> dict:
    return json.loads((DATA / "cache" / f"{name}.json").read_text(encoding="utf-8"))["payload"]


class CohortInvariance(unittest.TestCase):
    """R12: adding or removing a model must not move anybody else's score.

    Under min-max-against-the-cohort, removing openai-gpt-5-nano moved the composite of 48
    of the 52 survivors, by up to 8.03, with 33 models changing position - and not one
    underlying benchmark value had changed. That is the defect this whole rework exists to
    remove, and gpt-5-nano is the model that demonstrated it.
    """

    @classmethod
    def setUpClass(cls):
        cls.epoch, cls.livebench, cls.arena = (
            cached("epoch"), cached("livebench"), cached("lmarena")
        )

    def build(self, drop: str | None = None) -> dict[str, dict]:
        registry = dict(self.epoch["registry"])
        epoch_scores = dict(self.epoch["scores"])
        livebench_scores = dict(self.livebench["scores"])
        arena_text = dict(self.arena["text"])
        arena_vision = dict(self.arena["vision"])
        if drop:
            for source in (registry, epoch_scores, livebench_scores, arena_text, arena_vision):
                source.pop(drop, None)
        models, *_ = build_models(
            registry=registry, epoch_scores=epoch_scores,
            livebench_scores=livebench_scores, arena_text=arena_text,
            arena_vision=arena_vision, arena_snapshot=self.arena.get("snapshot"),
            vision_snapshot=self.arena.get("vision_snapshot"),
        )
        return {m["id"]: m for m in models}

    def test_removing_a_model_changes_no_other_score(self):
        before, after = self.build(), self.build("gpt-5-nano")
        survivors = [k for k in before if k in after]

        self.assertGreater(len(survivors), 40, "the fixture should hold a real cohort")
        self.assertNotIn("openai-gpt-5-nano", after)

        for model_id in survivors:
            self.assertEqual(
                before[model_id]["composite"], after[model_id]["composite"],
                f"{model_id} moved when a different model was removed",
            )
            self.assertEqual(
                before[model_id]["category_scores"], after[model_id]["category_scores"],
                f"{model_id} category scores moved when a different model was removed",
            )


class HardBenchmarkDoesNotSink(unittest.TestCase):
    """A model measured on a hard benchmark is not punished for the benchmark's difficulty.

    FrontierMath has a median near 28 and LiveBench Math near 90. Averaged raw, a model
    measured only on FrontierMath reads as catastrophic at maths; the two now map onto the
    same scale.
    """

    def test_a_model_at_the_reference_mean_scores_fifty(self):
        reference = load_reference()
        entry = reference.benchmarks["frontiermath"]

        normalized, meta = normalize(entry["mean"], "frontiermath", reference)

        self.assertEqual(normalized, 50.0)
        self.assertAlmostEqual(meta["z"], 0.0, places=6)

    def test_the_hard_and_the_easy_benchmark_agree_at_their_own_means(self):
        reference = load_reference()
        hard, _ = normalize(
            reference.benchmarks["frontiermath"]["mean"], "frontiermath", reference
        )
        easy, _ = normalize(
            reference.benchmarks["livebench_math"]["mean"], "livebench_math", reference
        )

        # Raw, these are roughly 27 and 89. Normalised, both are the average model.
        self.assertEqual(hard, easy)

    def test_a_typical_frontiermath_score_is_not_near_its_raw_value(self):
        reference = load_reference()
        normalized, _ = normalize(28.6, "frontiermath", reference)

        self.assertGreater(normalized, 45)
        self.assertLess(normalized, 55)


class Monotonicity(unittest.TestCase):
    def test_higher_raw_always_gives_higher_normalized(self):
        reference = reference_from({"b": {"mean": 50.0, "sd": 10.0, "n": 30}})

        previous = None
        for raw in [x / 2 for x in range(0, 200)]:
            normalized, _ = normalize(raw, "b", reference)
            if previous is not None:
                self.assertGreaterEqual(normalized, previous)
            previous = normalized

    def test_order_is_preserved_across_the_real_reference(self):
        reference = load_reference()
        for benchmark_id, entry in reference.benchmarks.items():
            low, _ = normalize(entry["observed_min"], benchmark_id, reference)
            high, _ = normalize(entry["observed_max"], benchmark_id, reference)
            self.assertLess(low, high, benchmark_id)


class Clipping(unittest.TestCase):
    def test_an_absurd_value_is_clipped_and_flagged(self):
        reference = reference_from({"b": {"mean": 50.0, "sd": 10.0, "n": 30}})

        normalized, meta = normalize(200.0, "b", reference)

        self.assertEqual(normalized, 100.0)
        self.assertTrue(meta["clipped"])

    def test_clipping_applies_at_the_bottom_too(self):
        reference = reference_from({"b": {"mean": 50.0, "sd": 10.0, "n": 30}})

        normalized, meta = normalize(-500.0, "b", reference)

        self.assertEqual(normalized, 0.0)
        self.assertTrue(meta["clipped"])

    def test_a_value_inside_the_range_is_not_flagged(self):
        reference = reference_from({"b": {"mean": 50.0, "sd": 10.0, "n": 30}})

        _, meta = normalize(55.0, "b", reference)

        self.assertFalse(meta["clipped"])

    def test_the_committed_reference_clips_nothing_it_was_built_from(self):
        # If this starts failing, the frozen reference has aged out of its own data and the
        # methodology version needs raising.
        reference = load_reference()
        for benchmark_id, entry in reference.benchmarks.items():
            for edge in (entry["observed_min"], entry["observed_max"]):
                _, meta = normalize(edge, benchmark_id, reference)
                self.assertFalse(meta["clipped"], f"{benchmark_id} clips its own range")


class Reproducibility(unittest.TestCase):
    def test_build_reference_reproduces_the_committed_file_exactly(self):
        from scripts.analysis.build_reference import build
        from scripts.ingest.composite import load_methodology_version

        snapshot = json.loads(
            (DATA / "baseline" / "methodology-1.0-scores.json").read_text(encoding="utf-8")
        )
        catalogue = {
            b["id"]: b
            for b in json.loads(
                (DATA / "benchmarks.json").read_text(encoding="utf-8")
            )["benchmarks"]
        }

        regenerated = build(
            snapshot["scores"], catalogue,
            snapshot["meta"]["generated_at"], load_methodology_version(),
        )
        committed = json.loads(
            (CONFIG / "benchmark_reference.json").read_text(encoding="utf-8")
        )

        self.assertEqual(regenerated, committed)


class MinimumSampleSize(unittest.TestCase):
    def test_the_committed_reference_excludes_math_level_5(self):
        reference = load_reference()

        self.assertNotIn("math_level_5", reference.benchmarks)
        self.assertIn("math_level_5", reference.excluded)
        self.assertIn("below min_n", reference.excluded["math_level_5"]["reason"])

    def test_an_excluded_benchmark_does_not_score(self):
        reference = load_reference()

        self.assertFalse(reference.scores("math_level_5"))
        self.assertTrue(reference.scores("frontiermath"))

    def test_an_excluded_benchmark_feeds_no_category(self):
        epoch, livebench, arena = cached("epoch"), cached("livebench"), cached("lmarena")
        _, score_rows, _, _ = build_models(
            registry=dict(epoch["registry"]), epoch_scores=dict(epoch["scores"]),
            livebench_scores=dict(livebench["scores"]), arena_text=dict(arena["text"]),
            arena_vision=dict(arena["vision"]), arena_snapshot=arena.get("snapshot"),
            vision_snapshot=arena.get("vision_snapshot"),
        )

        excluded = [r for r in score_rows if r["benchmark_id"] == "math_level_5"]
        self.assertTrue(excluded, "the fixture should still contain the excluded benchmark")
        for row in excluded:
            # Still published as a measurement, just never scored.
            self.assertIsNotNone(row["value"])
            self.assertIsNone(row["value_normalized"])
            self.assertFalse(row["normalization"]["scored"])

    def test_a_benchmark_below_min_n_cannot_be_hand_edited_into_scoring(self):
        with self.assertRaises(ReferenceError):
            reference_from({"thin": {"mean": 50.0, "sd": 10.0, "n": 5}}, min_n=15)

    def test_an_unknown_benchmark_fails_loudly_rather_than_guessing_a_scale(self):
        reference = reference_from({"b": {"mean": 50.0, "sd": 10.0, "n": 30}})

        with self.assertRaises(ReferenceError):
            reference.scores("a_benchmark_nobody_declared")


class ReferenceValidation(unittest.TestCase):
    def test_a_zero_standard_deviation_is_rejected(self):
        with self.assertRaises(ReferenceError):
            reference_from({"b": {"mean": 50.0, "sd": 0.0, "n": 30}})

    def test_a_missing_field_is_rejected(self):
        with self.assertRaises(ReferenceError):
            reference_from({"b": {"mean": 50.0, "n": 30}})


if __name__ == "__main__":
    unittest.main()
