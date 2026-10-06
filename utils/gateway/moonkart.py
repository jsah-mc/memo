"""Direct tool orchestration for explicitly authorized MoonKart commands."""

from __future__ import annotations

import uuid
from typing import Any

from utils.tools.ai.moonkart import MoonKartAction, detect_moonkart_action
from utils.tools.moonkart import MoonKartTool

from .sdk import ModelSDK, SDKResponseStream

__all__ = [
    "MoonKartAction",
    "detect_moonkart_action",
    "run_moonkart_tool_turn",
]


async def run_moonkart_tool_turn(
    _sdk: ModelSDK,
    _payload: dict[str, Any],
    action: MoonKartAction,
    tool: MoonKartTool,
) -> SDKResponseStream:
    """Execute an explicit gateway command without a model round trip."""

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
        except Exception as exc:  # noqa: BLE001 - BLE errors vary by platform.
            result = {
                "ok": False,
                "action": action,
                "error": str(exc),
            }

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
                "id": f"resp_{uuid.uuid4().hex}",
                "object": "response",
                "status": "completed",
                "output": [
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
                ],
                "output_text": text,
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                },
            },
        }

    return SDKResponseStream(events())
