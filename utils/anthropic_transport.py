"""Translate the shared chat contract to Anthropic's native Messages API."""

from __future__ import annotations
import json
from typing import Any


def request_body(body: dict[str, Any]) -> dict[str, Any]:
    system = []
    messages = []
    for message in body.get("messages", []):
        role = message["role"]
        content = message.get("content")
        if role in {"system", "developer"}:
            system.append(
                content
                if isinstance(content, str)
                else "\n".join(p.get("text", "") for p in content or [])
            )
            continue
        if role == "tool":
            blocks = [
                {
                    "type": "tool_result",
                    "tool_use_id": message["tool_call_id"],
                    "content": content or "",
                }
            ]
            role = "user"
        else:
            blocks = (
                [{"type": "text", "text": content}]
                if isinstance(content, str) and content
                else []
            )
            if isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        blocks.append(part)
                    elif part.get("type") == "image_url":
                        image = part["image_url"]
                        url = image if isinstance(image, str) else image["url"]
                        if url.startswith("data:"):
                            metadata, data = url.split(",", 1)
                            source = {
                                "type": "base64",
                                "media_type": metadata[5:].split(";")[0],
                                "data": data,
                            }
                        else:
                            source = {"type": "url", "url": url}
                        blocks.append({"type": "image", "source": source})
                    else:
                        raise ValueError(
                            "This attachment type is not supported by the Anthropic Messages adapter."
                        )
            for call in message.get("tool_calls", []):
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": call["id"],
                        "name": call["function"]["name"],
                        "input": json.loads(call["function"].get("arguments") or "{}"),
                    }
                )
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"].extend(blocks)
        else:
            messages.append({"role": role, "content": blocks})
    result = {"messages": messages, "max_tokens": body.get("max_tokens", 4096)}
    if system:
        result["system"] = "\n\n".join(system)
    for key in ("temperature", "top_p"):
        if key in body:
            result[key] = body[key]
    if body.get("tools"):
        result["tools"] = [
            {
                "name": t["function"]["name"],
                "description": t["function"].get("description", ""),
                "input_schema": t["function"].get("parameters", {"type": "object"}),
            }
            for t in body["tools"]
        ]
    choice = body.get("tool_choice")
    if choice in ("auto", "required", "none"):
        if choice == "none":
            result.pop("tools", None)
        elif result.get("tools"):
            result["tool_choice"] = {"type": "any" if choice == "required" else "auto"}
    elif isinstance(choice, dict):
        result["tool_choice"] = {
            "type": "tool",
            "name": choice.get("function", choice)["name"],
        }
    return result


def completion(message: dict[str, Any]) -> dict[str, Any]:
    text = "".join(
        part.get("text", "")
        for part in message.get("content", [])
        if part["type"] == "text"
    )
    calls = [
        {
            "id": part["id"],
            "type": "function",
            "function": {"name": part["name"], "arguments": json.dumps(part["input"])},
        }
        for part in message.get("content", [])
        if part["type"] == "tool_use"
    ]
    return {
        "choices": [
            {"message": {"role": "assistant", "content": text, "tool_calls": calls}}
        ],
        "usage": usage(message.get("usage", {})),
    }


def usage(raw: dict[str, Any]) -> dict[str, int]:
    return {
        "prompt_tokens": raw.get("input_tokens", 0),
        "completion_tokens": raw.get("output_tokens", 0),
        "total_tokens": raw.get("input_tokens", 0) + raw.get("output_tokens", 0),
    }


async def chat_chunks(events):
    tokens: dict[str, Any] = {}
    async for event in events:
        kind = event.get("type")
        if kind == "message_start":
            tokens.update(event["message"].get("usage", {}))
        elif (
            kind == "content_block_start"
            and event["content_block"]["type"] == "tool_use"
        ):
            block = event["content_block"]
            yield {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": event["index"],
                                    "id": block["id"],
                                    "function": {
                                        "name": block["name"],
                                        "arguments": "",
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        elif kind == "content_block_delta":
            delta = event["delta"]
            if delta["type"] == "text_delta":
                yield {"choices": [{"delta": {"content": delta["text"]}}]}
            elif delta["type"] == "input_json_delta":
                yield {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": event["index"],
                                        "function": {
                                            "arguments": delta["partial_json"]
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
        elif kind == "message_delta":
            tokens.update(event.get("usage", {}))
        elif kind == "message_stop":
            yield {
                "choices": [{"delta": {}, "finish_reason": "stop"}],
                "usage": usage(tokens),
            }
