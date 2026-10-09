"""Validate Memo action batches and dispatch typed CUA input calls."""

from typing import Annotated, Literal, assert_never

import anyio
from cua_driver import (
    ClickButton,
    ClickInput,
    CuaDriver,
    DesktopScope,
    HotkeyInput,
    MoveCursorInput,
    PressKeyInput,
    ScrollBy,
    ScrollDirection,
    ScrollInput,
    ToolResult,
    TypeTextInput,
)
from pydantic import BaseModel, ConfigDict, Field


AGENT_CURSOR_SESSION = "memo-agent-control"


class ActionModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)


class PointerAction(ActionModel):
    action: Literal["click", "double_click", "move"]
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    button: Literal["left", "right", "middle"] = "left"


class TypeAction(ActionModel):
    action: Literal["type"]
    text: str = Field(max_length=4000)


class PressAction(ActionModel):
    action: Literal["press"]
    key: str = Field(min_length=1, max_length=32)


class HotkeyAction(ActionModel):
    action: Literal["hotkey"]
    keys: list[Annotated[str, Field(min_length=1, max_length=32)]] = Field(
        min_length=2, max_length=4
    )


class ScrollAction(ActionModel):
    action: Literal["scroll"]
    amount: int = Field(ge=-20, le=20)


class WaitAction(ActionModel):
    action: Literal["wait"]
    seconds: float = Field(default=1, ge=0, le=5)


type Action = (
    PointerAction | TypeAction | PressAction | HotkeyAction | ScrollAction | WaitAction
)


class ActionBatch(ActionModel):
    actions: list[Annotated[Action, Field(discriminator="action")]] = Field(
        min_length=1, max_length=12
    )


class CuaToolError(RuntimeError):
    def __init__(self, result: ToolResult) -> None:
        self.code = result.error_code
        super().__init__(f"CUA driver: {result.text}")


def require_success(result: ToolResult) -> None:
    if result.is_error:
        raise CuaToolError(result)


def normalized_key(key: str) -> str:
    value = key.casefold()
    return {
        "control": "ctrl",
        "return": "enter",
        "escape": "esc",
        "win": "super",
        "windows": "super",
        "logo": "super",
    }.get(value, value)


async def perform(driver: CuaDriver, action: Action, point: tuple[int, int]) -> None:
    """Run one validated action; never retry an input with uncertain completion."""
    x, y = point
    match action:
        case PointerAction(action="move"):
            result = await driver.move_cursor(
                MoveCursorInput(
                    x=x,
                    y=y,
                    target=None,
                    scope=DesktopScope.DESKTOP,
                    session=AGENT_CURSOR_SESSION,
                )
            )
        case PointerAction():
            result = await driver.click(
                ClickInput(
                    x=x,
                    y=y,
                    target=None,
                    scope=DesktopScope.DESKTOP,
                    session=AGENT_CURSOR_SESSION,
                    button={
                        "left": ClickButton.LEFT,
                        "right": ClickButton.RIGHT,
                        "middle": ClickButton.MIDDLE,
                    }[action.button],
                    count=2 if action.action == "double_click" else 1,
                )
            )
        case TypeAction():
            result = await driver.type_text(
                TypeTextInput(
                    text=action.text,
                    target=None,
                    scope=DesktopScope.DESKTOP,
                    session=AGENT_CURSOR_SESSION,
                )
            )
        case PressAction():
            result = await driver.press_key(
                PressKeyInput(
                    key=normalized_key(action.key),
                    modifiers=None,
                    target=None,
                    scope=DesktopScope.DESKTOP,
                    session=AGENT_CURSOR_SESSION,
                )
            )
        case HotkeyAction():
            result = await driver.hotkey(
                HotkeyInput(
                    keys=[normalized_key(key) for key in action.keys],
                    target=None,
                    scope=DesktopScope.DESKTOP,
                    session=AGENT_CURSOR_SESSION,
                )
            )
        case ScrollAction(amount=0):
            return
        case ScrollAction():
            result = await driver.scroll(
                ScrollInput(
                    x=x,
                    y=y,
                    direction=ScrollDirection.UP
                    if action.amount > 0
                    else ScrollDirection.DOWN,
                    by=ScrollBy.LINE,
                    amount=abs(action.amount),
                    target=None,
                    scope=DesktopScope.DESKTOP,
                    session=AGENT_CURSOR_SESSION,
                )
            )
        case WaitAction():
            await anyio.sleep(action.seconds)
            return
        case unreachable:
            assert_never(unreachable)
    require_success(result)
