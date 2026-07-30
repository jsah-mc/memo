"""OpenAI Chat Completions compatibility helpers."""

from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import HTTPException


def _chat_content_to_responses(content: Any) -> Any:
    if not isinstance(content, list):
        return content

    converted: list[Any] = []
    for part in content:
        if not isinstance(part, dict):
            converted.append(part)
            continue

        part_type = part.get("type")
        if part_type == "text":
            converted.append({"type": "input_text", "text": part.get("text", "")})
        elif part_type == "image_url":
            image = part.get("image_url")
            if isinstance(image, str):
                converted.append({"type": "input_image", "image_url": image})
            elif isinstance(image, dict):
                image_url = image.get("url")
                if not isinstance(image_url, str) or not image_url:
                    raise HTTPException(
                        status_code=422,
                        detail="An `image_url` attachment must include a URL.",
                    )
                converted_image = {"type": "input_image", "image_url": image_url}
                if image.get("detail") is not None:
                    converted_image["detail"] = image["detail"]
                converted.append(converted_image)
            else:
                raise HTTPException(
                    status_code=422,
                    detail="An `image_url` attachment must include a URL.",
                )
        elif part_type == "file":
            file = part.get("file")
            if not isinstance(file, dict):
                raise HTTPException(
                    status_code=422,
                    detail="A `file` attachment must include a file object.",
                )
            converted_file = {"type": "input_file"}
            for source_key in ("file_data", "file_id", "file_url", "filename"):
                if file.get(source_key) is not None:
                    converted_file[source_key] = file[source_key]
            if not any(
                converted_file.get(key) for key in ("file_data", "file_id", "file_url")
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "A `file` attachment must include `file_data`, `file_id`, "
                        "or `file_url`."
                    ),
                )
            converted.append(converted_file)
        else:
            converted.append(part)

    return converted


def _chat_messages_to_responses(messages: list[Any]) -> list[Any]:
    converted: list[Any] = []
    for message in messages:
        if not isinstance(message, dict):
            converted.append(message)
            continue
        normalized = dict(message)
        if "content" in normalized:
            normalized["content"] = _chat_content_to_responses(normalized["content"])
        converted.append(normalized)
    return converted


def chat_to_responses(payload: dict[str, Any]) -> dict[str, Any]:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=422, detail="The `messages` field is required.")
    if payload.get("n", 1) != 1:
        raise HTTPException(status_code=400, detail="Only `n=1` is supported.")

    converted: dict[str, Any] = {
        "input": _chat_messages_to_responses(messages),
        "stream": payload.get("stream", False),
    }
    direct_fields = {
        "metadata",
        "parallel_tool_calls",
        "temperature",
        "tool_choice",
        "tools",
        "top_p",
        "user",
    }
    converted.update({key: payload[key] for key in direct_fields if key in payload})

    max_tokens = payload.get("max_completion_tokens", payload.get("max_tokens"))
    if max_tokens is not None:
        converted["max_output_tokens"] = max_tokens

    response_format = payload.get("response_format")
    if response_format is not None:
        converted["text"] = {"format": response_format}

    return converted


def response_text(response: dict[str, Any]) -> str:
    output_text = response.get("output_text")
    if isinstance(output_text, str):
        return output_text

    parts: list[str] = []
    for item in response.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") == "output_text":
                text = content.get("text")
                if isinstance(text, str):
                    parts.append(text)
    return "".join(parts)


def response_tool_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for item in response.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "function_call":
            continue
        calls.append(
            {
                "id": item.get("call_id")
                or item.get("id")
                or f"call_{uuid.uuid4().hex}",
                "type": "function",
                "function": {
                    "name": item.get("name", ""),
                    "arguments": item.get("arguments", ""),
                },
            }
        )
    return calls


def chat_usage(response: dict[str, Any]) -> dict[str, Any]:
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    prompt_tokens = usage.get("input_tokens", 0)
    completion_tokens = usage.get("output_tokens", 0)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": usage.get("total_tokens", prompt_tokens + completion_tokens),
    }


def to_chat_completion(
    response: dict[str, Any], model: str, request_id: str | None = None
) -> dict[str, Any]:
    tool_calls = response_tool_calls(response)
    message: dict[str, Any] = {
        "role": "assistant",
        "content": response_text(response) or None,
        "refusal": None,
        "annotations": [],
    }
    if tool_calls:
        message["tool_calls"] = tool_calls

    return {
        "id": request_id or f"chatcmpl_{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "logprobs": None,
                "finish_reason": "tool_calls" if tool_calls else "stop",
            }
        ],
        "usage": chat_usage(response),
    }


def chat_chunk(
    request_id: str,
    model: str,
    *,
    delta: dict[str, Any],
    finish_reason: str | None = None,
) -> dict[str, Any]:
    return {
        "id": request_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "logprobs": None,
                "finish_reason": finish_reason,
            }
        ],
    }
