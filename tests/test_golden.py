"""Golden test: rebuild models.json and scores.json from the versioned data/cache/*.json
payloads and check the result against the committed files bit for bit.

This is what the project's "how to change anything that moves a number" rule asks for made
executable: any change to the composite pipeline shows up here as a concrete, named diff
instead of a claim that it's probably fine.

Determinism: flag_recalibration() is called with an EMPTY previous build rather than
skipped, because it unconditionally writes "cohort_recalibration": null onto every model
- omitting the call entirely would make every model's shape disagree with the committed
file on that key. An empty previous build can never actually flag anything (the "before"
lookup is always a miss), so this is a deterministic no-op rather than a comparison
against a moving target.

Corollary: when a real ingest run's previous build was non-empty and cohort renormalisation
genuinely moved a model, the committed file carries a real cohort_recalibration record that
this harness's null rebuild cannot reproduce. The field is compared by shape instead of by
value for that reason - see test_models_match_field_for_field.

LiveBench rows are dated from data/cache/livebench_rows.json before the composite is built,
as the ingest does. The cached payload still carries the snapshot date on every row, so
without that step every re-dated row would read as a diff. The state and the payload are
written by the same run and hold the same rows, so the dating is a lookup, not a guess.
"""
import json
import unittest
from pathlib import Path

from scripts.ingest import row_dates
from scripts.ingest.composite import build_models, load_weights
from scripts.ingest.run import BENCHMARK_CATALOGUE, flag_recalibration
from scripts.ingest.sources import lmarena

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def _cache_file(name: str) -> dict:
    return json.loads((DATA / "cache" / f"{name}.json").read_text(encoding="utf-8"))


def _cached(name: str) -> dict:
    return _cache_file(name)["payload"]


def _dated_livebench() -> dict:
    cached = _cache_file("livebench")
    payload = cached["payload"]
    if (DATA / "cache" / f"{row_dates.STATE}.json").exists():
        row_dates.stamp(
            payload["scores"], payload["snapshot"], _cache_file(row_dates.STATE),
            cached["fetched_at"],
        )
    return payload


@unittest.skipUnless((DATA / "cache" / "epoch.json").exists(), "no cache to rebuild from")
class GoldenCompositeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        epoch_payload = _cached("epoch")
        livebench_payload = _dated_livebench()
        arena_payload = lmarena.upgrade_payload(_cached("lmarena"))

        weights, _min_coverage, _policy = load_weights()

        models, score_rows, _providers, _aliases, _arena_minmax = build_models(
            registry=epoch_payload.get("registry") or {},
            epoch_scores=epoch_payload.get("scores") or {},
            livebench_scores=livebench_payload.get("scores") or {},
            arena_text=arena_payload.get("text") or {},
            arena_vision=arena_payload.get("vision") or {},
            arena_snapshot=arena_payload.get("snapshot"),
            vision_snapshot=arena_payload.get("vision_snapshot"),
            benchmark_order=[entry[0] for entry in BENCHMARK_CATALOGUE],
        )
        flag_recalibration(models, score_rows, weights, {}, {})
        for model in models:
            model.pop("arena_name", None)

        cls.rebuilt_models = models
        cls.rebuilt_scores = score_rows
        cls.committed_models = json.loads(
            (DATA / "models.json").read_text(encoding="utf-8")
        )["models"]
        cls.committed_scores = json.loads(
            (DATA / "scores.json").read_text(encoding="utf-8")
        )["scores"]

    def test_model_count_matches(self):
        self.assertEqual(len(self.rebuilt_models), len(self.committed_models))

    def test_models_match_field_for_field(self):
        by_id_rebuilt = {m["id"]: m for m in self.rebuilt_models}
        by_id_committed = {m["id"]: m for m in self.committed_models}
        self.assertEqual(set(by_id_rebuilt), set(by_id_committed))
        for model_id, committed in by_id_committed.items():
            with self.subTest(model=model_id):
                rebuilt = dict(by_id_rebuilt[model_id])
                committed = dict(committed)
                rebuilt_recal = rebuilt.pop("cohort_recalibration", None)
                committed_recal = committed.pop("cohort_recalibration", None)
                self.assertIsNone(rebuilt_recal)
                if committed_recal is not None:
                    expected_keys = {
                        "raw_delta",
                        "normalized_delta",
                        "composite_effect",
                        "threshold",
                    }
                    self.assertEqual(set(committed_recal), expected_keys)
                    for key in expected_keys:
                        self.assertIsInstance(committed_recal[key], (int, float))
                self.assertEqual(rebuilt, committed)

    def test_scores_match(self):
        key = lambda row: (row["model_id"], row["benchmark_id"])
        rebuilt = sorted(self.rebuilt_scores, key=key)
        committed = sorted(self.committed_scores, key=key)
        self.assertEqual(rebuilt, committed)


if __name__ == "__main__":
    unittest.main()
