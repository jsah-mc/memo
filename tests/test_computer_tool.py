from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

from utils.program.sdk import SDKResponseStream
from utils.tools.computer import (
    ComputerSandboxTool,
    detect_app_request,
    detect_computer_task,
    detect_shell_request,
    generic_app_request_name,
    known_folder_request,
)
from utils.tools.computer_turn import (
    computer_request_text,
    computer_tool_events,
    direct_app_events,
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


class ComputerSandboxTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.tool = ComputerSandboxTool(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    async def test_workspace_write_and_read_stay_in_root(self) -> None:
        written = await self.tool.execute(
            "run_sandboxed_command",
            {"argv": ["write", "notes/hello.txt", "hello"]},
            user_text="write hello to notes/hello.txt",
        )
        read = await self.tool.execute(
            "run_sandboxed_command",
            {"argv": ["type", "notes/hello.txt"]},
            user_text="run type on notes/hello.txt",
        )

        self.assertTrue(written["ok"])
        self.assertEqual(read["stdout"], "hello")
        self.assertEqual(read["sandbox"], "capability_policy")
        self.assertFalse(read["os_isolated"])
        self.assertEqual((self.root / "notes" / "hello.txt").read_text(), "hello")

    async def test_path_escape_is_rejected(self) -> None:
        with self.assertRaises(PermissionError):
            await self.tool.execute(
                "run_sandboxed_command",
                {"argv": ["write", "../escape.txt", "no"]},
                user_text="write no to ../escape.txt",
            )

    async def test_shells_and_unlisted_executables_are_rejected(self) -> None:
        for command in ("cmd", "powershell", "python"):
            with self.subTest(command=command), self.assertRaises(PermissionError):
                await self.tool.execute(
                    "run_sandboxed_command",
                    {"argv": [command, "--version"]},
                    user_text=f"run {command} --version",
                )

    async def test_model_cannot_substitute_a_different_command(self) -> None:
        with self.assertRaises(PermissionError):
            await self.tool.execute(
                "run_sandboxed_command",
                {"argv": ["systeminfo"]},
                user_text="run hostname",
            )

    async def test_model_cannot_substitute_a_different_file(self) -> None:
        (self.root / "private.txt").write_text("secret")
        with self.assertRaises(PermissionError):
            await self.tool.execute(
                "run_sandboxed_command",
                {"argv": ["type", "private.txt"]},
                user_text="run type public.txt",
            )

    async def test_app_requires_explicit_name_and_opening_verb(self) -> None:
        process = Mock(pid=42)
        with patch(
            "utils.tools.computer.subprocess.Popen",
            return_value=process,
        ) as popen:
            result = await self.tool.execute(
                "open_allowed_app",
                {"app": "calculator"},
                user_text="please open calculator",
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["policy"], "allowlisted_host_app")
        self.assertFalse(result["os_isolated"])
        popen.assert_called_once()

        with self.assertRaises(PermissionError):
            await self.tool.execute(
                "open_allowed_app",
                {"app": "notepad"},
                user_text="open calculator",
            )

    def test_resolves_zed_from_local_programs(self) -> None:
        local_app_data = self.root / "Local"
        zed = local_app_data / "Programs" / "Zed" / "Zed.exe"
        zed.parent.mkdir(parents=True)
        zed.write_bytes(b"test executable")

        with patch.dict(
            os.environ,
            {
                "LOCALAPPDATA": str(local_app_data),
                "ProgramFiles": str(self.root / "Program Files"),
                "ProgramFiles(x86)": str(self.root / "Program Files (x86)"),
                "PATH": "",
            },
        ):
            resolved = self.tool._resolve_executable("Zed")

        self.assertEqual(resolved, zed.resolve())

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

    async def test_explicit_app_request_executes_without_a_model_decision(self) -> None:
        process = Mock(pid=42)
        with patch(
            "utils.tools.computer.subprocess.Popen",
            return_value=process,
        ):
            events = [
                event
                async for event in direct_app_events(
                    self.tool,
                    app="notepad",
                    user_text="open notepad",
                )
            ]

        self.assertEqual(events[0]["type"], "memo.tool_call.started")
        self.assertEqual(events[1]["type"], "memo.tool_call.completed")
        self.assertFalse(events[1]["tool_call"]["is_error"])
        self.assertEqual(events[2]["delta"], "Opened Notepad.")
        self.assertEqual(events[3]["type"], "response.completed")

    async def test_tool_loop_returns_events_and_tool_output_to_model(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_echo",
                            "name": "run_sandboxed_command",
                            "arguments": '{"argv":["echo","hello"]}',
                        }
                    ]
                },
                {"output": [], "output_text": "The command printed hello."},
            ]
        )

        events = [
            event
            async for event in computer_tool_events(
                sdk,
                {
                    "model": "chatgpt/test",
                    "input": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "input_text",
                                    "text": "run echo hello",
                                }
                            ],
                        }
                    ],
                },
                self.tool,
            )
        ]

        self.assertEqual(events[0]["type"], "memo.tool_call.started")
        self.assertEqual(events[1]["type"], "memo.tool_call.completed")
        self.assertEqual(events[1]["tool_call"]["result"]["stdout"], "hello\n")
        self.assertEqual(events[2]["delta"], "The command printed hello.")
        second_input = sdk.payloads[1]["input"]
        self.assertEqual(second_input[-1]["type"], "function_call_output")
        self.assertIn('"stdout":"hello\\n"', second_input[-1]["output"])

    async def test_shell_executor_rejects_missing_permission(self) -> None:
        with self.assertRaises(PermissionError):
            await self.tool.execute(
                "run_shell_command",
                {"command": "echo hello"},
                user_text="run command echo hello",
            )

    async def test_desktop_tools_reject_missing_permission(self) -> None:
        with self.assertRaises(PermissionError):
            await self.tool.execute(
                "inspect_computer_screen",
                {},
                user_text="use the computer",
            )

    async def test_approved_shell_command_runs_in_configured_workspace(self) -> None:
        result = await self.tool.execute(
            "run_shell_command",
            {"command": "echo hello"},
            user_text="run command echo hello",
            permission_granted=True,
        )

        self.assertTrue(result["ok"])
        self.assertIn("hello", result["stdout"])
        # Windows temp paths may use an 8.3 alias while the tool resolves it.
        self.assertTrue(Path(result["cwd"]).samefile(self.root))
        self.assertEqual(result["sandbox"], "working_directory_only")
        self.assertFalse(result["os_isolated"])

    async def test_linux_translates_safe_windows_style_app_launch(self) -> None:
        launch_result = {
            "ok": True,
            "resolved_name": "google-chrome-stable",
            "resolved_path": "/usr/bin/google-chrome-stable",
            "pid": 42,
            "resolution": "linux_executable",
        }
        with (
            patch("utils.tools.computer.os.name", "posix"),
            patch.object(
                self.tool,
                "_launch_linux_app",
                return_value=launch_result,
            ) as launch,
        ):
            result = await self.tool.run_shell(
                {"command": 'start "" "chrome"'},
                permission_granted=True,
            )

        launch.assert_called_once_with("chrome")
        self.assertTrue(result["ok"])
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(result["resolved_path"], "/usr/bin/google-chrome-stable")

    async def test_shell_tool_waits_for_one_time_permission(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_shell",
                            "name": "run_shell_command",
                            "arguments": '{"command":"npm --version"}',
                        }
                    ]
                },
                {"output": [], "output_text": "The command completed."},
            ]
        )
        broker = PermissionBroker(timeout_seconds=1)
        shell_result = {
            "ok": True,
            "stdout": "10.0.0\n",
            "stderr": "",
            "exit_code": 0,
        }

        with patch.object(
            self.tool,
            "run_shell",
            new=AsyncMock(return_value=shell_result),
        ) as run_shell:
            events = []
            async for event in computer_tool_events(
                sdk,
                {
                    "model": "chatgpt/test",
                    "input": "run npm --version",
                },
                self.tool,
                broker,
            ):
                events.append(event)
                if event.get("type") == "memo.permission.requested":
                    permission = event["permission"]
                    self.assertEqual(permission["command"], "npm --version")
                    self.assertFalse(permission["os_isolated"])
                    self.assertTrue(broker.resolve(permission["id"], True))

        self.assertEqual(events[0]["type"], "memo.tool_call.started")
        self.assertEqual(events[1]["type"], "memo.permission.requested")
        self.assertEqual(events[2]["type"], "memo.tool_call.completed")
        run_shell.assert_awaited_once_with(
            {"command": "npm --version"},
            permission_granted=True,
        )
        self.assertEqual(
            sdk.payloads[0]["tool_choice"],
            {"type": "function", "name": "run_shell_command"},
        )
        shell_definition = next(
            definition
            for definition in sdk.payloads[0]["tools"]
            if definition.get("name") == "run_shell_command"
        )
        expected_shell = "Windows cmd.exe" if os.name == "nt" else "POSIX /bin/sh"
        self.assertIn(expected_shell, shell_definition["description"])
        expected_launch = (
            "Windows syntax" if os.name == "nt" else "`xdg-open`"
        )
        self.assertIn(expected_launch, shell_definition["description"])
        self.assertNotIn("tool_choice", sdk.payloads[1])
        self.assertFalse(broker.pending_ids)

    async def test_arbitrary_app_launch_uses_permission_gated_shell(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_chrome",
                            "name": "run_shell_command",
                            "arguments": '{"command":"start \\"\\" \\"\\\\\\\\\\""}',
                        }
                    ]
                },
                {"output": [], "output_text": "Opened Chrome."},
            ]
        )
        broker = PermissionBroker(timeout_seconds=1)
        shell_result = {
            "ok": True,
            "stdout": "",
            "stderr": "",
            "exit_code": 0,
        }

        with patch.object(
            self.tool,
            "run_shell",
            new=AsyncMock(return_value=shell_result),
        ) as run_shell:
            events = []
            async for event in computer_tool_events(
                sdk,
                {"input": "open Google Chrome"},
                self.tool,
                broker,
            ):
                events.append(event)
                if event.get("type") == "memo.permission.requested":
                    self.assertEqual(
                        event["permission"]["command"],
                        'start "" "chrome"',
                    )
                    self.assertTrue(broker.resolve(event["permission"]["id"], True))

        run_shell.assert_awaited_once_with(
            {"command": 'start "" "chrome"'},
            permission_granted=True,
        )
        self.assertEqual(
            sdk.payloads[0]["tool_choice"],
            {"type": "function", "name": "run_shell_command"},
        )
        self.assertEqual(events[-2]["delta"], "Opened Chrome.")

    async def test_yes_grants_exactly_one_computer_action(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_spotify",
                            "name": "run_shell_command",
                            "arguments": (
                                '{"command":"start \\"\\" '
                                '\\"C:\\\\Apps\\\\Spotify.exe\\""}'
                            ),
                        },
                        {
                            "type": "function_call",
                            "call_id": "call_calc",
                            "name": "run_shell_command",
                            "arguments": '{"command":"start \\"\\" \\"calc\\""}',
                        },
                    ]
                },
                {"output": [], "output_text": "Handled the approved action."},
            ]
        )
        broker = PermissionBroker(timeout_seconds=0.01)
        shell_result = {
            "ok": True,
            "stdout": "",
            "stderr": "",
            "exit_code": 0,
        }
        history = [
            {"role": "user", "content": "launch Spotify"},
            {
                "role": "assistant",
                "content": "Would you like me to launch it?",
            },
            {"role": "user", "content": "yes"},
        ]

        with patch.object(
            self.tool,
            "run_shell",
            new=AsyncMock(return_value=shell_result),
        ) as run_shell:
            events = [
                event
                async for event in computer_tool_events(
                    sdk,
                    {"input": history},
                    self.tool,
                    broker,
                )
            ]

        run_shell.assert_awaited_once_with(
            {"command": 'start "" "spotify:"'},
            permission_granted=True,
        )
        permission_events = [
            event
            for event in events
            if event.get("type") == "memo.permission.requested"
        ]
        self.assertEqual(len(permission_events), 1)
        denied = [
            event
            for event in events
            if event.get("type") == "memo.tool_call.completed"
            and event["tool_call"]["result"].get("permission_denied")
        ]
        self.assertEqual(len(denied), 1)

    async def test_model_app_substitution_is_replaced_with_requested_app(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_wrong_app",
                            "name": "run_shell_command",
                            "arguments": '{"command":"start \\"\\" \\"calc\\""}',
                        }
                    ]
                },
                {"output": [], "output_text": "The action was not approved."},
            ]
        )
        broker = PermissionBroker(timeout_seconds=0.01)
        shell_result = {
            "ok": True,
            "stdout": "",
            "stderr": "",
            "exit_code": 0,
        }
        history = [
            {"role": "user", "content": "launch Spotify"},
            {
                "role": "assistant",
                "content": "Would you like me to launch it?",
            },
            {"role": "user", "content": "yes"},
        ]

        with patch.object(
            self.tool,
            "run_shell",
            new=AsyncMock(return_value=shell_result),
        ) as run_shell:
            events = [
                event
                async for event in computer_tool_events(
                    sdk,
                    {"input": history},
                    self.tool,
                    broker,
                )
            ]

        run_shell.assert_awaited_once_with(
            {"command": 'start "" "spotify:"'},
            permission_granted=True,
        )
        self.assertFalse(
            any(event.get("type") == "memo.permission.requested" for event in events)
        )

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
        screenshot = {
            "ok": True,
            "image_url": "data:image/jpeg;base64,c2NyZWVu",
            "image_width": 800,
            "image_height": 450,
            "screen_width": 1920,
            "screen_height": 1080,
            "origin_x": 0,
            "origin_y": 0,
        }

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
        self.assertEqual(
            sdk.payloads[0]["tool_choice"],
            {"type": "function", "name": "inspect_computer_screen"},
        )
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

    async def test_denied_shell_permission_never_executes(self) -> None:
        sdk = SequentialSDK(
            [
                {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call_shell",
                            "name": "run_shell_command",
                            "arguments": '{"command":"python --version"}',
                        }
                    ]
                },
                {"output": [], "output_text": "The command was denied."},
            ]
        )
        broker = PermissionBroker(timeout_seconds=1)

        with patch.object(
            self.tool,
            "run_shell",
            new=AsyncMock(),
        ) as run_shell:
            events = []
            async for event in computer_tool_events(
                sdk,
                {"input": "run python --version"},
                self.tool,
                broker,
            ):
                events.append(event)
                if event.get("type") == "memo.permission.requested":
                    self.assertTrue(broker.resolve(event["permission"]["id"], False))

        run_shell.assert_not_awaited()
        completed = next(
            event for event in events if event.get("type") == "memo.tool_call.completed"
        )
        self.assertTrue(completed["tool_call"]["result"]["permission_denied"])


if __name__ == "__main__":
    unittest.main()
