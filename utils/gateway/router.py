"""Deterministic model routing for Memo gateway requests."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

RouteKind = Literal["vision", "light", "heavy"]
_HEAVY_TASK = re.compile(
    r"\b(?:"
    r"analy[sz]e|architect|benchmark|build|debug|deep\s+dive|design|"
    r"diagnose|evaluate|implement|investigate|optimi[sz]e|plan|prove|"
    r"reason|refactor|research|review|solve|strategy|write\s+(?:code|a\s+program)"
    r")\b",
    re.IGNORECASE,
)


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(
        str(part.get("text", ""))
        for part in content
        if isinstance(part, dict)
        and part.get("type") in {"text", "input_text", "output_text"}
    )


def latest_user_text(input_value: Any) -> str:
    """Extract the latest user-authored text from a Responses input."""

    if isinstance(input_value, str):
        return input_value.strip()
    if not isinstance(input_value, list):
        return ""
    for item in reversed(input_value):
        if isinstance(item, dict) and item.get("role") == "user":
            return _content_text(item.get("content")).strip()
    return ""


def _has_image(input_value: Any) -> bool:
    if not isinstance(input_value, list):
        return False
    for item in input_value:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        if any(
            isinstance(part, dict) and part.get("type") in {"input_image", "image_url"}
            for part in content
        ):
            return True
    return False


def _complexity_score(text: str, input_value: Any) -> int:
    score = 0
    if len(text) >= 700:
        score += 2
    elif len(text) >= 300:
        score += 1
    if _HEAVY_TASK.search(text):
        score += 2
    if text.count("\n") >= 8:
        score += 1
    if isinstance(input_value, list) and len(input_value) >= 8:
        score += 1
    if "```" in text:
        score += 1
    return score


@dataclass(frozen=True, slots=True)
class ModelRoute:
    kind: RouteKind
    model: str | None
    reasoning_effort: Literal["low", "medium", "high"] | None
    fallback_model: str | None = None


class ModelRouter:
    """Route all text and vision work to the configured upstream models."""

    def __init__(
        self,
        *,
        light_model: str,
        heavy_model: str,
        vision_model: str,
    ) -> None:
        self.light_model = light_model
        self.heavy_model = heavy_model
        self.vision_model = vision_model

    def route(self, payload: dict[str, Any]) -> ModelRoute:
        input_value = payload.get("input")
        text = latest_user_text(input_value)
        if _has_image(input_value):
            return ModelRoute("vision", self.vision_model, None)
        if _complexity_score(text, input_value) >= 2:
            return ModelRoute(
                "heavy",
                self.heavy_model,
                None,
                fallback_model=self.light_model,
            )
        return ModelRoute("light", self.light_model, None)
