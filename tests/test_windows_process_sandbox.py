import os
import tempfile
from pathlib import Path
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import patch

from utils.tools.computer import ComputerSandboxTool
from utils.tools.windows_process_sandbox import sandboxed_command


class WindowsSandboxCommandTests(TestCase):
    def test_bundled_runner_receives_command_and_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            runner = Path(directory, "MemoSandbox.exe")
            runner.touch()
            workspace = Path(directory, "workspace")
            with patch.dict(
                os.environ,
                {
                    "MEMO_WINDOWS_PROCESS_SANDBOX": "required",
                    "MEMO_WINDOWS_SANDBOX_RUNNER": str(runner),
                },
            ):
                command = sandboxed_command("echo hello", workspace)

        self.assertEqual(
            command,
            (str(runner.resolve()), ["--cwd", str(workspace), "--", "echo hello"]),
        )

    def test_required_runner_fails_closed(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "MEMO_WINDOWS_PROCESS_SANDBOX": "required",
                    "MEMO_WINDOWS_SANDBOX_RUNNER": "missing.exe",
                },
            ),
            self.assertRaisesRegex(RuntimeError, "bundled Windows sandbox"),
        ):
            sandboxed_command("echo hello", Path.cwd())


class WindowsSandboxTargetTests(IsolatedAsyncioTestCase):
    async def test_virtual_target_does_not_use_windows_process_sandbox(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tool = ComputerSandboxTool(directory, computer_target="virtual")
            with patch(
                "utils.tools.computer.sandboxed_command",
                side_effect=AssertionError("sandbox invoked"),
            ):
                result = await tool.run_shell(
                    {"command": "echo virtual"},
                    permission_granted=True,
                )

        self.assertTrue(result["ok"])
        self.assertFalse(result["os_isolated"])
