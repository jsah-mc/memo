from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

from utils.gateway.sdk import SDKResponseStream
from utils.tools.computer import (
    ComputerSandboxTool,
    detect_app_request,
    detect_computer_task,
    detect_shell_request,
    generic_app_request_name,
    known_folder_request,
)
from utils.tools.computer_turn import (
    agent_tool_events,
    computer_request_text,
    computer_tool_events,
    has_one_time_computer_approval,
)
from utils.tools.desktop import detect_desktop_control_request
from utils.tools.permissions import PermissionBroker


class SequentialSDK:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses_to_return = responses
        self.payloads: list[dict[str, Any]] = []

    async def responses(self, payload: dict[str, Any]) -> SDKResponseStream:
        self.payloads.append(payload)
        response = self.responses_to_return.pop(0)

        async def events():
            if response.get("output_text"):
                yield {
                    "type": "response.output_text.delta",
                    "delta": response["output_text"],
                }
            yield {"type": "response.completed", "response": response}

        return SDKResponseStream(events())


def screen_result() -> dict[str, Any]:
    return {
        "ok": True,
        "image_url": "data:image/jpeg;base64,c2NyZWVu",
        "image_width": 800,
        "image_height": 450,
        "screen_width": 1920,
        "screen_height": 1080,
        "origin_x": 0,
        "origin_y": 0,
    }


class ComputerSandboxTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.tool = ComputerSandboxTool(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_only_cua_driver_tools_are_exposed(self) -> None:
        expected = {"inspect_computer_screen", "control_computer"}
        definitions = self.tool.responses_definitions
        self.assertEqual({item["name"] for item in definitions}, expected)
        self.assertEqual(self.tool.names, expected)
        self.assertEqual(self.tool.desktop_names, expected)

    async def test_shell_sandbox_and_app_launch_are_unavailable(self) -> None:
        unsupported = [
            ("run_sandboxed_command", {"argv": ["echo", "hello"]}),
            ("run_shell_command", {"command": "echo hello"}),
            ("open_allowed_app", {"app": "notepad"}),
        ]
        for name, arguments in unsupported:
            with self.subTest(name=name), self.assertRaises(PermissionError):
                await self.tool.execute(
                    name,
                    arguments,
                    user_text="do it",
                    permission_granted=True,
                )

    def test_intent_detection_is_narrow(self) -> None:
        self.assertTrue(detect_computer_task("open calculator"))
        self.assertTrue(detect_computer_task("run the hostname command"))
        self.assertFalse(detect_computer_task("calculate 2 + 2"))
        self.assertFalse(detect_computer_task("open calculus notes"))
        self.assertFalse(detect_computer_task("open https://example.com"))
        self.assertEqual(detect_app_request("please launch Notepad"), "notepad")
        self.assertTrue(detect_shell_request("run npm install example"))
        self.assertTrue(detect_shell_request("search air in my Downloads"))
        self.assertTrue(detect_shell_request("open Google Chrome"))
        self.assertTrue(detect_shell_request("launch Spotify"))
        self.assertTrue(detect_shell_request("start VS Code"))
        self.assertFalse(detect_shell_request("open the browser"))
        self.assertFalse(detect_shell_request("open https://example.com"))
        self.assertFalse(detect_shell_request("start the moon cart"))
        self.assertFalse(detect_shell_request("run a marathon"))
        self.assertEqual(
            generic_app_request_name("open Google Chrome"), "Google Chrome"
        )
        self.assertEqual(generic_app_request_name("launch Spotify!"), "Spotify")
        self.assertIsNone(generic_app_request_name("open the browser"))
        folder = known_folder_request("now open the downloads Folder")
        self.assertIsNotNone(folder)
        assert folder is not None
        self.assertEqual(folder[0], "Downloads")
        self.assertEqual(folder[1], (Path.home() / "Downloads").resolve())
        self.assertTrue(detect_desktop_control_request("use the computer"))
        self.assertTrue(detect_desktop_control_request("open Notepad and write hello"))
        self.assertTrue(
            detect_desktop_control_request("launch Paint then draw a circle")
        )
        self.assertFalse(detect_desktop_control_request("open Notepad"))

    def test_confirmed_followup_keeps_prior_computer_request(self) -> None:
        request = computer_request_text(
            [
                {
                    "role": "user",
                    "content": "search air in my Downloads",
                },
                {
                    "role": "assistant",
                    "content": "I can search that folder.",
                },
                {
                    "role": "user",
                    "content": "yeah do it",
                },
            ]
        )

        self.assertEqual(request, "search air in my Downloads")
        self.assertTrue(
            has_one_time_computer_approval(
                [
                    {
                        "role": "user",
                        "content": "search air in my Downloads",
                    },
                    {
                        "role": "assistant",
                        "content": "I can search that folder.",
                    },
                    {
                        "role": "user",
                        "content": "yeah do it",
                    },
                ]
            )
        )

    def test_unrelated_followup_does_not_reuse_prior_request(self) -> None:
        request = computer_request_text(
            [
                {"role": "user", "content": "tell me a joke"},
                {"role": "assistant", "content": "Should I continue?"},
                {"role": "user", "content": "yes"},
            ]
        )

        self.assertEqual(request, "yes")

    async def test_desktop_tools_reject_missing_permission(self) -> None:
        with self.assertRaises(PermissionError):
            await self.tool.execute(
                "inspect_computer_screen",
                {},
                user_text="use the computer",
            )

    async def test_tool_loop_returns_screen_and_tool_output_to_model(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_screen",
                            "name": "inspect_computer_screen",
                            "arguments": "{}",
                        }
                    ]
                },
                {"output": [], "output_text": "Your desktop is visible."},
            ]
        )

        with patch.object(
            self.tool.desktop,
            "capture",
            new=AsyncMock(return_value=screen_result()),
        ) as capture:
            events = [
                event
                async for event in agent_tool_events(
                    sdk,
                    {"model": "chatgpt/test", "input": "see my screen"},
                    computer_tool=self.tool,
                    permission_mode="full_access",
                )
            ]

        capture.assert_awaited_once_with()
        self.assertEqual(events[0]["type"], "memo.tool_call.started")
        self.assertEqual(events[1]["type"], "memo.tool_call.completed")
        self.assertEqual(events[2]["delta"], "Your desktop is visible.")
        second_input = sdk.payloads[1]["input"]
        self.assertEqual(second_input[-1]["content"][0]["type"], "input_image")
        self.assertEqual(second_input[-2]["type"], "function_call_output")

    async def test_tool_loop_continues_past_the_old_round_limit(self) -> None:
        tool_rounds = [
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": f"call_screen_{index}",
                        "name": "inspect_computer_screen",
                        "arguments": "{}",
                    }
                ]
            }
            for index in range(13)
        ]
        sdk = SequentialSDK(
            [*tool_rounds, {"output": [], "output_text": "Finished."}]
        )

        with patch.object(
            self.tool.desktop,
            "capture",
            new=AsyncMock(return_value=screen_result()),
        ):
            events = [
                event
                async for event in agent_tool_events(
                    sdk,
                    {
                        "model": "chatgpt/test",
                        "input": "keep looking at the screen until finished",
                    },
                    computer_tool=self.tool,
                    permission_mode="full_access",
                )
            ]

        self.assertEqual(len(sdk.payloads), 14)
        self.assertEqual(events[-2]["delta"], "Finished.")
        self.assertEqual(events[-1]["type"], "response.completed")

    async def test_only_desktop_tool_definitions_are_sent_to_the_model(self) -> None:
        sdk = SequentialSDK([{"output": [], "output_text": "Nothing to do."}])

        _ = [
            event
            async for event in computer_tool_events(
                sdk,
                {"model": "chatgpt/test", "input": "hello"},
                self.tool,
            )
        ]

        definitions = sdk.payloads[0]["tools"]
        self.assertEqual(
            {definition["name"] for definition in definitions},
            {"inspect_computer_screen", "control_computer"},
        )
        self.assertNotIn("tool_choice", sdk.payloads[0])

    async def test_desktop_session_shares_screenshots_with_model(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_screen",
                            "name": "inspect_computer_screen",
                            "arguments": "{}",
                        }
                    ]
                },
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_click",
                            "name": "control_computer",
                            "arguments": (
                                '{"actions":[{"action":"click","x":10,"y":20}]}'
                            ),
                        }
                    ]
                },
                {"output": [], "output_text": "The computer task is complete."},
            ]
        )
        broker = PermissionBroker(timeout_seconds=1)
        screenshot = screen_result()

        with (
            patch.object(
                self.tool.desktop,
                "capture",
                new=AsyncMock(return_value=dict(screenshot)),
            ) as capture,
            patch.object(
                self.tool.desktop,
                "control",
                new=AsyncMock(return_value={**screenshot, "actions_completed": 1}),
            ) as control,
        ):
            events = []
            async for event in computer_tool_events(
                sdk,
                {"input": "see my screen and tell me whats on it"},
                self.tool,
                broker,
            ):
                events.append(event)
                if event.get("type") == "memo.permission.requested":
                    self.assertEqual(
                        event["permission"]["kind"],
                        "computer_control",
                    )
                    self.assertTrue(broker.resolve(event["permission"]["id"], True))

        capture.assert_awaited_once_with()
        control.assert_awaited_once()
        permission_events = [
            event
            for event in events
            if event.get("type") == "memo.permission.requested"
        ]
        self.assertEqual(len(permission_events), 1)
        self.assertNotIn("tool_choice", sdk.payloads[0])
        second_input = sdk.payloads[1]["input"]
        screenshot_message = second_input[-1]
        self.assertEqual(
            screenshot_message["content"][0]["image_url"],
            "data:image/jpeg;base64,c2NyZWVu",
        )
        completed_tool_events = [
            event for event in events if event.get("type") == "memo.tool_call.completed"
        ]
        self.assertNotIn("image_url", completed_tool_events[0]["tool_call"]["result"])

    async def test_denied_desktop_permission_never_captures(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_screen",
                            "name": "inspect_computer_screen",
                            "arguments": "{}",
                        }
                    ]
                },
                {"output": [], "output_text": "The screen was denied."},
            ]
        )
        broker = PermissionBroker(timeout_seconds=1)

        with patch.object(
            self.tool.desktop,
            "capture",
            new=AsyncMock(),
        ) as capture:
            events = []
            async for event in computer_tool_events(
                sdk,
                {"input": "see my screen"},
                self.tool,
                broker,
            ):
                events.append(event)
                if event.get("type") == "memo.permission.requested":
                    self.assertTrue(broker.resolve(event["permission"]["id"], False))

        capture.assert_not_awaited()
        completed = next(
            event for event in events if event.get("type") == "memo.tool_call.completed"
        )
        self.assertTrue(completed["tool_call"]["result"]["permission_denied"])


if __name__ == "__main__":
    unittest.main()
