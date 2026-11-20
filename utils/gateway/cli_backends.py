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
            "models": self.available_models(resolved),
        }
        if self.id == "codex" and resolved:
            auth = CodexAuth().status()
            result.update(auth_status=auth["status"], auth_message=auth["message"])
        return result

    def available_models(self, resolved: str | None = None) -> list[str]:
        """Return models the CLI itself reports, when it exposes a listing."""

        executable = resolved if resolved is not None else self.resolved_executable
        if not executable:
            return []
        if self.id == "ollama":
            return _ollama_models(executable)
        if self.id == "lmstudio":
            return _lmstudio_models()
        if self.id == "opencode":
            return _opencode_models(executable)
        if self.id == "hermes":
            return _hermes_models()
        return []


def _run_cli(executable: str, *args: str, timeout: int = 5) -> str:
    try:
        completed = subprocess.run(
            [executable, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return completed.stdout if completed.returncode == 0 else ""


def _ollama_models(executable: str) -> list[str]:
    output = _run_cli(executable, "list")
    if not output:
        return []
    lines = output.splitlines()
    return list(
        dict.fromkeys(
            line.split()[0] for line in lines[1:] if line.strip() and line.split()
        )
    )


def _lmstudio_models() -> list[str]:
    """LM Studio serves an OpenAI-compatible model list on its local server."""
    import json
    import urllib.request

    try:
        with urllib.request.urlopen(
            "http://127.0.0.1:1234/v1/models", timeout=3
        ) as response:
            payload = json.loads(response.read(1024 * 1024))
    except Exception:
        return []
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []
    return list(
        dict.fromkeys(
            item["id"]
            for item in data
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        )
    )


def _opencode_models(executable: str) -> list[str]:
    """`opencode models` prints one provider/model id per line."""
    output = _run_cli(executable, "models")
    return list(
        dict.fromkeys(
            line.strip()
            for line in output.splitlines()
            if "/" in line.strip() and not line.strip().startswith(("-", "#"))
        )
    )


HERMES_CATALOG_URL = "https://hermes-agent.nousresearch.com/docs/api/model-catalog.json"


def _hermes_home() -> Path:
    """Mirror Hermes' own data-home resolution (hermes_constants.py)."""
    override = os.environ.get("HERMES_HOME", "").strip()
    if override:
        return Path(os.path.expandvars(os.path.expanduser(override)))
    suffix = os.environ.get("HERMES_DATA_DIR_SUFFIX", "")
    if sys.platform == "win32":
        local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
        base = Path(local_appdata) if local_appdata else Path.home() / "AppData" / "Local"
        return base / f"hermes{suffix}"
    return Path.home() / f".hermes{suffix}"


def _hermes_catalog_ids(payload: Any) -> list[str]:
    """Model ids from a Hermes model-catalog manifest, as `<provider>:<model>`.

    That qualified form is what Hermes' own `/model` command and `--model` flag
    accept, so a selected id routes back into the CLI unchanged.
    """
    providers = payload.get("providers") if isinstance(payload, dict) else None
    if not isinstance(providers, dict):
        return []
    entries: list[str] = []
    for provider_id, provider in providers.items():
        if not isinstance(provider, dict):
            continue
        models = provider.get("models")
        if not isinstance(models, list):
            continue
        prefix = str(provider_id).strip().lower()
        if not prefix:
            continue
        for model in models:
            if not isinstance(model, dict):
                continue
            model_id = model.get("id")
            if not isinstance(model_id, str) or not model_id.strip():
                continue
            entries.append(f"{prefix}:{model_id.strip()}")
    return list(dict.fromkeys(entries))


def _hermes_models() -> list[str]:
    """Hermes' curated model list: its disk cache, else the live manifest.

    Hermes' `/model` picker reads `<hermes home>/cache/model_catalog.json`
    (same data it publishes at HERMES_CATALOG_URL); the manifest never breaks
    the picker, so a missing or stale cache is safe to ignore here too.
    """
    import json
    import urllib.request

    catalog_path = _hermes_home() / "cache" / "model_catalog.json"
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
        ids = _hermes_catalog_ids(payload)
        if ids:
            return ids
    except (OSError, ValueError):
        pass

    try:
        with urllib.request.urlopen(HERMES_CATALOG_URL, timeout=5) as response:
            payload = json.loads(response.read(1024 * 1024))
    except Exception:
        return []
    return _hermes_catalog_ids(payload)


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
    permission_mode = value.get("permissionMode", "always_ask")
    if permission_mode not in {"full_access", "approve_for_me", "always_ask"}:
        raise ValueError("memo_agent.permissionMode is invalid")
    for field in ("allowedComposioTools", "allowedMcpServers"):
        items = value.get(field, [])
        if not isinstance(items, list) or not all(
            isinstance(item, str) and item.strip() for item in items
        ):
            raise ValueError(f"memo_agent.{field} must be a list of names")
    return get_cli_backend(backend_id), model.strip()
