"""Before/after of a change, aggregated by provider.

CONTRIBUTING asks every change that moves the ranking to say so with numbers. This adds
the cut that question usually skips: *whose* models moved. A fix can be correct model by
model and still, in aggregate, lift one lab's line-up - and whoever wrote the fix is the
last one who should be trusted to notice when that lab is their own.

    python -m scripts.neutrality.provider_delta                    # vs HEAD
    python -m scripts.neutrality.provider_delta --base origin/main
    python -m scripts.neutrality.provider_delta --author-vendor alibaba --strict

"Before" is data/models.json as committed at --base. "After" is a fresh in-memory rebuild
from the working tree's code, config and cache - so an uncommitted edit to composite.py or
weights.json is measured without running the ingest or touching /data.

--author-vendor names the provider the change's author has a stake in. There is no
default: CI cannot know who wrote a pull request, so it reports the table alone. When
given, that row is labelled, and --strict fails when that provider is flagged - in either
direction: flattering your own vendor and over-correcting against it are the same defect.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass, field

from scripts.neutrality.rebuild import ROOT, cache_available, rebuild

# Composite points, as the gap between one provider's mean delta and everyone else's.
# Half the median 95% half-width of a ranked composite (0.52 on 2026-09-30): small for one
# model, large when it is the average over a whole line-up. For scale, two weeks of daily
# ingest drift (HEAD~15 on 2026-09-30) moved no provider further than 0.19 from the rest.
DEFAULT_THRESHOLD = 0.25

# A small bonus applied to every model of one lab hides under any mean threshold - it is
# the shape of the movement that gives it away. When at least this many of a provider's
# models moved, all in the same direction, while the rest of the cohort did not, and the
# gap exceeds the floor, the provider is flagged as one-sided whatever the size.
ONE_SIDED_MIN_MODELS = 3
ONE_SIDED_FLOOR = 0.05


@dataclass
class ProviderRow:
    provider: str
    models_before: int = 0
    models_after: int = 0
    deltas: list[float] = field(default_factory=list)
    rank_gains: list[int] = field(default_factory=list)
    entered_ranking: list[str] = field(default_factory=list)
    left_ranking: list[str] = field(default_factory=list)
    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)

    @property
    def mean_delta(self) -> float:
        return sum(self.deltas) / len(self.deltas) if self.deltas else 0.0

    @property
    def up(self) -> int:
        return sum(1 for d in self.deltas if d > 0.005)

    @property
    def down(self) -> int:
        return sum(1 for d in self.deltas if d < -0.005)


def inputs_changed(ref: str) -> bool:
    """Whether data/cache differs between `ref` and the working tree.

    The one-sided test only means something when the inputs are the same on both sides:
    then every movement was caused by code or config, and a whole line-up moving together
    is a pattern worth explaining. When new measurements arrived, a lab's models moving
    together is often just its models being re-measured together - two weeks of daily
    ingest flagged xAI that way - so the test is switched off rather than left crying wolf.
    """
    result = subprocess.run(
        ["git", "diff", "--quiet", ref, "--", "data/cache"], cwd=ROOT, capture_output=True,
    )
    return result.returncode != 0


def load_base(ref: str) -> list[dict]:
    raw = subprocess.run(
        ["git", "show", f"{ref}:data/models.json"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(raw)["models"]


def compare(before: list[dict], after: list[dict]) -> tuple[dict[str, ProviderRow], list]:
    by_id_before = {m["id"]: m for m in before}
    by_id_after = {m["id"]: m for m in after}
    rows: dict[str, ProviderRow] = {}

    def row(provider: str) -> ProviderRow:
        return rows.setdefault(provider, ProviderRow(provider))

    for model in before:
        row(model["provider_id"]).models_before += 1
    for model in after:
        row(model["provider_id"]).models_after += 1

    movers = []
    for model_id in sorted(set(by_id_before) | set(by_id_after)):
        old, new = by_id_before.get(model_id), by_id_after.get(model_id)
        provider = (new or old)["provider_id"]
        if old is None:
            row(provider).added.append(model_id)
            continue
        if new is None:
            row(provider).removed.append(model_id)
            continue
        delta = round(new["composite"] - old["composite"], 2)
        row(provider).deltas.append(delta)
        old_rank, new_rank = old.get("rank"), new.get("rank")
        if old_rank and new_rank:
            row(provider).rank_gains.append(old_rank - new_rank)
        if old["provisional"] and not new["provisional"]:
            row(provider).entered_ranking.append(model_id)
        if new["provisional"] and not old["provisional"]:
            row(provider).left_ranking.append(model_id)
        if delta or old_rank != new_rank:
            movers.append((model_id, provider, old["composite"], new["composite"], delta,
                           old_rank, new_rank))
    movers.sort(key=lambda m: -abs(m[4]))
    return rows, movers


def gap_vs_rest(rows: dict[str, ProviderRow], provider: str) -> float | None:
    """Mean delta of one provider minus the mean delta of every other provider's models."""
    mine = rows.get(provider)
    others = [d for p, r in rows.items() if p != provider for d in r.deltas]
    if not mine or not mine.deltas or not others:
        return None
    return mine.mean_delta - sum(others) / len(others)


def flag_for(
    rows: dict[str, ProviderRow], provider: str, threshold: float, one_sided: bool = True
) -> str | None:
    """Return "shift", "one-sided" or None. Both directions count: penalising a provider
    is the same defect as flattering it."""
    gap = gap_vs_rest(rows, provider)
    if gap is None:
        return None
    if abs(gap) > threshold:
        return "shift"
    if not one_sided:
        return None
    row = rows[provider]
    others = [d for p, r in rows.items() if p != provider for d in r.deltas]
    # A change that lifts every model lifts this provider's too; that is not one-sided.
    unanimous_up = row.up == len(row.deltas) and not all(d > 0.005 for d in others)
    unanimous_down = row.down == len(row.deltas) and not all(d < -0.005 for d in others)
    if (
        len(row.deltas) >= ONE_SIDED_MIN_MODELS
        and (unanimous_up or unanimous_down)
        and abs(gap) > ONE_SIDED_FLOOR
    ):
        return "one-sided"
    return None


def render(
    rows, movers, author: str | None, threshold: float, base: str, one_sided: bool = True
) -> str:
    all_deltas = [d for r in rows.values() for d in r.deltas]
    # Raw rank gains are confounded by models entering or leaving the table: one new
    # model at #1 "costs" everyone a place. Reported relative to the cohort instead.
    all_gains = [g for r in rows.values() for g in r.rank_gains]
    cohort_gain = sum(all_gains) / len(all_gains) if all_gains else 0.0
    moved = any(abs(d) > 0.005 for d in all_deltas) or any(
        r.added or r.removed or r.entered_ranking or r.left_ranking for r in rows.values()
    )
    lines = [f"### Per-provider delta vs `{base}`", ""]
    if not moved:
        lines += ["No model changed composite, rank or ranking status.", ""]
        return "\n".join(lines)

    lines += [
        f"{len(all_deltas)} models present before and after. *Gap* is a provider's mean "
        f"Δ composite minus everyone else's. ⚠ shift: gap beyond ±{threshold}. "
        + (
            f"⚠ one-sided: {ONE_SIDED_MIN_MODELS}+ models all moved the same way while the "
            "rest of the cohort did not."
            if one_sided else
            "data/cache differs from the base, so movement includes new measurements and "
            "the one-sided test is off; shift still applies."
        ),
        "",
        "| Provider | Models | Mean Δ | Gap | ↑ / ↓ | Rank gain vs cohort "
        "| Entered / left ranking | New / gone |",
        "|---|---|---|---|---|---|---|---|",
    ]
    gaps = {p: gap_vs_rest(rows, p) for p in rows}
    for provider in sorted(rows, key=lambda p: (-abs(gaps[p] or 0.0), p)):
        r = rows[provider]
        flag = flag_for(rows, provider, threshold, one_sided)
        mark = f" ⚠ {flag}" if flag else ""
        label = f"**{provider}** (author's vendor)" if provider == author else provider
        gap = f"{gaps[provider]:+.2f}" if gaps[provider] is not None else "—"
        gain = (
            f"{sum(r.rank_gains) / len(r.rank_gains) - cohort_gain:+.1f}"
            if r.rank_gains else "—"
        )
        lines.append(
            f"| {label}{mark} | {r.models_before}→{r.models_after} | {r.mean_delta:+.2f} "
            f"| {gap} | {r.up} / {r.down} | {gain} | {len(r.entered_ranking)} / "
            f"{len(r.left_ranking)} | {len(r.added)} / {len(r.removed)} |"
        )

    lines.append("")
    skew = gaps.get(author) if author else None
    if author and skew is None:
        lines.append(f"Author's vendor (`{author}`): no comparable models in this change.")
    elif author:
        flag = flag_for(rows, author, threshold, one_sided)
        verdict = f"⚠ {flag}" if flag else "not flagged"
        lines.append(
            f"Author's vendor (`{author}`) vs everyone else: **{skew:+.2f}** composite "
            f"points ({verdict}). Positive favours the author's vendor, negative penalises "
            "it. Either one, flagged, needs a stated reason before merging."
        )

    if movers:
        lines += ["", "<details><summary>Largest movers</summary>", "",
                  "| Model | Provider | Before | After | Δ | Rank |", "|---|---|---|---|---|---|"]
        for model_id, provider, old, new, delta, old_rank, new_rank in movers[:15]:
            rank = f"{old_rank or '·'} → {new_rank or '·'}"
            lines.append(
                f"| {model_id} | {provider} | {old:.2f} | {new:.2f} | {delta:+.2f} | {rank} |"
            )
        lines += ["", "</details>"]
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", default="HEAD", help="git ref to compare against")
    parser.add_argument("--author-vendor",
                        help="provider_id the change's author has a stake in")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--strict", action="store_true",
                        help="exit 1 when the author's vendor moves beyond the threshold")
    args = parser.parse_args(argv)
    if args.strict and not args.author_vendor:
        parser.error("--strict needs --author-vendor")
    # The report prints Δ and ⚠; a Windows pipe defaults to cp1252 and cannot encode them.
    sys.stdout.reconfigure(encoding="utf-8")

    if not cache_available():
        print("No data/cache to rebuild from; nothing to compare.", file=sys.stderr)
        return 0

    before = load_base(args.base)
    after, _aliases = rebuild()
    rows, movers = compare(before, after)
    one_sided = not inputs_changed(args.base)
    print(render(rows, movers, args.author_vendor, args.threshold, args.base, one_sided))

    if args.strict and flag_for(rows, args.author_vendor, args.threshold, one_sided):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
