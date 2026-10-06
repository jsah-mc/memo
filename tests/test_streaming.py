import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import AsyncMock, Mock, patch

from fastapi.testclient import TestClient

from utils.gateway.api import create_app
from utils.gateway.sdk import SDKResponseStream
from utils.gateway.settings import GatewaySettings
from utils.tools.computer import ComputerSandboxTool
from utils.tools.permissions import PermissionBroker


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


class FakePermissionResponseStream:
    async def events(self):
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
        yield {"type": "response.completed", "response": {"usage": {}}}


def completed_stream(response: dict, text: str = "") -> SDKResponseStream:
    async def events():
        if text:
            yield {"type": "response.output_text.delta", "delta": text}
        yield {"type": "response.completed", "response": response}

    return SDKResponseStream(events())


class FakeMoonKartTool:
    name = "control_moonkart"

    def __init__(self) -> None:
        self.actions: list[str] = []

    async def execute(self, arguments: dict) -> dict:
        action = arguments["action"]
        self.actions.append(action)
        return {
            "ok": True,
            "action": action,
            "command": "H" if action == "start" else "S",
        }

    async def close(self) -> None:
        pass


class GatewayStreamingTests(TestCase):
    def test_chat_completions_emits_each_text_delta_before_done(self) -> None:
        settings = GatewaySettings()

        with (
            patch(
                "utils.gateway.sdk.ModelSDK.responses",
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
                "utils.gateway.sdk.ModelSDK.responses",
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

    def test_desktop_stream_exposes_shell_permission_event(self) -> None:
        with (
            patch(
                "utils.gateway.sdk.ModelSDK.responses",
                new=AsyncMock(return_value=FakePermissionResponseStream()),
            ),
            TestClient(create_app(GatewaySettings())) as client,
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
        permission = next(
            item for item in data if item.get("object") == "memo.permission_request"
        )
        self.assertEqual(permission["permission"]["command"], "npm --version")
        self.assertFalse(permission["permission"]["os_isolated"])

    def test_gateway_executes_spaced_moon_cart_without_upstream_model(self) -> None:
        settings = GatewaySettings()
        tool = FakeMoonKartTool()

        with (
            patch(
                "utils.gateway.sdk.ModelSDK.responses",
                new=AsyncMock(side_effect=AssertionError("model was called")),
            ),
            TestClient(create_app(settings, moonkart_tool=tool)) as client,
        ):
            response = client.post(
                "/v1/chat/completions",
                json={
                    "model": "codex",
                    "messages": [{"role": "user", "content": "start the moon cart"}],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(tool.actions, ["start"])
        self.assertEqual(
            response.json()["choices"][0]["message"]["content"],
            "MoonKart start command sent (H).",
        )

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

    def test_gateway_computer_tool_requires_setting_and_opt_in_header(self) -> None:
        settings = GatewaySettings(computer_enabled=True)
        with tempfile.TemporaryDirectory() as root:
            computer = ComputerSandboxTool(root)
            upstream = AsyncMock(
                side_effect=[
                    completed_stream(
                        {
                            "output": [
                                {
                                    "type": "function_call",
                                    "call_id": "call_echo",
                                    "name": "run_sandboxed_command",
                                    "arguments": '{"argv":["echo","gateway"]}',
                                }
                            ]
                        }
                    ),
                    completed_stream(
                        {"output": [], "usage": {}},
                        "The command printed gateway.",
                    ),
                ]
            )
            with (
                patch(
                    "utils.gateway.sdk.ModelSDK.responses",
                    new=upstream,
                ),
                TestClient(create_app(settings, computer_tool=computer)) as client,
            ):
                response = client.post(
                    "/v1/chat/completions",
                    headers={"X-Memo-Computer-Tools": "1"},
                    json={
                        "model": "codex",
                        "messages": [{"role": "user", "content": "run echo gateway"}],
                    },
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["choices"][0]["message"]["content"],
            "The command printed gateway.",
        )
        self.assertEqual(upstream.await_count, 2)
        second_input = upstream.await_args_list[1].args[-1]["input"]
        self.assertEqual(second_input[-1]["type"], "function_call_output")

    def test_screen_request_is_forced_to_desktop_tool_at_gateway_boundary(
        self,
    ) -> None:
        settings = GatewaySettings(computer_enabled=True)
        with tempfile.TemporaryDirectory() as root:
            computer = ComputerSandboxTool(root)
            upstream = AsyncMock(
                side_effect=[
                    completed_stream(
                        {
                            "output": [
                                {
                                    "type": "function_call",
                                    "call_id": "call_screen",
                                    "name": "inspect_computer_screen",
                                    "arguments": "{}",
                                }
                            ]
                        }
                    ),
                    completed_stream(
                        {"output": [], "usage": {}},
                        "Screen permission is required.",
                    ),
                ]
            )
            with (
                patch(
                    "utils.gateway.sdk.ModelSDK.responses",
                    new=upstream,
                ),
                TestClient(create_app(settings, computer_tool=computer)) as client,
            ):
                response = client.post(
                    "/v1/chat/completions",
                    headers={
                        "X-Memo-Desktop": "1",
                        "X-Memo-Computer-Tools": "1",
                    },
                    json={
                        "model": "codex",
                        "messages": [
                            {
                                "role": "user",
                                "content": "see my screen and tell me whats on it",
                            }
                        ],
                    },
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            upstream.await_args_list[0].args[-1]["tool_choice"],
            {"type": "function", "name": "inspect_computer_screen"},
        )

    def test_gateway_computer_tool_is_not_exposed_without_header(self) -> None:
        settings = GatewaySettings(computer_enabled=True)
        upstream = AsyncMock(
            return_value=completed_stream(
                {"output": [], "usage": {}},
                "Ordinary model response.",
            )
        )
        with (
            patch(
                "utils.gateway.sdk.ModelSDK.responses",
                new=upstream,
            ),
            TestClient(create_app(settings)) as client,
        ):
            response = client.post(
                "/v1/chat/completions",
                json={
                    "model": "codex",
                    "messages": [{"role": "user", "content": "run echo gateway"}],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(upstream.await_count, 1)
        self.assertNotIn("tools", upstream.await_args.args[-1])

    def test_gateway_opens_explicit_app_without_model_decision(self) -> None:
        settings = GatewaySettings(computer_enabled=True)
        with tempfile.TemporaryDirectory() as root:
            computer = ComputerSandboxTool(root)
            process = Mock(pid=42)
            with (
                patch(
                    "utils.gateway.sdk.ModelSDK.responses",
                    new=AsyncMock(side_effect=AssertionError("model was called")),
                ),
                patch(
                    "utils.tools.computer.subprocess.Popen",
                    return_value=process,
                ),
                TestClient(create_app(settings, computer_tool=computer)) as client,
            ):
                response = client.post(
                    "/v1/chat/completions",
                    headers={"X-Memo-Computer-Tools": "1"},
                    json={
                        "model": "codex",
                        "messages": [{"role": "user", "content": "open notepad"}],
                    },
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["choices"][0]["message"]["content"],
            "Opened Notepad.",
        )

    def test_yes_launches_named_app_without_another_model_promise(self) -> None:
        settings = GatewaySettings(computer_enabled=True)
        with tempfile.TemporaryDirectory() as root:
            computer = ComputerSandboxTool(root)
            launch_result = {
                "ok": True,
                "target": "Zed",
                "resolved_name": "Zed",
                "resolved_path": (r"C:\Users\Admin\AppData\Local\Programs\Zed\Zed.exe"),
                "pid": 42,
                "resolution": "executable",
            }
            with (
                patch(
                    "utils.gateway.sdk.ModelSDK.responses",
                    new=AsyncMock(
                        side_effect=AssertionError("model must not promise a launch")
                    ),
                ),
                patch.object(
                    computer,
                    "_launch_windows_app" if os.name == "nt" else "_launch_linux_app",
                    return_value=launch_result,
                ) as launch,
                TestClient(create_app(settings, computer_tool=computer)) as client,
            ):
                response = client.post(
                    "/v1/chat/completions",
                    headers={
                        "X-Memo-Desktop": "1",
                        "X-Memo-Computer-Tools": "1",
                    },
                    json={
                        "model": "codex",
                        "messages": [
                            {"role": "user", "content": "open Zed"},
                            {
                                "role": "assistant",
                                "content": "Reply yes and I'll open it.",
                            },
                            {"role": "user", "content": "yes"},
                        ],
                    },
                )

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "Opened Zed",
            response.json()["choices"][0]["message"]["content"],
        )
        launch.assert_called_once_with("Zed")

    def test_yes_opens_downloads_without_model_claiming_success(self) -> None:
        settings = GatewaySettings(computer_enabled=True)
        downloads = str((Path.home() / "Downloads").resolve())
        with tempfile.TemporaryDirectory() as root:
            computer = ComputerSandboxTool(root)
            with (
                patch(
                    "utils.gateway.sdk.ModelSDK.responses",
                    new=AsyncMock(
                        side_effect=AssertionError("model must not claim it opened a folder")
                    ),
                ),
                patch.object(
                    computer,
                    "_launch_windows_app" if os.name == "nt" else "_launch_linux_app",
                    return_value={
                        "ok": True,
                        "target": downloads,
                        "resolution": "windows_shell",
                    },
                ) as launch,
                TestClient(create_app(settings, computer_tool=computer)) as client,
            ):
                response = client.post(
                    "/v1/chat/completions",
                    headers={
                        "X-Memo-Desktop": "1",
                        "X-Memo-Computer-Tools": "1",
                    },
                    json={
                        "model": "codex",
                        "messages": [
                            {
                                "role": "user",
                                "content": "now open the downloads Folder",
                            },
                            {
                                "role": "assistant",
                                "content": "Reply yes and I'll open it.",
                            },
                            {"role": "user", "content": "yes"},
                        ],
                    },
                )

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "Opened Downloads",
            response.json()["choices"][0]["message"]["content"],
        )
        launch.assert_called_once_with(downloads)

    def test_gateway_permission_resolution_requires_desktop_headers(self) -> None:
        broker = Mock(spec=PermissionBroker)
        broker.resolve.return_value = True
        settings = GatewaySettings(computer_enabled=True)
        with TestClient(create_app(settings, permission_broker=broker)) as client:
            denied = client.post(
                "/v1/permissions/perm_test",
                json={"allowed": True},
            )
            allowed = client.post(
                "/v1/permissions/perm_test",
                headers={
                    "X-Memo-Desktop": "1",
                    "X-Memo-Computer-Tools": "1",
                },
                json={"allowed": True},
            )

        self.assertEqual(denied.status_code, 403)
        self.assertEqual(allowed.status_code, 200)
        broker.resolve.assert_called_once_with("perm_test", True)
