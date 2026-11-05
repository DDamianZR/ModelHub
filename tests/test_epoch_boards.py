import unittest

from scripts.ingest.sources import epoch


class KnowledgeStaysOutOfComposite(unittest.TestCase):
    def test_no_knowledge_benchmark_feeds_category_scores(self):
        self.assertNotIn("knowledge", {category for _, category in epoch.BENCHMARKS.values()})
        self.assertNotIn("simpleqa_verified", {bid for bid, _ in epoch.BENCHMARKS.values()})

    def test_simpleqa_is_a_knowledge_board(self):
        self.assertEqual(epoch.BOARD_TABLES["simpleqa_verified.csv"][2], "knowledge")


if __name__ == "__main__":
    unittest.main()
