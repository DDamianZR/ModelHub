"""row_dates.py: dating LiveBench rows by when they appeared, for a snapshot that grows in
place. Pure functions over plain data, except apply(), whose cache writes are patched out.
"""
import unittest
from unittest import mock

from scripts.ingest import row_dates

SNAPSHOT = "2026-06-25"


def _scores(*keys):
    return {
        key: [{"benchmark_id": "livebench_math", "value": 50.0, "measured_at": SNAPSHOT}]
        for key in keys
    }


class StampTests(unittest.TestCase):
    def test_first_run_dates_every_row_by_the_snapshot(self):
        # With no record of when rows arrived there is no evidence for any later date.
        scores = _scores("a", "b")
        state = row_dates.stamp(scores, SNAPSHOT, None, "2026-09-29")
        self.assertEqual(state["rows"], {"a": SNAPSHOT, "b": SNAPSHOT})

    def test_a_row_added_to_the_same_snapshot_is_dated_by_the_run_that_saw_it(self):
        before = row_dates.stamp(_scores("a"), SNAPSHOT, None, "2026-07-27")
        scores = _scores("a", "b")
        after = row_dates.stamp(scores, SNAPSHOT, before, "2026-09-11")
        self.assertEqual(after["rows"], {"a": SNAPSHOT, "b": "2026-09-11"})
        self.assertEqual(scores["b"][0]["measured_at"], "2026-09-11")
        self.assertEqual(scores["a"][0]["measured_at"], SNAPSHOT)

    def test_a_known_row_keeps_its_date_on_later_runs(self):
        state = row_dates.stamp(_scores("a"), SNAPSHOT, None, "2026-07-27")
        state = row_dates.stamp(_scores("a", "b"), SNAPSHOT, state, "2026-09-11")
        state = row_dates.stamp(_scores("a", "b"), SNAPSHOT, state, "2026-09-20")
        self.assertEqual(state["rows"]["b"], "2026-09-11")

    def test_a_rescored_row_keeps_its_date(self):
        # A change in how the ingest averages a row must not pass for a new publication.
        state = row_dates.stamp(_scores("a"), SNAPSHOT, None, "2026-07-27")
        scores = _scores("a")
        scores["a"][0]["value"] = 51.0
        state = row_dates.stamp(scores, SNAPSHOT, state, "2026-09-11")
        self.assertEqual(state["rows"]["a"], SNAPSHOT)

    def test_a_new_snapshot_dates_every_row_by_its_own_date(self):
        old = row_dates.stamp(_scores("a"), SNAPSHOT, None, "2026-07-27")
        new = row_dates.stamp(_scores("a", "b"), "2026-10-15", old, "2026-10-16")
        self.assertEqual(new["rows"], {"a": "2026-10-15", "b": "2026-10-15"})
        self.assertEqual(new["snapshot"], "2026-10-15")

    def test_no_row_is_dated_before_its_snapshot(self):
        state = row_dates.stamp(_scores("a"), SNAPSHOT, None, "2026-07-27")
        state = row_dates.stamp(_scores("a", "b"), SNAPSHOT, state, "2026-01-01")
        self.assertEqual(state["rows"]["b"], SNAPSHOT)


class LatestTests(unittest.TestCase):
    def test_age_counts_from_the_last_row_published(self):
        state = {"snapshot": SNAPSHOT, "rows": {"a": SNAPSHOT, "b": "2026-09-23"}}
        self.assertEqual(row_dates.latest(state), "2026-09-23")

    def test_without_rows_it_falls_back_to_the_snapshot(self):
        self.assertEqual(row_dates.latest({"snapshot": SNAPSHOT, "rows": {}}), SNAPSHOT)


class ApplyTests(unittest.TestCase):
    def test_an_empty_payload_leaves_the_stored_state_alone(self):
        # Forgetting when rows were first seen would re-date all of them next time.
        with mock.patch.object(row_dates, "write_cache") as written:
            self.assertIsNone(row_dates.apply({"scores": {}, "snapshot": SNAPSHOT}, "2026-09-29"))
            self.assertIsNone(row_dates.apply({}, "2026-09-29"))
        written.assert_not_called()

    def test_a_payload_is_dated_against_the_stored_state_and_persisted(self):
        stored = {"snapshot": SNAPSHOT, "rows": {"a": SNAPSHOT}}
        payload = {"snapshot": SNAPSHOT, "scores": _scores("a", "b")}
        with mock.patch.object(row_dates, "read_cache", return_value=stored), \
                mock.patch.object(row_dates, "write_cache") as written:
            state = row_dates.apply(payload, "2026-09-29")
        self.assertEqual(state["rows"], {"a": SNAPSHOT, "b": "2026-09-29"})
        written.assert_called_once_with(row_dates.STATE, state)


if __name__ == "__main__":
    unittest.main()
