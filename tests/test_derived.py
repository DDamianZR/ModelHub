"""Derived metrics: price per point, Pareto frontier and the "best by" rules."""
import json
import unittest
from pathlib import Path

from scripts.ingest import derived

BLEND = {"input": 3, "output": 1}


def model(mid, composite, price_in, price_out, *, err=0.0, open_w=False,
          provisional=False, covered=5, cats=None, cat_err=None):
    return {
        "id": mid, "composite": composite, "composite_error": err,
        "provisional": provisional, "is_open_weights": open_w,
        "pricing": None if price_in is None else
        {"input_usd_per_m": price_in, "output_usd_per_m": price_out},
        "coverage": {"covered": covered},
        "category_scores": cats or {}, "category_errors": cat_err or {},
    }


class BlendTest(unittest.TestCase):
    def test_blend(self):
        self.assertAlmostEqual(derived.blended_price(
            {"input_usd_per_m": 1.0, "output_usd_per_m": 5.0}, BLEND), 2.0)

    def test_unpriced(self):
        self.assertIsNone(derived.blended_price(None, BLEND))
        self.assertIsNone(derived.blended_price({"input_usd_per_m": 1.0}, BLEND))


class ParetoTest(unittest.TestCase):
    def test_dominated_excluded(self):
        pts = {"a": (1.0, 80.0), "b": (2.0, 70.0), "c": (0.5, 60.0), "d": (3.0, 90.0)}
        self.assertEqual(derived.pareto_frontier(pts), {"a", "c", "d"})

    def test_identical_points_both_stay(self):
        self.assertEqual(derived.pareto_frontier({"a": (1, 70), "b": (1, 70)}), {"a", "b"})

    def test_same_price_lower_score_dominated(self):
        self.assertEqual(derived.pareto_frontier({"a": (1, 70), "b": (1, 60)}), {"a"})


class AnnotateTest(unittest.TestCase):
    def setUp(self):
        self.cfg = {"price_blend": BLEND, "ranked_only": True}
        self.models = [
            model("a", 80, 1, 1), model("b", 70, 2, 2),
            model("prov", 90, 0.1, 0.1, provisional=True, covered=3),
            model("free", 50, None, None),
        ]
        derived.annotate(self.models, self.cfg)
        self.by = {m["id"]: m for m in self.models}

    def test_ratio(self):
        self.assertAlmostEqual(self.by["a"]["price_per_composite_point"], 1 / 80, places=5)

    def test_flags(self):
        self.assertTrue(self.by["a"]["pareto_frontier"])
        self.assertFalse(self.by["b"]["pareto_frontier"])

    def test_not_evaluated_is_none(self):
        self.assertIsNone(self.by["prov"]["pareto_frontier"])
        self.assertIsNone(self.by["prov"]["price_per_composite_point"])
        self.assertIsNone(self.by["free"]["pareto_frontier"])

    def test_provisional_cannot_dominate(self):
        # The provisional model is cheaper and scores higher, yet "a" stays on the frontier.
        self.assertTrue(self.by["a"]["pareto_frontier"])


class BoardsTest(unittest.TestCase):
    def build(self, models, rules):
        cfg = {"price_blend": BLEND, "ranked_only": True, "rules": rules}
        derived.annotate(models, cfg)
        return {b["id"]: b for b in derived.build_boards(models, cfg)}

    def test_composite_and_open(self):
        ms = [model("a", 80, 5, 5), model("b", 70, 1, 1, open_w=True),
              model("c", 60, 0.2, 0.2, open_w=True)]
        out = self.build(ms, [
            {"id": "composite", "metric": "composite"},
            {"id": "open", "metric": "composite", "filter": {"is_open_weights": True}},
            {"id": "u1", "metric": "composite", "filter": {"max_blended_price": 1.0}},
            {"id": "cheap", "metric": "price", "filter": {"min_coverage": 4}},
        ])
        self.assertEqual(out["composite"]["winners"], ["a"])
        self.assertEqual(out["open"]["winners"], ["b"])
        self.assertEqual(out["u1"]["winners"], ["b"])
        self.assertEqual(out["cheap"]["winners"], ["c"])

    def test_ties_reported_not_broken(self):
        ms = [model("a", 80, 5, 5, err=2.0), model("b", 79, 5, 5, err=2.0),
              model("c", 70, 5, 5, err=2.0)]
        out = self.build(ms, [{"id": "composite", "metric": "composite"}])
        self.assertEqual(out["composite"]["winners"], ["a", "b"])
        self.assertTrue(out["composite"]["indistinguishable"])

    def test_provisional_excluded(self):
        ms = [model("a", 70, 1, 1), model("p", 99, 1, 1, provisional=True, covered=3)]
        out = self.build(ms, [{"id": "composite", "metric": "composite"}])
        self.assertEqual(out["composite"]["winners"], ["a"])

    def test_category_and_empty_pool(self):
        ms = [model("a", 70, 1, 1, cats={"math": 90}), model("b", 60, 1, 1, cats={"math": 95})]
        out = self.build(ms, [
            {"id": "math", "metric": "category:math"},
            {"id": "none", "metric": "composite", "filter": {"max_blended_price": 0.01}},
        ])
        self.assertEqual(out["math"]["winners"], ["b"])
        self.assertEqual(out["none"]["winners"], [])
        self.assertIsNone(out["none"]["value"])

    def test_unknown_metric_raises(self):
        with self.assertRaises(ValueError):
            self.build([model("a", 1, 1, 1)], [{"id": "x", "metric": "vibes"}])


class CommittedDataTest(unittest.TestCase):
    """data/best_by.json must be exactly what the rules give on data/models.json."""

    def test_boards_reproduce_from_committed_models(self):
        data = Path(__file__).resolve().parents[1] / "data"
        models = json.loads((data / "models.json").read_text(encoding="utf-8"))["models"]
        committed = json.loads((data / "best_by.json").read_text(encoding="utf-8"))
        self.assertEqual(derived.build_boards(models), committed["boards"])


if __name__ == "__main__":
    unittest.main()
