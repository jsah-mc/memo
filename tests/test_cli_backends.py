from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase, mock

from utils.gateway.cli_backends import (
    CLI_BACKENDS,
    _hermes_catalog_ids,
    _hermes_models,
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


class HermesModelDiscoveryTests(TestCase):
    manifest = {
        "version": 1,
        "providers": {
            "openrouter": {
                "models": [
                    {"id": "z-ai/glm-5.3", "default": True},
                    {"id": "openai/gpt-5.4"},
                ]
            },
            "nous": {"models": [{"id": "z-ai/glm-5.3"}]},
        },
    }

    def test_ids_are_qualified_with_their_provider_and_deduplicated(self) -> None:
        self.assertEqual(
            _hermes_catalog_ids(self.manifest),
            [
                "openrouter:z-ai/glm-5.3",
                "openrouter:openai/gpt-5.4",
                "nous:z-ai/glm-5.3",
            ],
        )

    def test_malformed_manifests_yield_nothing(self) -> None:
        self.assertEqual(_hermes_catalog_ids({}), [])
        self.assertEqual(_hermes_catalog_ids({"providers": {"nous": None}}), [])
        self.assertEqual(
            _hermes_catalog_ids({"providers": {"nous": {"models": [{"id": 5}]}}}),
            [],
        )

    @mock.patch("utils.gateway.cli_backends._hermes_home")
    def test_models_are_read_from_hermes_disk_cache(self, home: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home.return_value = Path(tmp)
            cache = Path(tmp) / "cache"
            cache.mkdir()
            (cache / "model_catalog.json").write_text(
                json.dumps(self.manifest), encoding="utf-8"
            )
            self.assertEqual(
                _hermes_models(),
                [
                    "openrouter:z-ai/glm-5.3",
                    "openrouter:openai/gpt-5.4",
                    "nous:z-ai/glm-5.3",
                ],
            )

    @mock.patch("urllib.request.urlopen")
    @mock.patch("utils.gateway.cli_backends._hermes_home")
    def test_missing_cache_falls_back_to_the_live_manifest(
        self, home: mock.Mock, urlopen: mock.Mock
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home.return_value = Path(tmp)  # no cache file
            urlopen.return_value.__enter__.return_value.read.return_value = (
                json.dumps(self.manifest).encode("utf-8")
            )
            self.assertEqual(
                _hermes_models(),
                [
                    "openrouter:z-ai/glm-5.3",
                    "openrouter:openai/gpt-5.4",
                    "nous:z-ai/glm-5.3",
                ],
            )
            urlopen.assert_called_once()

    @mock.patch("urllib.request.urlopen")
    @mock.patch("utils.gateway.cli_backends._hermes_home")
    def test_unreachable_manifest_returns_empty(
        self, home: mock.Mock, urlopen: mock.Mock
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home.return_value = Path(tmp)
            urlopen.side_effect = OSError("offline")
            self.assertEqual(_hermes_models(), [])
