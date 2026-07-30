"""Browser tool detection and execution for the direct Memo program."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from utils.tools.browser import BrowserUseTool

from .sdk import SDKResponseStream

_BROWSER_INTENT = re.compile(
    r"(?:"
    r"\buse\s+(?:the\s+)?browser\b|"
    r"\b(?:open|launch|start)\s+(?:the\s+)?browser\b|"
    r"\bbrowse(?:\s+the\s+(?:web|internet))?\b|"
    r"\bsearch\s+(?:the\s+)?(?:web|internet|online)\b|"
    r"\bsearch\s+(?:on|in|using)\s+(?:duck\s*duck\s*go|google|bing)\b|"
    r"\b(?:duck\s*duck\s*go|google|bing)\s+search\b|"
    r"\blook\s+up\b|"
    r"\b(?:visit|navigate\s+to|go\s+to)\b|"
    r"\bopen\s+(?:https?://|www\.|\S+\.(?:com|org|net|io|dev|ai)\b)"
    r")",
    re.IGNORECASE,
)


def _latest_user_text(input_value: Any) -> str:
    if isinstance(input_value, str):
        return input_value.strip()
    if not isinstance(input_value, list):
        return ""
    for item in reversed(input_value):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            return "\n".join(
                str(part.get("text", ""))
                for part in content
                if isinstance(part, dict)
                and part.get("type") in {"text", "input_text"}
            ).strip()
    return ""


def detect_browser_task(input_value: Any) -> str | None:
    task = _latest_user_text(input_value)
    if not task or not _BROWSER_INTENT.search(task):
        return None
    return task


def run_browser_tool_turn(
    task: str,
    tool: BrowserUseTool,
) -> SDKResponseStream:
    """Execute an explicitly requested browser task without an HTTP gateway."""

    async def events():
        call_id = f"call_{uuid.uuid4().hex}"
        arguments = {"task": task}
        yield {
            "type": "memo.tool_call.started",
            "tool_call": {
                "id": call_id,
                "name": tool.name,
                "arguments": arguments,
            },
        }
        try:
            result = await tool.execute(arguments)
        except Exception as exc:
            result = {"ok": False, "task": task, "error": str(exc)}

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
        output = result.get("result") if result.get("ok") else result.get("error")
        if not isinstance(output, str) or not output.strip():
            output = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        text = output.strip()
        yield {"type": "response.output_text.delta", "delta": text}
        yield {
            "type": "response.completed",
            "response": {
                "id": f"resp_{uuid.uuid4().hex}",
                "object": "response",
                "status": "completed",
                "output_text": text,
                "output": [],
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                },
            },
        }

    return SDKResponseStream(events())
