"""Direct LiteLLM Python SDK adapter."""

from __future__ import annotations

import asyncio
import uuid
import warnings
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import litellm
from fastapi import HTTPException

from .codex_auth import install_codex_auth_adapter
from .serialization import as_dict

warnings.filterwarnings("ignore", message=r"^Pydantic serializer warnings:")
install_codex_auth_adapter()

SUPPORTED_RESPONSE_FIELDS = {
    "background",
    "include",
    "input",
    "instructions",
    "max_output_tokens",
    "metadata",
    "parallel_tool_calls",
    "previous_response_id",
    "prompt",
    "reasoning",
    "safety_identifier",
    "service_tier",
    "store",
    "temperature",
    "text",
    "tool_choice",
    "tools",
    "top_p",
    "truncation",
    "user",
}
_STREAM_END = object()


def _next_stream_event(iterator: Any) -> Any:
    try:
        return next(iterator)
    except StopIteration:
        return _STREAM_END


def _response_content_to_chat(content: Any) -> Any:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return content

    converted: list[dict[str, Any]] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        part_type = part.get("type")
        if part_type in {"input_text", "output_text", "text"}:
            converted.append({"type": "text", "text": str(part.get("text", ""))})
        elif part_type == "input_image":
            image_url = part.get("image_url")
            if isinstance(image_url, str):
                converted.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_url,
                            **(
                                {"detail": part["detail"]}
                                if part.get("detail") is not None
                                else {}
                            ),
                        },
                    }
                )
        else:
            converted.append(part)
    return converted


def _responses_input_to_messages(
    input_value: Any,
    instructions: Any = None,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    if isinstance(instructions, str) and instructions:
        messages.append({"role": "system", "content": instructions})

    if isinstance(input_value, str):
        messages.append({"role": "user", "content": input_value})
        return messages
    if not isinstance(input_value, list):
        raise HTTPException(status_code=422, detail="The `input` field is invalid.")

    for item in input_value:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        role = item.get("role")
        if role in {"system", "developer", "user", "assistant", "tool"}:
            message = {
                "role": role,
                "content": _response_content_to_chat(item.get("content")),
            }
            if role == "tool" and item.get("tool_call_id"):
                message["tool_call_id"] = item["tool_call_id"]
            messages.append(message)
        elif item_type == "function_call":
            call_id = (
                item.get("call_id") or item.get("id") or f"call_{uuid.uuid4().hex}"
            )
            messages.append(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": item.get("name", ""),
                                "arguments": item.get("arguments", ""),
                            },
                        }
                    ],
                }
            )
        elif item_type == "function_call_output":
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": item.get("call_id", ""),
                    "content": str(item.get("output", "")),
                }
            )
    return messages


def _responses_tools_to_chat(tools: Any) -> Any:
    if not isinstance(tools, list):
        return tools
    converted: list[Any] = []
    for tool in tools:
        if (
            isinstance(tool, dict)
            and tool.get("type") == "function"
            and "function" not in tool
        ):
            converted.append(
                {
                    "type": "function",
                    "function": {
                        key: tool[key]
                        for key in ("name", "description", "parameters", "strict")
                        if key in tool
                    },
                }
            )
        else:
            converted.append(tool)
    return converted


def _responses_tool_choice_to_chat(tool_choice: Any) -> Any:
    if (
        isinstance(tool_choice, dict)
        and tool_choice.get("type") == "function"
        and isinstance(tool_choice.get("name"), str)
    ):
        return {
            "type": "function",
            "function": {"name": tool_choice["name"]},
        }
    return tool_choice


@dataclass(slots=True)
class SDKResponseStream:
    iterator: Any

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        if hasattr(self.iterator, "__aiter__"):
            async for event in self.iterator:
                yield as_dict(event)
            return

        iterator = iter(self.iterator)
        while True:
            event = await asyncio.to_thread(_next_stream_event, iterator)
            if event is _STREAM_END:
                return
            yield as_dict(event)

    async def completed_response(self) -> dict[str, Any]:
        completed: dict[str, Any] | None = None
        output_text_parts: list[str] = []
        output_items: dict[int, dict[str, Any]] = {}

        async for event in self.events():
            if event.get("type") == "response.output_text.delta":
                delta = event.get("delta")
                if isinstance(delta, str):
                    output_text_parts.append(delta)
            if event.get("type") == "response.output_item.done":
                output_index = event.get("output_index")
                item = event.get("item")
                if isinstance(output_index, int) and isinstance(item, dict):
                    output_items[output_index] = item
            if event.get("type") == "response.completed":
                response = event.get("response")
                if isinstance(response, dict):
                    completed = response

        if completed is None:
            raise RuntimeError("Upstream stream ended without a completed response.")

        output_text = "".join(output_text_parts)
        if output_items and not completed.get("output"):
            completed["output"] = [item for _, item in sorted(output_items.items())]
        elif output_text and not completed.get("output"):
            completed["output"] = [
                {
                    "id": f"msg_{uuid.uuid4().hex}",
                    "type": "message",
                    "status": "completed",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": output_text,
                            "annotations": [],
                        }
                    ],
                }
            ]
        completed["output_text"] = output_text
        return completed


class LiteLLMSDK:
    def __init__(self, upstream_model: str, *, api_base: str | None = None):
        self.upstream_model = upstream_model
        self.api_base = api_base

    def _connection_arguments(self) -> dict[str, Any]:
        return {"api_base": self.api_base} if self.api_base else {}

    async def responses(self, payload: dict[str, Any]) -> SDKResponseStream:
        if "input" not in payload:
            raise HTTPException(
                status_code=422, detail="The `input` field is required."
            )

        if self.upstream_model.startswith("chatgpt/"):
            arguments = {
                key: payload[key] for key in SUPPORTED_RESPONSE_FIELDS if key in payload
            }
            if isinstance(arguments.get("input"), str):
                arguments["input"] = [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": arguments["input"],
                            }
                        ],
                    }
                ]
            arguments.update(
                model=self.upstream_model,
                stream=True,
                timeout=60,
                **self._connection_arguments(),
            )
            # LiteLLM's ChatGPT OAuth adapter performs blocking authentication
            # and stream reads even through `aresponses`. Keep that work off
            # FastAPI's event loop so health checks and other requests remain
            # responsive while a model request is in flight.
            try:
                iterator = await asyncio.wait_for(
                    asyncio.to_thread(litellm.responses, **arguments),
                    timeout=60,
                )
            except TimeoutError as exc:
                raise HTTPException(
                    status_code=504,
                    detail=(
                        "The ChatGPT upstream did not begin responding within "
                        "60 seconds. Check the Codex login and network connection."
                    ),
                ) from exc
            return SDKResponseStream(iterator)

        arguments: dict[str, Any] = {
            "messages": _responses_input_to_messages(
                payload["input"],
                payload.get("instructions"),
            )
        }
        direct_fields = {
            "metadata",
            "parallel_tool_calls",
            "temperature",
            "top_p",
            "user",
        }
        arguments.update({key: payload[key] for key in direct_fields if key in payload})
        if "max_output_tokens" in payload:
            arguments["max_tokens"] = payload["max_output_tokens"]
        if "tools" in payload:
            arguments["tools"] = _responses_tools_to_chat(payload["tools"])
        if "tool_choice" in payload:
            arguments["tool_choice"] = _responses_tool_choice_to_chat(
                payload["tool_choice"]
            )
        return await self.completion_stream(arguments)

    async def completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Run one non-streaming LiteLLM Chat Completions request."""

        arguments = dict(payload)
        arguments.update(
            model=self.upstream_model,
            stream=False,
            **self._connection_arguments(),
        )
        return as_dict(await litellm.acompletion(**arguments))

    async def completion_stream(self, payload: dict[str, Any]) -> SDKResponseStream:
        """Expose a LiteLLM Chat Completions stream as Responses API events."""

        arguments = dict(payload)
        arguments.update(
            model=self.upstream_model,
            stream=True,
            **self._connection_arguments(),
        )
        arguments.setdefault("stream_options", {"include_usage": True})
        iterator = await litellm.acompletion(**arguments)
        response_id = f"resp_{uuid.uuid4().hex}"

        async def response_events() -> AsyncIterator[dict[str, Any]]:
            text_parts: list[str] = []
            usage: dict[str, Any] = {}
            tool_calls: dict[int, dict[str, Any]] = {}
            async for raw_chunk in iterator:
                chunk = as_dict(raw_chunk)
                raw_usage = chunk.get("usage")
                if isinstance(raw_usage, dict):
                    usage = raw_usage

                choices = chunk.get("choices")
                if not isinstance(choices, list) or not choices:
                    continue
                choice = choices[0]
                if not isinstance(choice, dict):
                    continue
                delta = choice.get("delta")
                if not isinstance(delta, dict):
                    continue

                raw_tool_calls = delta.get("tool_calls")
                if isinstance(raw_tool_calls, list):
                    for raw_call in raw_tool_calls:
                        if not isinstance(raw_call, dict):
                            continue
                        index = raw_call.get("index", 0)
                        if not isinstance(index, int):
                            index = 0
                        call = tool_calls.setdefault(
                            index,
                            {
                                "id": "",
                                "name": "",
                                "arguments": "",
                            },
                        )
                        if isinstance(raw_call.get("id"), str):
                            call["id"] = raw_call["id"]
                        function = raw_call.get("function")
                        if isinstance(function, dict):
                            if isinstance(function.get("name"), str):
                                call["name"] += function["name"]
                            if isinstance(function.get("arguments"), str):
                                call["arguments"] += function["arguments"]

                content = delta.get("content")
                if not isinstance(content, str) or not content:
                    continue

                text_parts.append(content)
                yield {
                    "type": "response.output_text.delta",
                    "delta": content,
                }

            text = "".join(text_parts)
            output: list[dict[str, Any]] = []
            if text:
                output.append(
                    {
                        "id": f"msg_{uuid.uuid4().hex}",
                        "type": "message",
                        "status": "completed",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": text,
                                "annotations": [],
                            }
                        ],
                    }
                )
            for index, call in sorted(tool_calls.items()):
                item = {
                    "id": f"fc_{uuid.uuid4().hex}",
                    "type": "function_call",
                    "status": "completed",
                    "call_id": call["id"] or f"call_{uuid.uuid4().hex}",
                    "name": call["name"],
                    "arguments": call["arguments"],
                }
                output.append(item)
                yield {
                    "type": "response.output_item.done",
                    "output_index": index,
                    "item": item,
                }

            response = {
                "id": response_id,
                "object": "response",
                "status": "completed",
                "output": output,
                "output_text": text,
                "usage": {
                    "input_tokens": usage.get("prompt_tokens", 0),
                    "output_tokens": usage.get("completion_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
                },
            }
            yield {"type": "response.completed", "response": response}

        return SDKResponseStream(response_events())
