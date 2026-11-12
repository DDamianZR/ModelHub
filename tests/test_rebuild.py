"""The neutrality rebuild must be the cohort the site publishes.

scripts/neutrality/rebuild.py and tests/test_golden.py each assemble the arguments for
build_models(). The golden test passed the Epoch boards and the rebuild did not, so the
rebuild silently scored 85 of 89 models and every provider delta reported four models as
gone, with the ranks below them shifted. A second copy of the inputs can drift again; this
compares its output with the committed data so it cannot do so quietly.
"""
import json
import unittest
from pathlib import Path

from scripts.neutrality.rebuild import cache_available, rebuild

DATA = Path(__file__).resolve().parents[1] / "data"


@unittest.skipUnless(cache_available(), "no cache to rebuild from")
class RebuildMatchesPublishedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rebuilt = {model["id"]: model for model in rebuild()[0]}
        published = json.loads((DATA / "models.json").read_text(encoding="utf-8"))["models"]
        cls.published = {model["id"]: model for model in published}

    def test_same_models(self):
        self.assertEqual(sorted(self.rebuilt), sorted(self.published))

    def test_same_published_numbers(self):
        fields = ("composite", "composite_error", "rank", "tied_with", "provisional")
        for model_id, published in self.published.items():
            rebuilt = self.rebuilt.get(model_id)
            if rebuilt is None:
                continue  # reported by test_same_models
            for field in fields:
                self.assertEqual(
                    rebuilt[field], published[field], f"{model_id}: {field}"
                )


if __name__ == "__main__":
    unittest.main()
