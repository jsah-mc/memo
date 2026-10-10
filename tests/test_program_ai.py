from __future__ import annotations

import unittest
from pathlib import Path
from typing import Any, ClassVar

from utils.tools.ai import AI as ProgramAI
from utils.tools.ai import AISettings as ProgramSettings
from utils.tools.ai.sdk import SDKResponseStream


class FakeSDK:
    calls: ClassVar[list[tuple[str, dict[str, Any]]]] = []

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


class FakeBrowser:
    name = "browse_web"

    async def execute(self, arguments: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True, "result": f"Browsed: {arguments['task']}"}


class FakeComputer:
    app_name = "open_allowed_app"
    responses_definitions: ClassVar[list[dict[str, Any]]] = [
        {
            "type": "function",
            "name": "run_sandboxed_command",
            "description": "Run a test command.",
            "parameters": {"type": "object"},
        }
    ]
    names: ClassVar[set[str]] = {"run_sandboxed_command"}

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any], str]] = []

    async def execute(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        user_text: str,
    ) -> dict[str, Any]:
        self.calls.append((name, arguments, user_text))
        return {"ok": True, "stdout": "hello\n"}


class FakeComputerSDK:
    call_count = 0

    def __init__(self, model: str, *, api_base: str | None = None) -> None:
        self.model = model
        self.api_base = api_base

    async def responses(self, payload: dict[str, Any]) -> SDKResponseStream:
        self.__class__.call_count += 1

        async def events():
            if self.call_count == 1:
                yield {
                    "type": "response.completed",
                    "response": {
                        "output": [
                            {
                                "type": "function_call",
                                "call_id": "call_echo",
                                "name": "run_sandboxed_command",
                                "arguments": '{"argv":["echo","hello"]}',
                            }
                        ]
                    },
                }
            else:
                yield {
                    "type": "response.output_text.delta",
                    "delta": "The command printed hello.",
                }
                yield {
                    "type": "response.completed",
                    "response": {"output": []},
                }

        return SDKResponseStream(events())


class ProgramAITests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        FakeSDK.calls.clear()
        self.ai = ProgramAI(
            ProgramSettings(
                light_model="chatgpt/light",
                heavy_model="chatgpt/heavy",
                vision_model="chatgpt/vision",
                computer_enabled=False,
            ),
            browser_tool=FakeBrowser(),  # type: ignore[arg-type]
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

    async def test_computer_request_runs_responses_tool_loop(self) -> None:
        FakeComputerSDK.call_count = 0
        computer = FakeComputer()
        ai = ProgramAI(
            ProgramSettings(
                light_model="chatgpt/light",
                heavy_model="chatgpt/heavy",
                vision_model="chatgpt/vision",
                browser_enabled=False,
                computer_enabled=True,
            ),
            browser_tool=FakeBrowser(),  # type: ignore[arg-type]
            computer_tool=computer,  # type: ignore[arg-type]
            sdk_factory=FakeComputerSDK,  # type: ignore[arg-type]
        )

        events = [event async for event in ai.events("run echo hello")]

        self.assertEqual(FakeComputerSDK.call_count, 2)
        self.assertEqual(computer.calls[0][0], "run_sandboxed_command")
        self.assertEqual(events[0]["type"], "memo.tool_call.started")
        self.assertEqual(events[1]["tool_call"]["result"]["stdout"], "hello\n")
        self.assertEqual(events[2]["delta"], "The command printed hello.")

    async def test_open_notepad_bypasses_model_discretion(self) -> None:
        FakeComputerSDK.call_count = 0
        computer = FakeComputer()
        ai = ProgramAI(
            ProgramSettings(
                light_model="chatgpt/light",
                heavy_model="chatgpt/heavy",
                vision_model="chatgpt/vision",
                browser_enabled=False,
                computer_enabled=True,
            ),
            browser_tool=FakeBrowser(),  # type: ignore[arg-type]
            computer_tool=computer,  # type: ignore[arg-type]
            sdk_factory=FakeComputerSDK,  # type: ignore[arg-type]
        )

        events = [event async for event in ai.events("open notepad")]

        self.assertEqual(FakeComputerSDK.call_count, 0)
        self.assertEqual(computer.calls[0][0], "open_allowed_app")
        self.assertEqual(events[0]["type"], "memo.tool_call.started")
        self.assertEqual(events[2]["delta"], "Opened Notepad.")

if __name__ == "__main__":
    unittest.main()
