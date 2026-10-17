"""Register Memo's stdio MCP server with supported local AI agents."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any


def server_config(project_root: Path) -> dict[str, Any]:
    return {
        "command": "uv",
        "args": ["run", "--directory", str(project_root.resolve()), "memo-mcp"],
    }


def merge_json_server(path: Path, section: str, config: dict[str, Any]) -> None:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        document = {}
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Cannot update invalid JSON in {path}: {error}") from error
    if not isinstance(document, dict):
        raise TypeError(f"Cannot update non-object JSON in {path}")
    servers = document.setdefault(section, {})
    if not isinstance(servers, dict):
        raise TypeError(f"{section} in {path} must be an object")
    servers["memo"] = config
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def _run_registration(executable: str, args: list[str]) -> str:
    command = shutil.which(executable)
    if command is None:
        return "not installed"
    result = subprocess.run([command, *args], text=True, capture_output=True, check=False)
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        return f"failed: {detail or f'exit code {result.returncode}'}"
    return "registered"


def install_mcp(project_root: Path, *, agent: str = "all") -> dict[str, str]:
    config = server_config(project_root)
    command_args = config["args"]
    results: dict[str, str] = {}
    if agent in {"all", "codex"}:
        results["Codex"] = _run_registration(
            "codex", ["mcp", "add", "memo", "--", "uv", *command_args]
        )
    if agent in {"all", "claude"}:
        results["Claude Code"] = _run_registration(
            "claude",
            ["mcp", "add", "--transport", "stdio", "--scope", "user", "memo", "--", "uv", *command_args],
        )
    if agent in {"all", "cursor"}:
        path = Path.home() / ".cursor" / "mcp.json"
        merge_json_server(path, "mcpServers", config)
        results["Cursor"] = f"registered in {path}"
    if agent in {"all", "vscode"}:
        path = project_root / ".vscode" / "mcp.json"
        merge_json_server(path, "servers", config)
        results["VS Code"] = f"registered in {path}"
    return results


def registration_status(project_root: Path) -> dict[str, str]:
    expected = server_config(project_root)
    locations = {
        "Cursor": (Path.home() / ".cursor" / "mcp.json", "mcpServers"),
        "VS Code": (project_root / ".vscode" / "mcp.json", "servers"),
    }
    results: dict[str, str] = {}
    for name, (path, section) in locations.items():
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            installed = document.get(section, {}).get("memo") == expected
        except (OSError, json.JSONDecodeError, AttributeError):
            installed = False
        results[name] = "registered" if installed else "not registered"
    results["Codex"] = "CLI available" if shutil.which("codex") else "not installed"
    results["Claude Code"] = "CLI available" if shutil.which("claude") else "not installed"
    return results
