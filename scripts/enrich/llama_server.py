"""Local llama-server client. Stdlib only, no hosted API is ever contacted.

Talks to llama.cpp's llama-server on a loopback address through its OpenAI-compatible chat
endpoint. The model writes prose and nothing else: no number, no URL and no score ever
originates from it.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8080"
ENV_URL = "MODELHUB_LLAMA_URL"

# In router mode llama-server names each model after its GGUF file.
PRIMARY_MODEL = "qwen3-coder-30b"
FAST_MODEL = "qwen3-8b"

# One retry, then give up on that model and move on. A second failure means the output is
# unreliable, and writing unreliable prose into the repo is worse than leaving a gap.
MAX_ATTEMPTS = 2
MAX_TOKENS = 700

# Pinned per request so the output does not depend on how the server was started. No seed:
# the retry in describe() needs a fresh sample, not the same text twice.
SAMPLING = {"temperature": 0.3, "top_k": 40, "top_p": 0.95, "min_p": 0.05, "repeat_penalty": 1.0}

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError)


class LlamaServerError(RuntimeError):
    """llama-server is unreachable, refused the request, or is not local."""


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def base_url() -> str:
    """The server's URL, which must be a loopback address.

    Model calls never leave this machine, and that is enforced here rather than in a README:
    an OpenAI-compatible client is one environment variable away from a hosted API, and that
    variable must not be enough.
    """
    url = (os.environ.get(ENV_URL) or DEFAULT_URL).rstrip("/")
    parts = urllib.parse.urlsplit(url)
    local = parts.hostname is not None and _is_loopback(parts.hostname)
    if parts.scheme not in ("http", "https") or not local:
        raise LlamaServerError(
            f"{url} is not a loopback address; Layer B only talks to a local llama-server"
        )
    return url


def _build_opener() -> urllib.request.OpenerDirector:
    # An empty ProxyHandler replaces the default one, which reads HTTP_PROXY and the Windows
    # registry: a system proxy must never see the prompt, even on its way to localhost.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


_OPENER = _build_opener()


def available() -> list[str]:
    url = base_url()
    try:
        with _OPENER.open(f"{url}/v1/models", timeout=10) as response:
            payload = json.loads(response.read().decode())
    except _NETWORK_ERRORS as exc:
        raise LlamaServerError(
            f"llama-server not reachable at {url} ({exc}). "
            'Start it as described in CONTRIBUTING.md, under "Working on the code".'
        ) from exc
    return [model["id"] for model in payload.get("data", [])]


def pick_model(fast: bool = False) -> str:
    """Primary model unless --fast, falling back if the preferred one isn't served."""
    served = available()
    preferred = FAST_MODEL if fast else PRIMARY_MODEL
    if preferred in served:
        return preferred
    for candidate in (FAST_MODEL, PRIMARY_MODEL):
        if candidate in served:
            print(f"  ! {preferred} not served, using {candidate}")
            return candidate
    raise LlamaServerError(
        f"neither {PRIMARY_MODEL} nor {FAST_MODEL} is served "
        f"(the server offers: {', '.join(served) or 'nothing'}). "
        "Name the GGUF files after them in llama-server's --models-dir."
    )


def _strip_thinking(text: str) -> str:
    """qwen3 can emit reasoning in <think> blocks that must not reach the parser."""
    return _THINK_BLOCK.sub("", text).strip()


def generate_json(
    model: str, prompt: str, schema: dict | None = None, timeout: int = 600
) -> tuple[dict, float]:
    """Ask for JSON and return (parsed, seconds).

    Goes through /v1/chat/completions so the model's own chat template is applied, and
    constrains the output with the schema. Still parses defensively: the grammar constrains
    the shape but does not guarantee the keys we asked for.
    """
    url = base_url()
    last_error = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        body = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "max_tokens": MAX_TOKENS,
            **SAMPLING,
            # Thinking traces are noise here and slow generation down. qwen3-8b's template
            # honours this flag; qwen3-coder-30b has no thinking mode and ignores it.
            "chat_template_kwargs": {"enable_thinking": False},
            "response_format": (
                {"type": "json_schema", "json_schema": {"name": "reply", "schema": schema}}
                if schema
                else {"type": "json_object"}
            ),
        }
        request = urllib.request.Request(
            f"{url}/v1/chat/completions",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )

        started = time.monotonic()
        try:
            with _OPENER.open(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode())
        except _NETWORK_ERRORS as exc:
            raise LlamaServerError(f"generation failed: {exc}") from exc
        elapsed = time.monotonic() - started

        try:
            choice = payload["choices"][0]
            raw = _strip_thinking(choice["message"]["content"] or "")
        except (KeyError, IndexError, TypeError):
            last_error = f"attempt {attempt}: no message in the reply"
            print(f"    ! {last_error}")
            continue

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            last_error = (
                f"attempt {attempt}: invalid JSON ({exc}, "
                f"finish_reason={choice.get('finish_reason')})"
            )
            print(f"    ! {last_error}")
            continue

        if isinstance(parsed, dict):
            return parsed, elapsed
        last_error = f"attempt {attempt}: expected an object, got {type(parsed).__name__}"
        print(f"    ! {last_error}")

    raise ValueError(f"no usable JSON after {MAX_ATTEMPTS} attempts ({last_error})")
