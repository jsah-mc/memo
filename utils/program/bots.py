"""Shared desktop bot settings and terminal bot selection."""

from __future__ import annotations

import json
import shlex
from pathlib import Path
from typing import Any

BOT_TOOL_IDS = {"browser", "computer", "integrations"}


def bot_store_path() -> Path:
    return Path.home() / ".memo" / "bots.json"


def load_bots(path: Path | None = None) -> list[dict[str, Any]]:
    try:
        value = json.loads((path or bot_store_path()).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(value, list):
        return []
    return [
        {
            **bot,
            "allowedTools": [
                tool
                for tool in bot.get("allowedTools", sorted(BOT_TOOL_IDS))
                if isinstance(tool, str) and tool in BOT_TOOL_IDS
            ],
        }
        for bot in value
        if isinstance(bot, dict)
        and isinstance(bot.get("name"), str)
        and bot["name"].strip()
        and isinstance(bot.get("instructions"), str)
        and isinstance(bot.get("enabled"), bool)
    ]


def parse_bot_command(value: str) -> str | None:
    try:
        parts = shlex.split(value, posix=True)
    except ValueError:
        return None
    if len(parts) != 2 or parts[0].casefold() != "/bot":
        return None
    return parts[1].strip() or None


def find_bot(name: str, bots: list[dict[str, Any]]) -> dict[str, Any] | None:
    expected = name.strip().casefold()
    return next(
        (
            bot
            for bot in bots
            if bot.get("enabled") is True
            and str(bot.get("name", "")).strip().casefold() == expected
        ),
        None,
    )


def bot_prompt(bot: dict[str, Any]) -> str:
    name = str(bot["name"]).strip()
    command = str(bot.get("command", "bot")).strip()
    instructions = str(bot["instructions"]).strip()
    return "\n".join(
        part
        for part in (
            "Memo bot mode is enabled.",
            f"Your bot name is {name}.",
            f"Your command name is /{command}.",
            "Allowed tool groups: "
            + ", ".join(bot.get("allowedTools", sorted(BOT_TOOL_IDS))),
            instructions,
        )
        if part
    )
