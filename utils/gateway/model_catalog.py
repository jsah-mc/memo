"""Live model catalog backed by models.dev (same source OpenCode/OpenMausBot use).

Fetches https://models.dev/api.json, keeps only providers Memo can route to and
only tool-calling text models, caches the result on disk for 24h, and falls back
to the last good cache when the network is unavailable.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path
from typing import Any

from utils.provider_transport import PROVIDERS

MODELS_DEV_URL = "https://models.dev/api.json"
CACHE_MAX_AGE_S = 24 * 60 * 60
FETCH_TIMEOUT_S = 10
MAX_BYTES = 20 * 1024 * 1024

# models.dev provider ids that map onto Memo provider prefixes.
PROVIDER_ALIASES = {
    "google": "google",
    "google-vertex": "google",
    "openai": "openai",
    "azure-openai": "openai",
    "anthropic": "anthropic",
    "groq": "groq",
    "openrouter": "openrouter",
    "xai": "xai",
    "minimax": "minimax",
    "vercel": "vercel",
    "ollama": "ollama",
    "lmstudio": "lmstudio",
    "opencode": "opencode",
    "opencode-go": "opencode-go",
}


def _cache_path() -> Path:
    override = os.environ.get("MEMO_MODEL_CATALOG_CACHE")
    if override:
        return Path(override)
    return Path.home() / ".memo" / "model-catalog.json"


def _usable(model: dict[str, Any]) -> bool:
    if "{" in model.get("id", "") or "}" in model.get("id", ""):
        return False
    if model.get("tool_call") is False:
        return False
    modalities = model.get("modalities") or {}
    inputs = modalities.get("input") or []
    outputs = modalities.get("output") or []
    if inputs and "text" not in inputs:
        return False
    if outputs and "text" not in outputs:
        return False
    return True


def _trim(raw: dict[str, Any]) -> dict[str, list[str]]:
    catalog: dict[str, list[str]] = {}
    for source_id, provider in raw.items():
        prefix = PROVIDER_ALIASES.get(source_id)
        if prefix is None or prefix not in PROVIDERS:
            continue
        models = provider.get("models") if isinstance(provider, dict) else None
        if not isinstance(models, dict):
            continue
        names = sorted(
            model_id
            for model_id, model in models.items()
            if isinstance(model, dict) and _usable(model)
        )
        if not names:
            continue
        bucket = catalog.setdefault(prefix, [])
        for name in names:
            entry = f"{prefix}/{name}"
            if entry not in bucket:
                bucket.append(entry)
    return catalog


def _read_cache(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("models"), dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return None


def _write_cache(path: Path, catalog: dict[str, list[str]]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(
                {"fetched_at": time.time(), "models": catalog},
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        tmp.replace(path)
    except OSError:
        pass


def load_catalog(force_refresh: bool = False) -> dict[str, list[str]]:
    """Return {provider: [provider/model, ...]} using cache or a fresh fetch."""
    path = _cache_path()
    cached = _read_cache(path)
    fresh = (
        cached is not None
        and time.time() - float(cached.get("fetched_at", 0)) < CACHE_MAX_AGE_S
    )
    if fresh and not force_refresh:
        return cached["models"]

    if os.environ.get("MEMO_DISABLE_MODEL_CATALOG_FETCH"):
        return (cached or {}).get("models", {})

    try:
        request = urllib.request.Request(
            MODELS_DEV_URL,
            headers={"accept": "application/json", "user-agent": "memo/1.0"},
        )
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_S) as response:
            raw_bytes = response.read(MAX_BYTES + 1)
        if len(raw_bytes) > MAX_BYTES:
            raise RuntimeError("models.dev payload too large")
        raw = json.loads(raw_bytes)
        if not isinstance(raw, dict):
            raise RuntimeError("models.dev payload is not an object")
        catalog = _trim(raw)
        if catalog:
            _write_cache(path, catalog)
            return catalog
    except Exception:
        pass

    if cached is not None:
        return cached["models"]
    return {}


def catalog_model_ids() -> list[str]:
    catalog = load_catalog()
    return [entry for entries in catalog.values() for entry in entries]
