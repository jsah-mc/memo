from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# pywin32 honors this flag the first time ``pythoncom`` is imported. Memo's
# asyncio-based Bluetooth stack requires MTA rather than a GUI/STA apartment.
if sys.platform == "win32":
    sys.coinit_flags = 0

from dotenv import load_dotenv

from utils.updater import check_for_update, install_update

PROJECT_ROOT = Path(__file__).resolve().parents[1]



def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Memo CLI gateway or TUI.")
    subparsers = parser.add_subparsers(dest="command", required=False)

    # Gateway subparser
    gateway = subparsers.add_parser("gateway", help="Run the core program execution gateway")
    gateway.add_argument(
        "--host",
        default=os.environ.get("GATEWAY_HOST", "127.0.0.1"),
        help="Interface on which the gateway listens.",
    )
    gateway.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("GATEWAY_PORT", "4000")),
        help="Port on which the gateway listens.",
    )
    desktop = subparsers.add_parser("desktop", help="Launch the Memo desktop application")
    desktop.add_argument(
        "--host",
        default=os.environ.get("GATEWAY_HOST", "127.0.0.1"),
        help="Gateway host to connect to.",
    )
    desktop.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("GATEWAY_PORT", "4000")),
        help="Gateway port to connect to.",
    )
    # TUI subparser
    tui = subparsers.add_parser("tui", help="Launch the Memo TUI (Terminal User Interface)")
    tui.add_argument(
        "--host",
        default=os.environ.get("GATEWAY_HOST", "127.0.0.1"),
        help="Gateway host to connect to.",
    )
    tui.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("GATEWAY_PORT", "4000")),
        help="Gateway port to connect to.",
    )

    # Update subparser
    update = subparsers.add_parser("update", help="Update Memo and its dependencies")
    update.add_argument(
        "--check",
        action="store_true",
        help="Check for an update without installing it.",
    )
    return parser


def find_pnpm() -> str | None:
    """Find pnpm executable with multiple fallback strategies."""
    # Strategy 1: Check workspace node_modules/.pnpm/pnpm (various extensions)
    pnpm_dir = PROJECT_ROOT / "node_modules" / ".pnpm" / "pnpm"
    for ext in ["index.js", "index.cjs", "pnpm.js", "pnpm.cjs"]:
        pnpm_path = pnpm_dir / ext
        if pnpm_path.exists():
            return str(pnpm_path)
    
    # Strategy 2: Check workspace node_modules/.bin
    bin_pnpm = PROJECT_ROOT / "node_modules" / ".bin" / "pnpm"
    if bin_pnpm.exists():
        return str(bin_pnpm)
    
    # Strategy 3: Check for pnpm.cmd/.exe on Windows
    if sys.platform == "win32":
        for ext in ["pnpm.cmd", "pnpm.exe"]:
            pnpm_path = PROJECT_ROOT / "node_modules" / ".bin" / ext
            if pnpm_path.exists():
                return str(pnpm_path)
    
    # Strategy 4: Check PATH for pnpm command
    pnpm_cmd = shutil.which("pnpm")
    if pnpm_cmd:
        return pnpm_cmd
    
    # Strategy 5: Check pnpm in parent directory (if in a subworkspace)
    parent_pnpm_dir = PROJECT_ROOT.parent / "node_modules" / ".pnpm" / "pnpm"
    for ext in ["index.js", "index.cjs", "pnpm.js", "pnpm.cjs"]:
        pnpm_path = parent_pnpm_dir / ext
        if pnpm_path.exists():
            return str(pnpm_path)
    
    # Strategy 6: Check common global pnpm locations
    if sys.platform == "win32":
        global_locations = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "pnpm" / "pnpm.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "pnpm" / "pnpm.cmd",
            Path(os.environ.get("APPDATA", "")) / "npm" / "pnpm.cmd",
            Path(os.environ.get("APPDATA", "")) / "npm" / "pnpm" / "pnpm.cmd",
            Path.home() / "AppData" / "Roaming" / "npm" / "pnpm.cmd",
            Path.home() / "AppData" / "Roaming" / "npm" / "pnpm" / "pnpm.cmd",
            Path.home() / "AppData" / "Local" / "pnpm" / "pnpm.exe",
            Path(os.environ.get("USERPROFILE", "")) / "AppData" / "Roaming" / "npm" / "pnpm.cmd",
        ]
    else:
        global_locations = [
            Path.home() / ".local" / "share" / "pnpm" / "pnpm",
            Path.home() / ".local" / "bin" / "pnpm",
            Path.home() / ".npm" / "global" / "node_modules" / ".bin" / "pnpm",
            Path("/usr/local/bin") / "pnpm",
            Path("/usr/bin") / "pnpm",
            Path.home() / ".pnpm" / "pnpm",
            Path.home() / ".config" / "npm" / "global" / "node_modules" / ".bin" / "pnpm",
        ]
    
    for location in global_locations:
        if location.exists():
            return str(location)
    
    return None


def find_npx() -> str | None:
    """Find npx as a fallback if pnpm is unavailable."""
    npx_cmd = shutil.which("npx")
    if npx_cmd:
        return npx_cmd
    
    # Check npx in node_modules/.bin
    npx_path = PROJECT_ROOT / "node_modules" / ".bin" / "npx"
    if npx_path.exists():
        return str(npx_path)
    
    # Check npx.cmd on Windows
    if sys.platform == "win32":
        npx_cmd_path = PROJECT_ROOT / "node_modules" / ".bin" / "npx.cmd"
        if npx_cmd_path.exists():
            return str(npx_cmd_path)
        npx_cmd_path2 = PROJECT_ROOT / "node_modules" / ".bin" / "npx.exe"
        if npx_cmd_path2.exists():
            return str(npx_cmd_path2)
    
    return None


def try_pnpm_via_npx() -> str | None:
    """Try to run pnpm via npx if pnpm is not installed locally."""
    npx = find_npx()
    if npx:
        return npx
    return None


def main() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    args = build_parser().parse_args()
    if args.command == "gateway":
        import uvicorn

        from utils.gateway.api import create_app
        from utils.gateway.settings import GatewaySettings

        uvicorn.run(
            host=args.host,
            port=args.port,
            app=create_app(GatewaySettings.from_environment()),
        )
    elif args.command == "tui":
        import subprocess

        tui_path = PROJECT_ROOT / "apps" / "tui"
        pnpm = find_pnpm()
        if pnpm:
            if pnpm.endswith(".js"):
                subprocess.run(["node", pnpm, "exec", "tsx", "src/main.tsx"], cwd=tui_path)
            else:
                subprocess.run([pnpm, "exec", "tsx", "src/main.tsx"], cwd=tui_path)
        else:
            # Fallback to npx
            npx = find_npx()
            if npx:
                subprocess.run([npx, "tsx", "src/main.tsx"], cwd=tui_path)
            else:
                print("Error: Neither pnpm nor npx found. Please install pnpm or Node.js.")
                sys.exit(1)
    elif args.command == "update":
        try:
            status = (
                check_for_update(PROJECT_ROOT)
                if args.check
                else install_update(PROJECT_ROOT)
            )
        except (RuntimeError, OSError, subprocess.SubprocessError) as error:
            raise SystemExit(f"Update failed: {error}") from error
        if status.updated:
            print("Memo updated successfully. Restart the desktop app if it is open.")
        elif status.available:
            print(f"Memo update available ({status.commits_behind} commit(s)).")
        else:
            print("Memo is already up to date.")
    elif args.command == "desktop":
        import subprocess

        # Run desktop in dev mode instead of packaging
        pnpm = find_pnpm()
        if pnpm:
            if pnpm.endswith(".js") or pnpm.endswith(".cjs"):
                subprocess.run(["node", pnpm, "exec", "pnpm", "--filter", "@memo/desktop", "start"], cwd=PROJECT_ROOT)
            else:
                subprocess.run([pnpm, "exec", "pnpm", "--filter", "@memo/desktop", "start"], cwd=PROJECT_ROOT)
        else:
            # Fallback to npx
            npx = find_npx()
            if npx:
                subprocess.run([npx, "pnpm", "--filter", "@memo/desktop", "start"], cwd=PROJECT_ROOT)
            else:
                print("Error: Neither pnpm nor npx found. Please install pnpm or Node.js.")
                sys.exit(1)
    elif args.command in {"", None}:
        # Default to TUI if no command specified
        import subprocess

        tui_path = PROJECT_ROOT / "apps" / "tui"
        pnpm = find_pnpm()
        if pnpm:
            if pnpm.endswith(".js") or pnpm.endswith(".cjs"):
                subprocess.run(["node", pnpm, "exec", "tsx", "src/main.tsx"], cwd=tui_path)
            else:
                subprocess.run([pnpm, "exec", "tsx", "src/main.tsx"], cwd=tui_path)
        else:
            # Fallback to npx
            npx = find_npx()
            if npx:
                subprocess.run([npx, "tsx", "src/main.tsx"], cwd=tui_path)
            else:
                print("Error: Neither pnpm nor npx found. Please install pnpm or Node.js.")
                sys.exit(1)
    else:
        print(f"Unknown command: {args.command}")
