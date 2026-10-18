"""Run an agent's Composio tools and continue the model with their results."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from .composio_tools import ComposioTools, as_object
from .sdk import ModelSDK, SDKResponseStream


def tool_name(tool: dict[str, Any]) -> str:
    return tool.get("function", tool).get("name", "")


async def composio_tool_turn(
    sdk: ModelSDK,
    payload: dict[str, Any],
    composio: ComposioTools,
    user_id: str,
    toolkits: list[str],
    *,
    allowed_tools: list[str] | None = None,
) -> SDKResponseStream:
    session = await asyncio.to_thread(composio.create_session, user_id, toolkits)
    tools = await asyncio.to_thread(session.tools)
    if not isinstance(tools, list) or not all(isinstance(tool, dict) for tool in tools):
        raise RuntimeError("Composio returned an invalid tool collection.")
    available = {tool_name(tool) for tool in tools} - {""}
    configured = set(["*"] if allowed_tools is None else allowed_tools)
    allowed = available if "*" in configured else available & configured
    tools = [tool for tool in tools if tool_name(tool) in allowed]
    original = payload.get("input", [])
    history = (
        [{"role": "user", "content": original}]
        if isinstance(original, str)
        else list(original)
    )
    next_payload = {**payload, "tools": [*payload.get("tools", []), *tools]}
    initial = await sdk.responses({**next_payload, "input": history})

    async def events():
        stream = initial
        for turn in range(8):
            completed = None
            items: dict[int, dict[str, Any]] = {}
            async for event in stream.events():
                if event.get("type") == "response.output_item.done" and isinstance(
                    event.get("item"), dict
                ):
                    items[event.get("output_index", len(items))] = event["item"]
                if event.get("type") == "response.completed":
                    completed = event["response"]
                else:
                    yield event
            if completed is None:
                raise RuntimeError("Agent stream ended before completing.")
            output = completed.get("output") or list(items.values())
            calls = [item for item in output if item.get("type") == "function_call"]
            if not calls:
                yield {"type": "response.completed", "response": completed}
                return
            history.extend(output)
            for call in calls:
                name = call.get("name", "")
                if name not in allowed:
                    raise RuntimeError(
                        f"The agent requested a tool outside its Composio session: {name}"
                    )
                arguments = json.loads(call.get("arguments") or "{}")
                if not isinstance(arguments, dict):
                    raise ValueError("Integration tool arguments must be an object.")
                call_id = call.get("call_id") or call["id"]
                yield {
                    "type": "memo.tool_call.started",
                    "tool_call": {"id": call_id, "name": name, "arguments": arguments},
                }
                try:
                    result = as_object(
                        await asyncio.to_thread(
                            session.execute, name, arguments=arguments
                        )
                    )
                    is_error = bool(
                        isinstance(result, dict)
                        and (result.get("error") or result.get("successful") is False)
                    )
                except Exception as exc:
                    result = {
                        "error": "Integration request failed. Check the app connection and try again."
                    }
                    message = str(exc).casefold()
                    if len(toolkits) == 1 and any(
                        marker in message
                        for marker in (
                            "auth",
                            "connect",
                            "sign in",
                            "account",
                            "unauthorized",
                        )
                    ):
                        try:
                            authorization = await asyncio.to_thread(
                                composio.authorize, user_id, toolkits[0]
                            )
                            result.update(
                                memo_sign_in_url=authorization["redirect_url"],
                                toolkit=toolkits[0],
                                error=f"Sign in to {toolkits[0]} to continue.",
                            )
                        except Exception:
                            pass
                    is_error = True
                yield {
                    "type": "memo.tool_call.completed",
                    "tool_call": {
                        "id": call_id,
                        "name": name,
                        "arguments": arguments,
                        "result": result,
                        "is_error": is_error,
                    },
                }
                history.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps(result),
                    }
                )
            if turn == 7:
                raise RuntimeError(
                    "Agent reached the integration tool limit for this turn."
                )
            stream = await sdk.responses({**next_payload, "input": history})
        raise RuntimeError("Agent reached the integration tool limit for this turn.")

    return SDKResponseStream(events())
