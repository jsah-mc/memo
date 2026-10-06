"""Read and refresh Codex CLI OAuth tokens without changing the file format."""

from __future__ import annotations

import base64
import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import httpx

_LOCK = threading.RLock()
_WINDOWS_PATH = re.compile(r"^[A-Za-z]:[\\/]")


def configure_codex_token_dir() -> None:
    configured = os.environ.get("CHATGPT_TOKEN_DIR")
    if configured and not (os.name != "nt" and _WINDOWS_PATH.match(configured)):
        return
    codex_dir = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    if (codex_dir / os.environ.get("CHATGPT_AUTH_FILE", "auth.json")).is_file():
        os.environ["CHATGPT_TOKEN_DIR"] = str(codex_dir)


def _claims(token: str) -> dict[str, Any]:
    try:
        part = token.split(".")[1]
        value = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return value if isinstance(value, dict) else {}
    except (ValueError, IndexError):
        return {}


class CodexAuth:
    def __init__(self, path: Path | None = None):
        configure_codex_token_dir()
        self.path = path or Path(
            os.environ.get("CHATGPT_TOKEN_DIR")
            or os.environ.get("CODEX_HOME")
            or Path.home() / ".codex"
        ) / os.environ.get("CHATGPT_AUTH_FILE", "auth.json")

    def read(self) -> dict[str, Any]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError(
                "Codex login is unavailable. Run `codex login` and restart Memo."
            ) from exc
        if not isinstance(raw, dict):
            raise RuntimeError("Invalid Codex login file. Run `codex login` again.")
        tokens = raw.get("tokens", raw)
        if not isinstance(tokens, dict):
            raise RuntimeError("Invalid Codex tokens. Run `codex login` again.")
        return {**raw, **tokens}

    def write(self, tokens: dict[str, Any]) -> None:
        # Preserve unknown fields and the nested format used by Codex CLI.
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        target = raw["tokens"] if isinstance(raw.get("tokens"), dict) else raw
        for key in ("access_token", "refresh_token", "id_token", "account_id"):
            if tokens.get(key) is not None:
                target[key] = tokens[key]
        if tokens.get("expires_at") is not None:
            raw["expires_at"] = tokens["expires_at"]
        raw["last_refresh"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        handle, name = tempfile.mkstemp(prefix=".auth-", dir=self.path.parent)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as temporary:
                json.dump(raw, temporary)
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def credentials(
        self, *, force_refresh: bool = False, previous_token: str | None = None
    ) -> dict[str, str]:
        with _LOCK:
            tokens = self.read()
            access = tokens.get("access_token")
            expiry = _claims(access or "").get("exp", tokens.get("expires_at"))
            expired = isinstance(expiry, (int, float)) and expiry <= time.time() + 60
            refresh = (
                (force_refresh and (previous_token is None or access == previous_token))
                or expired
                or not access
            )
            if refresh:
                if not tokens.get("refresh_token"):
                    raise RuntimeError(
                        "Codex login has expired. Run `codex login` again."
                    )
                response = httpx.post(
                    "https://auth.openai.com/oauth/token",
                    json={
                        "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
                        "grant_type": "refresh_token",
                        "refresh_token": tokens["refresh_token"],
                    },
                    timeout=30,
                )
                if response.is_error:
                    raise RuntimeError(
                        "Could not refresh Codex login. Run `codex login` again."
                    )
                fresh = response.json()
                if not fresh.get("access_token"):
                    raise RuntimeError("Codex refresh did not return an access token.")
                tokens.update(fresh)
                if "expires_in" in fresh:
                    tokens["expires_at"] = time.time() + fresh["expires_in"]
                self.write(tokens)
            access = tokens["access_token"]
            account = tokens.get("account_id") or _claims(
                tokens.get("id_token") or access
            ).get("https://api.openai.com/auth", {}).get("chatgpt_account_id")
            return {
                "Authorization": f"Bearer {access}",
                **({"ChatGPT-Account-Id": account} if account else {}),
            }
