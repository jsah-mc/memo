from __future__ import annotations

import argparse
import os
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
    parser = argparse.ArgumentParser(description="Run the Memo direct provider SDK gateway.")
    subparsers = parser.add_subparsers(dest="command", required=False)

    # 3. Create the 'run' subparser
    gateway = subparsers.add_parser("gateway", help="Run the core program execution")
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
    update = subparsers.add_parser("update", help="Update Memo and its dependencies")
    update.add_argument(
        "--check",
        action="store_true",
        help="Check for an update without installing it.",
    )
    mcp = subparsers.add_parser("mcp", help="Expose Memo to MCP-compatible AI agents")
    mcp_subparsers = mcp.add_subparsers(dest="mcp_command", required=True)
    mcp_subparsers.add_parser("serve", help="Run Memo's stdio MCP server")
    install = mcp_subparsers.add_parser("install", help="Register Memo with local AI agents")
    install.add_argument(
        "--agent",
        choices=("all", "codex", "claude", "cursor", "vscode"),
        default="all",
        help="Agent to configure (default: every detected agent)",
    )
    mcp_subparsers.add_parser("status", help="Show Memo MCP registration status")
    return parser


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
    elif args.command == "mcp":
        if args.mcp_command == "serve":
            from utils.mcp_server import main as run_mcp

            run_mcp()
        else:
            from utils.mcp_setup import install_mcp, registration_status

            if args.mcp_command == "install":
                results = install_mcp(PROJECT_ROOT, agent=args.agent)
            else:
                results = registration_status(PROJECT_ROOT)
            for name, message in results.items():
                print(f"{name}: {message}")
    elif args.command in {"", None}:
        from utils.program.main import MemoApp

        app = MemoApp()
        app.run()
    else:
        print(f"Unknown command: {args.command}")
