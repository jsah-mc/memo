from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class UpdateStatus:
    available: bool
    commits_behind: int
    updated: bool = False


def _run(root: Path, *command: str) -> str:
    completed = subprocess.run(
        command,
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _program(name: str) -> str:
    executable = shutil.which(name)
    if executable:
        return executable
    raise RuntimeError(f"{name} is required to update Memo.")


def check_for_update(root: Path) -> UpdateStatus:
    root = root.resolve()
    if not (root / ".git").is_dir():
        raise RuntimeError("Memo's source checkout could not be found.")
    git = _program("git")
    _run(root, git, "fetch", "--quiet", "origin", "main")
    behind = int(_run(root, git, "rev-list", "--count", "HEAD..origin/main") or "0")
    return UpdateStatus(available=behind > 0, commits_behind=behind)


def install_update(root: Path) -> UpdateStatus:
    root = root.resolve()
    status = check_for_update(root)
    if not status.available:
        return status

    git = _program("git")
    if _run(root, git, "status", "--porcelain"):
        raise RuntimeError(
            "Memo has local source changes. Commit or remove them before updating."
        )

    _run(root, git, "pull", "--ff-only", "origin", "main")
    _run(root, _program("uv"), "sync", "--locked")
    pnpm = "pnpm.cmd" if sys.platform == "win32" else "pnpm"
    _run(root, _program(pnpm), "install", "--frozen-lockfile")
    return UpdateStatus(available=False, commits_behind=0, updated=True)
