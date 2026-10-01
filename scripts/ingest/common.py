"""Shared helpers for the daily ingest. Stdlib only."""
from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
CACHE = DATA / "cache"
CONFIG = ROOT / "config"

USER_AGENT = "modelhub-ingest/1.0 (+https://github.com/DDamianZR/ModelHub)"


class SourceError(RuntimeError):
    """A source could not be read. The run continues without it."""


# Every artifact downloaded this run, keyed by URL, in fetch order. Recorded so the site
# can publish what it actually read: a reader who downloads the same URL and hashes it
# gets the same digest, or the numbers did not come from where we say they did.
DIGESTS: dict[str, dict] = {}


def digest_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def fetch(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SourceError(f"{url}: {exc}") from exc
    DIGESTS[url] = {"sha256": digest_bytes(body), "bytes": len(body)}
    return body


def fetch_json(url: str, timeout: int = 120) -> dict:
    try:
        return json.loads(fetch(url, timeout).decode())
    except json.JSONDecodeError as exc:
        raise SourceError(f"{url}: invalid JSON ({exc})") from exc


# Qualifiers that describe how a model was run, not which model it is. "-pro" is
# deliberately absent: GPT-5.5 Pro is a different product from GPT-5.5, and stripping
# "-pro-unknown" once published the base model's scores under the Pro name. "-chat" is
# absent for the same reason - GPT-5 Chat is the non-reasoning ChatGPT model, not a mode
# of GPT-5.
_SUFFIXES = (
    "-max-effort", "-xhigh-effort", "-high-effort", "-medium-effort", "-low-effort",
    "-pre-release", "-unknown", "-none", "-minimal",
    "-thinking-auto", "-thinking", "-non-reasoning", "-reasoning", "-max", "-xhigh",
    "-high", "-medium", "-low", "-preview", "-exp", "-latest", "-instruct", "-it",
)

# Thinking-budget variants: claude-opus-4-1-16k, claude-haiku-4-5-8k.
_BUDGET = re.compile(r"-\d+k$")


def _naming() -> dict:
    """Hand-curated identity rules from config/naming.json, read once per process."""
    global _NAMING_CACHE
    if _NAMING_CACHE is None:
        path = CONFIG / "naming.json"
        try:
            _NAMING_CACHE = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            _NAMING_CACHE = {}
    return _NAMING_CACHE


_NAMING_CACHE: dict | None = None


def _canonical_text(name: str) -> str:
    """Lowercase, hyphenated, undated form of a raw name, before any qualifier is cut."""
    s = name.lower().strip()
    s = re.sub(r"[_\s]+", "-", s)
    s = re.sub(r"[-(]\d{8}\)?", "", s)
    s = re.sub(r"-\d{4}-\d{2}-\d{2}", "", s)
    # Epoch fuses the Pro tier and the effort into one token (gpt-5.6-sol_promax). Split
    # it so "max" is read as the effort and "pro" stays part of the name.
    s = re.sub(r"-pro(max|unknown)$", r"-pro-\1", s)
    return s


def split_name(name: str) -> tuple[str, list[str]]:
    """(canonical key, qualifiers stripped from it, outermost first).

    Effort levels and thinking modes are stripped because the same underlying model ships
    under many of them; keeping them apart would fragment the ranking. Product names that
    happen to end in an effort word (Qwen3.8-Max) are protected by config/naming.json.
    """
    s = _canonical_text(name)
    protected = 0
    for rule in _naming().get("protected_names", []):
        match = re.match(rule["pattern"], s)
        if match:
            protected = max(protected, match.end())

    qualifiers: list[str] = []
    changed = True
    while changed:
        changed = False
        for suffix in _SUFFIXES:
            if s.endswith(suffix) and len(s) - len(suffix) >= protected:
                s, changed = s[: -len(suffix)], True
                qualifiers.append(suffix[1:])
        budget = _BUDGET.search(s)
        if budget and budget.start() >= protected:
            qualifiers.append(budget.group(0)[1:])
            s, changed = s[: budget.start()], True

    s = re.sub(r"-+", "-", s).strip("-")
    s = _naming().get("aliases", {}).get(s, s)
    return s, qualifiers


def norm(name: str) -> str:
    """Collapse a vendor model string into a comparable key."""
    return split_name(name)[0]


def is_hosted(name: str) -> bool:
    """A run served by a third-party host (chutes/, fireworks/...) rather than the vendor."""
    return "/" in name


def renamed_model_ids() -> dict[str, str]:
    """Old model id -> new id, for ids an identity correction changed."""
    return dict(_naming().get("renamed_model_ids", {}))


def canonical_organization(name: str) -> str:
    """One spelling per organisation, so a vendor never splits into two providers."""
    cleaned = (name or "").strip()
    return _naming().get("organizations", {}).get(cleaned, cleaned)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def read_cache(name: str) -> dict | None:
    """Last good payload for a source, used when today's fetch fails."""
    path = CACHE / f"{name}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def write_cache(name: str, payload: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / f"{name}.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
