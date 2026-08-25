"""lmarena.collapse_slices - the mislabelled-slice filter, and the duplication guard it
feeds. Verified 2026-07-28 against the last clean snapshot: max vote_count gives 0.80
mean rating drift, first-row or max-rating give 11.94 (see the project notes). This module
fixes that behaviour so a refactor can't silently swap it back.
"""
import unittest

from scripts.ingest.sources import lmarena


def _row(model_name, vote_count, variance, rating=1500.0, **extra):
    return {
        "model_name": model_name, "vote_count": vote_count, "variance": variance,
        "rating": rating, "rank": 1.0, "category": "overall",
        "leaderboard_publish_date": "2026-08-21", **extra,
    }


class CollapseSlicesTests(unittest.TestCase):
    def test_highest_vote_count_wins(self):
        rows = [
            _row("model-a", vote_count=100, variance=5.0),
            _row("model-a", vote_count=9000, variance=5.0),
            _row("model-a", vote_count=4000, variance=5.0),
        ]
        collapsed = lmarena.collapse_slices(rows)
        self.assertEqual(len(collapsed), 1)
        self.assertEqual(collapsed[0]["vote_count"], 9000)

    def test_tie_on_vote_count_breaks_toward_lower_variance(self):
        rows = [
            _row("model-a", vote_count=9000, variance=12.0),
            _row("model-a", vote_count=9000, variance=3.0),
        ]
        collapsed = lmarena.collapse_slices(rows)
        self.assertEqual(len(collapsed), 1)
        self.assertEqual(collapsed[0]["variance"], 3.0)

    def test_one_row_per_model_regardless_of_input_duplication(self):
        """The property the duplication guard actually depends on: after collapsing,
        rows/distinct_models is always exactly 1.0, however duplicated the input was."""
        rows = []
        for i in range(6):
            rows.append(_row("model-a", vote_count=1000 * (i + 1), variance=5.0))
        rows += [_row("model-b", vote_count=500, variance=5.0)]
        raw_ratio = len(rows) / len({r["model_name"] for r in rows})
        self.assertGreater(raw_ratio, lmarena.DUPLICATE_RATIO_LIMIT)

        collapsed = lmarena.collapse_slices(rows)
        residual = len(collapsed) / len({r["model_name"] for r in collapsed})
        self.assertEqual(residual, 1.0)
        self.assertLessEqual(residual, lmarena.DUPLICATE_RATIO_LIMIT)

    def test_distinct_models_are_not_collapsed_into_each_other(self):
        rows = [
            _row("model-a", vote_count=100, variance=5.0),
            _row("model-b", vote_count=200, variance=5.0),
        ]
        collapsed = lmarena.collapse_slices(rows)
        self.assertEqual({r["model_name"] for r in collapsed}, {"model-a", "model-b"})


if __name__ == "__main__":
    unittest.main()
