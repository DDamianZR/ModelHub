"""livebench.py release discovery and report_status.py failure rule, with no network.

The fetcher is replaced by a dict of canned bodies; a missing URL raises SourceError the
way a 404 does.
"""
import json
import pathlib
import tempfile
import unittest

from scripts.ingest.common import SourceError
from scripts.ingest.report_status import (
    apply_failure_rule, degrade_after_failures, describe_category_rule, explain_age)
from scripts.ingest.sources import livebench

SITE = livebench.SITE
BUNDLE = (
    'x=["2026-01-08","2026-06-25"];'
    'y=["20261014","20261025"];'
)
HTML = '<script src="./static/js/main.abc123.js"></script>'

V1_CATEGORIES = {"Reasoning": ["r1"], "Mathematics": ["m1"], "IF": ["i1"], "Coding": ["c1"]}
V1_TABLE = "model,r1,m1,i1,c1\nalpha-1,80,60,70,90\nbeta-2,10,20,30,40\ngamma-3,50,50,50,50\n"
V2_CATEGORIES = {"Reasoning": ["reasoning"], "Coding": ["coding"], "Browser": ["browser"]}
V2_TABLE = "model,reasoning,coding,browser\nalpha-1,81,20,99\n"


def _fetcher(files):
    def fetch(url, timeout=120):
        if url not in files:
            raise SourceError(f"{url}: HTTP Error 404: Not Found")
        body = files[url]
        return body if isinstance(body, bytes) else body.encode()
    return fetch


def _site(**extra):
    files = {
        f"{SITE}/": HTML,
        f"{SITE}/static/js/main.abc123.js": BUNDLE,
        f"{SITE}/v1/table_2026_06_25.csv": V1_TABLE,
        f"{SITE}/v1/categories_2026_06_25.json": json.dumps(V1_CATEGORIES),
        f"{SITE}/data/20261025/table.csv": V2_TABLE,
        f"{SITE}/data/20261025/categories.json": json.dumps(V2_CATEGORIES),
        f"{SITE}/data/20261014/table.csv": V2_TABLE,
        f"{SITE}/data/20261014/categories.json": json.dumps(V2_CATEGORIES),
    }
    files.update(extra)
    return files


class ParseReleases(unittest.TestCase):
    def test_both_generations_newest_first_with_their_own_paths(self):
        releases = livebench.parse_releases(BUNDLE)
        self.assertEqual([r["date"] for r in releases],
                         ["2026-10-25", "2026-10-14", "2026-06-25", "2026-01-08"])
        self.assertEqual(releases[0]["table"], f"{SITE}/data/20261025/table.csv")
        self.assertEqual(releases[2]["table"], f"{SITE}/v1/table_2026_06_25.csv")

    def test_missing_list_is_a_source_error(self):
        with self.assertRaises(SourceError):
            livebench.parse_releases("no dates here")


class Collect(unittest.TestCase):
    """Each category is decided on its own, from how its two newest releases compare."""

    MAX_DRIFT = 3.0

    def _collect(self, files=None, max_drift=None, min_common=1):
        return livebench.collect(_fetcher(files or _site()),
                                 max_drift=max_drift or self.MAX_DRIFT, min_common=min_common)

    def _by_cat(self, payload, key="alpha-1"):
        rows: dict[str, dict] = {}
        for r in payload["scores"][key]:
            kept = rows.get(r["category"])
            if kept is None or r["measured_at"] > kept["measured_at"]:
                rows[r["category"]] = r
        return rows

    def test_comparable_category_uses_newest_and_dates_it(self):
        payload = self._collect()
        rows = self._by_cat(payload)
        self.assertEqual((rows["reasoning"]["value"], rows["reasoning"]["measured_at"]), (81.0, "2026-10-25"))
        rule = payload["category_rule"]["reasoning"]
        self.assertEqual((rule["release"], rule["fallback"], rule["drift"], rule["common_models"]),
                         ("2026-10-25", True, 1.0, 1))

    def test_comparable_category_emits_both_releases_dated(self):
        rows = [(r["measured_at"], r["value"]) for r in self._collect()["scores"]["alpha-1"]
                if r["category"] == "reasoning"]
        self.assertEqual(sorted(rows), [("2026-06-25", 80.0), ("2026-10-25", 81.0)])

    def test_comparable_category_lets_an_absent_model_keep_its_older_dated_value(self):
        rows = self._by_cat(self._collect(), "beta-2")
        self.assertEqual((rows["reasoning"]["value"], rows["reasoning"]["measured_at"]), (10.0, "2026-06-25"))

    def test_non_comparable_category_comes_from_the_release_covering_more_models(self):
        payload = self._collect()
        rule = payload["category_rule"]["coding"]
        self.assertEqual((rule["release"], rule["fallback"], rule["drift"]), ("2026-06-25", False, 70.0))
        self.assertEqual(rule["reason"], "not_comparable_more_coverage_older")
        # One scale for the whole category: alpha takes the older value, not the newer one.
        self.assertEqual(self._by_cat(payload)["coding"]["value"], 90.0)
        self.assertEqual(self._by_cat(payload, "gamma-3")["coding"]["measured_at"], "2026-06-25")

    def test_non_comparable_tie_goes_to_the_newest_release(self):
        extra = ["beta-2,20,20,20", "gamma-3,20,20,20"]
        files = _site(**{f"{SITE}/data/20261025/table.csv": V2_TABLE + "\n".join(extra) + "\n"})
        rule = self._collect(files)["category_rule"]["coding"]
        self.assertEqual((rule["release"], rule["reason"]), ("2026-10-25", "not_comparable_more_coverage_newest"))

    def test_category_with_a_single_release_uses_it(self):
        payload = self._collect()
        rows = self._by_cat(payload)
        self.assertEqual((rows["math"]["value"], rows["math"]["measured_at"]), (60.0, "2026-06-25"))
        self.assertEqual(payload["category_rule"]["math"]["reason"], "single_release")
        self.assertEqual(payload["category_rule"]["instruction_following"]["release"], "2026-06-25")

    def test_a_release_republishing_the_same_suite_is_not_the_comparison(self):
        # 2026-10-14 carries the same suite as 2026-10-25 with an extra model; comparing against
        # it would show drift 0 and hide the change of suite against 2026-06-25.
        extra = "delta-4,5,5,5" + chr(10)
        files = _site(**{f"{SITE}/data/20261014/table.csv": V2_TABLE + extra})
        rule = self._collect(files)["category_rule"]["coding"]
        self.assertEqual((rule["release"], rule["drift"]), ("2026-06-25", 70.0))
        self.assertNotIn("delta-4", self._collect(files)["scores"])

    def test_too_few_common_models_leave_the_newest_release_alone(self):
        payload = self._collect(min_common=2)
        rule = payload["category_rule"]["reasoning"]
        self.assertEqual((rule["reason"], rule["fallback"], rule["common_models"]),
                         ("too_few_common_models", False, 1))
        self.assertNotIn("reasoning", self._by_cat(payload, "beta-2"))

    def test_threshold_decides_the_same_data(self):
        rule = self._collect(max_drift=80.0)["category_rule"]["coding"]
        self.assertEqual((rule["release"], rule["fallback"]), ("2026-10-25", True))

    def test_snapshot_is_the_newest_date_in_use(self):
        payload = self._collect()
        self.assertEqual(payload["snapshot"], "2026-10-25")
        self.assertNotIn("skipped_releases", payload)

    def test_unreadable_newest_release_is_reported_as_skipped(self):
        files = _site()
        del files[f"{SITE}/data/20261025/table.csv"]
        payload = self._collect(files)
        self.assertEqual(payload["snapshot"], "2026-10-14")
        self.assertEqual([s["date"] for s in payload["skipped_releases"]], ["2026-10-25"])

    def test_missing_files_fall_through_to_an_older_release(self):
        files = _site()
        for key in [k for k in files if "/data/" in k]:
            del files[key]
        payload = self._collect(files)
        self.assertEqual(payload["snapshot"], "2026-06-25")
        self.assertTrue(all(s["reason"].startswith("unreadable")
                            for s in payload["skipped_releases"]))

    def test_nothing_scoreable_raises_so_the_cache_serves(self):
        files = _site()
        for key in [k for k in files if "table" in k]:
            del files[key]
        with self.assertRaises(SourceError):
            self._collect(files)

    def test_threshold_is_read_from_config(self):
        self.assertEqual(livebench.load_max_drift(), 3.0)
        self.assertGreaterEqual(livebench.load_min_common(), 1)


class FailureRule(unittest.TestCase):
    def _ages(self):
        return {"livebench": {"freshness": "fresh", "age_days": 17}}

    def test_streak_at_threshold_degrades_despite_fresh_age(self):
        ages = self._ages()
        changed = apply_failure_rule({"livebench": {"consecutive_failures": 3}}, ages, 3)
        self.assertEqual(changed, ["livebench"])
        self.assertEqual(ages["livebench"]["freshness"], "degraded")
        self.assertEqual(ages["livebench"]["freshness_by_age"], "fresh")

    def test_streak_below_threshold_is_untouched(self):
        ages = self._ages()
        self.assertEqual(apply_failure_rule({"livebench": {"consecutive_failures": 2}}, ages, 3), [])
        self.assertEqual(ages["livebench"]["freshness"], "fresh")

    def test_idempotent_and_ignores_sources_without_an_age(self):
        ages = self._ages()
        sources = {"livebench": {"consecutive_failures": 9}, "epoch": {"consecutive_failures": 9}}
        apply_failure_rule(sources, ages, 3)
        self.assertEqual(apply_failure_rule(sources, ages, 3), [])

    def test_threshold_comes_from_config_with_a_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "sources.json"
            path.write_text('{"degrade_after_consecutive_failures": 5}', encoding="utf-8")
            self.assertEqual(degrade_after_failures(path), 5)
            path.write_text("{}", encoding="utf-8")
            self.assertEqual(degrade_after_failures(path), 3)
            self.assertEqual(degrade_after_failures(pathlib.Path(tmp) / "missing.json"), 3)


class Explain(unittest.TestCase):
    def test_a_quiet_source_is_not_blamed_on_skipped_releases(self):
        text = explain_age("livebench", {"date": "2026-06-25"}, {})
        self.assertIn("nothing newer", text)

    def test_skipped_releases_are_named_with_their_reason(self):
        text = explain_age("livebench", {"date": "2026-06-25"},
                           {"skipped_releases": [{"date": "2026-10-25", "reason": "unreadable"}]})
        self.assertIn("passed over", text)
        self.assertIn("2026-10-25 (unreadable)", text)

    def test_category_rule_lines_state_release_and_drift(self):
        lines = describe_category_rule("livebench", {"category_rule": {
            "coding": {"release": "2026-06-25", "reason": "not_comparable_more_coverage_older",
                       "drift": 17.9, "common_models": 15}}})
        self.assertEqual(len(lines), 1)
        self.assertIn("coding from 2026-06-25", lines[0])
        self.assertIn("drift 17.9 over 15 models", lines[0])


if __name__ == "__main__":
    unittest.main()
