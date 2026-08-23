"""Golden test: rebuild models.json and scores.json from the versioned data/cache/*.json
payloads and check the result against the committed files bit for bit.

This is what "how to change anything that moves a number" (CLAUDE.md) asks for made
executable: any change to the composite pipeline shows up here as a concrete, named diff
instead of a claim that it's probably fine.

Determinism: flag_recalibration() is called with an EMPTY previous build rather than
skipped, because it unconditionally writes "cohort_recalibration": null onto every model
- omitting the call entirely would make every model's shape disagree with the committed
file on that key. An empty previous build can never actually flag anything (the "before"
lookup is always a miss), so this is a deterministic no-op rather than a comparison
against a moving target.
"""
import json
import unittest
from pathlib import Path

from scripts.ingest.composite import build_models, load_weights
from scripts.ingest.run import flag_recalibration
from scripts.ingest.sources import lmarena

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def _cached(name: str) -> dict:
    payload = json.loads((DATA / "cache" / f"{name}.json").read_text(encoding="utf-8"))
    return payload["payload"]


@unittest.skipUnless((DATA / "cache" / "epoch.json").exists(), "no cache to rebuild from")
class GoldenCompositeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        epoch_payload = _cached("epoch")
        livebench_payload = _cached("livebench")
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
                self.assertEqual(by_id_rebuilt[model_id], committed)

    def test_scores_match(self):
        key = lambda row: (row["model_id"], row["benchmark_id"])
        rebuilt = sorted(self.rebuilt_scores, key=key)
        committed = sorted(self.committed_scores, key=key)
        self.assertEqual(rebuilt, committed)


if __name__ == "__main__":
    unittest.main()
