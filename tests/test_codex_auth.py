import json
import tempfile
import unittest
from pathlib import Path

from litellm.llms.chatgpt.authenticator import Authenticator

from utils.gateway.codex_auth import install_codex_auth_adapter


class CodexAuthAdapterTests(unittest.TestCase):
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
