"""Responses API tool loop for Memo's CUA Driver desktop capability."""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncIterator
from typing import Any

from .browser import BrowserUseTool
from .computer import ComputerSandboxTool, detect_computer_task
from .permissions import PermissionBroker

_AFFIRMATION = (
    r"^(?:(?:yes|yeah|yep|sure|ok(?:ay)?)(?:,?\s+(?:do it|go ahead|"
    r"please|proceed))?|do it|go ahead|please do|continue|proceed)[.! ]*$"
)


def latest_user_text(input_value: Any) -> str:
    if isinstance(input_value, str):
        return input_value
    if not isinstance(input_value, list):
        return ""
    for item in reversed(input_value):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "\n".join(
                str(part.get("text", ""))
                for part in content
                if isinstance(part, dict) and part.get("type") in {"text", "input_text"}
            )
    return ""


def computer_request_text(input_value: Any) -> str:
    """Keep an immediately confirmed prior computer request in scope."""

    latest = latest_user_text(input_value)
    if not isinstance(input_value, list) or not re.match(
        _AFFIRMATION,
        latest.strip(),
        re.IGNORECASE,
    ):
        return latest

    seen_latest = False
    for item in reversed(input_value):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        if not seen_latest:
            seen_latest = True
            continue
        prior = latest_user_text([item])
        if detect_computer_task(prior):
            return prior
        break
    return latest


def has_one_time_computer_approval(input_value: Any) -> bool:
    """Return whether the latest user message confirms one prior computer action."""

    latest = latest_user_text(input_value).strip()
    if not isinstance(input_value, list) or not re.match(
        _AFFIRMATION,
        latest,
        re.IGNORECASE,
    ):
        return False

    seen_latest = False
    for item in reversed(input_value):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        if not seen_latest:
            seen_latest = True
            continue
        return detect_computer_task(latest_user_text([item]))
    return False


def _function_calls(response: dict[str, Any], names: set[str]) -> list[dict[str, Any]]:
    output = response.get("output")
    if not isinstance(output, list):
        return []
    return [
        item
        for item in output
        if isinstance(item, dict)
        and item.get("type") == "function_call"
        and item.get("name") in names
    ]


async def agent_tool_events(
    sdk: Any,
    payload: dict[str, Any],
    *,
    browser_tool: BrowserUseTool | None = None,
    computer_tool: ComputerSandboxTool | None = None,
    permission_broker: PermissionBroker | None = None,
    permission_mode: str = "always_ask",
) -> AsyncIterator[dict[str, Any]]:
    """Expose CUA Driver tools and let the model decide whether to use them."""

    user_text = computer_request_text(payload.get("input"))
    one_time_approval = has_one_time_computer_approval(payload.get("input"))
    desktop_names = getattr(computer_tool, "desktop_names", set())
    computer_names = getattr(computer_tool, "names", set())
    browser_name = getattr(browser_tool, "name", "browse_web")
    names = {*computer_names, *({browser_name} if browser_tool is not None else set())}
    definitions: list[dict[str, Any]] = []
    if browser_tool is not None:
        definition = browser_tool.function_definition
        function = definition.get("function")
        definitions.append(
            {"type": "function", **function}
            if isinstance(function, dict)
            else definition
        )
    if computer_tool is not None:
        definitions.extend(computer_tool.responses_definitions)
    desktop_session_granted = False
    next_payload = {
        **payload,
        "tools": [
            *(payload["tools"] if isinstance(payload.get("tools"), list) else []),
            *definitions,
        ],
    }
    input_value = payload.get("input", [])
    if isinstance(input_value, list):
        conversation = list(input_value)
    elif isinstance(input_value, str):
        conversation = [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": input_value}],
            }
        ]
    else:
        conversation = []

    while True:
        response: dict[str, Any] | None = None
        output_items: dict[int, dict[str, Any]] = {}
        stream = await sdk.responses(next_payload)
        async for event in stream.events():
            event_type = event.get("type")
            if event_type == "response.output_text.delta" or (
                isinstance(event_type, str) and event_type.startswith("memo.")
            ):
                yield event
            elif event_type == "response.output_item.done":
                output_index = event.get("output_index")
                item = event.get("item")
                if isinstance(output_index, int) and isinstance(item, dict):
                    output_items[output_index] = item
            elif event_type == "response.completed":
                completed = event.get("response")
                if isinstance(completed, dict):
                    response = completed
        if response is None:
            raise RuntimeError("The model stream ended before completing.")
        if output_items and not response.get("output"):
            response["output"] = [item for _, item in sorted(output_items.items())]
        calls = _function_calls(response, names)
        if not calls:
            yield {"type": "response.completed", "response": response}
            return

        outputs: list[dict[str, Any]] = []
        screenshots: list[dict[str, Any]] = []
        for call in calls[:3]:
            call_id = call.get("call_id") or call.get("id")
            if not isinstance(call_id, str) or not call_id:
                call_id = f"call_{uuid.uuid4().hex}"
            name = str(call.get("name"))
            try:
                arguments = json.loads(call.get("arguments", "{}"))
            except (TypeError, json.JSONDecodeError):
                arguments = {}
            if not isinstance(arguments, dict):
                arguments = {}
            yield {
                "type": "memo.tool_call.started",
                "tool_call": {
                    "id": call_id,
                    "name": name,
                    "arguments": arguments,
                },
            }
            permission_granted = False
            if name in desktop_names:
                if permission_mode == "full_access":
                    permission_granted = True
                    desktop_session_granted = True
                elif desktop_session_granted:
                    permission_granted = True
                elif one_time_approval:
                    one_time_approval = False
                    desktop_session_granted = True
                    permission_granted = True
                elif permission_broker is not None:
                    pending = permission_broker.create(
                        {
                            "kind": "computer_control",
                            "tool_call_id": call_id,
                            "command": (
                                "View and control the Windows desktop for this task"
                            ),
                            "cwd": str(computer_tool.root),
                            "os_isolated": False,
                        }
                    )
                    yield {
                        "type": "memo.permission.requested",
                        "permission": {
                            "id": pending.id,
                            **pending.details,
                        },
                    }
                    permission_granted = await permission_broker.wait(pending.id)
                    desktop_session_granted = permission_granted

            if name in desktop_names and not permission_granted:
                result = {
                    "ok": False,
                    "permission_denied": True,
                    "error": (
                        "The user denied or did not answer the computer permission."
                    ),
                }
            else:
                try:
                    if name == browser_name and browser_tool is not None:
                        result = await browser_tool.execute(arguments)
                    elif computer_tool is None:
                        result = {"ok": False, "error": "Computer tools are disabled."}
                    else:
                        result = await computer_tool.execute(
                            name,
                            arguments,
                            user_text=user_text,
                            permission_granted=permission_granted,
                        )
                except Exception as exc:  # noqa: BLE001 - report policy errors.
                    result = {"ok": False, "error": str(exc)}
            image_url = result.pop("image_url", None)
            if isinstance(image_url, str):
                screenshots.append(
                    {
                        "image_url": image_url,
                        "image_width": result.get("image_width"),
                        "image_height": result.get("image_height"),
                    }
                )
            yield {
                "type": "memo.tool_call.completed",
                "tool_call": {
                    "id": call_id,
                    "name": name,
                    "arguments": arguments,
                    "result": result,
                    "is_error": not bool(result.get("ok")),
                },
            }
            outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps(result, separators=(",", ":")),
                }
            )

        response_output = response.get("output")
        if isinstance(response_output, list):
            conversation.extend(response_output)
        conversation.extend(outputs)
        for screenshot in screenshots:
            conversation.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_image",
                            "image_url": screenshot["image_url"],
                        },
                        {
                            "type": "input_text",
                            "text": (
                                "Current Windows desktop screenshot. "
                                f"Its coordinate space is "
                                f"{screenshot['image_width']} by "
                                f"{screenshot['image_height']} pixels. "
                                "Continue the requested task using the computer "
                                "tools, or answer when it is complete."
                            ),
                        },
                    ],
                }
            )
        next_payload = {
            key: value
            for key, value in next_payload.items()
            if key not in {"input", "previous_response_id", "tool_choice"}
        }
        next_payload["input"] = conversation


async def computer_tool_events(
    sdk: Any,
    payload: dict[str, Any],
    tool: ComputerSandboxTool,
    permission_broker: PermissionBroker | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Backward-compatible computer-only entry point for gateway clients."""

    async for event in agent_tool_events(
        sdk,
        payload,
        computer_tool=tool,
        permission_broker=permission_broker,
    ):
        yield event
