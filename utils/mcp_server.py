"""Minimal MCP stdio server exposing Memo's tools to agent CLIs.

Spawned by ``opencode run`` (or any MCP client) as a local command. Tools are
scoped through environment variables set by the gateway's CLI runner:

- ``MEMO_MCP_TOOLS`` — comma-separated groups: ``browser``, ``computer``,
  ``integrations`` (default: all).
- ``MEMO_MCP_COMPOSIO_USER`` / ``MEMO_MCP_COMPOSIO_TOOLKITS`` /
  ``MEMO_MCP_COMPOSIO_ALLOWED`` — Composio scoping for ``integrations``.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.gateway.composio_tools import ComposioTools
from utils.tools.browser import BrowserUseTool
from utils.tools.computer import ComputerSandboxTool

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "memo", "version": "1.0.0"}

_browser = BrowserUseTool()
_computer = ComputerSandboxTool(computer_target="host")
_composio = ComposioTools()

_ENABLED = {
    item.strip()
    for item in os.environ.get(
        "MEMO_MCP_TOOLS", "browser,computer,integrations"
    ).split(",")
    if item.strip()
}
_COMPOSIO_USER = os.environ.get("MEMO_MCP_COMPOSIO_USER", "").strip()
_COMPOSIO_TOOLKITS = [
    item.strip()
    for item in os.environ.get("MEMO_MCP_COMPOSIO_TOOLKITS", "").split(",")
    if item.strip()
]
_COMPOSIO_ALLOWED = [
    item.strip()
    for item in os.environ.get("MEMO_MCP_COMPOSIO_ALLOWED", "*").split(",")
    if item.strip()
]


def _computer_tools() -> list[dict]:
    tools = []
    for definition in _computer.responses_definitions:
        fn = definition.get("function", definition)
        name = fn.get("name")
        if not name:
            continue
        tools.append(
            {
                "name": name,
                "description": fn.get("description", ""),
                "inputSchema": fn.get("parameters")
                or {"type": "object", "properties": {}},
            }
        )
    return tools


def _tool_list() -> list[dict]:
    tools: list[dict] = []
    if "browser" in _ENABLED:
        fn = _browser.function_definition.get("function", {})
        tools.append(
            {
                "name": _browser.name,
                "description": fn.get("description", "Browse the web."),
                "inputSchema": fn.get("parameters")
                or {"type": "object", "properties": {}},
            }
        )
    if "computer" in _ENABLED:
        tools.extend(_computer_tools())
    if "integrations" in _ENABLED and _COMPOSIO_USER:
        tools.append(
            {
                "name": "composio_execute",
                "description": (
                    "Execute a Composio app action. First call "
                    "composio_search_tools to find the slug, then pass the "
                    "slug and JSON arguments here."
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "slug": {"type": "string"},
                        "arguments": {"type": "object"},
                    },
                    "required": ["slug"],
                },
            }
        )
        tools.append(
            {
                "name": "composio_search_tools",
                "description": (
                    "Search the connected Composio apps for an action slug "
                    "matching a query (e.g. 'send email', 'create issue')."
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "toolkits": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["query"],
                },
            }
        )
    return tools


async def _call_tool(name: str, arguments: dict) -> dict:
    if name == _browser.name and "browser" in _ENABLED:
        return await _browser.execute(arguments)
    if "computer" in _ENABLED and name in _computer.names:
        return await _computer.execute(
            name,
            arguments,
            user_text="",
            permission_granted=True,
        )
    if name == "composio_execute" and "integrations" in _ENABLED:
        slug = str(arguments.get("slug") or "")
        slug = slug.rsplit(".", 1)[-1] if "." in slug else slug
        toolkits = arguments.get("toolkits")
        scope = (
            [str(item) for item in toolkits if str(item).strip()]
            if isinstance(toolkits, list) and toolkits
            else _COMPOSIO_TOOLKITS
        )
        args = arguments.get("arguments")
        return await asyncio.to_thread(
            _composio.execute,
            _COMPOSIO_USER,
            scope,
            slug,
            args if isinstance(args, dict) else {},
        )
    if name == "composio_search_tools" and "integrations" in _ENABLED:
        query = str(arguments.get("query") or "")
        toolkits = arguments.get("toolkits")
        scope = (
            [str(item) for item in toolkits if str(item).strip()]
            if isinstance(toolkits, list) and toolkits
            else _COMPOSIO_TOOLKITS
        )
        session = _composio.create_session(_COMPOSIO_USER, scope)
        tools = session.tools()
        query_l = query.lower()
        matches = [
            tool
            for tool in tools
            if query_l in json.dumps(tool).lower()
        ][:25]
        return {"tools": matches, "count": len(matches)}
    raise ValueError(f"Unknown or disabled tool: {name}")


async def _handle(message: dict) -> dict | None:
    method = message.get("method")
    request_id = message.get("id")
    if method is None:
        return None
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": SERVER_INFO,
            },
        }
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}
    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"tools": _tool_list()},
        }
    if method == "tools/call":
        params = message.get("params") or {}
        name = str(params.get("name") or "")
        arguments = params.get("arguments")
        if not isinstance(arguments, dict):
            arguments = {}
        try:
            result = await _call_tool(name, arguments)
            text = (
                result
                if isinstance(result, str)
                else json.dumps(result, default=str)[:50_000]
            )
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "content": [{"type": "text", "text": text}],
                },
            }
        except Exception as exc:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "content": [{"type": "text", "text": f"Error: {exc}"}],
                    "isError": True,
                },
            }
    if request_id is not None:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }
    return None


async def _serve() -> None:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[bytes] = asyncio.Queue()
    stdin = sys.stdin.buffer

    def _reader() -> None:
        while True:
            line = stdin.readline()
            if not line:
                loop.call_soon_threadsafe(queue.put_nowait, b"")
                return
            loop.call_soon_threadsafe(queue.put_nowait, line)

    threading.Thread(target=_reader, daemon=True).start()

    def _send(payload: dict) -> None:
        sys.stdout.buffer.write(json.dumps(payload).encode() + b"\n")
        sys.stdout.buffer.flush()

    while True:
        line = await queue.get()
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        messages = message if isinstance(message, list) else [message]
        for item in messages:
            if not isinstance(item, dict):
                continue
            response = await _handle(item)
            if response is not None:
                _send(response)


def main() -> None:
    try:
        asyncio.run(_serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
