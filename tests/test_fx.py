"""The exchange-rate source and the plans validator, from fixtures: no network."""
import json
import unittest
from pathlib import Path
from unittest import mock

from scripts.ingest import plans
from scripts.ingest.common import SourceError
from scripts.ingest.sources import fx

GOOD = {"amount": 1.0, "base": "USD", "date": "2026-11-06", "rates": {"MXN": 18.704}}


class FxParseTests(unittest.TestCase):
    def test_reads_the_rate_and_its_own_date(self):
        self.assertEqual(
            fx.parse(GOOD),
            {"base": "USD", "date": "2026-11-06", "rates": {"MXN": 18.704}},
        )

    def test_refuses_what_would_turn_prices_into_zero_or_nothing(self):
        for rates in ({"MXN": 0}, {"MXN": -3.0}, {"MXN": None}, {"MXN": "18.7"},
                      {"MXN": True}, {"MXN": float("inf")}, {"MXN": float("nan")},
                      {}, None):
            with self.subTest(rates=rates), self.assertRaises(SourceError):
                fx.parse({**GOOD, "rates": rates})

    def test_refuses_the_wrong_base_or_a_bad_date(self):
        with self.assertRaises(SourceError):
            fx.parse({**GOOD, "base": "EUR"})
        with self.assertRaises(SourceError):
            fx.parse({**GOOD, "date": "yesterday"})
        with self.assertRaises(SourceError):
            fx.parse([GOOD])

    def test_a_failed_fetch_is_a_source_error_not_a_crash(self):
        with mock.patch.object(fx, "fetch_json", return_value={"message": "not found"}):
            with self.assertRaises(SourceError):
                fx.collect()

    def test_document_says_what_the_number_is(self):
        out = fx.document(fx.parse(GOOD), "2026-11-09")
        self.assertFalse(out["meta"]["in_composite"])
        self.assertIn("not a bank", out["meta"]["kind"])
        self.assertEqual(out["rates"], {"MXN": 18.704})
        self.assertEqual(out["date"], "2026-11-06")


def plan(**overrides):
    base = {"id": "p1", "name": "Plan One", "price_usd_per_month": 20,
            "model_ids": ["m-a"], "source_url": "https://example.org/plan",
            "verified_at": "2026-11-09"}
    return {**base, **overrides}


class PlanValidatorTests(unittest.TestCase):
    def check(self, *entries):
        return plans.validate({"plans": list(entries)}, {"m-a", "m-b"})

    def test_a_complete_entry_passes_and_an_empty_file_is_valid(self):
        valid, problems = self.check(plan())
        self.assertEqual((len(valid), problems), (1, []))
        self.assertEqual(plans.validate({"plans": []}, set()), ([], []))

    def test_an_entry_without_evidence_is_withheld(self):
        for override in ({"source_url": None}, {"source_url": "http://insecure.example"},
                         {"source_url": "https://"}, {"verified_at": None},
                         {"verified_at": "last week"}, {"verified_at": "20261109"}):
            with self.subTest(override=override):
                valid, problems = self.check(plan(**override))
                self.assertEqual(valid, [])
                self.assertTrue(problems)

    def test_unknown_models_and_duplicates_are_withheld(self):
        self.assertEqual(self.check(plan(model_ids=["ghost"]))[0], [])
        self.assertEqual(self.check(plan(model_ids=["m-a", "m-a"]))[0], [])
        self.assertEqual(self.check(plan(model_ids=[]))[0], [])
        valid, problems = self.check(plan(), plan(name="Other"))
        self.assertEqual(len(valid), 1)
        self.assertIn("duplicate id", problems[0])

    def test_fee_is_a_number_or_null_never_a_string_or_negative(self):
        self.assertEqual(len(self.check(plan(price_usd_per_month=None))[0]), 1)
        for fee in ("20", -1, True):
            with self.subTest(fee=fee):
                self.assertEqual(self.check(plan(price_usd_per_month=fee))[0], [])

    def test_one_bad_entry_does_not_take_the_good_ones_down(self):
        valid, problems = self.check(plan(id="good"), plan(id="bad", source_url=None))
        self.assertEqual([p["id"] for p in valid], ["good"])
        self.assertEqual(len(problems), 1)


class CommittedPlansTests(unittest.TestCase):
    """CI runs the same validator over what is committed, as the enrichment audit does."""

    def test_committed_plans_have_no_problems(self):
        root = Path(__file__).resolve().parents[1]
        models = json.loads((root / "data" / "models.json").read_text(encoding="utf-8"))
        ids = {m["id"] for m in models["models"]}
        valid, problems = plans.validate(plans.load(root / "config" / "plans.json"), ids)
        self.assertEqual(problems, [])
        published = json.loads((root / "data" / "plans.json").read_text(encoding="utf-8"))
        self.assertEqual(published["plans"], valid)


if __name__ == "__main__":
    unittest.main()
