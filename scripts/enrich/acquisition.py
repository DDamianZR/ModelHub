"""Where to get a model. Deterministic, then verified over HTTP.

No URL here is ever produced by the language model. Candidates are built from known
patterns and then checked; anything that does not resolve is marked unverified and kept
out of the UI until a human confirms it. A plausible-looking dead link is worse than an
absent one on a site whose entire pitch is that its data can be checked.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "modelhub-enrich/1.0"

# Provider landing pages and API docs. Hand-maintained because there is no registry for
# them; every entry was opened once by a human rather than guessed by a model.
PROVIDER_PAGES: dict[str, dict[str, str]] = {
    "anthropic": {
        "provider_page": "https://www.anthropic.com/claude",
        "api_docs": "https://docs.claude.com/en/docs/about-claude/models",
    },
    "openai": {
        "provider_page": "https://openai.com/api/",
        "api_docs": "https://platform.openai.com/docs/models",
    },
    "google-deepmind": {
        "provider_page": "https://deepmind.google/models/gemini/",
        "api_docs": "https://ai.google.dev/gemini-api/docs/models",
    },
    "google": {
        "provider_page": "https://deepmind.google/models/gemini/",
        "api_docs": "https://ai.google.dev/gemini-api/docs/models",
    },
    "meta-ai": {
        "provider_page": "https://ai.meta.com/",
        "api_docs": "https://www.llama.com/docs/overview/",
    },
    "deepseek": {
        "provider_page": "https://www.deepseek.com/",
        "api_docs": "https://api-docs.deepseek.com/",
    },
    "alibaba": {
        "provider_page": "https://qwen.ai/",
        "api_docs": "https://www.alibabacloud.com/help/en/model-studio/",
    },
    "moonshot": {
        "provider_page": "https://www.moonshot.ai/",
        "api_docs": "https://platform.moonshot.ai/docs",
    },
    "xai": {
        "provider_page": "https://x.ai/",
        "api_docs": "https://docs.x.ai/",
    },
    "mistral": {
        "provider_page": "https://mistral.ai/",
        "api_docs": "https://docs.mistral.ai/",
    },
    "z-ai-zhipu-ai": {
        "provider_page": "https://z.ai/",
        "api_docs": "https://docs.z.ai/",
    },
}


def _get(url: str, timeout: int = 20) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, b""
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, b""


def url_resolves(url: str) -> bool:
    status, _ = _get(url, timeout=15)
    return status == 200


def find_hf_repo(display_name: str, provider: str) -> str | None:
    """Search the HuggingFace Hub for the model's weights repository.

    Deterministic: the Hub's own search decides, not the language model. Only an exact-ish
    match on the returned id is accepted, so a fuzzy hit does not become a claim.
    """
    # Display names carry the chosen variant, e.g. "Kimi K3 (max)". The Hub does not know
    # about our effort labels, so search on the base name.
    base_name = display_name.split("(")[0].strip() or display_name
    query = urllib.parse.quote(base_name)
    status, body = _get(
        f"https://huggingface.co/api/models?search={query}&limit=10&sort=downloads"
        f"&direction=-1"
    )
    if status != 200 or not body:
        return None

    try:
        results = json.loads(body.decode())
    except json.JSONDecodeError:
        return None

    def normalise(text: str) -> str:
        return "".join(ch for ch in text.lower() if ch.isalnum())

    target = normalise(base_name)
    provider_key = normalise(provider)

    for entry in results:
        repo_id = entry.get("id") or ""
        owner, _, name = repo_id.partition("/")
        if not name:
            continue
        if normalise(name) == target or (
            target in normalise(name) and normalise(owner).startswith(provider_key[:4])
        ):
            return f"https://huggingface.co/{repo_id}"
    return None


def find_ollama_tag(display_name: str) -> str | None:
    """A model is only claimed to be on Ollama if its library page actually resolves."""
    slug = display_name.lower().replace(" ", "-")
    for candidate in (slug, slug.replace(".", "-"), slug.split("-(")[0]):
        if not candidate:
            continue
        if url_resolves(f"https://ollama.com/library/{candidate}"):
            return candidate
    return None


def build(model: dict) -> dict:
    """Return the acquisition block plus a per-field verification map."""
    provider_id = model.get("provider_id") or ""
    known = PROVIDER_PAGES.get(provider_id, {})

    acquisition: dict[str, str | None] = {
        "hf_repo": None,
        "provider_page": known.get("provider_page"),
        "api_docs": known.get("api_docs"),
        "ollama_tag": None,
    }
    verified: dict[str, bool] = {}

    if model.get("is_open_weights"):
        repo = find_hf_repo(model["display_name"], provider_id)
        if repo:
            acquisition["hf_repo"] = repo
        tag = find_ollama_tag(model["display_name"])
        if tag:
            acquisition["ollama_tag"] = tag

    for field, url in acquisition.items():
        if not url:
            verified[field] = False
            continue
        if field == "ollama_tag":
            # Already resolved against the library page above.
            verified[field] = True
            continue
        verified[field] = url_resolves(url)

    return {"acquisition": acquisition, "verified": verified}
