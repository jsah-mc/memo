from __future__ import annotations

import os
from pathlib import Path
from unittest import TestCase, mock

from utils.gateway.cli_backends import (
    CLI_BACKENDS,
    executable_search_path,
    get_cli_backend,
    validate_agent_config,
)


class CLIBackendRegistryTests(TestCase):
    def test_expected_backends_are_registered(self) -> None:
        self.assertEqual(
            {backend.id for backend in CLI_BACKENDS},
            {
                "codex",
                "claude",
                "antigravity",
                "opencode",
                "ollama",
                "lmstudio",
                "grok-build",
                "cursor",
                "hermes",
                "pi",
            },
        )

    def test_agent_config_requires_known_cli_and_model(self) -> None:
        backend, model = validate_agent_config({"cli": "claude", "model": "sonnet"})
        self.assertEqual(backend.executable, "claude")
        self.assertEqual(model, "sonnet")

        hermes, hermes_model = validate_agent_config(
            {"cli": "hermes", "model": "anthropic/claude-sonnet-4"}
        )
        self.assertEqual(hermes.executable, "hermes")
        self.assertEqual(hermes.model_flag, "--model")
        self.assertEqual(hermes_model, "anthropic/claude-sonnet-4")

        with self.assertRaisesRegex(ValueError, "Unknown CLI backend"):
            validate_agent_config({"cli": "unknown", "model": "model"})

    @mock.patch("utils.gateway.cli_backends._login_shell_path")
    @mock.patch("utils.gateway.cli_backends.Path.home")
    def test_search_path_includes_login_shell_and_macos_package_locations(
        self, home: mock.Mock, login_path: mock.Mock
    ) -> None:
        home.return_value = Path("/Users/joseph")
        login_path.return_value = os.pathsep.join(["/custom/bin", "/opt/homebrew/bin"])
        with mock.patch.dict(os.environ, {"PATH": "/usr/bin"}, clear=False):
            paths = executable_search_path().split(os.pathsep)
        self.assertIn("/custom/bin", paths)
        self.assertIn("/opt/homebrew/bin", paths)
        self.assertTrue(
            any(path.replace("\\", "/").endswith(".npm-global/bin") for path in paths)
        )
        self.assertEqual(len(paths), len(set(paths)))

    @mock.patch("utils.gateway.cli_backends.shutil.which")
    def test_public_backend_data_uses_the_extended_search_path(
        self, which: mock.Mock
    ) -> None:
        which.return_value = "/opt/homebrew/bin/codex"
        with mock.patch("utils.gateway.cli_backends.CodexAuth.status") as status:
            status.return_value = {
                "status": "missing",
                "message": "Codex is not signed in.",
            }
            payload = get_cli_backend("codex").public_dict()
        self.assertTrue(payload["installed"])
        self.assertEqual(payload["resolved_executable"], "/opt/homebrew/bin/codex")
        self.assertEqual(payload["auth_status"], "missing")
        self.assertIn("install_url", payload)
        which.assert_called_with("codex", path=mock.ANY)

    @mock.patch("utils.gateway.cli_backends.subprocess.run")
    @mock.patch("utils.gateway.cli_backends.shutil.which")
    def test_ollama_models_come_from_cli_list(
        self, which: mock.Mock, run: mock.Mock
    ) -> None:
        which.return_value = "/usr/local/bin/ollama"
        run.return_value = mock.Mock(
            returncode=0,
            stdout=(
                "NAME ID SIZE MODIFIED\n"
                "qwen3:8b abc 5 GB yesterday\n"
                "llama3.3:latest def 42 GB today\n"
            ),
        )

        payload = get_cli_backend("ollama").public_dict()

        self.assertEqual(payload["models"], ["qwen3:8b", "llama3.3:latest"])
        run.assert_called_once_with(
            ["/usr/local/bin/ollama", "list"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
