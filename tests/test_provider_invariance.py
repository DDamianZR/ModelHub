"""The composite must not know who made a model.

Two kinds of check, because a vendor preference can enter the scoring path two ways.

1. Metamorphic: rebuild the real cohort from data/cache with the provider metadata
   shuffled between models, and again with every provider anonymised. Every number the
   ranking publishes - composite, interval, category scores, rank, ties, coverage gate -
   has to come out identical, model for model. If a score depends on the label on the box
   rather than on what is in it, this is where it shows.

2. Static: no string literal in scripts/ingest names a vendor or a model family. A
   branch like `if org == "Anthropic"` or a hand-written alias for one lab's models is the
   cheapest way to tilt a ranking and the hardest to spot in review. Docstrings and
   comments are exempt - explaining a past bug with the model it hit is documentation,
   not logic.

3. The per-provider delta's flags, on a synthetic cohort: a bonus to one lab is caught
   however small once it is one-sided, a penalty is caught like a bonus, and a change
   that moves everyone together is not blamed on anyone.

None of this says the ranking is right. They say it would be the same ranking if the
names were swapped, which is the property a reader of a vendor-neutral leaderboard is
actually asking for.
"""
import ast
import random
import unittest
from pathlib import Path

from scripts.neutrality.provider_delta import compare, flag_for
from scripts.neutrality.rebuild import cache_available, load_inputs, rebuild
from scripts.neutrality.vendors import vendors_in

ROOT = Path(__file__).resolve().parents[1]
SCORING_PATH = ROOT / "scripts" / "ingest"

# Every field of a model that is a published judgement rather than a label.
SCORED_FIELDS = (
    "composite",
    "composite_error",
    "category_scores",
    "category_errors",
    "uncertainty",
    "coverage",
    "evidence",
    "provisional",
    "awaiting_human_votes",
    "rank",
    "tied_with",
    "variant",
    "human_preference_variant",
    "is_open_weights",
)

# (relative path, literal) pairs that are allowed to name a vendor. Empty on purpose.
# Adding to it is a methodology change: say why in the commit body and show the
# per-provider delta (python -m scripts.neutrality.provider_delta).
ALLOWED_LITERALS: set[tuple[str, str]] = set()


def _by_key(models: list[dict], aliases: dict) -> dict[str, dict]:
    return {aliases[m["id"]]["canonical_key"]: m for m in models}


def _order(models: list[dict], aliases: dict) -> list[str]:
    return [aliases[m["id"]]["canonical_key"] for m in models]


def _shuffled(seed: int):
    def transform(registry: dict) -> dict:
        identities = [(meta["organization"], meta["country"]) for meta in registry.values()]
        random.Random(seed).shuffle(identities)
        for meta, (organization, country) in zip(registry.values(), identities):
            meta["organization"] = organization
            meta["country"] = country
        return registry
    return transform


def _anonymised(registry: dict) -> dict:
    labels: dict[str, str] = {}
    for index, meta in enumerate(registry.values()):
        meta["organization"] = labels.setdefault(
            meta["organization"], f"Lab {len(labels):03d}"
        )
        meta["country"] = "Nowhere"
        meta["display_name"] = f"Model {index:04d}"
    return registry


@unittest.skipUnless(cache_available(), "no cache to rebuild from")
class ProviderInvarianceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = load_inputs()
        models, aliases = rebuild(cls.inputs)
        cls.baseline = _by_key(models, aliases)
        cls.baseline_order = _order(models, aliases)

    def _assert_same_ranking(self, transform, label: str):
        models, aliases = rebuild(self.inputs, transform)
        variant = _by_key(models, aliases)
        self.assertEqual(set(variant), set(self.baseline), f"{label}: cohort changed")
        relabelled = sum(
            1 for key, original in self.baseline.items()
            if variant[key]["provider_id"] != original["provider_id"]
        )
        # A transform that relabels nothing would make every assertion below vacuous.
        self.assertGreater(relabelled, len(self.baseline) // 2, f"{label}: barely relabelled")
        for key, original in self.baseline.items():
            for field in SCORED_FIELDS:
                with self.subTest(transform=label, model=key, field=field):
                    self.assertEqual(variant[key].get(field), original.get(field))
        self.assertEqual(
            _order(models, aliases), self.baseline_order, f"{label}: table order changed"
        )

    def test_cohort_is_not_trivial(self):
        """Guard against the test passing vacuously on an empty or single-vendor build."""
        providers = {m["provider_id"] for m in self.baseline.values()}
        self.assertGreaterEqual(len(self.baseline), 10)
        self.assertGreaterEqual(len(providers), 3)

    def test_shuffling_providers_between_models_changes_no_score(self):
        for seed in (1, 2, 3):
            self._assert_same_ranking(_shuffled(seed), f"shuffle seed={seed}")

    def test_anonymising_every_provider_changes_no_score(self):
        self._assert_same_ranking(_anonymised, "anonymised")


def _docstring_nodes(tree: ast.AST) -> set[int]:
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                ids.add(id(body[0].value))
    return ids


class ScoringPathLiteralTests(unittest.TestCase):
    def test_no_vendor_literals_in_scoring_path(self):
        offenders: list[str] = []
        for path in sorted(SCORING_PATH.rglob("*.py")):
            relative = path.relative_to(ROOT).as_posix()
            tree = ast.parse(path.read_text(encoding="utf-8"))
            docstrings = _docstring_nodes(tree)
            for node in ast.walk(tree):
                if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
                    continue
                if id(node) in docstrings or (relative, node.value) in ALLOWED_LITERALS:
                    continue
                found = vendors_in(node.value)
                if found:
                    offenders.append(
                        f"{relative}:{node.lineno} {node.value[:60]!r} -> {sorted(found)}"
                    )
        self.assertEqual(
            offenders, [],
            "Vendor-specific literal in the scoring path. Express the rule as a pattern "
            "that applies to every provider, or allowlist it with a reason.",
        )

    def test_matcher_catches_the_obvious_case(self):
        """The static check is only as good as the matcher; prove it can fire."""
        self.assertEqual(vendors_in('if org == "Anthropic":'), {"anthropic": 1})
        self.assertEqual(vendors_in("gpt-5.6-sol"), {"openai": 1})
        self.assertEqual(vendors_in("qwen3.8-27b"), {"alibaba": 1})
        self.assertEqual(vendors_in("Google DeepMind"), {"google-deepmind": 1})
        self.assertEqual(vendors_in("gptq metadata"), {})

    def test_matcher_counts_names_not_tokens(self):
        """Over-counting would make the copy report cry wolf, and a report that always
        warns is one nobody reads."""
        self.assertEqual(vendors_in("claude-opus-5_max"), {"anthropic": 1})
        self.assertEqual(vendors_in("Cada fuente llama distinto"), {})
        self.assertEqual(vendors_in("Llama 4 Maverick"), {"meta-ai": 1})
        self.assertEqual(
            vendors_in("Claude Opus 4.6 y GPT-5"), {"anthropic": 1, "openai": 1}
        )


def _model(model_id: str, provider: str, composite: float, rank: int) -> dict:
    return {"id": model_id, "provider_id": provider, "composite": composite,
            "rank": rank, "provisional": False}


def _cohort(bonus_for: dict[str, float]) -> tuple[list[dict], list[dict]]:
    before, after = [], []
    for index, provider in enumerate(("lab-a", "lab-b", "lab-c") * 4):
        model_id = f"{provider}-{index}"
        base = 70.0 + index
        before.append(_model(model_id, provider, base, index + 1))
        # Unrelated jitter, so "everyone else" is not perfectly still.
        jitter = 0.02 if index % 2 else -0.02
        after.append(_model(model_id, provider, base + jitter + bonus_for.get(provider, 0.0),
                            index + 1))
    return before, after


class ProviderDeltaFlagTests(unittest.TestCase):
    def test_small_bonus_to_one_lab_is_flagged_one_sided(self):
        rows, _ = compare(*_cohort({"lab-a": 0.1}))
        self.assertEqual(flag_for(rows, "lab-a", 0.25), "one-sided")
        self.assertIsNone(flag_for(rows, "lab-b", 0.25))

    def test_penalty_is_flagged_like_a_bonus(self):
        rows, _ = compare(*_cohort({"lab-a": -0.4}))
        self.assertEqual(flag_for(rows, "lab-a", 0.25), "shift")

    def test_lifting_everyone_is_not_one_sided(self):
        rows, _ = compare(*_cohort({"lab-a": 0.1, "lab-b": 0.1, "lab-c": 0.1}))
        for provider in ("lab-a", "lab-b", "lab-c"):
            self.assertIsNone(flag_for(rows, provider, 0.25))

    def test_one_sided_test_can_be_switched_off_for_new_data(self):
        rows, _ = compare(*_cohort({"lab-a": 0.1}))
        self.assertIsNone(flag_for(rows, "lab-a", 0.25, one_sided=False))


if __name__ == "__main__":
    unittest.main()
