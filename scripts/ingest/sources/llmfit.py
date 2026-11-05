"""llmfit model catalogue: architecture shape for sizing models on a local machine.

https://github.com/AlexsJones/llmfit (MIT) publishes `llmfit-core/data/hf_models.json`, a
scrape of Hugging Face repos with parameter counts, layer and head shapes, mixture-of-experts
sizes and context windows. It supplies no measurement of quality, so nothing read here can
reach the composite: it only answers "how much memory does this model need".

The file is large (about 17 MB, some 19 thousand repos) and almost all of it is repackaged
variants of models this project does not track. Only entries whose normalised name equals one
the caller asks for are kept, so the cache that is committed holds a few dozen rows instead.

Several repos can share a normalised name: the original release and community repacks that
report a different parameter count. The rule for choosing is mechanical and reads nothing
about who published a repo: the most downloaded wins, ties broken by repo name. How far the
other candidates disagree on size is recorded beside the choice rather than hidden.
"""
from __future__ import annotations

from ..common import SourceError, fetch_json
from .openrouter import catalogue_key

URL = ("https://raw.githubusercontent.com/AlexsJones/llmfit/main/"
       "llmfit-core/data/hf_models.json")
ATTRIBUTION = "https://github.com/AlexsJones/llmfit"

# Candidates whose parameter count sits further than this from the chosen one are counted as
# disagreeing about the model's size.
SIZE_DISAGREEMENT_TOLERANCE = 0.10

_FIELDS = (
    "parameters_raw", "active_parameters", "is_moe", "num_experts", "active_experts",
    "context_length", "num_hidden_layers", "num_attention_heads", "num_key_value_heads",
    "head_dim", "architecture", "quantization", "min_ram_gb", "min_vram_gb", "license",
)


def _downloads(entry: dict) -> int:
    value = entry.get("hf_downloads")
    return value if isinstance(value, int) else 0


def _usable(entry: dict) -> bool:
    return (
        isinstance(entry.get("name"), str)
        and isinstance(entry.get("parameters_raw"), int)
        and entry["parameters_raw"] > 0
        and isinstance(entry.get("context_length"), int)
        and isinstance(entry.get("min_ram_gb"), (int, float))
    )


def choose(candidates: list[dict]) -> dict:
    """The most downloaded candidate, ties broken by repo name so reruns agree."""
    return sorted(candidates, key=lambda e: (-_downloads(e), e["name"]))[0]


def parse(rows: list[dict], wanted: set[str]) -> dict[str, dict]:
    """Chosen entry per wanted key, with how many candidates there were and how far they differ."""
    grouped: dict[str, list[dict]] = {}
    for entry in rows:
        if not isinstance(entry, dict) or not _usable(entry):
            continue
        key = catalogue_key(entry["name"])
        if key in wanted:
            grouped.setdefault(key, []).append(entry)

    out: dict[str, dict] = {}
    for key, candidates in sorted(grouped.items()):
        picked = choose(candidates)
        size = picked["parameters_raw"]
        disagreeing = sum(
            1 for other in candidates
            if abs(other["parameters_raw"] - size) / size > SIZE_DISAGREEMENT_TOLERANCE
        )
        out[key] = {
            "hf_repo": picked["name"],
            **{field: picked.get(field) for field in _FIELDS},
            "hf_downloads": _downloads(picked),
            "candidates": len(candidates),
            "size_disagreement": disagreeing,
        }
    return out


def collect(wanted: set[str]) -> dict:
    rows = fetch_json(URL, timeout=180)
    if not isinstance(rows, list) or not rows:
        raise SourceError("llmfit: catalogue came back empty")
    return {"entries": parse(rows, wanted), "catalogue_size": len(rows)}
