"""Computer control through CUA Driver only.

The agent's computer capability is deliberately limited to desktop capture and
input through :class:`~utils.tools.cua_desktop.CuaDesktopController`. There is
no shell, sandboxed command runner, or app-launch fallback: if CUA Driver cannot
do it, the agent cannot do it.
"""

from __future__ import annotations

import copy
import os
import re
from pathlib import Path
from typing import Any

from .cua_desktop import CuaDesktopController
from .desktop import detect_desktop_control_request

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SANDBOX_ROOT = PROJECT_ROOT / ".memo-sandbox"

_OPEN_VERB = re.compile(r"\b(?:open|launch|start|show)\b", re.IGNORECASE)
_COMMAND_VERB = re.compile(
    r"\b(?:run|execute|use)\b.*\b(?:command|terminal|shell|cmd|"
    r"echo|pwd|dir|type|mkdir|write|delete|whoami|hostname|ipconfig|"
    r"tasklist|systeminfo)\b",
    re.IGNORECASE | re.DOTALL,
)
_SHELL_REQUEST = re.compile(
    r"\b(?:run|execute)\b.{0,80}\b(?:command|terminal|shell|cmd|powershell|"
    r"pwsh|npm|npx|pnpm|yarn|uv|python|py|pip|git|dotnet|node|"
    r"pytest|ruff|ls|curl|wget|make|cmake|java|gradle|go|docker|"
    r"podman|wsl|bash|sh|[\w.-]+\.exe)\b",
    re.IGNORECASE | re.DOTALL,
)
_LOCAL_FILE_REQUEST = re.compile(
    r"\b(?:search|find|locate|look\s+for|list|open|show)\b.{0,160}"
    r"\b(?:downloads?|desktop|documents?|files?|folders?|director(?:y|ies))\b",
    re.IGNORECASE | re.DOTALL,
)
_KNOWN_FOLDER_REQUEST = re.compile(
    r"\b(?:open|show)\s+(?:(?:the|my)\s+)?"
    r"(?P<folder>downloads?|documents?|desktop)"
    r"(?:\s+(?:folder|directory))?(?:\s+in\s+file\s+explorer)?\s*[.!?]?$",
    re.IGNORECASE,
)
_GENERIC_APP_REQUEST = re.compile(
    r"\b(?:open|launch|start)\s+(?!(?:https?://|www\.))"
    r"(?!(?:(?:the|a|an)\s+)?(?:browser|website|web\s+page)\b)"
    r"(?!(?:(?:the|a|an)\s+)?moon\s*(?:kart|cart)\b)"
    r"(?!.*\b(?:notes?|documents?|files?|folders?)\s*[.!?]?$)"
    r"(?:the\s+)?(?:app(?:lication)?\s+)?[\w .()+#-]{2,100}\s*[.!?]?$",
    re.IGNORECASE,
)
APP_ALIASES: dict[str, tuple[str, ...]] = {
    "notepad": ("notepad",),
    "calculator": ("calculator", "calc"),
    "paint": ("paint",),
    "file_explorer": ("file explorer", "explorer"),
}


def _has_alias(text: str, aliases: tuple[str, ...]) -> bool:
    return any(
        re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", text, re.IGNORECASE)
        for alias in aliases
    )


def detect_app_request(text: str) -> str | None:
    """Return the explicitly requested allowlisted app, if any."""

    if not _OPEN_VERB.search(text):
        return None
    for app, aliases in APP_ALIASES.items():
        if _has_alias(text, aliases):
            return app
    return None


def detect_shell_request(text: str) -> bool:
    """Return whether the user explicitly requested a host shell action."""

    return bool(
        _SHELL_REQUEST.search(text)
        or _LOCAL_FILE_REQUEST.search(text)
        or _GENERIC_APP_REQUEST.search(text)
    )


def generic_app_request_name(text: str) -> str | None:
    """Return the name from an arbitrary application-launch request."""

    match = _GENERIC_APP_REQUEST.search(text)
    if match is None:
        return None
    request = match.group(0)
    request = re.sub(
        r"^(?:open|launch|start)\s+(?:the\s+)?"
        r"(?:app(?:lication)?\s+)?",
        "",
        request,
        flags=re.IGNORECASE,
    )
    return request.rstrip(" .!?") or None


def known_folder_request(text: str) -> tuple[str, Path] | None:
    """Return a safe, user-scoped folder explicitly requested for opening."""

    match = _KNOWN_FOLDER_REQUEST.search(text)
    if match is None:
        return None
    names = {
        "download": "Downloads",
        "downloads": "Downloads",
        "document": "Documents",
        "documents": "Documents",
        "desktop": "Desktop",
    }
    label = names[match.group("folder").casefold()]
    return label, (Path.home() / label).resolve()


def detect_computer_task(text: str) -> bool:
    """Return whether the user explicitly requested a computer action."""

    if detect_desktop_control_request(text):
        return True
    if _COMMAND_VERB.search(text):
        return True
    if detect_shell_request(text):
        return True
    return detect_app_request(text) is not None


class ComputerSandboxTool:
    """Expose CUA Driver desktop capture and input, and nothing else."""

    def __init__(
        self, root: str | Path | None = None, *, computer_target: str = "host"
    ) -> None:
        configured = root or os.environ.get("MEMO_SANDBOX_ROOT")
        self.computer_target = computer_target
        self.root = Path(configured or DEFAULT_SANDBOX_ROOT).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.desktop = CuaDesktopController(computer_target)

    @property
    def responses_definitions(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self.desktop.responses_definitions)

    @property
    def names(self) -> set[str]:
        return set(self.desktop.names)

    @property
    def desktop_names(self) -> set[str]:
        return set(self.desktop.names)

    async def execute(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        user_text: str,
        permission_granted: bool = False,
    ) -> dict[str, Any]:
        if name not in self.desktop.names:
            raise PermissionError(
                "Only CUA Driver desktop tools are available. "
                f"Unsupported computer tool: {name}"
            )
        if not permission_granted:
            raise PermissionError("Desktop control permission was not granted.")
        if name == self.desktop.screen_name:
            return await self.desktop.capture()
        return await self.desktop.control(arguments)
