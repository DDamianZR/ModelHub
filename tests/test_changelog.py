"""scripts/ingest/changelog.py: what counts as a change between two builds.

The cohorts here are synthetic and anonymous on purpose: the module must work without
knowing who made a model, so the fixtures never say.
"""
import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.ingest import backfill_changes, changelog

DATA = Path(__file__).resolve().parents[1] / "data"


def model(model_id, composite, error=0.5, covered=5, provisional=False, price=None, rank=None, tied=0):
    return {
        "id": model_id,
        "composite": composite,
        "composite_error": error,
        "provisional": provisional,
        "coverage": {"covered": covered, "total": 5},
        "blended_price_usd_per_m": price,
        "rank": rank,
        "tied_with": tied,
    }


def state(models, scores=(), scale=None):
    """A build with published ranks filled in the way the ingest fills them."""
    ranked = [m for m in models if not m["provisional"]]
    placed = changelog.ranks_among({m["id"]: m for m in ranked}, [m["id"] for m in ranked])
    for m in ranked:
        m["rank"], m["tied_with"] = placed[m["id"]]
    rows = [{"model_id": mid, "benchmark_id": bid, "value": value} for mid, bid, value in scores]
    meta = {"arena_normalization": scale} if scale else {}
    return changelog.build_state(list(models), rows, meta)


def kinds(events):
    return [event["type"] for event in events]


class DiffStatesTests(unittest.TestCase):
    def test_identical_builds_log_nothing(self):
        a = state([model("m-a", 90), model("m-b", 80)], [("m-a", "bench", 90.0)])
        b = state([model("m-a", 90), model("m-b", 80)], [("m-a", "bench", 90.0)])
        self.assertEqual(changelog.diff_states(a, b, "2026-01-02", 0.5), [])

    def test_a_newcomer_at_the_top_is_one_arrival_not_a_move_for_everyone_below(self):
        # Published ranks of m-a..m-c each drop by one when m-new arrives ahead of them.
        # Among the three models present on both days nothing changed, so nothing moved.
        before = state([model("m-a", 90), model("m-b", 80), model("m-c", 70)])
        after = state([model("m-new", 99), model("m-a", 90), model("m-b", 80), model("m-c", 70)])
        self.assertEqual(
            [after["models"][i]["rank"] for i in ("m-a", "m-b", "m-c")], [2, 3, 4]
        )
        events = changelog.diff_states(before, after, "2026-01-02", 0.5)
        self.assertEqual(kinds(events), ["model_added"])
        self.assertEqual(events[0]["model_id"], "m-new")
        self.assertEqual((events[0]["rank"], events[0]["ranked"]), (1, True))

    def test_a_move_lists_the_models_own_rows_that_changed(self):
        models_before = [model(f"m-{i}", 90 - 5 * i) for i in range(6)]
        models_after = [model(f"m-{i}", 90 - 5 * i) for i in range(6)]
        models_after[4]["composite"] = 88.0  # m-4 climbs from fifth to second
        before = state(models_before, [("m-4", "bench", 60.0), ("m-4", "other", 50.0)])
        after = state(models_after, [("m-4", "bench", 95.0), ("m-4", "other", 50.0)])
        events = changelog.diff_states(before, after, "2026-01-02", 0.9)
        moved = {e["model_id"]: e for e in events if e["type"] == "moved"}
        self.assertEqual(moved["m-4"]["position"], [5, 2])
        self.assertEqual(moved["m-4"]["among"], 6)
        self.assertEqual(moved["m-4"]["composite"], [70, 88.0])
        self.assertEqual(
            moved["m-4"]["inputs"], [{"benchmark_id": "bench", "value": [60.0, 95.0]}]
        )
        # The three it overtook moved too, with no row of their own changed: said as such.
        self.assertEqual(sorted(set(moved) - {"m-4"}), ["m-1", "m-2", "m-3"])
        self.assertTrue(all(moved[i]["inputs"] == [] for i in ("m-1", "m-2", "m-3")))

    def test_overlapping_intervals_do_not_count_as_a_move(self):
        # 80 +-2 and 79 +-2 are a tie either way round; swapping the points moves nobody.
        before = state([model("m-a", 80, 2), model("m-b", 79, 2)])
        after = state([model("m-a", 79, 2), model("m-b", 80, 2)])
        self.assertEqual(changelog.diff_states(before, after, "2026-01-02", 0.5), [])

    def test_more_than_the_share_moving_is_one_event_with_counts(self):
        before = state([model(f"m-{i}", 90 - 5 * i) for i in range(6)])
        after = state([model(f"m-{i}", 60 + 5 * i) for i in range(6)])  # order reversed
        events = changelog.diff_states(before, after, "2026-01-02", 0.5)
        self.assertEqual(kinds(events), ["cohort_shift"])
        self.assertEqual((events[0]["compared"], events[0]["moved"]), (6, 6))

    def test_exactly_the_share_is_still_listed_per_model(self):
        models_before = [model(f"m-{i}", 90 - 5 * i) for i in range(4)]
        models_after = [model(f"m-{i}", 90 - 5 * i) for i in range(4)]
        models_after[0]["composite"], models_after[1]["composite"] = 85, 90  # top two swap
        events = changelog.diff_states(state(models_before), state(models_after), "2026-01-02", 0.5)
        self.assertEqual(kinds(events), ["moved", "moved"])  # 2 of 4 is not more than 0.5

    def test_gate_crossings_are_reported_and_kept_out_of_the_moves(self):
        before = state([model("m-a", 90), model("m-b", 80), model("m-c", 85, covered=3, provisional=True)])
        after = state([model("m-a", 90), model("m-b", 80), model("m-c", 85, covered=4)])
        events = changelog.diff_states(before, after, "2026-01-02", 0.5)
        self.assertEqual(kinds(events), ["gate_crossed"])
        self.assertEqual(
            (events[0]["model_id"], events[0]["entered"], events[0]["covered"]), ("m-c", True, [3, 4])
        )

    def test_departures_prices_scale_and_benchmark_counts(self):
        before = state(
            [model("m-a", 90, price=2.0), model("m-b", 80), model("m-gone", 50)],
            [("m-a", "bench", 90.0), ("m-b", "bench", 80.0), ("m-gone", "bench", 50.0)],
            scale={"min": 1300.0, "max": 1500.0},
        )
        after = state(
            [model("m-a", 90, price=1.5), model("m-b", 80)],
            [("m-a", "bench", 90.0), ("m-b", "bench", 81.0), ("m-b", "extra", 70.0)],
            scale={"min": 1290.0, "max": 1500.0},
        )
        events = changelog.diff_states(before, after, "2026-01-02", 0.5)
        self.assertEqual(
            kinds(events),
            ["arena_scale", "benchmark_updated", "benchmark_updated", "model_removed", "price_changed"],
        )
        by_type = {e["type"]: e for e in events if e["type"] != "benchmark_updated"}
        self.assertEqual(by_type["arena_scale"]["min"], [1300.0, 1290.0])
        self.assertEqual(by_type["model_removed"]["model_id"], "m-gone")
        self.assertEqual(by_type["price_changed"]["blended_usd_per_m"], [2.0, 1.5])
        updates = {e["benchmark_id"]: e for e in events if e["type"] == "benchmark_updated"}
        self.assertEqual(
            (updates["bench"]["changed"], updates["bench"]["added"], updates["bench"]["removed"]), (1, 0, 1)
        )
        self.assertEqual(updates["extra"]["added"], 1)
        self.assertTrue(all(event["date"] == "2026-01-02" for event in events))

    def test_comparing_two_builds_changes_neither(self):
        # The ingest hands this module the very lists it is about to publish.
        before = state([model("m-a", 90), model("m-b", 80), model("m-c", 70)], [("m-a", "bench", 1.0)])
        after = state([model("m-c", 95), model("m-a", 90), model("m-b", 80)], [("m-a", "bench", 2.0)])
        frozen = copy.deepcopy((before, after))
        changelog.diff_states(before, after, "2026-01-02", 0.9)
        self.assertEqual((before, after), frozen)

    def test_no_event_names_who_made_a_model(self):
        before = state([model("m-a", 90), model("m-b", 80)])
        after = state([model("m-new", 99), model("m-b", 91), model("m-a", 90, price=1.0)])
        for event in changelog.diff_states(before, after, "2026-01-02", 0.9):
            self.assertFalse({"provider_id", "organization", "country"} & event.keys())


class RanksAmongTests(unittest.TestCase):
    def test_over_the_full_ranked_set_it_is_the_published_rank(self):
        published = json.loads((DATA / "models.json").read_text(encoding="utf-8"))["models"]
        by_id = {m["id"]: m for m in published}
        ranked = [m["id"] for m in published if not m["provisional"]]
        placed = changelog.ranks_among(by_id, ranked)
        self.assertGreater(len(ranked), 0)
        for model_id in ranked:
            self.assertEqual(
                placed[model_id], (by_id[model_id]["rank"], by_id[model_id]["tied_with"]), model_id
            )

    def test_it_leaves_the_models_it_was_given_untouched(self):
        models = {"m-a": model("m-a", 90, rank=7, tied=3)}
        changelog.ranks_among(models, ["m-a"])
        self.assertEqual((models["m-a"]["rank"], models["m-a"]["tied_with"]), (7, 3))


class AppendTests(unittest.TestCase):
    def test_append_only_and_one_json_object_per_line(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "changes.jsonl"
            changelog.append([{"date": "2026-01-01", "type": "model_added", "model_id": "m-a"}], path)
            changelog.append([], path)
            changelog.append([{"date": "2026-01-02", "type": "model_removed", "model_id": "m-a"}], path)
            lines = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual([json.loads(line)["date"] for line in lines], ["2026-01-01", "2026-01-02"])

    def test_an_empty_list_does_not_create_the_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "changes.jsonl"
            changelog.append([], path)
            self.assertFalse(path.exists())


class SeedTests(unittest.TestCase):
    """The ingest builds the log from history once; it must never stop a run or redo it."""

    EVENTS = [{"date": "2026-01-01", "type": "model_added", "model_id": "m-a"}]

    def test_an_existing_log_is_left_exactly_as_it_is(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "changes.jsonl"
            path.write_text("kept\n", encoding="utf-8")
            with mock.patch.object(backfill_changes, "rebuild") as rebuild:
                self.assertEqual(backfill_changes.seed(path), 0)
                rebuild.assert_not_called()
            self.assertEqual(path.read_text(encoding="utf-8"), "kept\n")

    def test_a_missing_log_is_written_from_history(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "changes.jsonl"
            with mock.patch.object(backfill_changes, "rebuild", return_value=([], self.EVENTS, 0)):
                self.assertEqual(backfill_changes.seed(path), 1)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), self.EVENTS[0])

    def test_no_history_or_no_git_writes_nothing_and_does_not_raise(self):
        failures = (
            subprocess.CalledProcessError(128, "git"),  # not a repository, or a bad object
            FileNotFoundError("git"),                    # git is not installed
            json.JSONDecodeError("bad", "", 0),          # a build that is not JSON
        )
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "changes.jsonl"
            for failure in failures:
                with self.subTest(failure=type(failure).__name__):
                    with mock.patch.object(backfill_changes, "rebuild", side_effect=failure):
                        self.assertEqual(backfill_changes.seed(path), 0)
                    self.assertFalse(path.exists())
            # A shallow clone: one build, so no pair to compare and no events.
            with mock.patch.object(backfill_changes, "rebuild", return_value=([], [], 0)):
                self.assertEqual(backfill_changes.seed(path), 0)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
