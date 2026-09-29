"""epoch.py: which name a registry row is shown under. Pure functions over plain rows; the
archive is replaced by a reader that returns canned CSV rows.
"""
import unittest

from scripts.ingest.sources import epoch


def _metadata(**overrides):
    row = {
        "model_version": "grok-4.3_high",
        "model_group": "Grok 4.3 Beta",
        "date": "2026-04-17",
        "display_name": "",
        "organization": "xAI",
        "country": "United States of America",
        "accessibility": "API access",
    }
    row.update(overrides)
    return row


def _reader(metadata_rows):
    files = {
        "model_metadata.csv": metadata_rows,
        "epoch_capabilities_index/eci_scores.csv": [{"Model": "Grok 4.3 Beta", "eci": "150"}],
    }

    def read(name):
        if name not in files:
            raise KeyError(name)
        return files[name]

    return read


class DisplayNameTests(unittest.TestCase):
    def test_a_published_display_name_wins(self):
        row = {"Display name": "Grok 4.3 (no thinking)", "Model name": "Grok 4.3 Beta",
               "Model version": "grok-4.3_none"}
        self.assertEqual(epoch._display_name(row), "Grok 4.3 (no thinking)")

    def test_an_empty_display_name_falls_back_to_the_model_name(self):
        row = {"Display name": "", "Model name": "Gemini 2.5 Pro (Jun 2025)",
               "Model version": "gemini-2.5-pro"}
        self.assertEqual(epoch._display_name(row), "Gemini 2.5 Pro (Jun 2025)")

    def test_a_whitespace_display_name_counts_as_missing(self):
        row = {"Display name": "  ", "Model name": "Grok 4.3 Beta",
               "Model version": "grok-4.3_high"}
        self.assertEqual(epoch._display_name(row), "Grok 4.3 Beta")

    def test_the_version_id_is_only_the_last_resort(self):
        row = {"Display name": "", "Model name": "", "Model version": "grok-4.3_high"}
        self.assertEqual(epoch._display_name(row), "grok-4.3_high")


class ReadIndexTests(unittest.TestCase):
    def test_the_new_layout_carries_the_model_group_as_the_model_name(self):
        rows = epoch._read_index(None, _reader([_metadata()]))
        self.assertEqual(rows[0]["Model name"], "Grok 4.3 Beta")
        self.assertEqual(epoch._display_name(rows[0]), "Grok 4.3 Beta")

    def test_a_row_without_a_group_still_gets_a_name(self):
        rows = epoch._read_index(None, _reader([_metadata(model_group="")]))
        self.assertEqual(epoch._display_name(rows[0]), "grok-4.3_high")


if __name__ == "__main__":
    unittest.main()
