"""Configuration for Memo's direct, FastAPI-free AI program."""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_MODEL = "chatgpt/gpt-5.4"


def _normalized_model(value: str) -> str:
    return value if "/" in value else f"chatgpt/{value}"


@dataclass(frozen=True, slots=True)
class ProgramSettings:
    light_model: str = DEFAULT_MODEL
    heavy_model: str = DEFAULT_MODEL
    vision_model: str = DEFAULT_MODEL
    upstream_api_base: str | None = None
    browser_enabled: bool = True
    moonkart_enabled: bool = True
    computer_enabled: bool = True

    @classmethod
    def from_environment(cls) -> ProgramSettings:
        default = _normalized_model(os.environ.get("CODEX_MODEL", DEFAULT_MODEL))
        return cls(
            light_model=_normalized_model(os.environ.get("MEMO_LIGHT_MODEL", default)),
            heavy_model=_normalized_model(os.environ.get("MEMO_HEAVY_MODEL", default)),
            vision_model=_normalized_model(
                os.environ.get("MEMO_VISION_MODEL", default)
            ),
            upstream_api_base=os.environ.get("CHATGPT_API_BASE") or None,
            browser_enabled=os.environ.get("MEMO_BROWSER_ENABLED", "1") != "0",
            moonkart_enabled=os.environ.get("MEMO_MOONKART_ENABLED", "1") != "0",
            computer_enabled=os.environ.get("MEMO_COMPUTER_ENABLED", "1") != "0",
        )
