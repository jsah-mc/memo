"""Responses API tool loop for Memo's local computer capability."""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncIterator
from typing import Any

from .computer import (
    ComputerSandboxTool,
    detect_computer_task,
    detect_shell_request,
    generic_app_request_name,
    known_folder_request,
)
from .desktop import detect_desktop_control_request
from .permissions import PermissionBroker

MAX_TOOL_ROUNDS = 12
APP_LABELS = {
    "notepad": "Notepad",
    "calculator": "Calculator",
    "paint": "Paint",
    "file_explorer": "File Explorer",
}
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


def _matches_approved_app_launch(command: str, user_text: str) -> bool:
    """Bind conversational approval to one plain Windows app launch."""

    requested_app = generic_app_request_name(user_text)
    if requested_app is None:
        return False
    launch = re.fullmatch(
        r'\s*start\s+""\s+"(?P<target>[^"\r\n]+)"\s*',
        command,
        re.IGNORECASE,
    )
    if launch is None:
        return False

    requested_words = {
        word.casefold()
        for word in re.findall(r"[\w+#]+", requested_app)
        if len(word) >= 2
    }
    target_words = {
        word.casefold()
        for word in re.findall(r"[\w+#]+", launch.group("target"))
        if len(word) >= 2
    }
    return bool(requested_words & target_words)


def canonical_app_launch_command(user_text: str) -> str | None:
    """Build a non-injectable Windows launch command from the user's app name."""

    folder = known_folder_request(user_text)
    if folder is not None:
        _, path = folder
        return f'start "" "{path}"'
    requested_app = generic_app_request_name(user_text)
    if requested_app is None:
        return None
    aliases = {
        "chrome": "chrome",
        "google chrome": "chrome",
        "edge": "msedge",
        "microsoft edge": "msedge",
        "firefox": "firefox",
        "visual studio code": "code",
        "vs code": "code",
        "vscode": "code",
        "windows terminal": "wt",
        "terminal": "wt",
        "microsoft word": "winword",
        "word": "winword",
        "microsoft excel": "excel",
        "excel": "excel",
        "microsoft powerpoint": "powerpnt",
        "powerpoint": "powerpnt",
        "spotify": "spotify:",
        "steam": "steam:",
        "settings": "ms-settings:",
        "windows settings": "ms-settings:",
        "microsoft store": "ms-windows-store:",
        "windows store": "ms-windows-store:",
    }
    target = aliases.get(requested_app.casefold(), requested_app)
    return f'start "" "{target}"'


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


def _response_events(response: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    async def events():
        text = response.get("output_text")
        if isinstance(text, str) and text:
            yield {"type": "response.output_text.delta", "delta": text}
        yield {"type": "response.completed", "response": response}

    return events()


async def direct_app_events(
    tool: ComputerSandboxTool,
    *,
    app: str,
    user_text: str,
) -> AsyncIterator[dict[str, Any]]:
    """Open an explicitly named app without allowing the model to decline."""

    call_id = f"call_{uuid.uuid4().hex}"
    arguments = {"app": app}
    tool_call = {
        "id": call_id,
        "name": tool.app_name,
        "arguments": arguments,
    }
    yield {"type": "memo.tool_call.started", "tool_call": tool_call}
    try:
        result = await tool.execute(
            tool.app_name,
            arguments,
            user_text=user_text,
        )
    except Exception as exc:  # noqa: BLE001 - report launcher failure to the UI.
        result = {"ok": False, "error": str(exc)}
    yield {
        "type": "memo.tool_call.completed",
        "tool_call": {
            **tool_call,
            "result": result,
            "is_error": not bool(result.get("ok")),
        },
    }

    label = APP_LABELS.get(app, app)
    if result.get("ok"):
        text = f"Opened {label}."
    else:
        text = f"Could not open {label}: {result.get('error', 'unknown error')}"
    yield {"type": "response.output_text.delta", "delta": text}
    yield {
        "type": "response.completed",
        "response": {"output_text": text, "usage": {}},
    }


async def direct_named_app_events(
    tool: ComputerSandboxTool,
    *,
    user_text: str,
    permission_broker: PermissionBroker | None,
    approved: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    """Launch an arbitrary named app without trusting a model-generated command."""

    folder = known_folder_request(user_text)
    app_name = folder[0] if folder is not None else generic_app_request_name(user_text)
    command = canonical_app_launch_command(user_text)
    if app_name is None or command is None:
        raise ValueError("The app-launch request is invalid.")

    call_id = f"call_{uuid.uuid4().hex}"
    arguments = {"command": command}
    tool_call = {
        "id": call_id,
        "name": tool.shell_name,
        "arguments": arguments,
    }
    yield {"type": "memo.tool_call.started", "tool_call": tool_call}

    permission_granted = approved
    if not permission_granted and permission_broker is not None:
        pending = permission_broker.create(
            {
                "kind": "folder_open" if folder is not None else "app_launch",
                "tool_call_id": call_id,
                "command": command,
                "cwd": str(tool.root),
                "os_isolated": False,
            }
        )
        yield {
            "type": "memo.permission.requested",
            "permission": {"id": pending.id, **pending.details},
        }
        permission_granted = await permission_broker.wait(pending.id)

    if permission_granted:
        try:
            result = await tool.execute(
                tool.shell_name,
                arguments,
                user_text=user_text,
                permission_granted=True,
            )
        except Exception as exc:  # noqa: BLE001 - report launch failure to the UI.
            result = {"ok": False, "error": str(exc)}
    else:
        result = {
            "ok": False,
            "permission_denied": True,
            "error": "The app launch was not approved.",
        }

    yield {
        "type": "memo.tool_call.completed",
        "tool_call": {
            **tool_call,
            "result": result,
            "is_error": not bool(result.get("ok")),
        },
    }
    if result.get("ok"):
        resolved = result.get("resolved_path") or result.get("resolved_name")
        if resolved is None and folder is not None:
            resolved = str(folder[1])
        resolved = resolved or app_name
        text = f"Opened {app_name} ({resolved})."
    elif result.get("permission_denied"):
        text = f"Opening {app_name} was not approved."
    else:
        text = f"Could not open {app_name}: {result.get('error', 'unknown error')}"
    yield {"type": "response.output_text.delta", "delta": text}
    yield {
        "type": "response.completed",
        "response": {"output_text": text, "usage": {}},
    }


async def computer_tool_events(
    sdk: Any,
    payload: dict[str, Any],
    tool: ComputerSandboxTool,
    permission_broker: PermissionBroker | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Let the model choose an allowed tool, execute it, and return its answer."""

    user_text = computer_request_text(payload.get("input"))
    one_time_approval = has_one_time_computer_approval(payload.get("input"))
    shell_name = getattr(tool, "shell_name", "run_shell_command")
    desktop_names = getattr(tool, "desktop_names", set())
    screen_name = getattr(
        getattr(tool, "desktop", None),
        "screen_name",
        "inspect_computer_screen",
    )
    desktop_session_granted = False
    next_payload = {
        **payload,
        "tools": [
            *(payload["tools"] if isinstance(payload.get("tools"), list) else []),
            *tool.responses_definitions,
        ],
    }
    if detect_desktop_control_request(user_text):
        next_payload["tool_choice"] = {
            "type": "function",
            "name": screen_name,
        }
    elif detect_shell_request(user_text):
        next_payload["tool_choice"] = {
            "type": "function",
            "name": shell_name,
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

    for _round in range(MAX_TOOL_ROUNDS):
        response = await (await sdk.responses(next_payload)).completed_response()
        calls = _function_calls(response, tool.names)
        if not calls:
            async for event in _response_events(response):
                yield event
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
            if name == shell_name:
                app_command = canonical_app_launch_command(user_text)
                if app_command is not None:
                    arguments = {**arguments, "command": app_command}
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
                if desktop_session_granted:
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
                            "cwd": str(tool.root),
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
            elif name == shell_name:
                command = arguments.get("command")
                if one_time_approval:
                    one_time_approval = False
                    permission_granted = isinstance(
                        command,
                        str,
                    ) and _matches_approved_app_launch(command, user_text)
                if (
                    not permission_granted
                    and isinstance(command, str)
                    and permission_broker is not None
                ):
                    pending = permission_broker.create(
                        {
                            "kind": "shell_command",
                            "tool_call_id": call_id,
                            "command": command,
                            "cwd": str(tool.root),
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

            if (name == shell_name or name in desktop_names) and not permission_granted:
                result = {
                    "ok": False,
                    "permission_denied": True,
                    "error": (
                        "The user denied or did not answer the computer permission."
                    ),
                }
            else:
                try:
                    if name == shell_name or name in desktop_names:
                        result = await tool.execute(
                            name,
                            arguments,
                            user_text=user_text,
                            permission_granted=True,
                        )
                    else:
                        result = await tool.execute(
                            name,
                            arguments,
                            user_text=user_text,
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

    raise RuntimeError("Local computer tool exceeded its maximum number of rounds.")
