import json
import os
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from utils.gateway.api import create_app
from utils.gateway.composio_tools import ComposioTools
from utils.gateway.composio_turn import composio_tool_turn
from utils.gateway.sdk import SDKResponseStream
from utils.gateway.settings import GatewaySettings


class ComposioConnectionTests(TestCase):
    def test_reuses_sessions_and_isolates_user_and_toolkit_scope(self):
        client = MagicMock()
        composio = ComposioTools(client)
        first = composio.create_session("alice", ["GMAIL", "github"])
        self.assertIs(
            first, composio.create_session("alice", ["github", "gmail", "gmail"])
        )
        self.assertEqual(client.sessions.create.call_count, 1)
        composio.create_session("bob", ["gmail"])
        composio.create_session("alice", ["gmail"])
        self.assertEqual(client.sessions.create.call_count, 3)
        composio.invalidate("alice")
        composio.create_session("alice", ["github", "gmail"])
        self.assertEqual(client.sessions.create.call_count, 4)

    def test_expired_session_is_recreated(self):
        client = MagicMock()
        composio = ComposioTools(client)
        with patch("utils.gateway.composio_tools.time.monotonic", side_effect=[0, 901]):
            composio.create_session("alice", ["gmail"])
            composio.create_session("alice", ["gmail"])
        self.assertEqual(client.sessions.create.call_count, 2)

    def test_connections_are_sanitized_paginated_and_owned_before_disconnect(self):
        client = MagicMock()
        client.connected_accounts.list.side_effect = [
            {
                "items": [
                    {
                        "id": "account1",
                        "user_id": "alice",
                        "toolkit": {"slug": "gmail"},
                        "status": "ACTIVE",
                        "state": {"access_token": "secret"},
                    }
                ],
                "next_cursor": "page2",
            },
            {
                "items": [
                    {
                        "id": "foreign",
                        "user_id": "bob",
                        "toolkit": {"slug": "gmail"},
                        "status": "ACTIVE",
                    },
                    {
                        "id": "account2",
                        "toolkit": {"slug": "github"},
                        "status": "EXPIRED",
                    },
                ]
            },
        ]
        composio = ComposioTools(client)
        self.assertEqual(
            composio.connections("alice"),
            [
                {"id": "account1", "toolkit": "gmail", "status": "ACTIVE"},
                {"id": "account2", "toolkit": "github", "status": "EXPIRED"},
            ],
        )
        self.assertEqual(
            client.connected_accounts.list.call_args.kwargs["cursor"], "page2"
        )
        client.connected_accounts.list.side_effect = None
        client.connected_accounts.list.return_value = {
            "items": [
                {
                    "id": "account1",
                    "user_id": "alice",
                    "toolkit": {"slug": "gmail"},
                    "status": "ACTIVE",
                }
            ]
        }
        with self.assertRaises(ValueError):
            composio.disconnect("alice", "foreign")
        client.connected_accounts.delete.assert_not_called()
        composio.disconnect("alice", "account1")
        client.connected_accounts.delete.assert_called_once_with(nanoid="account1")

    def test_catalog_search_uses_public_sdk_query_and_returns_only_display_fields(self):
        from composio.core.models.toolkits import Toolkits

        transport = MagicMock()
        transport.toolkits.list.return_value = SimpleNamespace(
            items=[
                {
                    "slug": "outlook",
                    "name": "Microsoft Outlook",
                    "meta": {"secret": "hidden", "logo": "https://assets.composio.dev/outlook.png"},
                }
            ]
        )
        wrapper = Toolkits(transport)
        composio = ComposioTools(SimpleNamespace(toolkits=wrapper))
        self.assertEqual(
            composio.toolkits("outlook"),
            {
                "data": [
                    {
                        "id": "outlook",
                        "label": "Microsoft Outlook",
                        "icon": "https://assets.composio.dev/outlook.png",
                    }
                ]
            },
        )
        transport.toolkits.list.assert_called_once_with(
            limit=100, sort_by="usage", search="outlook"
        )

    def test_connection_api_uses_shared_identity(self):
        composio = MagicMock(spec=ComposioTools)
        composio.connections.return_value = [
            {"id": "app", "toolkit": "github", "status": "ACTIVE"}
        ]
        with (
            patch.dict(os.environ, MEMO_COMPOSIO_USER_ID="memo_user"),
            TestClient(
                create_app(GatewaySettings(), composio_tools=composio)
            ) as client,
        ):
            self.assertEqual(
                client.get("/v1/composio/connections").json()["data"][0]["status"],
                "ACTIVE",
            )
            self.assertEqual(
                client.delete("/v1/composio/connections/app").status_code, 204
            )
        composio.connections.assert_called_once_with("memo_user")
        composio.disconnect.assert_called_once_with("memo_user", "app")


class ComposioTurnTests(IsolatedAsyncioTestCase):
    async def test_executes_in_same_session_then_continues_with_tool_result(self):
        session = MagicMock()
        session.tools.return_value = [
            {
                "type": "function",
                "function": {"name": "SEARCH", "parameters": {"type": "object"}},
            }
        ]
        session.execute.return_value = {"data": {"found": 1}, "error": None}
        composio = ComposioTools(
            SimpleNamespace(sessions=SimpleNamespace(create=lambda **kwargs: session))
        )

        class SDK:
            def __init__(self):
                self.payloads = []

            async def responses(self, payload):
                self.payloads.append(payload)
                first = len(self.payloads) == 1

                async def events():
                    if first:
                        yield {
                            "type": "response.completed",
                            "response": {
                                "output": [
                                    {
                                        "type": "function_call",
                                        "name": "SEARCH",
                                        "arguments": '{"q":"hello"}',
                                        "call_id": "call1",
                                    }
                                ]
                            },
                        }
                    else:
                        yield {
                            "type": "response.output_text.delta",
                            "delta": "Found one.",
                        }
                        yield {"type": "response.completed", "response": {"output": []}}

                return SDKResponseStream(events())

        sdk = SDK()
        stream = await composio_tool_turn(
            sdk, {"input": "search hello"}, composio, "alice", ["github"]
        )
        events = [event async for event in stream.events()]
        self.assertEqual(
            sum(event["type"] == "response.completed" for event in events), 1
        )
        session.execute.assert_called_once_with("SEARCH", arguments={"q": "hello"})
        output = sdk.payloads[1]["input"][-1]
        self.assertEqual(output["call_id"], "call1")
        self.assertEqual(json.loads(output["output"])["data"], {"found": 1})
        self.assertIn("memo.tool_call.completed", [event["type"] for event in events])

    async def test_agent_composio_settings_reach_chat_tool_loop(self):
        async def events():
            yield {"type": "response.completed", "response": {"output": []}}

        with (
            patch.dict(os.environ, MEMO_COMPOSIO_USER_ID="shared_user"),
            patch(
                "utils.gateway.api.composio_tool_turn",
                return_value=SDKResponseStream(events()),
            ) as turn,
        ):
            with TestClient(create_app(GatewaySettings())) as client:
                response = client.post(
                    "/v1/chat/completions",
                    json={
                        "messages": [{"role": "user", "content": "hi"}],
                        "memo_agent": {
                            "cli": "codex",
                            "model": "test",
                            "composioEnabled": True,
                            "composioToolkits": ["github"],
                        },
                    },
                )
                self.assertEqual(response.status_code, 200)
        self.assertEqual(turn.call_args.args[-2:], ("shared_user", ["github"]))
