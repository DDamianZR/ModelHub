"""The exchange-rate source and the plans validator, from fixtures: no network."""
import json
from datetime import date
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
    base = {"id": "p1", "name": "Plan One", "price_per_month": 399, "currency": "MXN",
            "region": "MX", "model_ids": ["m-a"],
            "source_url": "https://example.org/plan", "verified_at": "2026-11-09"}
    return {**base, **overrides}


TODAY = date(2026, 11, 12)


class PlanValidatorTests(unittest.TestCase):
    def check(self, *entries, today=TODAY, **top):
        return plans.validate({"plans": list(entries), **top}, {"m-a", "m-b"}, today)

    def test_a_complete_entry_passes_and_an_empty_file_is_valid(self):
        checked = self.check(plan())
        self.assertEqual((len(checked.valid), checked.expired, checked.problems), (1, [], []))
        self.assertEqual(plans.validate({"plans": []}, set(), TODAY), ([], [], []))

    def test_an_entry_without_evidence_is_withheld(self):
        for override in ({"source_url": None}, {"source_url": "http://insecure.example"},
                         {"source_url": "https://"}, {"verified_at": None},
                         {"verified_at": "last week"}, {"verified_at": "20261109"}):
            with self.subTest(override=override):
                checked = self.check(plan(**override))
                self.assertEqual(checked.valid, [])
                self.assertTrue(checked.problems)

    def test_unknown_models_and_duplicates_are_withheld(self):
        self.assertEqual(self.check(plan(model_ids=["ghost"])).valid, [])
        self.assertEqual(self.check(plan(model_ids=["m-a", "m-a"])).valid, [])
        self.assertEqual(self.check(plan(model_ids=[])).valid, [])
        checked = self.check(plan(), plan(name="Other"))
        self.assertEqual(len(checked.valid), 1)
        self.assertIn("duplicate id", checked.problems[0])

    def test_fee_is_a_number_or_null_never_a_string_or_negative(self):
        self.assertEqual(len(self.check(plan(price_per_month=None, currency=None)).valid), 1)
        self.assertEqual(len(self.check(plan(price_per_month=0)).valid), 1)
        for fee in ("399", -1, True):
            with self.subTest(fee=fee):
                self.assertEqual(self.check(plan(price_per_month=fee)).valid, [])

    def test_a_fee_carries_its_currency_and_its_country(self):
        self.assertEqual(len(self.check(plan(price_per_month=20, currency="USD", region="US")).valid), 1)
        for override in ({"currency": None}, {"currency": "EUR"}, {"currency": "mxn"},
                         {"region": None}, {"region": "Mexico"}, {"region": "mx"}, {"region": "M1"},
                         # A currency with no fee is a half-filled entry, not a free plan.
                         {"price_per_month": None}):
            with self.subTest(override=override):
                checked = self.check(plan(**override))
                self.assertEqual(checked.valid, [])
                self.assertTrue(checked.problems)

    def test_one_bad_entry_does_not_take_the_good_ones_down(self):
        checked = self.check(plan(id="good"), plan(id="bad", source_url=None))
        self.assertEqual([p["id"] for p in checked.valid], ["good"])
        self.assertEqual(len(checked.problems), 1)


class PlanExpiryTests(unittest.TestCase):
    def check(self, *entries, today=TODAY, **top):
        return plans.validate({"plans": list(entries), **top}, {"m-a", "m-b"}, today)

    def test_ninety_days_is_shown_and_ninety_one_is_set_aside(self):
        # 2026-08-14 is 90 days before 2026-11-12; 2026-08-13 is 91.
        self.assertEqual((TODAY - date(2026, 8, 14)).days, 90)
        at_limit = self.check(plan(verified_at="2026-08-14"))
        self.assertEqual((len(at_limit.valid), at_limit.expired), (1, []))
        past = self.check(plan(verified_at="2026-08-13"))
        self.assertEqual(past.valid, [])
        self.assertEqual(past.problems, [])
        self.assertEqual([p["id"] for p in past.expired], ["p1"])

    def test_an_expired_entry_is_named_with_its_date_and_never_with_its_price(self):
        expired = self.check(plan(verified_at="2026-01-01")).expired[0]
        self.assertEqual(
            expired,
            {"id": "p1", "name": "Plan One", "region": "MX",
             "source_url": "https://example.org/plan", "verified_at": "2026-01-01"},
        )

    def test_the_same_file_expires_by_itself_as_days_pass(self):
        entry = plan(verified_at="2026-11-09")
        self.assertEqual(len(self.check(entry, today=date(2027, 2, 7)).valid), 1)   # day 90
        self.assertEqual(len(self.check(entry, today=date(2027, 2, 8)).expired), 1)  # day 91

    def test_the_file_can_set_its_own_limit_and_a_bad_one_falls_back_to_the_default(self):
        entry = plan(verified_at="2026-10-01")  # 42 days before TODAY
        self.assertEqual(len(self.check(entry, max_age_days=30).expired), 1)
        self.assertEqual(len(self.check(entry, max_age_days=60).valid), 1)
        for bad in (0, -5, "30", True, None, 1.5):
            with self.subTest(bad=bad):
                self.assertEqual(plans.max_age_days({"max_age_days": bad}), plans.DEFAULT_MAX_AGE_DAYS)

    def test_a_date_in_the_future_is_a_problem_not_a_plan_that_never_expires(self):
        checked = self.check(plan(verified_at="2027-11-09"))
        self.assertEqual((checked.valid, checked.expired), ([], []))
        self.assertIn("future", checked.problems[0])

    def test_a_faulty_entry_is_a_problem_even_when_it_is_also_old(self):
        checked = self.check(plan(verified_at="2026-01-01", source_url=None))
        self.assertEqual((checked.valid, checked.expired), ([], []))
        self.assertEqual(len(checked.problems), 1)

    def test_the_published_document_states_the_limit_and_lists_both(self):
        checked = self.check(plan(id="fresh"), plan(id="old", verified_at="2026-01-01"))
        published = plans.document(checked, "2026-11-12", 90)
        self.assertEqual(published["meta"]["max_age_days"], 90)
        self.assertEqual([p["id"] for p in published["plans"]], ["fresh"])
        self.assertEqual([p["id"] for p in published["expired"]], ["old"])


class CommittedPlansTests(unittest.TestCase):
    """CI runs the same validator over what is committed, as the enrichment audit does."""

    def test_committed_plans_have_no_problems(self):
        root = Path(__file__).resolve().parents[1]
        models = json.loads((root / "data" / "models.json").read_text(encoding="utf-8"))
        ids = {m["id"] for m in models["models"]}
        published = json.loads((root / "data" / "plans.json").read_text(encoding="utf-8"))
        # Judged on the day the output was generated: an entry that has expired since is
        # the next ingest's to set aside, not a reason for an unrelated change to fail CI.
        generated = date.fromisoformat(published["meta"]["generated_at"][:10])
        checked = plans.validate(plans.load(root / "config" / "plans.json"), ids, generated)
        self.assertEqual(checked.problems, [])
        self.assertEqual(published["plans"], checked.valid)
        # Absent in a file written before plans could expire.
        self.assertEqual(published.get("expired", []), checked.expired)


if __name__ == "__main__":
    unittest.main()
