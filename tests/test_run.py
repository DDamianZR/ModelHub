"""run.py: history merging and snapshot-age thresholds. Both are pure functions over
plain data, so no network or filesystem access is needed to exercise the rules that
protect the time series from corruption.
"""
import unittest
from datetime import date, timedelta

from scripts.ingest.run import (
    DEGRADED_CADENCE_MULTIPLE,
    FALLBACK_CADENCE_DAYS,
    WARN_CADENCE_MULTIPLE,
    merge_history,
    snapshot_age,
)


def _point(model="m1", benchmark="b1", day="2026-08-20", value=1500.0, variant="high"):
    return {"model_id": model, "benchmark_id": benchmark, "date": day, "value": value,
            "variant": variant}


class MergeHistoryTests(unittest.TestCase):
    def test_rerunning_the_same_day_is_idempotent(self):
        rows = [_point()]
        once = merge_history(rows, [], set(), None)
        twice = merge_history(once, rows, set(), {("m1", "b1")})
        self.assertEqual(twice, once)
        self.assertEqual(len(twice), 1)

    def test_variant_change_restarts_the_series(self):
        existing = [_point(day="2026-08-01", variant="high"),
                    _point(day="2026-08-05", variant="high")]
        incoming = [_point(day="2026-08-20", value=1600.0, variant="max")]
        merged = merge_history(existing, incoming, set(), {("m1", "b1")})
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["date"], "2026-08-20")
        self.assertEqual(merged[0]["variant"], "max")

    def test_rejected_date_is_purged_from_existing_history(self):
        existing = [_point(day="2026-08-01"), _point(day="2026-08-05")]
        merged = merge_history(existing, [], {"2026-08-01"}, None)
        self.assertEqual([r["date"] for r in merged], ["2026-08-05"])

    def test_series_no_longer_measured_is_dropped_when_active_series_is_known(self):
        existing = [_point()]
        merged = merge_history(existing, [], set(), active_series=set())
        self.assertEqual(merged, [])

    def test_stale_points_survive_when_the_source_itself_failed(self):
        """active_series=None means the source failed this run - there is nothing to
        compare against, and keeping stale points beats deleting good ones."""
        existing = [_point()]
        merged = merge_history(existing, [], set(), active_series=None)
        self.assertEqual(len(merged), 1)

    def test_duplicated_incoming_snapshot_is_excluded(self):
        """Measured on the RAW incoming rows before dedup - deduplicating first would
        make the ratio structurally 1.0 and the guard would never fire."""
        incoming = [_point(day="2026-08-20", value=v) for v in (1500.0, 1501.0, 1502.0)]
        merged = merge_history([], incoming, set(), None)
        self.assertEqual(merged, [])

    def test_clean_incoming_snapshot_is_kept(self):
        incoming = [_point(model="m1"), _point(model="m2")]
        merged = merge_history([], incoming, set(), None)
        self.assertEqual(len(merged), 2)


class SnapshotAgeTests(unittest.TestCase):
    def test_thresholds_derive_from_declared_cadence_not_a_fixed_number(self):
        result = snapshot_age("2020-01-01", cadence_days=4)
        self.assertEqual(result["cadence_days"], 4)
        self.assertEqual(result["warn_days"], 4 * WARN_CADENCE_MULTIPLE)
        self.assertEqual(result["degraded_days"], 4 * DEGRADED_CADENCE_MULTIPLE)

    def test_fresh_inside_the_warn_window(self):
        recent = (date.today() - timedelta(days=1)).isoformat()
        self.assertEqual(snapshot_age(recent, cadence_days=4)["freshness"], "fresh")

    def test_aging_at_the_warn_boundary(self):
        boundary = (date.today() - timedelta(days=4 * WARN_CADENCE_MULTIPLE)).isoformat()
        self.assertEqual(snapshot_age(boundary, cadence_days=4)["freshness"], "aging")

    def test_degraded_at_the_degraded_boundary(self):
        boundary = (date.today() - timedelta(days=4 * DEGRADED_CADENCE_MULTIPLE)).isoformat()
        self.assertEqual(snapshot_age(boundary, cadence_days=4)["freshness"], "degraded")

    def test_missing_snapshot_is_unknown(self):
        self.assertEqual(snapshot_age(None, cadence_days=4)["freshness"], "unknown")

    def test_missing_cadence_falls_back_to_the_default(self):
        result = snapshot_age("2020-01-01", cadence_days=None)
        self.assertEqual(result["cadence_days"], FALLBACK_CADENCE_DAYS)


if __name__ == "__main__":
    unittest.main()
