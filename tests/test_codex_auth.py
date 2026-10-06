import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from utils.codex_auth import CodexAuth, configure_codex_token_dir


class CodexAuthTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "Windows paths are native on Windows")
    def test_replaces_windows_token_directory_on_linux(self):
        with tempfile.TemporaryDirectory() as home:
            directory = Path(home, ".codex")
            directory.mkdir()
            (directory / "auth.json").write_text("{}")
            with (
                patch("utils.codex_auth.Path.home", return_value=Path(home)),
                patch.dict(
                    os.environ,
                    {
                        "CHATGPT_TOKEN_DIR": r"C:\Users\Admin\.codex",
                        "CODEX_HOME": "",
                        "CHATGPT_AUTH_FILE": "auth.json",
                    },
                ),
            ):
                configure_codex_token_dir()
                self.assertEqual(os.environ["CHATGPT_TOKEN_DIR"], str(directory))

    def test_preserves_configured_native_token_path(self):
        with patch.dict(os.environ, CHATGPT_TOKEN_DIR="/tmp/custom-codex"):
            configure_codex_token_dir()
            self.assertEqual(os.environ["CHATGPT_TOKEN_DIR"], "/tmp/custom-codex")

    def test_refresh_preserves_nested_tokens_metadata_and_rotated_token(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "auth.json")
            path.write_text(
                json.dumps(
                    {
                        "auth_mode": "chatgpt",
                        "extra": "keep",
                        "expires_at": 1,
                        "tokens": {
                            "access_token": "old",
                            "refresh_token": "refresh",
                            "account_id": "account",
                            "extra_token": "keep",
                        },
                    }
                )
            )
            auth = CodexAuth(path)
            with patch(
                "utils.codex_auth.httpx.post",
                return_value=httpx.Response(
                    200,
                    json={
                        "access_token": "new",
                        "refresh_token": "rotated",
                        "expires_in": 3600,
                    },
                ),
            ) as refresh:
                headers = auth.credentials()
                # A concurrent request must not refresh an already rotated token again.
                self.assertEqual(
                    auth.credentials(force_refresh=True, previous_token="old"), headers
                )
                refresh.assert_called_once()
            stored = json.loads(path.read_text())
        self.assertEqual(
            headers, {"Authorization": "Bearer new", "ChatGPT-Account-Id": "account"}
        )
        self.assertEqual(stored["tokens"]["refresh_token"], "rotated")
        self.assertEqual(stored["tokens"]["extra_token"], "keep")
        self.assertEqual(stored["extra"], "keep")
        self.assertNotIn("access_token", stored)

    def test_missing_login_provides_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "codex login"):
                CodexAuth(Path(directory, "missing.json")).credentials()
