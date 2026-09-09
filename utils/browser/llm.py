"""Browser Use chat model backed directly by Memo's LiteLLM SDK."""

from __future__ import annotations

import json
import os
from typing import Any, TypeVar, overload

from pydantic import BaseModel

from utils.tools.ai.sdk import LiteLLMSDK

T = TypeVar("T", bound=BaseModel)


def _configured_model(model: str) -> str:
    """Resolve Memo's legacy ``codex`` alias to a LiteLLM ChatGPT model."""

    if model.casefold() == "codex":
        model = os.environ.get("CODEX_MODEL", "chatgpt/gpt-5.6-luna")
    return model if "/" in model else f"chatgpt/{model}"


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(
        str(part.get("text", ""))
        for part in content
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    )


def _responses_input(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    instructions: list[str] = []
    converted: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if role in {"system", "developer"}:
            text = _message_text(content)
            if text:
                instructions.append(text)
            continue
        if role not in {"user", "assistant"}:
            continue

        if isinstance(content, str):
            parts: list[dict[str, Any]] = [
                {
                    "type": "input_text" if role == "user" else "output_text",
                    "text": content,
                }
            ]
        elif isinstance(content, list):
            parts = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    parts.append(
                        {
                            "type": (
                                "input_text" if role == "user" else "output_text"
                            ),
                            "text": str(part.get("text", "")),
                        }
                    )
                elif role == "user" and part.get("type") == "image_url":
                    image = part.get("image_url")
                    if isinstance(image, dict) and isinstance(image.get("url"), str):
                        parts.append(
                            {
                                "type": "input_image",
                                "image_url": image["url"],
                                **(
                                    {"detail": image["detail"]}
                                    if image.get("detail") is not None
                                    else {}
                                ),
                            }
                        )
        else:
            parts = []
        if parts:
            converted.append({"role": role, "content": parts})
    return "\n\n".join(instructions), converted


class MemoChatModel:
    """Implement Browser Use's chat protocol without an HTTP gateway."""

    _verified_api_keys = True

    def __init__(
        self,
        model: str,
        *,
        api_base: str | None = None,
        sdk: LiteLLMSDK | None = None,
    ) -> None:
        self.model = _configured_model(model)
        self._sdk = sdk or LiteLLMSDK(self.model, api_base=api_base)

    @property
    def provider(self) -> str:
        return "memo"

    @property
    def name(self) -> str:
        return self.model

    @property
    def model_name(self) -> str:
        return self.model

    @overload
    async def ainvoke(
        self,
        messages: list[Any],
        output_format: None = None,
        **kwargs: Any,
    ) -> Any: ...

    @overload
    async def ainvoke(
        self,
        messages: list[Any],
        output_format: type[T],
        **kwargs: Any,
    ) -> Any: ...

    async def ainvoke(
        self,
        messages: list[Any],
        output_format: type[T] | None = None,
        **kwargs: Any,
    ) -> Any:
        from browser_use.llm.openai.serializer import OpenAIMessageSerializer
        from browser_use.llm.schema import SchemaOptimizer
        from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

        del kwargs
        serialized = OpenAIMessageSerializer.serialize_messages(messages)
        instructions, input_messages = _responses_input(serialized)
        payload: dict[str, Any] = {"input": input_messages}
        if instructions:
            payload["instructions"] = instructions
        if output_format is not None:
            payload["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": "agent_output",
                    "strict": True,
                    "schema": SchemaOptimizer.create_optimized_json_schema(
                        output_format
                    ),
                }
            }

        response = await (await self._sdk.responses(payload)).completed_response()
        text = response.get("output_text")
        if not isinstance(text, str) or not text:
            raise RuntimeError("The browser reasoning model returned no text.")
        completion: str | T
        if output_format is None:
            completion = text
        else:
            try:
                completion = output_format.model_validate_json(text)
            except (ValueError, json.JSONDecodeError) as exc:
                raise RuntimeError(
                    "The browser reasoning model returned invalid structured output."
                ) from exc

        raw_usage = response.get("usage")
        usage = None
        if isinstance(raw_usage, dict):
            prompt_tokens = int(
                raw_usage.get("input_tokens") or raw_usage.get("prompt_tokens") or 0
            )
            completion_tokens = int(
                raw_usage.get("output_tokens")
                or raw_usage.get("completion_tokens")
                or 0
            )
            usage = ChatInvokeUsage(
                prompt_tokens=prompt_tokens,
                prompt_cached_tokens=None,
                prompt_cache_creation_tokens=None,
                prompt_image_tokens=None,
                completion_tokens=completion_tokens,
                total_tokens=int(
                    raw_usage.get("total_tokens")
                    or prompt_tokens + completion_tokens
                ),
            )

        return ChatInvokeCompletion(
            completion=completion,
            usage=usage,
            stop_reason="stop" if response.get("status") == "completed" else None,
        )
