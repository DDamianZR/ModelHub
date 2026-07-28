"""Local Ollama client. Stdlib only, no hosted API is ever contacted.

Everything here runs on the user's machine. The model writes prose and nothing else:
no number, no URL and no score ever originates from it.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

HOST = "http://localhost:11434"

PRIMARY_MODEL = "qwen3-coder:30b"
FAST_MODEL = "qwen3:8b"

# One retry, then give up on that model and move on. A second failure means the output is
# unreliable, and writing unreliable prose into the repo is worse than leaving a gap.
MAX_ATTEMPTS = 2

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


class OllamaError(RuntimeError):
    """Ollama is unreachable or refused the request."""


def available() -> list[str]:
    try:
        with urllib.request.urlopen(f"{HOST}/api/tags", timeout=10) as response:
            payload = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OllamaError(f"Ollama not reachable at {HOST}: {exc}") from exc
    return [model["name"] for model in payload.get("models", [])]


def pick_model(fast: bool = False) -> str:
    """Primary model unless --fast, falling back if the preferred one isn't pulled."""
    installed = available()
    preferred = FAST_MODEL if fast else PRIMARY_MODEL
    if preferred in installed:
        return preferred
    for candidate in (FAST_MODEL, PRIMARY_MODEL):
        if candidate in installed:
            print(f"  ! {preferred} not installed, using {candidate}")
            return candidate
    raise OllamaError(
        f"neither {PRIMARY_MODEL} nor {FAST_MODEL} is installed. "
        f"Run: ollama pull {PRIMARY_MODEL}"
    )


def _strip_thinking(text: str) -> str:
    """qwen3 emits reasoning in <think> blocks that must not reach the parser."""
    return _THINK_BLOCK.sub("", text).strip()


def generate_json(
    model: str, prompt: str, schema: dict | None = None, timeout: int = 600
) -> tuple[dict, float]:
    """Ask for JSON and return (parsed, seconds).

    Uses Ollama's structured-output mode, and still parses defensively: format=json
    constrains the grammar but does not guarantee the keys we asked for.
    """
    last_error = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        body = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            # Reasoning traces are noise here and slow generation down considerably.
            "think": False,
            "format": schema or "json",
            "options": {"temperature": 0.3, "num_predict": 700},
        }
        request = urllib.request.Request(
            f"{HOST}/api/generate",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )

        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode())
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise OllamaError(f"generation failed: {exc}") from exc
        elapsed = time.monotonic() - started

        raw = _strip_thinking(payload.get("response", ""))
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            last_error = f"attempt {attempt}: invalid JSON ({exc})"
            print(f"    ! {last_error}")
            continue

        if isinstance(parsed, dict):
            return parsed, elapsed
        last_error = f"attempt {attempt}: expected an object, got {type(parsed).__name__}"
        print(f"    ! {last_error}")

    raise ValueError(f"no usable JSON after {MAX_ATTEMPTS} attempts ({last_error})")
