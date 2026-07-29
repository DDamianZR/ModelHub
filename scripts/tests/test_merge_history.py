"""The two anti-duplication defences in merge_history, and the dedup between them.

The guard was rewritten when the time series stopped being Arena-only. These tests pin the
behaviour it had to keep and the behaviour it had to gain, because the failure mode is
silent: a guard that no longer fires looks exactly like a guard with nothing to catch.
"""
from __future__ import annotations

import unittest

from scripts.ingest.run import merge_history


def row(model: str, benchmark: str, day: str, value: float = 1.0) -> dict:
    return {"model_id": model, "benchmark_id": benchmark, "date": day, "value": value}


class DuplicationGuard(unittest.TestCase):
    def test_rejects_a_snapshot_shipping_several_rows_per_model(self):
        # The original failure: an upstream snapshot with ~3 rows per model, which rendered
        # three different rank-1 models on the home page.
        incoming = [
            row(m, "lmarena_text_overall", "2026-07-20", v)
            for m in ("a", "b", "c")
            for v in (1400, 1401, 1402)
        ]
        self.assertEqual(merge_history([], incoming, set()), [])

    def test_a_clean_snapshot_survives(self):
        incoming = [row(m, "lmarena_text_overall", "2026-07-22") for m in ("a", "b", "c")]
        self.assertEqual(len(merge_history([], incoming, set())), 3)

    def test_many_benchmarks_on_one_date_are_not_duplication(self):
        # A model legitimately has one row per benchmark, one per category and one for the
        # composite on the same date. Counted per model that is 16 rows and reads as 16x
        # duplication; counted per benchmark it is exactly one reading each.
        incoming = [
            row(m, b, "2026-07-28")
            for m in ("a", "b", "c")
            for b in (
                "frontiermath", "livebench_math", "gpqa_diamond", "swe_bench_verified",
                "category:math", "category:reasoning", "category:coding", "composite",
            )
        ]
        merged = merge_history([], incoming, set())
        self.assertEqual(len(merged), 24)

    def test_one_duplicated_benchmark_rejects_the_whole_date(self):
        # Mixed evidence on one date: the composite is clean but the Arena rows are tripled.
        # The date goes, because a snapshot that is wrong about one thing is not trustworthy
        # about the rest of what it published that day.
        incoming = [row(m, "composite", "2026-07-20") for m in ("a", "b", "c")] + [
            row(m, "lmarena_text_overall", "2026-07-20", v)
            for m in ("a", "b", "c")
            for v in (1400, 1401, 1402)
        ]
        self.assertEqual(merge_history([], incoming, set()), [])

    def test_ratio_is_measured_before_deduplication(self):
        # Deduplicating first would collapse the incoming rows to one per model and make the
        # ratio structurally 1.0, so the guard could never fire again.
        incoming = [
            row("a", "lmarena_text_overall", "2026-07-20", v) for v in (1400, 1401, 1402)
        ]
        self.assertEqual(merge_history([], incoming, set()), [])


class RejectedDates(unittest.TestCase):
    def test_a_date_the_source_rejected_is_dropped_from_incoming_and_existing(self):
        existing = [row("a", "lmarena_text_overall", "2026-07-20")]
        incoming = [row("a", "lmarena_text_overall", "2026-07-21")]
        merged = merge_history(existing, incoming, {"2026-07-20", "2026-07-21"})
        self.assertEqual(merged, [])

    def test_purges_rows_earlier_runs_let_through(self):
        existing = [
            row("a", "lmarena_text_overall", "2026-07-20"),
            row("a", "lmarena_text_overall", "2026-07-22"),
        ]
        merged = merge_history(existing, [], {"2026-07-20"})
        self.assertEqual([r["date"] for r in merged], ["2026-07-22"])


class Deduplication(unittest.TestCase):
    def test_rerunning_the_same_day_is_idempotent(self):
        incoming = [row("a", "frontiermath", "2026-07-28", 38.2)]
        once = merge_history([], incoming, set())
        twice = merge_history(once, incoming, set())
        self.assertEqual(once, twice)

    def test_incoming_wins_over_a_stored_row_with_the_same_key(self):
        existing = [row("a", "frontiermath", "2026-07-28", 38.2)]
        incoming = [row("a", "frontiermath", "2026-07-28", 41.0)]
        merged = merge_history(existing, incoming, set())
        self.assertEqual([r["value"] for r in merged], [41.0])

    def test_same_model_and_date_under_different_benchmarks_are_both_kept(self):
        incoming = [
            row("a", "frontiermath", "2026-07-28", 38.2),
            row("a", "category:math", "2026-07-28", 64.8),
        ]
        merged = merge_history([], incoming, set())
        self.assertEqual(len(merged), 2)

    def test_output_is_sorted_by_model_then_benchmark_then_date(self):
        incoming = [
            row("b", "frontiermath", "2026-01-01"),
            row("a", "livebench_math", "2026-01-01"),
            row("a", "frontiermath", "2026-02-01"),
            row("a", "frontiermath", "2026-01-01"),
        ]
        merged = merge_history([], incoming, set())
        self.assertEqual(
            [(r["model_id"], r["benchmark_id"], r["date"]) for r in merged],
            [
                ("a", "frontiermath", "2026-01-01"),
                ("a", "frontiermath", "2026-02-01"),
                ("a", "livebench_math", "2026-01-01"),
                ("b", "frontiermath", "2026-01-01"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
