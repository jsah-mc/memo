"""CUA contract tests using real SDK records and a fake native driver."""

import base64
import io
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from cua_driver import (
    ClickButton,
    DesktopScope,
    ImageContent,
    ScrollDirection,
    ToolResult,
)
from PIL import Image
from pydantic import ValidationError

from utils.tools.computer import ComputerSandboxTool
from utils.tools.cua_actions import CuaToolError
from utils.tools.cua_desktop import CuaDesktopController, DesktopInputError


def tool_result(*, image: bool = False, error: bool = False) -> ToolResult:
    images: list[ImageContent] = []
    if image:
        with io.BytesIO() as output:
            Image.new("RGB", (3200, 1800)).save(output, format="PNG")
            images.append(
                ImageContent(
                    mime_type="image/png",
                    data_base64=base64.b64encode(output.getvalue()).decode("ascii"),
                )
            )
    return ToolResult(
        text="denied" if error else "ok",
        images=images,
        structured_json=None,
        is_error=error,
        error_code="permission_denied" if error else None,
        action=None,
        verification=None,
        degraded=False,
        raw_json="{}",
    )


class CuaDesktopTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.driver = AsyncMock()
        self.driver.get_desktop_state.return_value = tool_result(image=True)
        for name in (
            "click",
            "move_cursor",
            "type_text",
            "press_key",
            "hotkey",
            "scroll",
        ):
            getattr(self.driver, name).return_value = tool_result()
        self.factory = patch(
            "utils.tools.cua_desktop.CuaDriver.create", return_value=self.driver
        ).start()
        self.addCleanup(patch.stopall)
        self.desktop = CuaDesktopController()

    async def test_capture_scales_native_screenshot_and_closes_driver(self) -> None:
        result = await self.desktop.capture()
        self.assertEqual((result["image_width"], result["image_height"]), (1600, 900))
        self.assertEqual(
            (result["screen_width"], result["screen_height"]), (3200, 1800)
        )
        self.assertTrue(result["image_url"].startswith("data:image/jpeg;base64,"))
        self.driver.shutdown.assert_awaited_once()

    async def test_action_mapping_uses_desktop_coordinates(self) -> None:
        await self.desktop.capture()
        result = await self.desktop.control(
            {
                "actions": [
                    {"action": "move", "x": 100, "y": 200},
                    {"action": "click", "x": 120, "y": 240, "button": "right"},
                    {"action": "double_click", "x": 130, "y": 250},
                    {"action": "type", "text": "hello"},
                    {"action": "press", "key": "ENTER"},
                    {"action": "hotkey", "keys": ["SUPER", "SHIFT", "F"]},
                    {"action": "scroll", "amount": -3},
                    {"action": "wait", "seconds": 0},
                ]
            }
        )
        move = self.driver.move_cursor.call_args.args[0]
        self.assertEqual((move.x, move.y), (200, 400))
        click, double = [call.args[0] for call in self.driver.click.call_args_list]
        self.assertEqual((click.x, click.y, click.count), (240, 480, 1))
        self.assertEqual(click.button, ClickButton.RIGHT)
        self.assertEqual(double.count, 2)
        self.assertEqual(click.scope, DesktopScope.DESKTOP)
        self.assertEqual(self.driver.type_text.call_args.args[0].text, "hello")
        self.assertEqual(self.driver.press_key.call_args.args[0].key, "enter")
        self.assertEqual(
            self.driver.hotkey.call_args.args[0].keys, ["super", "shift", "f"]
        )
        scroll = self.driver.scroll.call_args.args[0]
        self.assertEqual((scroll.x, scroll.y, scroll.amount), (260, 500, 3))
        self.assertEqual(scroll.direction, ScrollDirection.DOWN)
        self.assertEqual(result["actions_completed"], 8)
        self.assertEqual(self.driver.get_desktop_state.await_count, 2)
        self.assertEqual(self.driver.shutdown.await_count, 2)

    async def test_input_requires_prior_capture(self) -> None:
        with self.assertRaises(DesktopInputError):
            await self.desktop.control(
                {"actions": [{"action": "press", "key": "enter"}]}
            )
        self.factory.assert_not_called()

    async def test_invalid_batch_is_rejected_before_any_input(self) -> None:
        await self.desktop.capture()
        for action in (
            {"action": "click", "x": 1600, "y": 0},
            {"action": "click", "x": -1, "y": 0},
            {"action": "scroll", "amount": 21},
            {"action": "wait", "seconds": 6},
            {"action": "hotkey", "keys": ["ctrl"]},
            {"action": "unknown"},
        ):
            with (
                self.subTest(action=action),
                self.assertRaises((ValidationError, DesktopInputError)),
            ):
                await self.desktop.control(
                    {
                        "actions": [
                            {"action": "click", "x": 1, "y": 1},
                            action,
                        ]
                    }
                )
        self.driver.click.assert_not_awaited()
        self.factory.assert_called_once()

    async def test_tool_error_stops_batch_and_closes_driver(self) -> None:
        await self.desktop.capture()
        self.driver.click.return_value = tool_result(error=True)
        with self.assertRaises(CuaToolError):
            await self.desktop.control(
                {
                    "actions": [
                        {"action": "click", "x": 1, "y": 1},
                        {"action": "type", "text": "must not type"},
                    ]
                }
            )
        self.driver.type_text.assert_not_awaited()
        self.assertEqual(self.driver.shutdown.await_count, 2)

    async def test_missing_screenshot_is_an_error(self) -> None:
        self.driver.get_desktop_state.return_value = tool_result()
        with self.assertRaises(DesktopInputError):
            await self.desktop.capture()
        self.driver.shutdown.assert_awaited_once()

    async def test_failed_capture_invalidates_previous_coordinates(self) -> None:
        await self.desktop.capture()
        self.driver.get_desktop_state.return_value = tool_result(error=True)
        with self.assertRaises(CuaToolError):
            await self.desktop.capture()
        with self.assertRaises(DesktopInputError):
            await self.desktop.control(
                {"actions": [{"action": "click", "x": 1, "y": 1}]}
            )
        self.driver.click.assert_not_awaited()

    async def test_computer_tool_gates_cua_access(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            tool = ComputerSandboxTool(root)
            self.assertIsInstance(tool.desktop, CuaDesktopController)
            with self.assertRaises(PermissionError):
                await tool.execute(
                    "inspect_computer_screen", {}, user_text="see the screen"
                )
            self.factory.assert_not_called()
            result = await tool.execute(
                "inspect_computer_screen",
                {},
                user_text="see the screen",
                permission_granted=True,
            )
            self.assertTrue(result["ok"])
            self.driver.get_desktop_state.assert_awaited_once()
