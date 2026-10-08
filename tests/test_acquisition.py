"""acquisition.find_hf_repo: which Hub search results become a published link.

The Hub is replaced by a canned search response, so these run offline.
"""
import json
import unittest
from unittest import mock

from scripts.enrich import acquisition

_RESULTS = [
    {"id": "Qwen/Qwen3-30B-A3B-Instruct-2507-FP8"},
    {"id": "Qwen/Qwen3-30B-A3B-Instruct-2507"},
    {"id": "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF"},
]


def _hub(results):
    return mock.patch.object(
        acquisition, "_get", return_value=(200, json.dumps(results).encode())
    )


class FindHfRepoTests(unittest.TestCase):
    def test_display_name_from_the_source_alone_misses_the_repo(self):
        """The 2026-10-03 regression: the name carries a date label, not the repo suffix."""
        with _hub(_RESULTS):
            self.assertIsNone(
                acquisition.find_hf_repo("Qwen3-30B-A3B-Instruct (Jul 2025)", "alibaba")
            )

    def test_canonical_slug_finds_the_exact_repo_not_a_quantised_copy(self):
        with _hub(_RESULTS):
            self.assertEqual(
                acquisition.find_hf_repo(
                    "Qwen3-30B-A3B-Instruct (Jul 2025)", "alibaba",
                    "qwen3-30b-a3b-instruct-2507",
                ),
                "https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507",
            )

    def test_empty_slug_matches_nothing_extra(self):
        with _hub([{"id": "someone/x"}]):
            self.assertIsNone(acquisition.find_hf_repo("Other Model", "acme", ""))


if __name__ == "__main__":
    unittest.main()
