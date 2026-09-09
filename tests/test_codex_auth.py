import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from litellm.llms.chatgpt.authenticator import Authenticator

from utils.gateway.codex_auth import (
    configure_codex_token_dir,
    install_codex_auth_adapter,
)


class CodexAuthAdapterTests(unittest.TestCase):
    def test_replaces_windows_token_directory_on_linux(self):
        with tempfile.TemporaryDirectory() as home:
            codex_dir = Path(home, ".codex")
            codex_dir.mkdir()
            Path(codex_dir, "auth.json").write_text("{}", encoding="utf-8")
            with (
                patch("utils.gateway.codex_auth.Path.home", return_value=Path(home)),
                patch.dict(
                    os.environ,
                    {
                        "CHATGPT_TOKEN_DIR": r"C:\Users\Admin\.codex",
                        "CHATGPT_AUTH_FILE": "auth.json",
                    },
                    clear=False,
                ),
            ):
                configure_codex_token_dir()
                self.assertEqual(os.environ["CHATGPT_TOKEN_DIR"], str(codex_dir))

    def test_configures_codex_token_directory_on_windows(self):
        with tempfile.TemporaryDirectory() as home:
            codex_dir = Path(home, ".codex")
            codex_dir.mkdir()
            Path(codex_dir, "auth.json").write_text("{}", encoding="utf-8")
            with (
                patch("utils.gateway.codex_auth.Path.home", return_value=Path(home)),
                patch.dict(
                    os.environ,
                    {"CHATGPT_TOKEN_DIR": "", "CHATGPT_AUTH_FILE": "auth.json"},
                    clear=False,
                ),
            ):
                configure_codex_token_dir()
                self.assertEqual(os.environ["CHATGPT_TOKEN_DIR"], str(codex_dir))

    def test_reads_and_updates_nested_codex_tokens_without_flattening_file(self):
        install_codex_auth_adapter()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "auth.json")
            path.write_text(
                json.dumps(
                    {
                        "auth_mode": "chatgpt",
                        "tokens": {
                            "access_token": "old-access",
                            "refresh_token": "old-refresh",
                            "id_token": "old-id",
                            "account_id": "account",
                        },
                    }
                ),
                encoding="utf-8",
            )
            authenticator = object.__new__(Authenticator)
            authenticator.auth_file = str(path)

            loaded = authenticator._read_auth_file()
            self.assertEqual(loaded["access_token"], "old-access")
            self.assertEqual(loaded["account_id"], "account")

            authenticator._write_auth_file(
                {
                    "access_token": "new-access",
                    "refresh_token": "new-refresh",
                    "id_token": "new-id",
                    "account_id": "account",
                    "expires_at": 123,
                }
            )
            stored = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(stored["auth_mode"], "chatgpt")
        self.assertEqual(stored["tokens"]["access_token"], "new-access")
        self.assertNotIn("access_token", stored)
        self.assertEqual(stored["expires_at"], 123)
