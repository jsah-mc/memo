"""MoonKart tool orchestration for the direct Memo program."""

from __future__ import annotations

import re
import uuid
from typing import Any, Literal

from utils.tools.moonkart import MoonKartTool

from .sdk import ModelSDK, SDKResponseStream

MoonKartAction = Literal["start", "stop"]

_MOONKART_INTENT = re.compile(
    r"\b(?P<action>start|stop)\s+(?:the\s+)?moon\s*(?:kart|cart)\b",
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
        raise TypeError("MoonKart requests require text or message input.")
    return messages


async def run_moonkart_tool_turn(
    _sdk: ModelSDK,
    _payload: dict[str, Any],
    action: MoonKartAction,
    tool: MoonKartTool,
) -> SDKResponseStream:
    """Execute an explicit MoonKart command without asking the model again."""

    async def events():
        call_id = f"call_{uuid.uuid4().hex}"
        arguments = {"action": action}
        yield {
            "type": "memo.tool_call.started",
            "tool_call": {
                "id": call_id,
                "name": tool.name,
                "arguments": arguments,
            },
        }
        try:
            result: dict[str, Any] = await tool.execute(arguments)
        except Exception as exc:  # noqa: BLE001 - hardware backends vary by platform.
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
        if result.get("ok"):
            command = result.get("command")
            text = (
                f"MoonKart {action} command sent"
                + (f" ({command})." if command else ".")
            )
        else:
            text = f"Could not {action} MoonKart: {result.get('error', 'unknown error')}"
        yield {"type": "response.output_text.delta", "delta": text}
        yield {
            "type": "response.completed",
            "response": {
                "status": "completed",
                "output_text": text,
            },
        }

    return SDKResponseStream(events())
