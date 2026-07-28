"""MoonKart tool orchestration for the direct Memo program."""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from utils.tools.moonkart import MoonKartTool

from .sdk import LiteLLMSDK, SDKResponseStream

MoonKartAction = Literal["start", "stop"]

_MOONKART_INTENT = re.compile(
    r"\b(?P<action>start|stop)\s+(?:the\s+)?moon(?:kart|cart)\b",
    re.IGNORECASE,
)
_NEGATED_ACTION = re.compile(
    r"(?:do\s+not|don't|never|not\s+to)\s*$",
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
        and part.get("type") in {"text", "input_text"}
    )


def detect_moonkart_action(input_value: Any) -> MoonKartAction | None:
    if isinstance(input_value, str):
        text = input_value
    elif isinstance(input_value, list):
        text = ""
        for item in reversed(input_value):
            if isinstance(item, dict) and item.get("role") == "user":
                text = _content_text(item.get("content"))
                break
    else:
        return None

    matches: set[str] = set()
    for match in _MOONKART_INTENT.finditer(text):
        prefix = text[max(0, match.start() - 20) : match.start()]
        if not _NEGATED_ACTION.search(prefix):
            matches.add(match.group("action").lower())
    if len(matches) != 1:
        return None
    return matches.pop()  # type: ignore[return-value]


def _responses_content(content: Any, role: str) -> Any:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    text_type = "output_text" if role == "assistant" else "input_text"
    converted: list[dict[str, Any]] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") in {"text", "input_text", "output_text"}:
            converted.append(
                {
                    "type": text_type,
                    "text": str(part.get("text", "")),
                }
            )
        elif part.get("type") == "input_image":
            image_url = part.get("image_url")
            if isinstance(image_url, str):
                converted.append(
                    {"type": "image_url", "image_url": {"url": image_url}}
                )
    return converted


def _completion_messages(
    payload: dict[str, Any],
    action: MoonKartAction,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    instructions = payload.get("instructions")
    if isinstance(instructions, str) and instructions.strip():
        messages.append({"role": "system", "content": instructions.strip()})
    messages.append(
        {
            "role": "system",
            "content": (
                f'The user explicitly authorized the MoonKart action "{action}". '
                "Call control_moonkart exactly once with that action."
            ),
        }
    )
    input_value = payload.get("input")
    if isinstance(input_value, str):
        messages.append({"role": "user", "content": input_value})
    elif isinstance(input_value, list):
        for item in input_value:
            if not isinstance(item, dict) or item.get("role") not in {
                "system",
                "user",
                "assistant",
            }:
                continue
            messages.append(
                {
                    "role": item["role"],
                    "content": _responses_content(
                        item.get("content"),
                        item["role"],
                    ),
                }
            )
    else:
        raise ValueError("MoonKart requests require text or message input.")
    return messages


async def run_moonkart_tool_turn(
    sdk: LiteLLMSDK,
    payload: dict[str, Any],
    action: MoonKartAction,
    tool: MoonKartTool,
) -> SDKResponseStream:
    messages = _completion_messages(payload, action)
    initial = await (
        await sdk.responses(
            {
                "input": list(messages),
                "tools": [tool.responses_definition],
                "tool_choice": {"type": "function", "name": tool.name},
            }
        )
    ).completed_response()

    output = initial.get("output")
    calls = (
        [
            item
            for item in output
            if isinstance(item, dict)
            and item.get("type") == "function_call"
            and item.get("name") == tool.name
        ]
        if isinstance(output, list)
        else []
    )
    if not calls:
        raise RuntimeError("The model did not call the MoonKart tool.")

    call = calls[0]
    call_id = call.get("call_id") or call.get("id")
    if not isinstance(call_id, str) or not call_id:
        raise RuntimeError("The MoonKart tool call did not include an ID.")
    try:
        arguments = json.loads(call.get("arguments", "{}"))
    except (TypeError, json.JSONDecodeError):
        arguments = {}
    if not isinstance(arguments, dict):
        arguments = {}

    async def events():
        yield {
            "type": "memo.tool_call.started",
            "tool_call": {
                "id": call_id,
                "name": tool.name,
                "arguments": arguments,
            },
        }
        if arguments.get("action") != action:
            result: dict[str, Any] = {
                "ok": False,
                "error": "The model requested an unauthorized MoonKart action.",
                "authorized_action": action,
            }
        else:
            try:
                result = await tool.execute(arguments)
            except Exception as exc:
                result = {"ok": False, "action": action, "error": str(exc)}

        yield {
            "type": "memo.tool_call.completed",
            "tool_call": {
                "id": call_id,
                "name": tool.name,
                "arguments": arguments,
                "result": result,
                "is_error": not bool(result.get("ok")),
            },
        }
        final_stream = await sdk.responses(
            {
                "input": [
                    *messages,
                    {
                        "type": "function_call",
                        "call_id": call_id,
                        "name": tool.name,
                        "arguments": json.dumps(arguments, separators=(",", ":")),
                    },
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps(result, separators=(",", ":")),
                    },
                ]
            }
        )
        async for event in final_stream.events():
            yield event

    return SDKResponseStream(events())
