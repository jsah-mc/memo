"""Compatibility between Codex CLI auth.json and LiteLLM ChatGPT OAuth."""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

_PATCH_LOCK = threading.Lock()
_PATCHED = False
_WINDOWS_ABSOLUTE_PATH = re.compile(r"^[A-Za-z]:[\\/]")


def configure_codex_token_dir() -> None:
    """Point LiteLLM at the Codex CLI login when it is available."""

    configured = os.environ.get("CHATGPT_TOKEN_DIR")
    if configured and not _WINDOWS_ABSOLUTE_PATH.match(configured):
        return

    codex_dir = Path.home() / ".codex"
    if (codex_dir / os.environ.get("CHATGPT_AUTH_FILE", "auth.json")).is_file():
        os.environ["CHATGPT_TOKEN_DIR"] = str(codex_dir)


def install_codex_auth_adapter() -> None:
    """Teach LiteLLM to read and safely refresh Codex CLI's nested token file."""

    global _PATCHED
    configure_codex_token_dir()
    if _PATCHED:
        return

    with _PATCH_LOCK:
        if _PATCHED:
            return

        from litellm.llms.chatgpt.authenticator import Authenticator

        original_read = Authenticator._read_auth_file
        original_write = Authenticator._write_auth_file

        def read_auth_file(self: Any) -> dict[str, Any] | None:
            raw = original_read(self)
            if not isinstance(raw, dict):
                return raw
            tokens = raw.get("tokens")
            if not isinstance(tokens, dict):
                return raw

            flattened = dict(tokens)
            for key in ("account_id", "expires_at", "device_code_requested_at"):
                if key in raw and key not in flattened:
                    flattened[key] = raw[key]
            return flattened

        def write_auth_file(self: Any, data: dict[str, Any]) -> None:
            path = Path(self.auth_file)
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                original_write(self, data)
                return

            tokens = raw.get("tokens")
            if not isinstance(tokens, dict):
                original_write(self, data)
                return

            for key in ("access_token", "refresh_token", "id_token", "account_id"):
                if data.get(key) is not None:
                    tokens[key] = data[key]
            for key in ("expires_at", "device_code_requested_at"):
                if data.get(key) is not None:
                    raw[key] = data[key]
            raw["tokens"] = tokens

            path.parent.mkdir(parents=True, exist_ok=True)
            handle, temporary_name = tempfile.mkstemp(
                prefix=f".{path.name}.",
                suffix=".tmp",
                dir=path.parent,
            )
            try:
                with os.fdopen(handle, "w", encoding="utf-8") as temporary:
                    json.dump(raw, temporary)
                os.replace(temporary_name, path)
            finally:
                try:
                    os.unlink(temporary_name)
                except FileNotFoundError:
                    pass

        Authenticator._read_auth_file = read_auth_file
        Authenticator._write_auth_file = write_auth_file
        from litellm.llms.chatgpt.responses.transformation import (
            ChatGPTResponsesAPIConfig,
        )

        def use_native_streaming(
            self: ChatGPTResponsesAPIConfig,
            model: str | None,
            stream: bool | None,
            custom_llm_provider: str | None = None,
        ) -> bool:
            return False

        ChatGPTResponsesAPIConfig.should_fake_stream = use_native_streaming
        _PATCHED = True
