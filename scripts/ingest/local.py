"""Join the llmfit catalogue onto the scored cohort to size models for a local machine.

Nothing here touches a score, a rank or the composite. It answers one question, how much
memory a model needs, for models the ranking already holds. Eligibility is the accessibility
Epoch reports (open weights); matching is by normalised name with pattern rules only, and the
publisher of a model is never read.

Beyond that cohort the page also lists the most downloaded models the ranking does not track
(`catalogue`), chosen by the rule in `config/local.json`. Those rows are sized the same way and
carry a Hugging Face link, but no composite, no rank and no score: they are listed because a
student asks "what could this machine run", not because ModelHub measured them.

Hybrid attention layouts come from `config/local.json`, by name pattern, so the browser ships
no model names and a new layout is a reviewable change to a config file.
"""
from __future__ import annotations

import json

from .common import CONFIG
from .sources.llmfit import ATTRIBUTION
from .sources.openrouter import catalogue_key

CONFIG_PATH = CONFIG / "local.json"


def load_layout_rules(path=CONFIG_PATH) -> list[dict]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    rules = (payload.get("attention_layouts") or {}).get("rules") or []
    return [r for r in rules if isinstance(r, dict) and r.get("all_of")]


def load_catalogue_rules(path=CONFIG_PATH) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    rules = payload.get("catalogue")
    return rules if isinstance(rules, dict) else {}


def modality(entry: dict) -> str | None:
    """'vision' when the repo takes images as well as text, 'text' otherwise, None if unknown."""
    tag = entry.get("pipeline_tag")
    if tag == "image-text-to-text":
        return "vision"
    return "text" if tag else None


def attention_layout(repo: str, rules: list[dict]) -> dict | None:
    """First rule whose every group has an alternative in the repo name, else None.

    None means unknown, and the sizing treats it as all full attention.
    """
    name = repo.lower()
    for rule in rules:
        if all(any(alt in name for alt in group) for group in rule["all_of"]):
            return {"full": rule["full"], "linear": rule["linear"]}
    return None


def wanted_keys(models: list[dict], canonical_keys: dict[str, str]) -> set[str]:
    """Catalogue keys worth fetching: those of open-weights scored models."""
    return {
        catalogue_key(canonical_keys[m["id"]])
        for m in models if m.get("is_open_weights") and m["id"] in canonical_keys
    }


def _spec(entry: dict, rules: list[dict]) -> dict:
    """The sizing shape of one catalogue entry, as the page and fit.ts read it."""
    return {
        "hf_repo": entry["hf_repo"],
        "source_url": f"https://huggingface.co/{entry['hf_repo']}",
        "parameters_raw": entry["parameters_raw"],
        "active_parameters": entry.get("active_parameters") if entry.get("is_moe") else None,
        "is_moe": bool(entry.get("is_moe")),
        "num_experts": entry.get("num_experts"),
        "active_experts": entry.get("active_experts"),
        "context_length": entry["context_length"],
        "num_hidden_layers": entry.get("num_hidden_layers"),
        "num_attention_heads": entry.get("num_attention_heads"),
        "num_key_value_heads": entry.get("num_key_value_heads"),
        "head_dim": entry.get("head_dim"),
        "architecture": entry.get("architecture"),
        "attention_layout": attention_layout(entry["hf_repo"], rules),
        "quantization": entry.get("quantization") or "Q4_K_M",
        "min_ram_gb": entry["min_ram_gb"],
        "min_vram_gb": entry.get("min_vram_gb"),
        "license": entry.get("license"),
        "modality": modality(entry),
        "hf_downloads": entry.get("hf_downloads"),
        "hf_likes": entry.get("hf_likes"),
        "candidates": entry.get("candidates", 1),
        "size_disagreement": entry.get("size_disagreement", 0),
    }


def build(models: list[dict], canonical_keys: dict[str, str], entries: dict[str, dict],
          rules: list[dict]) -> list[dict]:
    rows = []
    for model in models:
        if not model.get("is_open_weights") or model["id"] not in canonical_keys:
            continue
        entry = entries.get(catalogue_key(canonical_keys[model["id"]]))
        if not entry:
            continue
        rows.append({"model_id": model["id"], **_spec(entry, rules)})
    return sorted(rows, key=lambda r: r["model_id"])


def scored_keys(models: list[dict], canonical_keys: dict[str, str]) -> set[str]:
    """Catalogue keys of every scored model, open or not: a repo named after one of them is
    that model's namesake, never a separate unmeasured entry."""
    return {catalogue_key(canonical_keys[m["id"]]) for m in models if m["id"] in canonical_keys}


def build_catalogue(popular: list[dict], rules: list[dict]) -> list[dict]:
    """Unscored rows for the most downloaded models outside the cohort, in download order."""
    return [
        {"model_id": f"hf:{entry['hf_repo']}", "display_name": entry["hf_repo"].split("/", 1)[-1],
         **_spec(entry, rules)}
        for entry in popular
    ]


def document(rows: list[dict], open_weights_scored: int, generated_at: str,
             catalogue: list[dict] | None = None, catalogue_rules: dict | None = None) -> dict:
    return {
        "meta": {
            "generated_at": generated_at,
            "source": ATTRIBUTION,
            "license": "MIT",
            "in_composite": False,
            "open_weights_scored": open_weights_scored,
            "matched": len(rows),
            "catalogue_rows": len(catalogue or []),
            "catalogue_rules": catalogue_rules or {},
        },
        "models": rows,
        "catalogue": catalogue or [],
    }
