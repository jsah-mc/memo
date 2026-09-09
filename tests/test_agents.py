from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from utils.gateway.agents import AgentStore
from utils.gateway.api import create_app
from utils.gateway.composio_tools import ComposioTools
from utils.gateway.settings import GatewaySettings


class AgentStoreTests(TestCase):
    def test_agents_are_persisted_and_builtin_cannot_be_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agents.json"
            store = AgentStore(path)
            created = store.create(
                {
                    "name": "Reviewer",
                    "role": "Code reviewer",
                    "instructions": "Review changes carefully.",
                    "cli": "claude",
                    "model": "sonnet",
                    "color": "blue",
                }
            )

            reloaded = AgentStore(path)
            self.assertEqual(reloaded.list()[1]["id"], created["id"])
            with self.assertRaises(ValueError):
                reloaded.delete("memo")

    def test_agent_crud_api(self) -> None:
        with TestClient(
            create_app(GatewaySettings(), agent_store=AgentStore())
        ) as client:
            response = client.post(
                "/v1/agents",
                json={
                    "name": "Local",
                    "role": "Local model",
                    "instructions": "Work locally.",
                    "cli": "ollama",
                    "model": "qwen3",
                    "color": "green",
                },
            )
            self.assertEqual(response.status_code, 201)
            agent_id = response.json()["id"]
            self.assertEqual(len(client.get("/v1/agents").json()["data"]), 2)
            self.assertEqual(client.delete(f"/v1/agents/{agent_id}").status_code, 204)
            self.assertEqual(client.delete("/v1/agents/memo").status_code, 409)

    def test_composio_session_tools_and_execution_api(self) -> None:
        class Session:
            session_id = "session_1"

            def tools(self):
                return [{"type": "function", "function": {"name": "TEST_TOOL"}}]

            def execute(self, slug, arguments):
                return {"slug": slug, "arguments": arguments}

        class Client:
            class Sessions:
                @staticmethod
                def create(**_kwargs):
                    return Session()

            sessions = Sessions()

        app = create_app(
            GatewaySettings(),
            agent_store=AgentStore(),
            composio_tools=ComposioTools(Client()),
        )
        with TestClient(app) as client:
            tools = client.post(
                "/v1/composio/session-tools",
                json={"user_id": "user_1", "toolkits": ["GitHub"]},
            )
            self.assertEqual(tools.status_code, 200)
            self.assertEqual(tools.json()["session_id"], "session_1")
            result = client.post(
                "/v1/composio/execute",
                json={
                    "user_id": "user_1",
                    "toolkits": ["github"],
                    "slug": "TEST_TOOL",
                    "arguments": {"value": 1},
                },
            )
            self.assertEqual(result.json()["slug"], "TEST_TOOL")
