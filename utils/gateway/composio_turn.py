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
) -> SDKResponseStream:
    session = await asyncio.to_thread(composio.create_session, user_id, toolkits)
    tools = await asyncio.to_thread(session.tools)
    if not isinstance(tools, list) or not all(isinstance(tool, dict) for tool in tools):
        raise RuntimeError("Composio returned an invalid tool collection.")
    allowed = {tool_name(tool) for tool in tools} - {""}
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
                except Exception:
                    result = {
                        "error": "Integration request failed. Check the app connection in Settings and try again."
                    }
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
