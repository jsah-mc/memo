"""Standalone bundled gateway entry point; never invoke the interactive TUI."""
from __future__ import annotations

import multiprocessing
import os
import sys
from pathlib import Path


def main() -> None:
    runtime_lib = Path(__file__).resolve().parents[1] / "runtime/lib"
    if sys.platform == "darwin":
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = str(runtime_lib)
    if sys.platform == "win32":
        sys.coinit_flags = 0
    # User data lives in the desktop-selected working directory, not resources.
    os.environ.setdefault("MEMO_SANDBOX_ROOT", str(Path.cwd() / "workspace"))
    os.environ.setdefault("MEMO_WHISPER_DEVICE", "cpu")
    os.environ.setdefault("MEMO_POCKETTTS_DEVICE", "cpu")
    import uvicorn
    from utils.gateway.api import create_app
    from utils.gateway.settings import GatewaySettings

    uvicorn.run(create_app(GatewaySettings.from_environment()),
                host="127.0.0.1", port=int(os.environ.get("GATEWAY_PORT", "4010")))


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
