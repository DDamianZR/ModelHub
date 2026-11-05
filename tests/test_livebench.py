"""livebench.py release discovery and report_status.py failure rule, with no network.

The fetcher is replaced by a dict of canned bodies; a missing URL raises SourceError the
way a 404 does.
"""
import json
import pathlib
import tempfile
import unittest

from scripts.ingest.common import SourceError
from scripts.ingest.report_status import apply_failure_rule, degrade_after_failures
from scripts.ingest.sources import livebench

SITE = livebench.SITE
BUNDLE = (
    'x=["2026-01-08","2026-06-25"];'
    'y=["20261014","20261025"];'
)
HTML = '<script src="./static/js/main.abc123.js"></script>'

V1_CATEGORIES = {"Reasoning": ["r1"], "Mathematics": ["m1"], "IF": ["i1"], "Coding": ["c1"]}
V1_TABLE = "model,r1,m1,i1,c1\nalpha-1,80,60,70,90\n"
V2_CATEGORIES = {"Reasoning": ["reasoning"], "Coding": ["coding"], "Browser": ["browser"]}
V2_TABLE = "model,reasoning,coding,browser\nalpha-1,99,99,99\n"


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
    """Per category, the newest release that publishes its suite counts."""

    def _by_cat(self, payload, key="alpha-1"):
        return {r["category"]: r for r in payload["scores"][key]}

    def test_each_category_comes_from_its_newest_release_with_that_suite(self):
        payload = livebench.collect(_fetcher(_site()), fallback=False)
        rows = self._by_cat(payload)
        self.assertEqual(set(rows), {"reasoning", "coding", "math", "instruction_following"})
        self.assertEqual((rows["reasoning"]["value"], rows["reasoning"]["measured_at"]), (99.0, "2026-10-25"))
        self.assertEqual((rows["coding"]["value"], rows["coding"]["measured_at"]), (99.0, "2026-10-25"))
        self.assertEqual((rows["math"]["value"], rows["math"]["measured_at"]), (60.0, "2026-06-25"))
        self.assertEqual(rows["instruction_following"]["measured_at"], "2026-06-25")
        self.assertEqual(payload["snapshot"], "2026-10-25")
        self.assertEqual(payload["releases_used"]["math"], "2026-06-25")
        self.assertNotIn("skipped_releases", payload)

    def test_strict_leaves_a_model_absent_from_the_newer_release_without_that_category(self):
        files = _site(**{
            f"{SITE}/v1/table_2026_06_25.csv": V1_TABLE + "beta-2,10,20,30,40\n"})
        rows = self._by_cat(livebench.collect(_fetcher(files), fallback=False), "beta-2")
        self.assertEqual(set(rows), {"math", "instruction_following"})

    def test_fallback_carries_an_older_value_dated_with_its_own_release(self):
        files = _site(**{
            f"{SITE}/v1/table_2026_06_25.csv": V1_TABLE + "beta-2,10,20,30,40\n"})
        rows = self._by_cat(livebench.collect(_fetcher(files), fallback=True), "beta-2")
        self.assertEqual(rows["reasoning"]["value"], 10.0)
        self.assertEqual(rows["reasoning"]["measured_at"], "2026-06-25")

    def test_unreadable_newest_release_is_reported_as_skipped(self):
        files = _site()
        del files[f"{SITE}/data/20261025/table.csv"]
        payload = livebench.collect(_fetcher(files), fallback=False)
        self.assertEqual(payload["snapshot"], "2026-10-14")
        self.assertEqual([s["date"] for s in payload["skipped_releases"]], ["2026-10-25"])

    def test_missing_files_fall_through_to_an_older_release(self):
        files = _site()
        for key in [k for k in files if "/data/" in k]:
            del files[key]
        payload = livebench.collect(_fetcher(files), fallback=False)
        self.assertEqual(payload["snapshot"], "2026-06-25")
        self.assertTrue(all(s["reason"].startswith("unreadable")
                            for s in payload["skipped_releases"]))

    def test_nothing_scoreable_raises_so_the_cache_serves(self):
        files = _site()
        for key in [k for k in files if "table" in k]:
            del files[key]
        with self.assertRaises(SourceError):
            livebench.collect(_fetcher(files))


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


if __name__ == "__main__":
    unittest.main()
