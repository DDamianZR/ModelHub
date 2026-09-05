"""lmarena.collapse_slices - the mislabelled-slice filter, and the duplication guard it
feeds. Verified 2026-07-28 against the last clean snapshot: max vote_count gives 0.80
mean rating drift, first-row or max-rating give 11.94 (see the project notes). This module
fixes that behaviour so a refactor can't silently swap it back.

Also covers the /rows "latest" fallback (_rows_all, _fetch_rows_page,
_clean_snapshot_via_latest, and _clean_snapshot's fall-through from /filter to it). That
path exists specifically to keep the site running while /filter 500s on this dataset, which
is the exact failure mode this pipeline lived with for 12 consecutive runs - it needs
coverage that does not depend on /filter staying broken (or staying fixed) to exercise it.
"""
import unittest
from unittest import mock

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


def _page(total, n):
    return {"num_rows_total": total, "rows": [{"row": {"i": i}} for i in range(n)]}


def _cat_page(total, categories):
    """A /rows page whose rows carry the given categories, in order."""
    return {
        "num_rows_total": total,
        "rows": [{"row": {"category": c}} for c in categories],
    }


class RowsAllTests(unittest.TestCase):
    def test_paginates_across_multiple_pages(self):
        # ROWS_PAGE is 100: a 150-row total needs a 100-row page and a 50-row page.
        with mock.patch.object(
            lmarena, "fetch_json", side_effect=[_page(150, 100), _page(150, 50)]
        ), mock.patch.object(lmarena.time, "sleep") as sleep_mock:
            rows = lmarena._rows_all("text", "latest")
        self.assertEqual(len(rows), 150)
        sleep_mock.assert_called_once()

    def test_stops_on_empty_page(self):
        with mock.patch.object(lmarena, "fetch_json", return_value=_page(999, 0)):
            rows = lmarena._rows_all("text", "latest")
        self.assertEqual(rows, [])

    def test_single_page_needs_no_pacing_delay(self):
        with mock.patch.object(
            lmarena, "fetch_json", return_value=_page(10, 10)
        ), mock.patch.object(lmarena.time, "sleep") as sleep_mock:
            rows = lmarena._rows_all("text", "latest")
        self.assertEqual(len(rows), 10)
        sleep_mock.assert_not_called()

    def test_stops_at_category_boundary_once_target_seen(self):
        """Mirrors the real 2026-08-29 shape: 'overall' fills three clean pages, then a
        fourth page mixes the tail of 'overall' with the start of 'chinese'. That page is
        where the boundary lives, so the fetch must stop there - 4 requests, not ~105."""
        pages = [
            _cat_page(10424, ["overall"] * 100),
            _cat_page(10424, ["overall"] * 100),
            _cat_page(10424, ["overall"] * 100),
            _cat_page(10424, ["overall"] * 95 + ["chinese"] * 5),
        ]
        with mock.patch.object(
            lmarena, "fetch_json", side_effect=pages
        ) as fetch_mock, mock.patch.object(lmarena.time, "sleep"):
            rows = lmarena._rows_all("text", "latest", stop_after_category="overall")
        self.assertEqual(fetch_mock.call_count, 4)
        self.assertEqual(len(rows), 400)
        self.assertEqual(sum(1 for r in rows if r["category"] == "overall"), 395)

    def test_exact_page_boundary_loses_no_rows(self):
        """The boundary can land exactly on a page edge instead of mid-page - the block
        before it (400 rows) must still come back whole."""
        pages = [
            _cat_page(10424, ["overall"] * 100),
            _cat_page(10424, ["overall"] * 100),
            _cat_page(10424, ["overall"] * 100),
            _cat_page(10424, ["overall"] * 100),
            _cat_page(10424, ["chinese"] * 100),
        ]
        with mock.patch.object(
            lmarena, "fetch_json", side_effect=pages
        ) as fetch_mock, mock.patch.object(lmarena.time, "sleep"):
            rows = lmarena._rows_all("text", "latest", stop_after_category="overall")
        self.assertEqual(fetch_mock.call_count, 5)
        self.assertEqual(sum(1 for r in rows if r["category"] == "overall"), 400)

    def test_reordered_dataset_does_not_stop_before_target_seen(self):
        """If the target category isn't first, a page whose category differs from it must
        NOT trigger a stop before the target has ever been seen - otherwise this would
        stop on page 1 of a dataset that simply starts with something else."""
        pages = [
            _cat_page(300, ["chinese"] * 100),
            _cat_page(300, ["overall"] * 100),
            _cat_page(300, ["coding"] * 100),
        ]
        with mock.patch.object(
            lmarena, "fetch_json", side_effect=pages
        ) as fetch_mock, mock.patch.object(lmarena.time, "sleep"):
            rows = lmarena._rows_all("text", "latest", stop_after_category="overall")
        self.assertEqual(fetch_mock.call_count, 3)
        self.assertEqual(len(rows), 300)

    def test_exhausts_without_boundary_returns_full_traversal(self):
        """If 'overall' never gives way to another category before the split ends, there
        is no boundary to find. This must behave exactly like a full pass - same request
        count, same rows - never a silent truncation."""
        pages = [
            _cat_page(250, ["overall"] * 100),
            _cat_page(250, ["overall"] * 100),
            _cat_page(250, ["overall"] * 50),
        ]
        with mock.patch.object(
            lmarena, "fetch_json", side_effect=pages
        ) as fetch_mock, mock.patch.object(lmarena.time, "sleep"):
            rows = lmarena._rows_all("text", "latest", stop_after_category="overall")
        self.assertEqual(fetch_mock.call_count, 3)
        self.assertEqual(len(rows), 250)


class FetchRowsPageTests(unittest.TestCase):
    def test_retries_transient_status_then_succeeds(self):
        attempts = []

        def flaky(url):
            attempts.append(url)
            if len(attempts) < 3:
                raise lmarena.SourceError("http://x: HTTP Error 429: rate limited")
            return {"ok": True}

        with mock.patch.object(lmarena, "fetch_json", side_effect=flaky), \
                mock.patch.object(lmarena.time, "sleep") as sleep_mock:
            result = lmarena._fetch_rows_page("http://x")
        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(attempts), 3)
        self.assertEqual(sleep_mock.call_count, 2)

    def test_non_transient_status_raises_without_retrying(self):
        def broken(url):
            raise lmarena.SourceError("http://x: HTTP Error 500: Internal Server Error")

        with mock.patch.object(lmarena, "fetch_json", side_effect=broken) as fetch_mock, \
                mock.patch.object(lmarena.time, "sleep") as sleep_mock:
            with self.assertRaises(lmarena.SourceError):
                lmarena._fetch_rows_page("http://x")
        self.assertEqual(fetch_mock.call_count, 1)
        sleep_mock.assert_not_called()

    def test_exhausts_retries_and_raises(self):
        def always_429(url):
            raise lmarena.SourceError("http://x: HTTP Error 429: rate limited")

        with mock.patch.object(lmarena, "fetch_json", side_effect=always_429) as fetch_mock, \
                mock.patch.object(lmarena.time, "sleep"):
            with self.assertRaises(lmarena.SourceError):
                lmarena._fetch_rows_page("http://x")
        self.assertEqual(fetch_mock.call_count, lmarena.ROWS_RETRIES + 1)


class CleanSnapshotViaLatestTests(unittest.TestCase):
    def test_filters_to_overall_category_and_collapses_duplicates(self):
        rows = [
            _row("model-a", vote_count=100, variance=5.0),
            _row("model-a", vote_count=9000, variance=5.0),
            _row("model-b", vote_count=200, variance=5.0),
            _row("model-c", vote_count=50, variance=5.0, category="hard_prompt"),
        ]
        with mock.patch.object(lmarena, "_rows_all", return_value=rows):
            collapsed, snapshot, rejected = lmarena._clean_snapshot_via_latest("text")
        self.assertEqual({r["model_name"] for r in collapsed}, {"model-a", "model-b"})
        self.assertEqual(snapshot, "2026-08-21")
        self.assertEqual(rejected, [])

    def test_no_rows_raises(self):
        with mock.patch.object(lmarena, "_rows_all", return_value=[]):
            with self.assertRaises(lmarena.SourceError):
                lmarena._clean_snapshot_via_latest("text")

    def test_no_overall_rows_raises(self):
        rows = [_row("model-a", vote_count=100, variance=5.0, category="hard_prompt")]
        with mock.patch.object(lmarena, "_rows_all", return_value=rows):
            with self.assertRaises(lmarena.SourceError):
                lmarena._clean_snapshot_via_latest("text")

    def test_no_category_boundary_found_raises(self):
        """Every fetched row is 'overall' - _rows_all's early-stop contract never lies
        about this (see test_exhausts_without_boundary_returns_full_traversal), but this
        caller must independently refuse to trust the result rather than assume a short
        fetch was a valid early stop when it never actually saw the boundary."""
        rows = [_row(f"model-{i}", vote_count=100, variance=5.0) for i in range(5)]
        with mock.patch.object(lmarena, "_rows_all", return_value=rows):
            with self.assertRaises(lmarena.SourceError):
                lmarena._clean_snapshot_via_latest("text")


class CleanSnapshotFallbackTests(unittest.TestCase):
    def test_filter_success_reports_served_by_filter(self):
        with mock.patch.object(
            lmarena, "_clean_snapshot_via_filter", return_value=([], "2026-08-21", [])
        ), mock.patch.object(lmarena, "_clean_snapshot_via_latest") as latest_mock:
            rows, snapshot, rejected, served_by = lmarena._clean_snapshot("text")
        self.assertEqual(served_by, "filter")
        latest_mock.assert_not_called()

    def test_filter_failure_falls_through_to_rows_latest(self):
        with mock.patch.object(
            lmarena, "_clean_snapshot_via_filter",
            side_effect=lmarena.SourceError("lmarena/text: HTTP Error 500"),
        ), mock.patch.object(
            lmarena, "_clean_snapshot_via_latest", return_value=([], "2026-08-21", [])
        ):
            rows, snapshot, rejected, served_by = lmarena._clean_snapshot("text")
        self.assertEqual(served_by, "rows-latest")

    def test_both_endpoints_failing_raises_with_both_errors_named(self):
        with mock.patch.object(
            lmarena, "_clean_snapshot_via_filter",
            side_effect=lmarena.SourceError("filter broke"),
        ), mock.patch.object(
            lmarena, "_clean_snapshot_via_latest",
            side_effect=lmarena.SourceError("rows broke"),
        ):
            with self.assertRaises(lmarena.SourceError) as ctx:
                lmarena._clean_snapshot("text")
        self.assertIn("filter broke", str(ctx.exception))
        self.assertIn("rows broke", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
