"""Join the llmfit catalogue onto the scored cohort to size models for a local machine.

Nothing here touches a score, a rank or the composite. It answers one question, how much
memory a model needs, for models the ranking already holds. Eligibility is the accessibility
Epoch reports (open weights); matching is by normalised name with pattern rules only, and the
publisher of a model is never read.

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


def build(models: list[dict], canonical_keys: dict[str, str], entries: dict[str, dict],
          rules: list[dict]) -> list[dict]:
    rows = []
    for model in models:
        if not model.get("is_open_weights") or model["id"] not in canonical_keys:
            continue
        entry = entries.get(catalogue_key(canonical_keys[model["id"]]))
        if not entry:
            continue
        rows.append({
            "model_id": model["id"],
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
            "candidates": entry.get("candidates", 1),
            "size_disagreement": entry.get("size_disagreement", 0),
        })
    return sorted(rows, key=lambda r: r["model_id"])


def document(rows: list[dict], open_weights_scored: int, generated_at: str) -> dict:
    return {
        "meta": {
            "generated_at": generated_at,
            "source": ATTRIBUTION,
            "license": "MIT",
            "in_composite": False,
            "open_weights_scored": open_weights_scored,
            "matched": len(rows),
        },
        "models": rows,
    }
