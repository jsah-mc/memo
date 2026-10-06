"""Gateway command-line entry point."""

from __future__ import annotations

import argparse
import os

import uvicorn
from dotenv import load_dotenv

from .api import create_app
from .settings import GatewaySettings

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Memo direct provider SDK gateway.")
    parser.add_argument(
        "--host",
        default=os.environ.get("GATEWAY_HOST", "127.0.0.1"),
        help="Interface on which the gateway listens.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("GATEWAY_PORT", "4000")),
        help="Port on which the gateway listens.",
    )
    return parser


def main() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    args = build_parser().parse_args()
    settings = GatewaySettings.from_environment()
    uvicorn.run(create_app(settings), host=args.host, port=args.port)
