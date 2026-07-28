import json
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from utils.gateway.api import create_app
from utils.gateway.settings import GatewaySettings


class FakeResponseStream:
    async def events(self):
        yield {"type": "response.output_text.delta", "delta": "Real"}
        yield {"type": "response.output_text.delta", "delta": " time"}
        yield {
            "type": "response.completed",
            "response": {
                "usage": {
                    "input_tokens": 1,
                    "output_tokens": 2,
                    "total_tokens": 3,
                }
            },
        }


class FakeToolResponseStream:
    async def events(self):
        tool_call = {
            "id": "call_browser",
            "name": "browse_web",
            "arguments": {"task": "Search the web"},
        }
        yield {"type": "memo.tool_call.started", "tool_call": tool_call}
        yield {
            "type": "memo.tool_call.completed",
            "tool_call": {
                **tool_call,
                "result": {"ok": True, "result": "Found it"},
                "is_error": False,
            },
        }
        yield {"type": "response.output_text.delta", "delta": "Found it"}
        yield {"type": "response.completed", "response": {"usage": {}}}


class FakeMoonKartTool:
    async def close(self) -> None:
        pass


class GatewayStreamingTests(TestCase):
    def test_chat_completions_emits_each_text_delta_before_done(self) -> None:
        settings = GatewaySettings()

        with (
            patch(
                "utils.gateway.sdk.LiteLLMSDK.responses",
                new=AsyncMock(return_value=FakeResponseStream()),
            ),
            TestClient(
                create_app(settings, moonkart_tool=FakeMoonKartTool())
            ) as client,
        ):
            response = client.post(
                "/v1/chat/completions",
                json={
                    "model": "codex",
                    "messages": [{"role": "user", "content": "Hello"}],
                    "stream": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        data = [
            line.removeprefix("data: ")
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        chunks = [json.loads(item) for item in data if item != "[DONE]"]
        deltas = [
            chunk["choices"][0]["delta"].get("content")
            for chunk in chunks
            if chunk.get("choices")
        ]

        self.assertEqual(deltas, ["", "Real", " time", None])
        self.assertEqual(data[-1], "[DONE]")

    def test_desktop_stream_includes_live_tool_call_events(self) -> None:
        settings = GatewaySettings()

        with (
            patch(
                "utils.gateway.sdk.LiteLLMSDK.responses",
                new=AsyncMock(return_value=FakeToolResponseStream()),
            ),
            TestClient(
                create_app(settings, moonkart_tool=FakeMoonKartTool())
            ) as client,
        ):
            response = client.post(
                "/v1/chat/completions",
                headers={"X-Memo-Desktop": "1"},
                json={
                    "model": "codex",
                    "messages": [{"role": "user", "content": "Hello"}],
                    "stream": True,
                },
            )

        data = [
            json.loads(line.removeprefix("data: "))
            for line in response.text.splitlines()
            if line.startswith("data: ") and line != "data: [DONE]"
        ]
        tool_events = [
            item["tool_call"] for item in data if item.get("object") == "memo.tool_call"
        ]

        self.assertEqual(len(tool_events), 2)
        self.assertNotIn("result", tool_events[0])
        self.assertEqual(tool_events[1]["result"]["result"], "Found it")

    def test_image_generation_endpoint_is_disabled_without_local_backend(self) -> None:
        settings = GatewaySettings()

        with TestClient(
            create_app(settings, moonkart_tool=FakeMoonKartTool())
        ) as client:
            response = client.post(
                "/v1/images/generations",
                json={"prompt": "a turtle astronaut"},
            )

        self.assertEqual(response.status_code, 501)
        self.assertIn("not configured", response.json()["detail"])
