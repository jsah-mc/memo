"""Conservative local command workspace and allowlisted app launcher."""

from __future__ import annotations

import asyncio
import copy
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, ClassVar

from .desktop import DesktopController, detect_desktop_control_request

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SANDBOX_ROOT = PROJECT_ROOT / ".memo-sandbox"
MAX_OUTPUT_BYTES = 64 * 1024
MAX_FILE_BYTES = 64 * 1024
MAX_WORKSPACE_BYTES = 10 * 1024 * 1024
MAX_WORKSPACE_FILES = 256

_COMMAND_DEFINITION = {
    "type": "function",
    "name": "run_sandboxed_command",
    "description": (
        "Run a command in Memo's restricted local workspace. There is no shell. "
        "Allowed workspace commands are echo, pwd, dir, type, mkdir, write, and "
        "delete. Allowed read-only Windows commands are whoami, hostname, "
        "ipconfig, tasklist, and systeminfo. Never claim other commands "
        "are supported."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "argv": {
                "type": "array",
                "items": {"type": "string", "maxLength": 8_000},
                "minItems": 1,
                "maxItems": 32,
                "description": "Executable or workspace command followed by arguments.",
            }
        },
        "required": ["argv"],
    },
    "strict": True,
}

_APP_DEFINITION = {
    "type": "function",
    "name": "open_allowed_app",
    "description": (
        "Open one explicitly requested allowlisted Windows app. Supported apps "
        "are Notepad, Calculator, Paint, and File Explorer. File Explorer opens "
        "only Memo's sandbox workspace."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "app": {
                "type": "string",
            },
        },
        "required": ["app"],
    },
    "strict": True,
}

_SHELL_DEFINITION = {
    "type": "function",
    "name": "run_shell_command",
    "description": (
        "Run a host shell command only after Memo shows the exact command to "
        "the user and receives one-time permission. The command starts in "
        "Memo's sandbox directory, but the host shell is not OS-isolated and "
        "can access other files. "
        + (
            "This Memo installation runs commands through Windows cmd.exe: use "
            "Windows syntax and paths such as %USERPROFILE%\\Downloads. To "
            'launch an application, use `start "" "app"` syntax. '
            if os.name == "nt"
            else
            "This Memo installation runs commands through POSIX /bin/sh on "
            "Linux: use Linux commands and paths such as ~/Downloads. Launch "
            "applications using their executable name or `xdg-open` for files "
            "and URLs. "
        )
        + "The exact command will be shown for one-time permission. Never claim "
        "the command is contained."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "command": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8_000,
                "description": "The exact shell command to show and execute.",
            }
        },
        "required": ["command"],
    },
    "strict": True,
}

_OPEN_VERB = re.compile(r"\b(?:open|launch|start|show)\b", re.IGNORECASE)
_COMMAND_VERB = re.compile(
    r"\b(?:run|execute|use)\b.*\b(?:command|terminal|shell|cmd|"
    r"echo|pwd|dir|type|mkdir|write|delete|whoami|hostname|ipconfig|"
    r"tasklist|systeminfo)\b",
    re.IGNORECASE | re.DOTALL,
)
_SHELL_REQUEST = re.compile(
    r"\b(?:run|execute)\b.{0,80}\b(?:command|terminal|shell|cmd|powershell|"
    r"pwsh|npm|npx|pnpm|yarn|uv|python|py|pip|git|cargo|dotnet|node|"
    r"pytest|ruff|ls|curl|wget|make|cmake|java|gradle|go|rustc|docker|"
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
_START_APP_COMMAND = re.compile(
    r'^\s*start\s+""\s+"(?P<target>[^"\r\n]+)"\s*$',
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
    """Return whether the user explicitly requested a host shell command."""

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
    """Return whether the user explicitly requested a command or app action."""

    if detect_desktop_control_request(text):
        return True
    if _COMMAND_VERB.search(text):
        return True
    if detect_shell_request(text):
        return True
    return detect_app_request(text) is not None


class ComputerSandboxTool:
    """Execute a deliberately small capability set inside one workspace."""

    command_name = "run_sandboxed_command"
    shell_name = "run_shell_command"
    app_name = "open_allowed_app"
    APP_ALIASES: ClassVar[dict[str, tuple[str, ...]]] = APP_ALIASES

    def __init__(self, root: str | Path | None = None) -> None:
        configured = root or os.environ.get("MEMO_SANDBOX_ROOT")
        self.root = Path(configured or DEFAULT_SANDBOX_ROOT).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.desktop = DesktopController()

    @property
    def responses_definitions(self) -> list[dict[str, Any]]:
        return [
            copy.deepcopy(_COMMAND_DEFINITION),
            copy.deepcopy(_SHELL_DEFINITION),
            copy.deepcopy(_APP_DEFINITION),
            *copy.deepcopy(self.desktop.responses_definitions),
        ]

    @property
    def names(self) -> set[str]:
        return {
            self.command_name,
            self.shell_name,
            self.app_name,
            *self.desktop.names,
        }

    @property
    def desktop_names(self) -> set[str]:
        return set(self.desktop.names)

    def _path(self, value: str, *, allow_root: bool = True) -> Path:
        candidate = (self.root / value).resolve()
        if not candidate.is_relative_to(self.root):
            raise PermissionError("Path escapes Memo's sandbox workspace.")
        if not allow_root and candidate == self.root:
            raise PermissionError("This operation cannot target the sandbox root.")
        return candidate

    @staticmethod
    def _validated_argv(value: Any) -> list[str]:
        if (
            not isinstance(value, list)
            or not value
            or len(value) > 32
            or any(
                not isinstance(item, str) or "\0" in item or len(item) > 8_000
                for item in value
            )
        ):
            raise ValueError("argv must contain 1 to 32 valid strings.")
        return value

    @staticmethod
    def _limited_output(text: str) -> tuple[str, bool]:
        encoded = text.encode()
        if len(encoded) <= MAX_OUTPUT_BYTES:
            return text, False
        return encoded[:MAX_OUTPUT_BYTES].decode(errors="replace"), True

    def _workspace_usage(self, replaced: Path | None = None) -> tuple[int, int]:
        size = 0
        files = 0
        for path in self.root.rglob("*"):
            if not path.is_file() or path == replaced:
                continue
            size += path.stat().st_size
            files += 1
        return size, files

    def _workspace_command(self, argv: list[str]) -> dict[str, Any] | None:
        command = argv[0].casefold()
        args = argv[1:]
        if command == "echo":
            stdout, truncated = self._limited_output(" ".join(args) + "\n")
            return {
                "stdout": stdout,
                "stderr": "",
                "exit_code": 0,
                "truncated": truncated,
            }
        if command == "pwd":
            if args:
                raise ValueError("pwd does not accept arguments.")
            return {"stdout": f"{self.root}\n", "stderr": "", "exit_code": 0}
        if command in {"dir", "list"}:
            if len(args) > 1:
                raise ValueError("dir accepts at most one relative path.")
            path = self._path(args[0] if args else ".")
            if not path.is_dir():
                raise FileNotFoundError(f"Directory not found: {args[0]}")
            names = sorted(
                item.name + ("/" if item.is_dir() else "") for item in path.iterdir()
            )
            stdout, truncated = self._limited_output(
                "\n".join(names) + ("\n" if names else "")
            )
            return {
                "stdout": stdout,
                "stderr": "",
                "exit_code": 0,
                "truncated": truncated,
            }
        if command in {"type", "cat"}:
            if len(args) != 1:
                raise ValueError("type requires exactly one relative file path.")
            path = self._path(args[0], allow_root=False)
            if not path.is_file():
                raise FileNotFoundError(f"File not found: {args[0]}")
            if path.stat().st_size > MAX_FILE_BYTES:
                raise ValueError("File exceeds the sandbox read limit.")
            return {
                "stdout": path.read_text(encoding="utf-8", errors="replace"),
                "stderr": "",
                "exit_code": 0,
            }
        if command == "mkdir":
            if len(args) != 1:
                raise ValueError("mkdir requires exactly one relative directory.")
            self._path(args[0], allow_root=False).mkdir(parents=True, exist_ok=True)
            return {"stdout": "", "stderr": "", "exit_code": 0}
        if command == "write":
            if len(args) != 2:
                raise ValueError("write requires a relative file path and text.")
            data = args[1].encode()
            if len(data) > MAX_FILE_BYTES:
                raise ValueError("Text exceeds the sandbox write limit.")
            path = self._path(args[0], allow_root=False)
            used_bytes, used_files = self._workspace_usage(path)
            if used_bytes + len(data) > MAX_WORKSPACE_BYTES:
                raise ValueError("Write would exceed the sandbox storage quota.")
            if not path.is_file() and used_files >= MAX_WORKSPACE_FILES:
                raise ValueError("Write would exceed the sandbox file-count quota.")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return {
                "stdout": f"Wrote {len(data)} bytes.\n",
                "stderr": "",
                "exit_code": 0,
            }
        if command in {"delete", "del"}:
            if len(args) != 1:
                raise ValueError("delete requires exactly one relative path.")
            path = self._path(args[0], allow_root=False)
            if path.is_file():
                path.unlink()
            elif path.is_dir():
                path.rmdir()
            else:
                raise FileNotFoundError(f"Path not found: {args[0]}")
            return {"stdout": "", "stderr": "", "exit_code": 0}
        return None

    @staticmethod
    def _authorize_command(argv: list[str], user_text: str) -> None:
        command = argv[0].casefold()
        lowered = user_text.casefold()
        if not re.search(rf"\b{re.escape(command.removesuffix('.exe'))}\b", lowered):
            raise PermissionError(
                f"Running '{command}' requires the user to name that command."
            )
        path_commands = {"dir", "type", "mkdir", "write", "delete"}
        if command in path_commands and len(argv) > 1:
            requested_path = argv[1].casefold().strip("\"'")
            path_spellings = {
                requested_path,
                requested_path.replace("\\", "/"),
                requested_path.replace("/", "\\"),
            }
            if not any(path and path in lowered for path in path_spellings):
                raise PermissionError(
                    "File operations require the user to name the target path."
                )
        if command == "write" and not re.search(
            r"\b(?:write|create|save)\b",
            lowered,
        ):
            raise PermissionError("Writing requires an explicit user request.")
        if command == "mkdir" and not (
            "mkdir" in lowered
            or re.search(
                r"\b(?:create|make)\b.*\b(?:directory|folder)\b",
                lowered,
                re.DOTALL,
            )
        ):
            raise PermissionError("Creating a directory requires an explicit request.")
        if command in {"delete", "del"} and not re.search(
            r"\b(?:delete|remove)\b",
            lowered,
        ):
            raise PermissionError("Deleting requires an explicit user request.")

    @staticmethod
    def _system_command(argv: list[str]) -> tuple[str, list[str]]:
        system32 = Path(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
        command = argv[0].casefold().removesuffix(".exe")
        allowed = {
            "whoami": "whoami.exe",
            "hostname": "hostname.exe",
            "ipconfig": "ipconfig.exe",
            "tasklist": "tasklist.exe",
            "systeminfo": "systeminfo.exe",
        }
        executable = allowed.get(command)
        if executable is None:
            raise PermissionError(
                f"Command '{argv[0]}' is not allowed by Memo's sandbox policy."
            )
        args = argv[1:]
        if command in {"whoami", "hostname", "tasklist", "systeminfo"} and args:
            raise PermissionError(f"{command} arguments are not allowed.")
        if command == "ipconfig" and args not in ([], ["/all"]):
            raise PermissionError("ipconfig supports only the optional /all argument.")
        return str(system32 / executable), args

    def _safe_environment(self) -> dict[str, str]:
        temporary = self.root / ".tmp"
        temporary.mkdir(exist_ok=True)
        windows = os.environ.get("SystemRoot", r"C:\Windows")
        return {
            "SystemRoot": windows,
            "WINDIR": windows,
            "PATH": str(Path(windows, "System32")),
            "TEMP": str(temporary),
            "TMP": str(temporary),
        }

    def _shell_environment(self) -> dict[str, str]:
        allowed_names = {
            "ALLUSERSPROFILE",
            "APPDATA",
            "COMSPEC",
            "HOME",
            "HOMEDRIVE",
            "HOMEPATH",
            "LANG",
            "DBUS_SESSION_BUS_ADDRESS",
            "DISPLAY",
            "HYPRLAND_INSTANCE_SIGNATURE",
            "LOCALAPPDATA",
            "NUMBER_OF_PROCESSORS",
            "OS",
            "PATH",
            "PATHEXT",
            "PROCESSOR_ARCHITECTURE",
            "PROGRAMDATA",
            "PROGRAMFILES",
            "PROGRAMFILES(X86)",
            "PROGRAMW6432",
            "SYSTEMDRIVE",
            "SYSTEMROOT",
            "USERDOMAIN",
            "USERNAME",
            "USERPROFILE",
            "WAYLAND_DISPLAY",
            "WINDIR",
            "XDG_CURRENT_DESKTOP",
            "XDG_RUNTIME_DIR",
            "XDG_SESSION_TYPE",
        }
        environment = {
            key: value
            for key, value in os.environ.items()
            if key.upper() in allowed_names
        }
        temporary = self.root / ".tmp"
        temporary.mkdir(exist_ok=True)
        environment["TEMP"] = str(temporary)
        environment["TMP"] = str(temporary)
        return environment

    @staticmethod
    def _normalized_app_name(value: str) -> str:
        return "".join(
            character for character in value.casefold() if character.isalnum()
        )

    def _resolve_start_app(self, target: str) -> tuple[str, str] | None:
        powershell = Path(
            os.environ.get("SystemRoot", r"C:\Windows"),
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
        )
        environment = self._shell_environment()
        environment["MEMO_APP_NAME"] = target
        try:
            completed = subprocess.run(
                [
                    str(powershell),
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    (
                        "Get-StartApps | Select-Object Name,AppID "
                        "| ConvertTo-Json -Compress"
                    ),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
                env=environment,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        if completed.returncode != 0 or not completed.stdout.strip():
            return None
        try:
            parsed = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return None
        apps = parsed if isinstance(parsed, list) else [parsed]
        normalized_target = self._normalized_app_name(target)
        candidates: list[tuple[int, str, str]] = []
        for app in apps:
            if not isinstance(app, dict):
                continue
            name = app.get("Name")
            app_id = app.get("AppID")
            if not isinstance(name, str) or not isinstance(app_id, str):
                continue
            normalized_name = self._normalized_app_name(name)
            if normalized_name == normalized_target:
                score = 0
            elif len(normalized_target) >= 4 and normalized_target in normalized_name:
                score = 1
            elif len(normalized_name) >= 4 and normalized_name in normalized_target:
                score = 2
            else:
                continue
            candidates.append((score, name, app_id))
        if not candidates:
            return None
        _, name, app_id = min(candidates, key=lambda candidate: candidate[:2])
        return name, app_id

    def _resolve_executable(self, target: str) -> Path | None:
        if target.endswith(":"):
            return None
        supplied = Path(target).expanduser()
        if supplied.is_file():
            return supplied.resolve()

        aliases = {
            "chrome": "chrome.exe",
            "code": "Code.exe",
            "excel": "EXCEL.EXE",
            "firefox": "firefox.exe",
            "msedge": "msedge.exe",
            "powerpnt": "POWERPNT.EXE",
            "winword": "WINWORD.EXE",
            "wt": "wt.exe",
        }
        executable_name = aliases.get(
            target.casefold(),
            target if target.casefold().endswith(".exe") else f"{target}.exe",
        )
        on_path = shutil.which(executable_name)
        if on_path:
            return Path(on_path).resolve()

        if os.name == "nt":
            try:
                import winreg

                registry_path = (
                    r"Software\Microsoft\Windows\CurrentVersion\App Paths"
                    f"\\{executable_name}"
                )
                for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                    for view in (
                        0,
                        getattr(winreg, "KEY_WOW64_64KEY", 0),
                        getattr(winreg, "KEY_WOW64_32KEY", 0),
                    ):
                        try:
                            with winreg.OpenKey(
                                hive,
                                registry_path,
                                0,
                                winreg.KEY_READ | view,
                            ) as key:
                                value, _ = winreg.QueryValueEx(key, None)
                        except OSError:
                            continue
                        candidate = Path(str(value).strip('"'))
                        if candidate.is_file():
                            return candidate.resolve()
            except ImportError:
                pass

        normalized = self._normalized_app_name(Path(executable_name).stem)
        roots = [
            path
            for value, suffix in (
                (os.environ.get("LOCALAPPDATA"), "Programs"),
                (os.environ.get("ProgramFiles"), ""),
                (os.environ.get("ProgramFiles(x86)"), ""),
            )
            if value
            for path in [Path(value, suffix)]
        ]
        for root in roots:
            if not root.is_dir():
                continue
            direct_candidates = (
                root / target / executable_name,
                root / target.capitalize() / executable_name,
            )
            for candidate in direct_candidates:
                if candidate.is_file():
                    return candidate.resolve()
            if root.name.casefold() != "programs":
                continue
            for candidate in root.glob("*/*.exe"):
                if self._normalized_app_name(candidate.stem) == normalized:
                    return candidate.resolve()
        return None

    def _launch_windows_app(self, target: str) -> dict[str, Any]:
        executable = self._resolve_executable(target)
        if executable is not None:
            process = subprocess.Popen(
                [str(executable)],
                cwd=executable.parent,
                env=self._shell_environment(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            return {
                "ok": True,
                "resolved_name": executable.stem,
                "resolved_path": str(executable),
                "target": target,
                "pid": process.pid,
                "resolution": "executable",
            }

        resolved = self._resolve_start_app(target)
        if resolved is not None:
            name, app_id = resolved
            explorer = Path(
                os.environ.get("SystemRoot", r"C:\Windows"),
                "explorer.exe",
            )
            subprocess.Popen(
                [str(explorer), f"shell:AppsFolder\\{app_id}"],
                cwd=self.root,
                env=self._shell_environment(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            return {
                "ok": True,
                "resolved_name": name,
                "target": target,
                "resolution": "windows_start_apps",
            }

        try:
            os.startfile(target)  # type: ignore[attr-defined]
        except OSError as exc:
            return {
                "ok": False,
                "target": target,
                "resolution": "windows_shell",
                "error": f"Windows could not resolve the app '{target}': {exc}",
            }
        return {
            "ok": True,
            "target": target,
            "resolution": "windows_shell",
        }

    def _launch_linux_app(self, target: str) -> dict[str, Any]:
        supplied = Path(target).expanduser()
        if supplied.exists():
            command = shutil.which("xdg-open")
            arguments = [str(supplied.resolve())]
            resolved_name = supplied.name
            resolution = "xdg_open"
        else:
            aliases = {
                "chrome": ("google-chrome-stable", "google-chrome", "chromium"),
                "google chrome": (
                    "google-chrome-stable",
                    "google-chrome",
                    "chromium",
                ),
                "edge": ("microsoft-edge-stable", "microsoft-edge"),
                "firefox": ("firefox",),
                "spotify": ("spotify",),
                "steam": ("steam",),
                "terminal": ("xdg-terminal-exec",),
                "visual studio code": ("code",),
                "vs code": ("code",),
                "vscode": ("code",),
                "zed": ("zeditor", "zed"),
            }
            candidates = aliases.get(target.casefold(), (target,))
            command = next(
                (resolved for name in candidates if (resolved := shutil.which(name))),
                None,
            )
            arguments = []
            resolved_name = Path(command).name if command else target
            resolution = "linux_executable"

        if command is None:
            return {
                "ok": False,
                "target": target,
                "resolution": "linux_executable",
                "error": f"Linux could not resolve the app '{target}'.",
            }

        try:
            process = subprocess.Popen(
                [command, *arguments],
                cwd=self.root,
                env=self._shell_environment(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
                start_new_session=True,
            )
        except OSError as exc:
            return {
                "ok": False,
                "target": target,
                "resolution": resolution,
                "error": f"Linux could not launch '{target}': {exc}",
            }
        return {
            "ok": True,
            "resolved_name": resolved_name,
            "resolved_path": command,
            "target": target,
            "pid": process.pid,
            "resolution": resolution,
        }

    async def run_command(
        self,
        arguments: dict[str, Any],
        *,
        user_text: str,
    ) -> dict[str, Any]:
        argv = self._validated_argv(arguments.get("argv"))
        self._authorize_command(argv, user_text)
        timeout = arguments.get("timeout_seconds", 10)
        if not isinstance(timeout, int) or not 1 <= timeout <= 30:
            raise ValueError("timeout_seconds must be between 1 and 30.")

        internal = await asyncio.to_thread(self._workspace_command, argv)
        if internal is not None:
            return {
                "ok": internal["exit_code"] == 0,
                "sandbox": "capability_policy",
                "os_isolated": False,
                "root": str(self.root),
                "argv": argv,
                **internal,
            }

        executable, args = self._system_command(argv)
        process = await asyncio.create_subprocess_exec(
            executable,
            *args,
            cwd=self.root,
            env=self._safe_environment(),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout,
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            return {
                "ok": False,
                "sandbox": "capability_policy",
                "os_isolated": False,
                "root": str(self.root),
                "argv": argv,
                "exit_code": None,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds.",
            }

        return {
            "ok": process.returncode == 0,
            "sandbox": "capability_policy",
            "os_isolated": False,
            "root": str(self.root),
            "argv": argv,
            "exit_code": process.returncode,
            "stdout": stdout[:MAX_OUTPUT_BYTES].decode(errors="replace"),
            "stderr": stderr[:MAX_OUTPUT_BYTES].decode(errors="replace"),
            "truncated": len(stdout) > MAX_OUTPUT_BYTES
            or len(stderr) > MAX_OUTPUT_BYTES,
        }

    async def run_shell(
        self,
        arguments: dict[str, Any],
        *,
        permission_granted: bool,
    ) -> dict[str, Any]:
        if not permission_granted:
            raise PermissionError("Shell command permission was not granted.")
        command = arguments.get("command")
        if (
            not isinstance(command, str)
            or not command.strip()
            or "\0" in command
            or len(command) > 8_000
        ):
            raise ValueError("command must contain 1 to 8,000 valid characters.")
        command = command.strip()

        if os.name == "nt":
            app_launch = _START_APP_COMMAND.fullmatch(command)
            if app_launch is not None:
                result = await asyncio.to_thread(
                    self._launch_windows_app,
                    app_launch.group("target"),
                )
                return {
                    **result,
                    "permission_granted": True,
                    "sandbox": "working_directory_only",
                    "os_isolated": False,
                    "command": command,
                    "cwd": str(self.root),
                    "exit_code": 0 if result.get("ok") else 1,
                    "stdout": "",
                    "stderr": "" if result.get("ok") else str(result.get("error", "")),
                }
            shell = str(
                Path(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "cmd.exe")
            )
            shell_args = ["/d", "/s", "/c", command]
            creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            app_launch = _START_APP_COMMAND.fullmatch(command)
            if app_launch is not None:
                result = await asyncio.to_thread(
                    self._launch_linux_app,
                    app_launch.group("target"),
                )
                return {
                    **result,
                    "permission_granted": True,
                    "sandbox": "working_directory_only",
                    "os_isolated": False,
                    "command": command,
                    "cwd": str(self.root),
                    "exit_code": 0 if result.get("ok") else 1,
                    "stdout": "",
                    "stderr": "" if result.get("ok") else str(result.get("error", "")),
                }
            shell = "/bin/sh"
            shell_args = ["-c", command]
            creationflags = 0

        process = await asyncio.create_subprocess_exec(
            shell,
            *shell_args,
            cwd=self.root,
            env=self._shell_environment(),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=creationflags,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=60,
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            return {
                "ok": False,
                "permission_granted": True,
                "sandbox": "working_directory_only",
                "os_isolated": False,
                "command": command,
                "cwd": str(self.root),
                "exit_code": None,
                "stdout": "",
                "stderr": "Shell command timed out after 60 seconds.",
            }

        return {
            "ok": process.returncode == 0,
            "permission_granted": True,
            "sandbox": "working_directory_only",
            "os_isolated": False,
            "command": command,
            "cwd": str(self.root),
            "exit_code": process.returncode,
            "stdout": stdout[:MAX_OUTPUT_BYTES].decode(errors="replace"),
            "stderr": stderr[:MAX_OUTPUT_BYTES].decode(errors="replace"),
            "truncated": len(stdout) > MAX_OUTPUT_BYTES
            or len(stderr) > MAX_OUTPUT_BYTES,
        }

    def _app_path(self, app: str) -> tuple[str, list[str]]:
        windows = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        mapping = {
            "notepad": (windows / "System32" / "notepad.exe", []),
            "calculator": (windows / "System32" / "calc.exe", []),
            "paint": (windows / "System32" / "mspaint.exe", []),
            "file_explorer": (windows / "explorer.exe", [str(self.root)]),
        }
        selected = mapping.get(app)
        if selected is None:
            raise PermissionError(f"App '{app}' is not allowlisted.")
        return str(selected[0]), selected[1]

    def _authorize_app(self, app: str, user_text: str) -> None:
        aliases = self.APP_ALIASES.get(app, ())
        if not _OPEN_VERB.search(user_text) or not _has_alias(user_text, aliases):
            raise PermissionError(
                "Opening an app requires an explicit user request naming that app."
            )

    async def open_app(
        self,
        arguments: dict[str, Any],
        *,
        user_text: str,
    ) -> dict[str, Any]:
        app = arguments.get("app")
        if not isinstance(app, str):
            raise TypeError("app must be a string.")
        self._authorize_app(app, user_text)
        executable, args = self._app_path(app)

        def launch() -> int:
            process = subprocess.Popen(
                [executable, *args],
                cwd=self.root,
                env=self._safe_environment(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            return process.pid

        pid = await asyncio.to_thread(launch)
        return {
            "ok": True,
            "app": app,
            "pid": pid,
            "sandbox_root": str(self.root),
            "policy": "allowlisted_host_app",
            "os_isolated": False,
        }

    async def execute(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        user_text: str,
        permission_granted: bool = False,
    ) -> dict[str, Any]:
        if name == self.command_name:
            return await self.run_command(arguments, user_text=user_text)
        if name == self.shell_name:
            return await self.run_shell(
                arguments,
                permission_granted=permission_granted,
            )
        if name == self.app_name:
            return await self.open_app(arguments, user_text=user_text)
        if name in self.desktop.names:
            if not permission_granted:
                raise PermissionError("Desktop control permission was not granted.")
            if name == self.desktop.screen_name:
                return await self.desktop.capture()
            return await self.desktop.control(arguments)
        raise PermissionError(f"Unknown local computer tool: {name}")
