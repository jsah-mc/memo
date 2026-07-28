from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]

from utils.program.main import MemoApp


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Memo LiteLLM SDK gateway.")
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
    elif args.command in {"", None}:
        app = MemoApp()
        app.run()
    else:
        print(f"Unknown command: {args.command}")
