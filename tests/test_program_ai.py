from __future__ import annotations

import unittest
from pathlib import Path
from typing import Any

from utils.program.ai import ProgramAI
from utils.program.moonkart import _completion_messages
from utils.program.sdk import SDKResponseStream
from utils.program.settings import ProgramSettings


class FakeSDK:
    calls: list[tuple[str, dict[str, Any]]] = []

    def __init__(self, model: str, *, api_base: str | None = None) -> None:
        self.model = model
        self.api_base = api_base

    async def responses(self, payload: dict[str, Any]) -> SDKResponseStream:
        self.calls.append((self.model, payload))

        async def events():
            yield {"type": "response.output_text.delta", "delta": "Direct reply"}
            yield {
                "type": "response.completed",
                "response": {"output_text": "Direct reply"},
            }

        return SDKResponseStream(events())


class FakeMoonKart:
    name = "control_moonkart"

    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


class FakeBrowser:
    name = "browse_web"

    async def execute(self, arguments: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True, "result": f"Browsed: {arguments['task']}"}


class ProgramAITests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        FakeSDK.calls.clear()
        self.moonkart = FakeMoonKart()
        self.ai = ProgramAI(
            ProgramSettings(
                light_model="chatgpt/light",
                heavy_model="chatgpt/heavy",
                vision_model="chatgpt/vision",
                moonkart_enabled=False,
            ),
            browser_tool=FakeBrowser(),  # type: ignore[arg-type]
            moonkart_tool=self.moonkart,  # type: ignore[arg-type]
            sdk_factory=FakeSDK,  # type: ignore[arg-type]
        )

    async def test_normal_chat_streams_directly_and_keeps_history(self) -> None:
        text = "".join([part async for part in self.ai.stream("hello")])

        self.assertEqual(text, "Direct reply")
        self.assertEqual(FakeSDK.calls[0][0], "chatgpt/light")
        self.assertEqual(
            FakeSDK.calls[0][1]["instructions"],
            Path("system.txt").read_text(encoding="utf-8").strip(),
        )
        self.assertEqual(len(self.ai.history), 2)

    async def test_heavy_prompt_uses_heavy_model(self) -> None:
        _ = [part async for part in self.ai.stream("debug and refactor this")]

        self.assertEqual(FakeSDK.calls[0][0], "chatgpt/heavy")

    async def test_browser_request_executes_local_tool_without_sdk(self) -> None:
        events = [
            event
            async for event in self.ai.events(
                "open the browser and search the web for turtles"
            )
        ]

        self.assertFalse(FakeSDK.calls)
        self.assertEqual(events[0]["type"], "memo.tool_call.started")
        self.assertEqual(events[1]["type"], "memo.tool_call.completed")
        self.assertIn("Browsed:", events[2]["delta"])

    async def test_close_releases_local_tools(self) -> None:
        await self.ai.close()

        self.assertTrue(self.moonkart.closed)

    def test_moonkart_turn_uses_responses_content_types(self) -> None:
        messages = _completion_messages(
            {
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": "start the moonkart",
                            }
                        ],
                    },
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "Starting it.",
                            }
                        ],
                    },
                ]
            },
            "start",
        )

        self.assertEqual(messages[1]["content"][0]["type"], "input_text")
        self.assertEqual(messages[2]["content"][0]["type"], "output_text")

    def test_moonkart_turn_keeps_configured_system_prompt(self) -> None:
        messages = _completion_messages(
            {
                "instructions": "Memo system prompt",
                "input": "start the moonkart",
            },
            "start",
        )

        self.assertEqual(
            messages[0],
            {"role": "system", "content": "Memo system prompt"},
        )


if __name__ == "__main__":
    unittest.main()
