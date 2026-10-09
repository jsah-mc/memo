from __future__ import annotations

from unittest import TestCase

from utils.gateway.cli_backends import CLI_BACKENDS, validate_agent_config


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
        backend, model = validate_agent_config(
            {"cli": "claude", "model": "sonnet"}
        )
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
