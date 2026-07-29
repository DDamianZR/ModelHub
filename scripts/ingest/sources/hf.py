"""HuggingFace Hub: parameter counts, architecture, and measured quantised file sizes.

This feeds the /local view and nothing else. It never contributes a score, so it carries no
source_type. What it provides is facts about a model file - how many parameters it has, how
its attention is shaped, and how big it actually is once quantised.

Three endpoints, all anonymous, all audited in SOURCES.md:

  /api/models/{repo}                      safetensors.total, cardData.license
  /{repo}/resolve/main/config.json        layers, KV heads, head_dim, context  (307, follow it)
  /api/models/{repo}/tree/main            GGUF file sizes per quantisation

The Ollama registry would answer the third question too, and is deliberately not used: its
terms prohibit automated access without permission. See SOURCES.md.

Budget policy. Quotas are per IP over 5-minute windows - 500 API, 3000 resolver - and a
GitHub Actions runner shares its address with other tenants, so the budget may already be
partly spent by somebody else. Model metadata never changes, so this module is cache-first
and spends a small fixed budget per run on models it has never seen. A cold start fills in
over several days instead of trying to fetch everything at once and being throttled into
failure.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request

from ..common import CACHE, SourceError, USER_AGENT

API = "https://huggingface.co/api/models"
RESOLVE = "https://huggingface.co/{repo}/resolve/main/config.json"

# New repos looked up per run. Metadata is immutable, so the steady state is zero requests
# and only genuinely new models cost anything. Three requests each keeps a full run an order
# of magnitude inside the 500-per-5-minutes anonymous API quota.
DEFAULT_BUDGET = 40

# Which GGUF repository wins when several have requantised the same model. The vendor's own
# build is preferred where it exists; the rest is a declared preference list rather than
# whatever the search happened to return first, because the choice moves a published number.
# The repository actually used is recorded per row.
GGUF_PREFERENCE = ("unsloth", "bartowski", "TheBloke", "QuantFactory", "mradermacher")

# Quantisations the view offers. Anything else in the repo is ignored rather than guessed at.
QUANTISATIONS = ("Q3_K_M", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0")

_SIZE_IN_NAME = re.compile(r"(\d+(?:\.\d+)?)\s*b(?![a-z0-9])", re.I)
_QUANT_BITS = re.compile(r"^Q(\d+)", re.I)

# How far a measured bytes-per-weight may sit from the quantisation's nominal bit width
# before the pairing is rejected as "this GGUF is not this model".
#
# k-quants store scales and zero points alongside the weights, so real files run consistently
# above nominal - Q4_K_M measures 0.6078 against a nominal 0.5. The band is generous in that
# direction and tight in the other, because the failure being caught is off by an order of
# magnitude, not by a few percent.
BPW_BAND = (0.9, 1.6)


def nominal_bytes_per_weight(quant: str) -> float | None:
    """Bytes per weight implied by the name alone: Q4 -> 4 bits -> 0.5 bytes."""
    match = _QUANT_BITS.match(quant)
    return int(match.group(1)) / 8 if match else None


def plausible_size(quant: str, size: int, params_total: int) -> bool:
    """Could this file really be this model at this quantisation?

    The guard exists because matching an Arena name to a HuggingFace repository is string
    search, and string search is confidently wrong: DeepSeek-V4-Pro (1.6T parameters) matched
    a 0.1B distillation's GGUF repository, and GLM-4.6 (356B) matched GLM-4.6V-Flash. Both
    would have told a reader that a frontier model fits in 6 GB.

    Parameter counts come from safetensors and are trustworthy, so the ratio between them and
    a file size is the check that catches a mismatched repository.
    """
    nominal = nominal_bytes_per_weight(quant)
    if not nominal or not params_total:
        return False
    ratio = size / params_total / nominal
    return BPW_BAND[0] <= ratio <= BPW_BAND[1]


class RateLimited(SourceError):
    """The 5-minute window is spent. Stop asking; serve what is cached."""


def size_hint(name: str) -> float | None:
    """Parameters in billions, parsed from a model name.

    A HINT ONLY, for deciding which repositories are worth a request. It is never written to
    a field: "qwen3-30b-a3b" suggests 30B, but that is string handling, not measurement, and
    config.json wins every time they disagree.
    """
    match = _SIZE_IN_NAME.search(name)
    return float(match.group(1)) if match else None


def _get(url: str, accept_json: bool = True) -> dict | list:
    request = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json" if accept_json else "*/*",
    })
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            # The header states exactly how long the window has left, so the caller can say
            # so rather than guessing at a backoff.
            remaining = exc.headers.get("RateLimit", "")
            raise RateLimited(f"rate limited by the Hub ({remaining})") from exc
        raise SourceError(f"{url}: HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SourceError(f"{url}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SourceError(f"{url}: invalid JSON ({exc})") from exc


def model_info(repo: str) -> dict:
    """Parameter count and licence. The parameter count here is authoritative."""
    payload = _get(f"{API}/{repo}")
    safetensors = payload.get("safetensors") or {}
    return {
        "hf_repo": repo,
        "params_total": safetensors.get("total"),
        "params_by_dtype": safetensors.get("parameters") or {},
        "license": (payload.get("cardData") or {}).get("license"),
        "tags": payload.get("tags") or [],
        "downloads": payload.get("downloads"),
    }


def _text_stack(payload: dict) -> dict:
    """The transformer whose KV cache we are sizing.

    A multimodal model nests its language stack: Gemma 3 27B declares nothing at the top
    level and puts 62 layers, 16 KV heads and head_dim 128 under `text_config`. Reading only
    the top level returns all-None and produces a model with no KV term at all - a silent
    hole rather than a loud failure, which is the worse kind.
    """
    for key in ("text_config", "llm_config", "language_config"):
        nested = payload.get(key)
        if isinstance(nested, dict) and nested.get("num_hidden_layers"):
            return nested
    return payload


def architecture(repo: str, mirror: str | None = None) -> dict:
    """Attention shape and context length, from the model's own config.json.

    urllib follows the 307 that this path answers with; a client that does not follow
    redirects gets nothing here, which is worth knowing before debugging an empty result.

    Gated repositories - Gemma among them, and they are exactly the interesting sizes for a
    student's card - answer 401 to an anonymous request. Where a GGUF mirror exists it is
    ungated and carries a copy of config.json, so it is used as a fallback and recorded as
    such: it is a third party's copy, and saying so costs nothing.
    """
    source = "hf_config_json"
    try:
        payload = _get(RESOLVE.format(repo=repo), accept_json=False)
    except RateLimited:
        raise
    except SourceError:
        if not mirror:
            raise
        payload = _get(RESOLVE.format(repo=mirror), accept_json=False)
        source = "hf_config_json_mirror"

    stack = _text_stack(payload)
    heads = stack.get("num_attention_heads")
    hidden = stack.get("hidden_size")
    head_dim = stack.get("head_dim")
    if head_dim is None and heads and hidden:
        # Standard fallback: models that do not declare head_dim split hidden_size evenly.
        head_dim = hidden // heads
    return {
        "model_type": payload.get("model_type") or stack.get("model_type"),
        "n_layers": stack.get("num_hidden_layers"),
        # Multi-query and grouped-query models publish fewer KV heads than attention heads,
        # and the KV cache scales on the KV count. Falling back to n_heads when it is absent
        # is the safe direction: it overestimates rather than promising a fit that is not there.
        "n_kv_heads": stack.get("num_key_value_heads") or heads,
        "n_heads": heads,
        "head_dim": head_dim,
        "hidden_size": hidden,
        "max_context": stack.get("max_position_embeddings"),
        "n_experts": stack.get("num_experts") or stack.get("num_local_experts"),
        "n_experts_active": stack.get("num_experts_per_tok"),
        "config_source": source,
    }


def gguf_sizes(repo: str, params_total: int | None = None) -> dict[str, int]:
    """Measured bytes per quantisation, from the repository file tree.

    Sharded quantisations are skipped rather than summed: a split file set is a different
    thing from a single downloadable file, and adding the parts up quietly would produce a
    number that matches nothing the reader can actually fetch.

    When the parameter count is known, every size is checked against it and the whole
    repository is rejected if the sizes do not belong to this model. Rejecting all of it
    rather than the odd file is deliberate: a repository that is wrong about one
    quantisation is the wrong repository, not a repository with one bad file.
    """
    tree = _get(f"{API}/{repo}/tree/main?recursive=true")
    if not isinstance(tree, list):
        raise SourceError(f"{repo}: unexpected tree payload")

    sizes: dict[str, int] = {}
    for item in tree:
        path = item.get("path") or ""
        if not path.lower().endswith(".gguf"):
            continue
        if re.search(r"-\d{5}-of-\d{5}\.gguf$", path, re.I):
            continue
        size = (item.get("lfs") or {}).get("size") or item.get("size")
        if not size:
            continue
        for quant in QUANTISATIONS:
            # Anchored on separators so Q4_K_M never matches inside UD-Q4_K_XL.
            if re.search(rf"[-._]{re.escape(quant)}\.gguf$", path, re.I):
                # Smallest wins when a repo ships several builds of one quantisation: it is
                # the plain build rather than an "XL" variant carrying extra tensors.
                if quant not in sizes or size < sizes[quant]:
                    sizes[quant] = size

    if params_total and sizes:
        implausible = [
            quant for quant, size in sizes.items()
            if not plausible_size(quant, size, params_total)
        ]
        if implausible:
            raise SourceError(
                f"{repo}: file sizes do not match {params_total:,} parameters "
                f"({', '.join(implausible)}); this GGUF is a different model"
            )
    return sizes


def find_gguf_repo(repo: str) -> str | None:
    """Pick the GGUF repository for a model, vendor's own first.

    Returns None rather than guessing when nothing matches; the caller then estimates the
    size from the calibrated table and marks the row as estimated.
    """
    owner, _, name = repo.partition("/")

    # The vendor's own build, when it exists.
    for candidate in (f"{repo}-GGUF", f"{owner}/{name}-GGUF"):
        try:
            _get(f"{API}/{candidate}")
            return candidate
        except RateLimited:
            raise
        except SourceError:
            continue

    results = _get(f"{API}?search={urllib.parse.quote(name)}-GGUF&limit=30")
    if not isinstance(results, list):
        return None

    # The repository name must reduce to the same thing the model's does, once "-GGUF" and
    # quantisation suffixes are stripped. Without this, search happily returns a distillation
    # or a neighbouring model: "DeepSeek-R1-0528" matched "DeepSeek-R1-0528-Qwen3-8B-GGUF",
    # an 8B model standing in for a 684B one.
    target = _repo_key(name)
    ids = []
    for item in results:
        candidate = item.get("id") or ""
        _, _, candidate_name = candidate.partition("/")
        if candidate and _repo_key(candidate_name) == target:
            ids.append(candidate)

    for preferred in GGUF_PREFERENCE:
        for candidate in ids:
            if candidate.lower().startswith(f"{preferred.lower()}/"):
                return candidate
    return ids[0] if ids else None


def _repo_key(name: str) -> str:
    """Reduce a repository name to what identifies the model, for comparison only."""
    text = name.lower()
    text = re.sub(r"[-_.]?gguf$", "", text)
    text = re.sub(r"[-_.]?(i?q\d[a-z0-9_]*|bf16|fp16|fp8|awq|gptq|mlx)$", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def load_local_cache() -> dict:
    path = CACHE / "hf_models.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_local_cache(payload: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "hf_models.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
