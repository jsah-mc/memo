from __future__ import annotations

import asyncio
import unittest
from typing import Any, cast

from textual.widgets import Button, Input, Static

from utils.program.main import MemoApp, ShellPermissionScreen


class FakeTextualSDK:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def events(self, prompt: str):
        self.prompts.append(prompt)
        yield {"type": "response.output_text.delta", "delta": "Hello"}
        yield {"type": "response.output_text.delta", "delta": " from Memo"}
        yield {"type": "response.completed", "response": {}}

    def clear_history(self) -> None:
        self.prompts.clear()

    async def close(self) -> None:
        pass


class FakeVoice:
    def __init__(self) -> None:
        self.listen_count = 0
        self.spoken: list[str] = []
        self.cancelled = asyncio.Event()
        self.release_count = 0

    async def listen(self) -> str:
        self.listen_count += 1
        if self.listen_count == 1:
            return "voice request"
        await self.cancelled.wait()
        return ""

    async def speak(self, text: str) -> bool:
        self.spoken.append(text)
        return True

    def cancel(self) -> None:
        self.cancelled.set()

    async def release_recorder(self) -> None:
        self.release_count += 1

    async def close(self) -> None:
        self.cancel()


class FakePermissionSDK(FakeTextualSDK):
    def __init__(self) -> None:
        super().__init__()
        self.decisions: list[tuple[str, bool]] = []

    async def events(self, prompt: str):
        self.prompts.append(prompt)
        yield {
            "type": "memo.tool_call.started",
            "tool_call": {
                "id": "call_shell",
                "name": "run_shell_command",
                "arguments": {"command": "npm --version"},
            },
        }
        yield {
            "type": "memo.permission.requested",
            "permission": {
                "id": "perm_test",
                "tool_call_id": "call_shell",
                "kind": "shell_command",
                "command": "npm --version",
                "cwd": r"C:\sandbox",
                "os_isolated": False,
            },
        }
        yield {
            "type": "memo.tool_call.completed",
            "tool_call": {
                "id": "call_shell",
                "name": "run_shell_command",
                "arguments": {"command": "npm --version"},
                "result": {"ok": True},
                "is_error": False,
            },
        }
        yield {"type": "response.output_text.delta", "delta": "Done"}
        yield {"type": "response.completed", "response": {}}

    def resolve_permission(self, permission_id: str, allowed: bool) -> bool:
        self.decisions.append((permission_id, allowed))
        return True


class TextualProgramTests(unittest.IsolatedAsyncioTestCase):
    async def test_submit_streams_response_and_keeps_input_at_bottom(self) -> None:
        sdk = FakeTextualSDK()
        app = MemoApp(cast(Any, sdk))

        async with app.run_test(size=(80, 24)) as pilot:
            input_widget = app.query_one("#messageinput", Input)
            input_widget.value = "test message"
            await pilot.press("enter")
            await pilot.pause()

            response = app.query_one(".assistant-message", Static)
            self.assertEqual(sdk.prompts, ["test message"])
            self.assertEqual(str(response.content), "Memo\nHello from Memo")
            self.assertFalse(input_widget.disabled)
            self.assertEqual(
                input_widget.region.y + input_widget.region.height,
                24,
            )
            button = app.query_one(Button)
            self.assertGreater(button.region.width, 0)
            self.assertLessEqual(button.region.x + button.region.width, 80)
            self.assertEqual(button.region.height, input_widget.region.height)
            self.assertEqual(button.region.width, 5)
            self.assertEqual(
                button.styles.border_top,
                input_widget.styles.border_top,
            )
            self.assertEqual(
                button.styles.border_bottom,
                input_widget.styles.border_bottom,
            )

    async def test_arrow_button_submits_input_to_ai(self) -> None:
        sdk = FakeTextualSDK()
        app = MemoApp(cast(Any, sdk))

        async with app.run_test(size=(80, 24)) as pilot:
            input_widget = app.query_one("#messageinput", Input)
            input_widget.value = "sent with arrow"
            await pilot.click("#sendbutton")
            await pilot.pause()

            self.assertEqual(sdk.prompts, ["sent with arrow"])
            self.assertEqual(input_widget.value, "")
            response = app.query_one(".assistant-message", Static)
            self.assertEqual(str(response.content), "Memo\nHello from Memo")

    async def test_mic_button_runs_voice_turn_and_speaks_answer(self) -> None:
        sdk = FakeTextualSDK()
        voice = FakeVoice()
        app = MemoApp(cast(Any, sdk), cast(Any, voice))

        async with app.run_test(size=(80, 24)) as pilot:
            await pilot.click("#voicebutton")
            for _ in range(10):
                await pilot.pause(0.02)
                if voice.spoken:
                    break

            self.assertEqual(sdk.prompts, ["voice request"])
            self.assertEqual(voice.spoken, ["Hello from Memo"])
            self.assertTrue(app._voice_mode_active)

            app._stop_voice_mode()
            await pilot.pause()
            self.assertFalse(app._voice_mode_active)
            self.assertTrue(voice.cancelled.is_set())
            self.assertEqual(str(app.query_one("#voicebutton", Button).label), "🎤")
            self.assertEqual(voice.release_count, 1)

    async def test_shell_command_shows_permission_modal(self) -> None:
        sdk = FakePermissionSDK()
        app = MemoApp(cast(Any, sdk))

        async with app.run_test(size=(100, 30)) as pilot:
            input_widget = app.query_one("#messageinput", Input)
            input_widget.value = "run npm --version"
            await pilot.press("enter")
            for _ in range(20):
                await pilot.pause(0.01)
                if isinstance(app.screen, ShellPermissionScreen):
                    break

            self.assertIsInstance(
                app.screen,
                ShellPermissionScreen,
                str(app.query_one(".assistant-message", Static).content),
            )
            command = app.screen.query_one("#shell-permission-command", Static)
            self.assertEqual(str(command.content), "npm --version")
            await pilot.click("#allow-shell")
            await pilot.pause()

            self.assertEqual(sdk.decisions, [("perm_test", True)])
            response = app.query_one(".assistant-message", Static)
            self.assertEqual(str(response.content), "Memo\nDone")

    async def test_shell_permission_escape_denies(self) -> None:
        sdk = FakePermissionSDK()
        app = MemoApp(cast(Any, sdk))

        async with app.run_test(size=(100, 30)) as pilot:
            input_widget = app.query_one("#messageinput", Input)
            input_widget.value = "run npm --version"
            await pilot.press("enter")
            for _ in range(20):
                await pilot.pause(0.01)
                if isinstance(app.screen, ShellPermissionScreen):
                    break

            self.assertIsInstance(app.screen, ShellPermissionScreen)
            await pilot.press("escape")
            await pilot.pause()

            self.assertEqual(sdk.decisions, [("perm_test", False)])


if __name__ == "__main__":
    unittest.main()
