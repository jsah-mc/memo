#!/usr/bin/env python3
"""Build one platform download containing separate Desktop and CLI installers."""

from __future__ import annotations

import argparse
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path


DESKTOP_SUFFIXES = {".deb", ".rpm", ".msi", ".exe", ".dmg"}


def cli_script(platform: str) -> tuple[str, str]:
    if platform == "win32":
        return (
            "install.ps1",
            """$ErrorActionPreference = "Stop"
$destination = Join-Path $env:LOCALAPPDATA "Programs\\Memo CLI"
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item (Join-Path $PSScriptRoot "memo.exe") (Join-Path $destination "memo.exe") -Force
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $destination) {
  [Environment]::SetEnvironmentVariable("Path", (($userPath.TrimEnd(";") + ";" + $destination).TrimStart(";")), "User")
}
Write-Host "Memo CLI installed. Open a new terminal and run: memo"
""",
        )
    return (
        "install.sh",
        """#!/bin/sh
set -eu
destination="${PREFIX:-$HOME/.local}/bin"
mkdir -p "$destination"
install -m 755 "$(dirname "$0")/memo" "$destination/memo"
printf 'Memo CLI installed at %s/memo\\n' "$destination"
""",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=["linux", "win32", "darwin"])
    parser.add_argument("--arch", required=True)
    parser.add_argument("--bundle-dir", default="apps/desktop/src-tauri/target/release/bundle")
    parser.add_argument("--binary-dir", default="target/release")
    parser.add_argument("--output-dir", default="release-package")
    args = parser.parse_args()

    bundle_dir = Path(args.bundle_dir)
    binary_name = "memo.exe" if args.platform == "win32" else "memo"
    binary = Path(args.binary_dir) / binary_name
    if not binary.is_file():
        raise FileNotFoundError(binary)

    desktop = sorted(
        path for path in bundle_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in DESKTOP_SUFFIXES
    )
    if not desktop:
        raise RuntimeError(f"No desktop installers found below {bundle_dir}")

    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"memo-{args.platform}-{args.arch}.zip"
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary) / f"memo-{args.platform}-{args.arch}"
        desktop_dir = root / "desktop"
        cli_dir = root / "cli"
        desktop_dir.mkdir(parents=True)
        cli_dir.mkdir()
        for installer in desktop:
            shutil.copy2(installer, desktop_dir / installer.name)
        shutil.copy2(binary, cli_dir / binary_name)
        script_name, script = cli_script(args.platform)
        (cli_dir / script_name).write_text(script, encoding="utf-8", newline="\n")
        (root / "README.txt").write_text(
            "Memo Desktop and Memo CLI are separate installs.\n"
            "Install a file from desktop/ for the graphical app.\n"
            f"Run cli/{script_name} to install the terminal app.\n",
            encoding="utf-8",
        )
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zipped:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    zipped.write(path, path.relative_to(root.parent))
    print(archive)


if __name__ == "__main__":
    main()
