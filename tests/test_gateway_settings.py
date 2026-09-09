from __future__ import annotations

from unittest import TestCase
from unittest.mock import patch

from utils.gateway.settings import GatewaySettings


class GatewaySettingsTests(TestCase):
    def test_default_model_supports_chatgpt_account_codex(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            settings = GatewaySettings.from_environment()

        self.assertEqual(settings.upstream_model, "chatgpt/gpt-5.6-luna")
        self.assertEqual(settings.light_model, settings.upstream_model)
        self.assertEqual(settings.heavy_model, settings.upstream_model)
        self.assertEqual(settings.vision_model, settings.upstream_model)
