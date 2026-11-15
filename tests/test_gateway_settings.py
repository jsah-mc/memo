from __future__ import annotations

from unittest import TestCase
from unittest.mock import patch

from utils.gateway.settings import GatewaySettings


class GatewaySettingsTests(TestCase):
    def test_default_model_supports_chatgpt_account_codex(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            settings = GatewaySettings.from_environment()

        # Default is now vercel/gpt-live-1 if VERCEL_GATEWAY_API_KEY is set,
        # otherwise ollama/llama3.2 if ollama is installed, otherwise openai/gpt-5
        self.assertIn(settings.upstream_model, ["openai/gpt-5", "ollama/llama3.2"])
        self.assertEqual(settings.light_model, settings.upstream_model)
        self.assertEqual(settings.heavy_model, settings.upstream_model)
        self.assertEqual(settings.vision_model, settings.upstream_model)
