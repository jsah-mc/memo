"""Memo's Model Context Protocol server."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from typing import Any

from mcp.server.fastmcp import FastMCP

from utils.program.bots import bot_prompt, find_bot, load_bots
from utils.tools.ai import ProgramAI


def memo_version() -> str:
    try:
        return version("memo")
    except PackageNotFoundError:
        return "development"


def list_memo_bots() -> list[dict[str, Any]]:
    """Return enabled Memo bots without leaking disabled configuration."""
    return [
        {
            "name": str(bot["name"]),
            "command": str(bot.get("command", "bot")),
            "instructions": str(bot["instructions"]),
        }
        for bot in load_bots()
        if bot.get("enabled") is True
    ]


async def ask_memo(prompt: str, bot_name: str = "") -> str:
    """Ask Memo to complete a task, optionally using a named Memo bot."""
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("prompt cannot be empty")
    system_prompt = None
    if bot_name.strip():
        bot = find_bot(bot_name, load_bots())
        if bot is None:
            raise ValueError(f"Enabled Memo bot not found: {bot_name}")
        system_prompt = bot_prompt(bot)
    ai = ProgramAI(system_prompt=system_prompt)
    try:
        return "".join([chunk async for chunk in ai.stream(prompt)])
    finally:
        await ai.close()


server = FastMCP(
    "Memo",
    instructions="Use Memo to run agent tasks and use the user's named Memo bots.",
)
server.tool()(ask_memo)
server.tool()(list_memo_bots)


@server.tool()
def memo_status() -> dict[str, Any]:
    """Return Memo MCP version and available bot count."""
    bots = list_memo_bots()
    return {"version": memo_version(), "enabled_bots": len(bots), "transport": "stdio"}


def main() -> None:
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
