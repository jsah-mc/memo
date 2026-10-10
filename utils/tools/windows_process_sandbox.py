"""Launch host commands through Memo's bundled Windows sandbox runner."""

from __future__ import annotations

import os
from pathlib import Path


def memo_sandbox_runner() -> Path | None:
    configured = os.environ.get("MEMO_WINDOWS_SANDBOX_RUNNER", "").strip()
    if configured:
        candidate = Path(configured)
        return candidate.resolve() if candidate.is_file() else None
    candidates = [
        Path(__file__).resolve().parents[2] / ".sandbox-build" / "MemoSandbox.exe",
    ]
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate.resolve()
    return None


def sandboxed_command(command: str, cwd: Path) -> tuple[str, list[str]] | None:
    mode = os.environ.get("MEMO_WINDOWS_PROCESS_SANDBOX", "auto").strip().casefold()
    if mode in {"0", "off", "false", "disabled"}:
        return None
    runner = memo_sandbox_runner()
    if runner is None:
        if mode == "required":
            raise RuntimeError(
                "Memo's bundled Windows sandbox is unavailable. Repair Memo or select Local VM."
            )
        return None
    return str(runner), [
        "--cwd",
        str(cwd),
        "--",
        command,
    ]
