"""Gateway configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass

MODEL_ALIAS = "codex"
DEFAULT_UPSTREAM_MODEL = "chatgpt/gpt-5.6-luna"
DEFAULT_LIGHT_MODEL = DEFAULT_UPSTREAM_MODEL
DEFAULT_HEAVY_MODEL = DEFAULT_UPSTREAM_MODEL
DEFAULT_VISION_MODEL = DEFAULT_UPSTREAM_MODEL


@dataclass(frozen=True, slots=True)
class GatewaySettings:
    upstream_model: str = DEFAULT_UPSTREAM_MODEL
    model_alias: str = MODEL_ALIAS
    light_model: str = DEFAULT_LIGHT_MODEL
    heavy_model: str = DEFAULT_HEAVY_MODEL
    vision_model: str = DEFAULT_VISION_MODEL
    upstream_api_base: str | None = None
    computer_enabled: bool = False

    @classmethod
    def from_environment(cls) -> GatewaySettings:
        configured_model = os.environ.get("CODEX_MODEL", DEFAULT_UPSTREAM_MODEL)
        upstream_model = (
            configured_model
            if "/" in configured_model
            else f"chatgpt/{configured_model}"
        )
        return cls(
            upstream_model=upstream_model,
            light_model=upstream_model,
            heavy_model=upstream_model,
            vision_model=upstream_model,
            upstream_api_base=os.environ.get("CHATGPT_API_BASE") or None,
            computer_enabled=os.environ.get("MEMO_COMPUTER_ENABLED", "0") == "1",
        )
