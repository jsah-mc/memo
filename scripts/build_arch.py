"""Create an installable Arch Linux binary package from the Linux prebuild."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPENDENCIES = ["glibc", "gcc-libs", "gtk3", "nss", "alsa-lib", "libxss", "libxtst",
                "at-spi2-core", "libdrm", "mesa", "libxkbcommon", "libsecret", "portaudio"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "apps/desktop/out/Memo-linux-x64")
    parser.add_argument("--output", type=Path, default=ROOT / "apps/desktop/out/make/arch/x64")
    args = parser.parse_args()
    source = args.source.resolve()
    if not (source / "Memo").is_file() or not (source / "resources/gateway/manifest.json").is_file():
        raise RuntimeError("Build the Linux app with its gateway before building the Arch package")
    version = json.loads((ROOT / "apps/desktop/package.json").read_text())["version"].replace("-", "_")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    package = output / f"memo-{version}-1-x86_64.pkg.tar.zst"
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary)
        app = stage / "opt/memo"
        app.parent.mkdir()
        shutil.copytree(source, app, symlinks=True)
        for item in app.rglob("*"):
            if item.is_symlink():
                continue
            if item.is_dir():
                item.chmod(0o755)
            elif item.is_file():
                item.chmod(0o755 if item.stat().st_mode & 0o111 else 0o644)
        sandbox = app / "chrome-sandbox"
        if sandbox.is_file():
            sandbox.chmod(0o4755)
        executable = stage / "usr/bin/memo"
        executable.parent.mkdir(parents=True)
        executable.write_text('#!/bin/sh\nexec /opt/memo/Memo "$@"\n', encoding="utf-8")
        executable.chmod(0o755)
        desktop = stage / "usr/share/applications/memo.desktop"
        desktop.parent.mkdir(parents=True)
        desktop.write_text("[Desktop Entry]\nName=Memo\nComment=Your local AI assistant\n"
                           "Exec=memo\nIcon=memo\nTerminal=false\nType=Application\nCategories=Utility;\n", encoding="utf-8")
        icon = stage / "usr/share/icons/hicolor/scalable/apps/memo.svg"
        icon.parent.mkdir(parents=True)
        icon.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
                        '<rect width="64" height="64" rx="16" fill="#18181b"/>'
                        '<path d="M16 46V18h7l9 15 9-15h7v28h-7V30l-9 14-9-14v16z" fill="#a78bfa"/></svg>\n', encoding="utf-8")
        size = sum(p.stat().st_size for p in stage.rglob("*") if p.is_file())
        metadata = ["pkgname = memo", "pkgbase = memo", f"pkgver = {version}-1",
                    "pkgdesc = Memo desktop AI assistant with bundled Python gateway",
                    "url = https://github.com/jsah-mc/memo", f"builddate = {int(time.time())}",
                    "packager = Memo release workflow", f"size = {size}", "arch = x86_64",
                    "license = MIT", *(f"depend = {name}" for name in DEPENDENCIES)]
        (stage / ".PKGINFO").write_text("\n".join(metadata) + "\n", encoding="utf-8")
        # pacman reads .PKGINFO directly; ownership is normalized for installation.
        subprocess.run(["tar", "--zstd", "--owner=0", "--group=0", "--numeric-owner",
                        "-cf", str(package), "-C", str(stage), ".PKGINFO", "opt", "usr"], check=True)
    subprocess.run(["tar", "--zstd", "-xOf", str(package), ".PKGINFO"], check=True)
    print(f"Arch package: {package}")


if __name__ == "__main__":
    main()
