"""Shared provider transport and stateful terminal chat."""

from __future__ import annotations
import os
from typing import Any, AsyncIterator
from utils.model_sdk import ModelSDK, SDKResponseStream


class TextualChatSDK:
    """Stateful streaming chat adapter intended for a Textual application."""

    def __init__(
        self,
        upstream_model: str | None = None,
        *,
        api_base: str | None = None,
        system_prompt: str | None = None,
    ) -> None:
        from .prompt import load_system_prompt

        configured_model = upstream_model or os.environ.get(
            "CODEX_MODEL",
            "chatgpt/gpt-5.6-luna",
        )
        if "/" not in configured_model:
            configured_model = f"chatgpt/{configured_model}"
        self.client = ModelSDK(
            configured_model,
            api_base=api_base or os.environ.get("CHATGPT_API_BASE") or None,
        )
        self.system_prompt = (
            system_prompt.strip() if system_prompt is not None else load_system_prompt()
        )
        self.history: list[dict[str, Any]] = []

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        """Yield response text as it arrives and retain completed chat history."""

        prompt = prompt.strip()
        if not prompt:
            return

        user_message = {
            "role": "user",
            "content": [{"type": "input_text", "text": prompt}],
        }
        stream = await self.client.responses(
            {
                "instructions": self.system_prompt,
                "input": [*self.history, user_message],
            }
        )
        response_text: list[str] = []
        completed = False

        async for event in stream.events():
            event_type = event.get("type")
            if event_type == "response.output_text.delta":
                delta = event.get("delta")
                if isinstance(delta, str) and delta:
                    response_text.append(delta)
                    yield delta
            elif event_type == "response.completed":
                completed = True

        if not completed:
            raise RuntimeError("The model stream ended before completing.")

        text = "".join(response_text)
        self.history.extend(
            [
                user_message,
                {
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": text}],
                },
            ]
        )

    def clear_history(self) -> None:
        """Start a fresh Textual chat."""

        self.history.clear()
