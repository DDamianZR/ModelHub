"""Shared helpers for the daily ingest. Stdlib only."""
from __future__ import annotations

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


def fetch(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SourceError(f"{url}: {exc}") from exc


def fetch_json(url: str, timeout: int = 120) -> dict:
    try:
        return json.loads(fetch(url, timeout).decode())
    except json.JSONDecodeError as exc:
        raise SourceError(f"{url}: invalid JSON ({exc})") from exc


_SUFFIXES = (
    "-max-effort", "-xhigh-effort", "-high-effort", "-medium-effort", "-low-effort",
    "-promax", "-pro-unknown", "-prounknown", "-pre-release", "-unknown", "-none",
    "-thinking-auto", "-thinking", "-reasoning", "-max", "-xhigh", "-high", "-medium",
    "-low", "-64k", "-32k", "-128k", "-preview", "-exp", "-latest", "-instruct",
    "-chat", "-it",
)


def norm(name: str) -> str:
    """Collapse a vendor model string into a comparable key.

    Effort levels and thinking modes are stripped because the same underlying model ships
    under many of them; keeping them apart would fragment the ranking.
    """
    s = name.lower().strip()
    s = re.sub(r"[_\s]+", "-", s)
    s = re.sub(r"[-(]\d{8}\)?", "", s)
    s = re.sub(r"-\d{4}-\d{2}-\d{2}", "", s)
    changed = True
    while changed:
        changed = False
        for suffix in _SUFFIXES:
            if s.endswith(suffix):
                s, changed = s[: -len(suffix)], True
    return re.sub(r"-+", "-", s).strip("-")


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
