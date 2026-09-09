"""Validated coding-CLI registry for Memo agents."""

from __future__ import annotations

import shutil
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class CLIBackend:
    id: str
    label: str
    executable: str
    model_flag: str | None
    native_tools_policy: str

    @property
    def installed(self) -> bool:
        return shutil.which(self.executable) is not None

    def public_dict(self) -> dict[str, Any]:
        return {**asdict(self), "installed": self.installed}


CLI_BACKENDS: tuple[CLIBackend, ...] = (
    CLIBackend("codex", "Codex CLI", "codex", "--model", "isolated"),
    CLIBackend("claude", "Claude Code", "claude", "--model", "disabled"),
    CLIBackend("antigravity", "Antigravity CLI", "agy", "--model", "isolated"),
    CLIBackend("opencode", "OpenCode", "opencode", "--model", "isolated"),
    CLIBackend("ollama", "Ollama", "ollama", None, "not-applicable"),
    CLIBackend("lmstudio", "LM Studio", "lms", None, "not-applicable"),
    CLIBackend("grok-build", "Grok Build", "grok-build", "--model", "isolated"),
    CLIBackend("cursor", "Cursor Agent", "cursor-agent", "--model", "isolated"),
    CLIBackend("pi", "Pi", "pi", "--model", "disabled"),
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
    return get_cli_backend(backend_id), model.strip()
