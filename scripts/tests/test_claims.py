"""Vendor claims: never scored, and never credited to the wrong row.

The anti-bias rules have said "vendor_claim is stored and displayed, never scored" since the
beginning. It was true by construction and untested, which is the state a rule quietly stops
being in. These tests make the two failure modes loud: a claim leaking into a score, and a
number being attributed to a benchmark or a model it did not come from.
"""
from __future__ import annotations

import json
import unittest

from scripts.enrich.claims import compare
from scripts.enrich.tables import extract_tables, find_rows, normalise_label, parse_value
from scripts.ingest.common import DATA
from scripts.ingest.composite import build_models

# The real shape, trimmed: a header row of model names and data rows of benchmark + values.
POST = """
<table>
  <thead><tr><td><strong>Eval</strong></td><td>GPT&#8209;5.6 Sol</td><td>Claude Fable 5</td></tr></thead>
  <tbody>
    <tr><td>GPQA Diamond</td><td>94.6%</td><td>92.6%</td></tr>
    <tr><td>FrontierMath Tier 1-3 (v2)</td><td>89%</td><td>87%</td></tr>
    <tr><td>Toolathlon</td><td>58%</td><td>&#8212;</td></tr>
  </tbody>
</table>
<p>An unrelated paragraph that happens to mention 94.6 and 74.9 in prose.</p>
"""


class NeverScored(unittest.TestCase):
    def test_a_vendor_claim_row_cannot_change_any_score(self):
        cached = lambda name: json.loads(
            (DATA / "cache" / f"{name}.json").read_text(encoding="utf-8")
        )["payload"]
        epoch, livebench, arena = cached("epoch"), cached("livebench"), cached("lmarena")

        def build(extra_source_type=None):
            scores = {
                key: [dict(entry) for entry in rows]
                for key, rows in epoch["scores"].items()
            }
            if extra_source_type:
                # Inject an absurd vendor claim on a real model and benchmark. If the filter
                # ever breaks, this moves a published score by a wide margin.
                for key, rows in scores.items():
                    if rows:
                        poisoned = dict(rows[0])
                        poisoned["value"] = 100.0
                        poisoned["source_type"] = extra_source_type
                        rows.append(poisoned)
                        break
            models, _, _, _ = build_models(
                registry=dict(epoch["registry"]), epoch_scores=scores,
                livebench_scores=dict(livebench["scores"]), arena_text=dict(arena["text"]),
                arena_vision=dict(arena["vision"]), arena_snapshot=arena.get("snapshot"),
                vision_snapshot=arena.get("vision_snapshot"),
            )
            return {m["id"]: m for m in models}

        before = build()
        after = build("vendor_claim")

        self.assertEqual(set(before), set(after))
        for model_id in before:
            self.assertEqual(
                before[model_id]["composite"], after[model_id]["composite"],
                f"{model_id} moved when a vendor_claim was injected",
            )
            self.assertEqual(
                before[model_id]["category_scores"], after[model_id]["category_scores"]
            )


class CoOccurrence(unittest.TestCase):
    """A value must sit in the same row as its benchmark, not merely the same document."""

    def test_a_value_is_read_from_its_own_row_and_column(self):
        tables = extract_tables(POST)
        header, row = find_rows(tables[0], "GPQA Diamond")[0]

        self.assertEqual(normalise_label(header[1]), normalise_label("GPT-5.6 Sol"))
        self.assertEqual(parse_value(row[1]), 94.6)
        self.assertEqual(parse_value(row[2]), 92.6)

    def test_a_number_loose_in_prose_is_not_reachable(self):
        # 74.9 appears in the document and in no table row. A substring check over the page
        # would accept it; this extractor cannot see it at all.
        tables = extract_tables(POST)
        every_cell = [cell for table in tables for row in table for cell in row]
        self.assertNotIn("74.9", every_cell)
        self.assertNotIn("74.9%", every_cell)

    def test_an_unmeasured_cell_is_not_read_as_zero(self):
        tables = extract_tables(POST)
        _, row = find_rows(tables[0], "Toolathlon")[0]

        self.assertEqual(parse_value(row[1]), 58.0)
        self.assertIsNone(parse_value(row[2]), "an em dash is absence, not a result")

    def test_a_qualified_cell_is_refused_rather_than_stripped(self):
        # Reading 94.6 out of "94.6% (max effort)" would silently drop the configuration,
        # which is the qualifier the whole comparability rule turns on.
        self.assertIsNone(parse_value("94.6% (max effort)"))
        self.assertEqual(parse_value("94.6%"), 94.6)

    def test_script_contents_are_never_treated_as_table_cells(self):
        markup = '<script>var data = {"GPQA Diamond": 99.9};</script>' + POST
        tables = extract_tables(markup)
        _, row = find_rows(tables[0], "GPQA Diamond")[0]

        self.assertEqual(parse_value(row[1]), 94.6)


class Comparability(unittest.TestCase):
    def base(self, **overrides) -> dict:
        claim = {
            "model_id": "m",
            "benchmark_id": "gpqa_diamond",
            "value": 94.6,
            "stated_configuration": "GPT-5.6 Sol",
            "comparable_label": True,
            "not_comparable_reason": None,
            "_threshold": 0.10,
        }
        claim.update(overrides)
        return claim

    def test_a_different_measurement_never_produces_a_gap(self):
        # The case that made this rule earn its keep: FrontierMath Tier 1-3 at 85.3 against a
        # full-set score of 51.7 would publish a 65% gap out of a definitional mismatch.
        claim = compare(
            self.base(
                benchmark_id="frontiermath",
                value=85.3,
                comparable_label=False,
                not_comparable_reason="a tier subset, not the full set",
            ),
            {("m", "frontiermath"): {"value": 51.7, "variant": "xhigh"}},
        )

        self.assertEqual(claim["comparison"], "different_measurement")
        self.assertIsNone(claim["gap"])

    def test_a_configuration_mismatch_never_produces_a_gap(self):
        claim = compare(
            self.base(),
            {("m", "gpqa_diamond"): {"value": 88.0, "variant": "max"}},
        )

        self.assertEqual(claim["comparison"], "different_configuration")
        self.assertIsNone(claim["gap"])

    def test_a_matching_configuration_is_compared(self):
        claim = compare(
            self.base(stated_configuration="GPT-5.6 Sol max"),
            {("m", "gpqa_diamond"): {"value": 94.0, "variant": "max"}},
        )

        self.assertEqual(claim["comparison"], "comparable")
        self.assertLess(claim["gap"], 0.01)
        self.assertFalse(claim["gap_flagged"])

    def test_a_real_gap_is_flagged(self):
        claim = compare(
            self.base(value=95.0, stated_configuration="GPT-5.6 Sol max"),
            {("m", "gpqa_diamond"): {"value": 80.0, "variant": "max"}},
        )

        self.assertEqual(claim["comparison"], "comparable")
        self.assertTrue(claim["gap_flagged"])
        self.assertGreater(claim["gap"], 0.10)

    def test_a_claim_with_no_third_party_measurement_says_so(self):
        claim = compare(self.base(), {})

        self.assertEqual(claim["comparison"], "no_third_party_measurement")
        self.assertIsNone(claim["gap"])


class CommittedFile(unittest.TestCase):
    def test_every_published_claim_carries_a_url_and_a_date(self):
        path = DATA / "vendor_claims.json"
        if not path.exists():
            self.skipTest("no vendor_claims.json yet")
        payload = json.loads(path.read_text(encoding="utf-8"))

        for claim in payload["claims"]:
            self.assertTrue(claim["claim_url"], claim)
            self.assertTrue(claim["claim_date"], claim)
            self.assertEqual(claim["source_type"], "vendor_claim")
            # The row it was read from travels with it, so the extraction is checkable
            # against the page without re-running anything.
            self.assertTrue(claim["evidence_row"], claim)

    def test_no_gap_is_published_without_a_matching_configuration(self):
        path = DATA / "vendor_claims.json"
        if not path.exists():
            self.skipTest("no vendor_claims.json yet")
        payload = json.loads(path.read_text(encoding="utf-8"))

        for claim in payload["claims"]:
            if claim.get("gap") is not None:
                self.assertEqual(claim["comparison"], "comparable", claim)


if __name__ == "__main__":
    unittest.main()
