import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from utils.gateway.api import create_app
from utils.gateway.settings import GatewaySettings


class HealthTests(unittest.TestCase):
    def test_readiness_reports_provider_state_without_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            auth_file = Path(directory, "missing.json")
            with patch(
                "utils.gateway.api.CodexAuth",
                return_value=__import__(
                    "utils.codex_auth", fromlist=["CodexAuth"]
                ).CodexAuth(auth_file),
            ):
                with TestClient(create_app(GatewaySettings())) as client:
                    response = client.get("/health/readiness")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "degraded")
        self.assertEqual(body["gateway"]["status"], "ok")
        self.assertEqual(body["provider"]["status"], "missing")
        self.assertNotIn("access_token", response.text)


if __name__ == "__main__":
    unittest.main()
