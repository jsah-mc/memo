"""Permission-gated desktop capture and input through CUA Driver."""

from __future__ import annotations

import base64
import io
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import ClassVar, TypedDict

import anyio
from cua_driver import CuaDriver, GetDesktopStateInput
from PIL import Image
from pydantic import JsonValue

from .cua_actions import ActionBatch, PointerAction, perform, require_success
from .desktop_schema import (
    CONTROL_TOOL_DEFINITION,
    MAX_SCREEN_EDGE,
    SCREEN_TOOL_DEFINITION,
)


class ScreenCapture(TypedDict):
    ok: bool
    image_url: str
    image_width: int
    image_height: int
    screen_width: int
    screen_height: int
    origin_x: int
    origin_y: int
    actions_completed: int


class DesktopInputError(ValueError):
    """An input cannot be addressed against the last observed screen."""


@dataclass(frozen=True, slots=True)
class ScreenGeometry:
    native: tuple[int, int]
    image: tuple[int, int]

    def point(self, action: PointerAction) -> tuple[int, int]:
        x, y = action.x, action.y
        if x >= self.image[0] or y >= self.image[1]:
            message = "Mouse coordinates are outside the latest screenshot."
            raise DesktopInputError(message)
        return (
            min(self.native[0] - 1, round(x * self.native[0] / self.image[0])),
            min(self.native[1] - 1, round(y * self.native[1] / self.image[1])),
        )


@asynccontextmanager
async def driver_session() -> AsyncIterator[CuaDriver]:
    """Own one driver for a complete tool call, including its final capture."""
    driver = CuaDriver.create()
    try:
        yield driver
    finally:
        with anyio.CancelScope(shield=True):
            await driver.shutdown()


class CuaDesktopController:
    """Track screenshot geometry while CUA owns native desktop interaction."""

    screen_name = "inspect_computer_screen"
    control_name = "control_computer"
    names: ClassVar[set[str]] = {screen_name, control_name}
    responses_definitions: ClassVar = [SCREEN_TOOL_DEFINITION, CONTROL_TOOL_DEFINITION]

    def __init__(self) -> None:
        self._geometry: ScreenGeometry | None = None
        self._point = (0, 0)
        self._lock = anyio.Lock()

    async def _capture(self, driver: CuaDriver) -> ScreenCapture:
        previous_geometry = self._geometry
        self._geometry = None
        result = await driver.get_desktop_state(
            GetDesktopStateInput(session=None, screenshot_out_file=None)
        )
        require_success(result)
        if not result.images:
            message = "CUA driver returned no desktop screenshot."
            raise DesktopInputError(message)
        encoded = result.images[0].data_base64
        with Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))) as source:
            native = source.size
            image = source.convert("RGB")
        image.thumbnail((MAX_SCREEN_EDGE, MAX_SCREEN_EDGE), Image.Resampling.LANCZOS)
        geometry = ScreenGeometry(native=native, image=image.size)
        if geometry != previous_geometry:
            self._point = (native[0] // 2, native[1] // 2)
        self._geometry = geometry
        with io.BytesIO() as output:
            image.save(output, format="JPEG", quality=72, optimize=True)
            image_url = "data:image/jpeg;base64," + base64.b64encode(
                output.getvalue()
            ).decode("ascii")
        return ScreenCapture(
            ok=True,
            image_url=image_url,
            image_width=image.width,
            image_height=image.height,
            screen_width=native[0],
            screen_height=native[1],
            origin_x=0,
            origin_y=0,
            actions_completed=0,
        )

    async def capture(self) -> ScreenCapture:
        async with self._lock, driver_session() as driver:
            return await self._capture(driver)

    async def control(self, arguments: Mapping[str, JsonValue]) -> ScreenCapture:
        batch = ActionBatch.model_validate(arguments)
        async with self._lock:
            geometry = self._geometry
            if geometry is None:
                message = "Inspect the computer screen before sending input."
                raise DesktopInputError(message)
            point = self._point
            points: list[tuple[int, int]] = []
            for action in batch.actions:
                if isinstance(action, PointerAction):
                    point = geometry.point(action)
                points.append(point)
            async with driver_session() as driver:
                for action, point in zip(batch.actions, points, strict=True):
                    await perform(driver, action, point)
                    self._point = point
                result = await self._capture(driver)
            result["actions_completed"] = len(batch.actions)
            return result
