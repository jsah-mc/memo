"""Validated coding-CLI registry for Memo agents."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from utils.codex_auth import CodexAuth


@lru_cache(maxsize=1)
def _login_shell_path() -> str:
    """Read the macOS login-shell PATH that GUI applications do not inherit."""
    if sys.platform != "darwin":
        return ""
    shell = os.environ.get("SHELL", "/bin/zsh")
    if not Path(shell).is_file():
        return ""
    marker = "__MEMO_LOGIN_PATH__="
    try:
        completed = subprocess.run(
            [shell, "-lic", f"printf '\n{marker}%s\n' \"$PATH\""],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    for line in reversed(completed.stdout.splitlines()):
        if line.startswith(marker):
            return line.removeprefix(marker).strip()
    return ""


def executable_search_path() -> str:
    """Return PATH plus user/package-manager locations used by desktop apps."""
    home = Path.home()
    paths = [item for item in os.environ.get("PATH", "").split(os.pathsep) if item]
    login_path = _login_shell_path()
    if login_path:
        paths.extend(item for item in login_path.split(os.pathsep) if item)
    paths.extend(
        str(path)
        for path in (
            home / ".local" / "bin",
            home / ".npm-global" / "bin",
            home / "Library" / "pnpm",
            home / ".bun" / "bin",
            home / ".cargo" / "bin",
            Path("/opt/homebrew/bin"),
            Path("/usr/local/bin"),
            Path("/usr/bin"),
        )
    )
    return os.pathsep.join(dict.fromkeys(paths))


@dataclass(frozen=True, slots=True)
class CLIBackend:
    id: str
    label: str
    executable: str
    model_flag: str | None
    native_tools_policy: str
    install_url: str
    install_command: str

    @property
    def resolved_executable(self) -> str | None:
        return shutil.which(self.executable, path=executable_search_path())

    @property
    def installed(self) -> bool:
        return self.resolved_executable is not None

    def public_dict(self) -> dict[str, Any]:
        resolved = self.resolved_executable
        result: dict[str, Any] = {
            **asdict(self),
            "installed": resolved is not None,
            "resolved_executable": resolved,
            "auth_status": "unknown",
            "auth_message": "",
        }
        if self.id == "codex" and resolved:
            auth = CodexAuth().status()
            result.update(auth_status=auth["status"], auth_message=auth["message"])
        return result


CLI_BACKENDS: tuple[CLIBackend, ...] = (
    CLIBackend(
        "codex",
        "Codex CLI",
        "codex",
        "--model",
        "isolated",
        "https://developers.openai.com/codex/cli",
        "npm install -g @openai/codex@latest",
    ),
    CLIBackend(
        "claude",
        "Claude Code",
        "claude",
        "--model",
        "disabled",
        "https://docs.anthropic.com/en/docs/claude-code/setup",
        "npm install -g @anthropic-ai/claude-code",
    ),
    CLIBackend(
        "antigravity",
        "Antigravity CLI",
        "agy",
        "--model",
        "isolated",
        "https://antigravity.google/download",
        "Install Antigravity, then enable its command-line tool.",
    ),
    CLIBackend(
        "opencode",
        "OpenCode",
        "opencode",
        "--model",
        "isolated",
        "https://opencode.ai/docs/",
        "npm install -g opencode-ai",
    ),
    CLIBackend(
        "ollama",
        "Ollama",
        "ollama",
        None,
        "not-applicable",
        "https://ollama.com/download",
        "brew install ollama",
    ),
    CLIBackend(
        "lmstudio",
        "LM Studio",
        "lms",
        None,
        "not-applicable",
        "https://lmstudio.ai/download",
        "Install LM Studio, then run: lms bootstrap",
    ),
    CLIBackend(
        "grok-build",
        "Grok Build",
        "grok-build",
        "--model",
        "isolated",
        "https://docs.x.ai/docs/grok-build",
        "Follow the Grok Build installation guide.",
    ),
    CLIBackend(
        "cursor",
        "Cursor Agent",
        "cursor-agent",
        "--model",
        "isolated",
        "https://cursor.com/docs/cli/installation",
        "curl https://cursor.com/install -fsS | bash",
    ),
    CLIBackend(
        "hermes",
        "Hermes Agent",
        "hermes",
        "--model",
        "disabled",
        "https://github.com/NousResearch/hermes-agent",
        "Follow the Hermes Agent installation guide.",
    ),
    CLIBackend(
        "pi",
        "Pi",
        "pi",
        "--model",
        "disabled",
        "https://github.com/badlogic/pi-mono",
        "npm install -g @mariozechner/pi-coding-agent",
    ),
)

_BACKENDS_BY_ID = {backend.id: backend for backend in CLI_BACKENDS}


def get_cli_backend(backend_id: str) -> CLIBackend:
    try:
        return _BACKENDS_BY_ID[backend_id]
    except KeyError as exc:
        raise ValueError(f"Unknown CLI backend: {backend_id}") from exc


def validate_agent_config(value: object) -> tuple[CLIBackend, str]:
    if not isinstance(value, dict):
        raise ValueError("memo_agent must be an object")
    backend_id = value.get("cli")
    model = value.get("model")
    if not isinstance(backend_id, str) or not backend_id:
        raise ValueError("memo_agent.cli must be a non-empty string")
    if not isinstance(model, str) or not model.strip():
        raise ValueError("memo_agent.model must be a non-empty string")
    allowed_tools = value.get("allowedTools")
    if allowed_tools is not None and (
        not isinstance(allowed_tools, list)
        or not all(
            isinstance(tool, str) and tool in {"browser", "computer", "integrations"}
            for tool in allowed_tools
        )
    ):
        raise ValueError("memo_agent.allowedTools contains an unknown tool group")
    return get_cli_backend(backend_id), model.strip()
