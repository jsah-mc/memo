"""Permission-gated Windows screen, mouse, and keyboard control."""

from __future__ import annotations

import asyncio
import base64
import ctypes
import io
import os
from typing import Any, ClassVar

from PIL import Image

MAX_SCREEN_EDGE = 1600
MAX_ACTIONS = 12

SCREEN_TOOL_DEFINITION = {
    "type": "function",
    "name": "inspect_computer_screen",
    "description": (
        "Capture the current Windows desktop so you can see visible apps and "
        "controls. Use this before clicking and again whenever the screen may "
        "have changed. A user approval grants screen and input access only for "
        "the current task."
        "If The User Says Anything Related or says something like see the screen You Can Use This Tool"
        "To See And Give The User What You Saw"
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    },
    "strict": True,
}

CONTROL_TOOL_DEFINITION = {
    "type": "function",
    "name": "control_computer",
    "description": (
        "Perform a short sequence of Windows mouse and keyboard actions, then "
        "return a fresh screenshot. Coordinates use the pixel dimensions from "
        "the latest screenshot. Supported actions are click, double_click, "
        "move, type, press, hotkey, scroll, and wait. Keep each sequence short "
        "and inspect the resulting screen before deciding the next actions."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "actions": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_ACTIONS,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": [
                                "click",
                                "double_click",
                                "move",
                                "type",
                                "press",
                                "hotkey",
                                "scroll",
                                "wait",
                            ],
                        },
                        "x": {"type": "integer"},
                        "y": {"type": "integer"},
                        "button": {
                            "type": "string",
                            "enum": ["left", "right", "middle"],
                        },
                        "text": {"type": "string", "maxLength": 4_000},
                        "key": {"type": "string", "maxLength": 32},
                        "keys": {
                            "type": "array",
                            "minItems": 2,
                            "maxItems": 4,
                            "items": {"type": "string", "maxLength": 32},
                        },
                        "amount": {
                            "type": "integer",
                            "minimum": -20,
                            "maximum": 20,
                        },
                        "seconds": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 5,
                        },
                    },
                    "required": ["action"],
                },
            }
        },
        "required": ["actions"],
    },
    "strict": False,
}
_DESKTOP_CONTROL_TERMS = (
    "click",
    "double click",
    "right click",
    "type ",
    "enter ",
    "press ",
    "scroll",
    "move the mouse",
    "use the computer",
    "use my computer",
    "control the computer",
    "control my computer",
    "interact with",
    "see my screen",
    "see the screen",
    "view my screen",
    "view the screen",
    "look at my screen",
    "look at the screen",
    "inspect my screen",
    "inspect the screen",
    "what's on my screen",
    "what is on my screen",
    "tell me what's on my screen",
    "tell me whats on my screen",
)


def detect_desktop_control_request(text: str) -> bool:
    """Return whether a request needs visible desktop interaction."""

    lowered = text.casefold()
    if any(term in lowered for term in _DESKTOP_CONTROL_TERMS):
        return True
    opens_then_interacts = any(
        verb in lowered for verb in ("open ", "launch ", "start ")
    ) and any(conjunction in lowered for conjunction in (" and ", " then "))
    return opens_then_interacts


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.c_ushort),
        ("wScan", ctypes.c_ushort),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


class _INPUT_UNION(ctypes.Union):
    _fields_: ClassVar[list[tuple[str, type[ctypes.Structure]]]] = [
        ("ki", _KEYBDINPUT),
        ("mi", _MOUSEINPUT),
    ]


class _INPUT(ctypes.Structure):
    _anonymous_ = ("value",)
    _fields_ = [("type", ctypes.c_ulong), ("value", _INPUT_UNION)]


class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", ctypes.c_ulong),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", ctypes.c_ushort),
        ("biBitCount", ctypes.c_ushort),
        ("biCompression", ctypes.c_ulong),
        ("biSizeImage", ctypes.c_ulong),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", ctypes.c_ulong),
        ("biClrImportant", ctypes.c_ulong),
    ]


class _BITMAPINFO(ctypes.Structure):
    _fields_ = [
        ("bmiHeader", _BITMAPINFOHEADER),
        ("bmiColors", ctypes.c_ulong * 1),
    ]


class DesktopController:
    """Capture and control the interactive Windows desktop."""

    screen_name = "inspect_computer_screen"
    control_name = "control_computer"
    names: ClassVar[set[str]] = {screen_name, control_name}

    _SPECIAL_KEYS: ClassVar[dict[str, int]] = {
        "backspace": 0x08,
        "tab": 0x09,
        "enter": 0x0D,
        "shift": 0x10,
        "ctrl": 0x11,
        "control": 0x11,
        "alt": 0x12,
        "escape": 0x1B,
        "esc": 0x1B,
        "space": 0x20,
        "pageup": 0x21,
        "pagedown": 0x22,
        "end": 0x23,
        "home": 0x24,
        "left": 0x25,
        "up": 0x26,
        "right": 0x27,
        "down": 0x28,
        "delete": 0x2E,
        "win": 0x5B,
        "windows": 0x5B,
        "f1": 0x70,
        "f2": 0x71,
        "f3": 0x72,
        "f4": 0x73,
        "f5": 0x74,
        "f6": 0x75,
        "f7": 0x76,
        "f8": 0x77,
        "f9": 0x78,
        "f10": 0x79,
        "f11": 0x7A,
        "f12": 0x7B,
    }

    def __init__(self) -> None:
        self._origin_x = 0
        self._origin_y = 0
        self._screen_width = 1
        self._screen_height = 1
        self._image_width = 1
        self._image_height = 1

    @property
    def responses_definitions(self) -> list[dict[str, Any]]:
        return [SCREEN_TOOL_DEFINITION, CONTROL_TOOL_DEFINITION]

    @staticmethod
    def _require_windows() -> None:
        if os.name != "nt":
            raise RuntimeError("Desktop control is supported only on Windows.")

    def _capture_sync(self) -> dict[str, Any]:
        self._require_windows()
        user32 = ctypes.windll.user32
        self._origin_x = int(user32.GetSystemMetrics(76))
        self._origin_y = int(user32.GetSystemMetrics(77))
        self._screen_width = max(1, int(user32.GetSystemMetrics(78)))
        self._screen_height = max(1, int(user32.GetSystemMetrics(79)))

        try:
            image = self._grab_screen_gdi()
        except OSError as gdi_error:
            try:
                from PIL import ImageGrab

                image = ImageGrab.grab(all_screens=True)
            except OSError as pillow_error:
                raise RuntimeError(
                    "Memo could not capture the interactive Windows desktop. "
                    "Make sure Memo is running in the signed-in desktop session "
                    "and the screen is unlocked."
                ) from ExceptionGroup(
                    "Windows screenshot backends failed",
                    [gdi_error, pillow_error],
                )
        if image.mode != "RGB":
            image = image.convert("RGB")
        scale = min(1.0, MAX_SCREEN_EDGE / max(image.size))
        if scale < 1:
            image = image.resize(
                (
                    max(1, round(image.width * scale)),
                    max(1, round(image.height * scale)),
                ),
                Image.Resampling.LANCZOS,
            )
        self._image_width, self._image_height = image.size
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=72, optimize=True)
        image_url = "data:image/jpeg;base64," + base64.b64encode(
            output.getvalue()
        ).decode("ascii")
        return {
            "ok": True,
            "image_url": image_url,
            "image_width": self._image_width,
            "image_height": self._image_height,
            "screen_width": self._screen_width,
            "screen_height": self._screen_height,
            "origin_x": self._origin_x,
            "origin_y": self._origin_y,
        }

    def _grab_screen_gdi(self) -> Image.Image:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
        user32.GetDC.argtypes = [ctypes.c_void_p]
        user32.GetDC.restype = ctypes.c_void_p
        user32.ReleaseDC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        gdi32.CreateCompatibleDC.argtypes = [ctypes.c_void_p]
        gdi32.CreateCompatibleDC.restype = ctypes.c_void_p
        gdi32.CreateCompatibleBitmap.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.c_int,
        ]
        gdi32.CreateCompatibleBitmap.restype = ctypes.c_void_p
        gdi32.SelectObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        gdi32.SelectObject.restype = ctypes.c_void_p
        gdi32.BitBlt.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_ulong,
        ]
        gdi32.GetDIBits.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_uint,
            ctypes.c_uint,
            ctypes.c_void_p,
            ctypes.POINTER(_BITMAPINFO),
            ctypes.c_uint,
        ]
        gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
        gdi32.DeleteDC.argtypes = [ctypes.c_void_p]

        source_dc = user32.GetDC(None)
        if not source_dc:
            raise OSError("Windows could not access the desktop device context.")
        memory_dc = gdi32.CreateCompatibleDC(source_dc)
        bitmap = None
        previous = None
        try:
            if not memory_dc:
                raise OSError("Windows could not create a screenshot context.")
            bitmap = gdi32.CreateCompatibleBitmap(
                source_dc,
                self._screen_width,
                self._screen_height,
            )
            if not bitmap:
                raise OSError("Windows could not allocate a screenshot bitmap.")
            previous = gdi32.SelectObject(memory_dc, bitmap)
            copied = gdi32.BitBlt(
                memory_dc,
                0,
                0,
                self._screen_width,
                self._screen_height,
                source_dc,
                self._origin_x,
                self._origin_y,
                0x00CC0020 | 0x40000000,
            )
            if not copied:
                error = ctypes.get_last_error()
                raise OSError(error, "Windows screen capture failed.")

            info = _BITMAPINFO(
                bmiHeader=_BITMAPINFOHEADER(
                    biSize=ctypes.sizeof(_BITMAPINFOHEADER),
                    biWidth=self._screen_width,
                    biHeight=-self._screen_height,
                    biPlanes=1,
                    biBitCount=32,
                    biCompression=0,
                    biSizeImage=0,
                    biXPelsPerMeter=0,
                    biYPelsPerMeter=0,
                    biClrUsed=0,
                    biClrImportant=0,
                )
            )
            buffer_size = self._screen_width * self._screen_height * 4
            pixels = ctypes.create_string_buffer(buffer_size)
            rows = gdi32.GetDIBits(
                memory_dc,
                bitmap,
                0,
                self._screen_height,
                pixels,
                ctypes.byref(info),
                0,
            )
            if rows != self._screen_height:
                raise OSError("Windows returned an incomplete screenshot.")
            return Image.frombuffer(
                "RGB",
                (self._screen_width, self._screen_height),
                pixels.raw,
                "raw",
                "BGRX",
                0,
                1,
            ).copy()
        finally:
            if previous and memory_dc:
                gdi32.SelectObject(memory_dc, previous)
            if bitmap:
                gdi32.DeleteObject(bitmap)
            if memory_dc:
                gdi32.DeleteDC(memory_dc)
            user32.ReleaseDC(None, source_dc)

    async def capture(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._capture_sync)

    def _screen_point(self, x: Any, y: Any) -> tuple[int, int]:
        if not isinstance(x, int) or not isinstance(y, int):
            raise TypeError("Mouse actions require integer x and y coordinates.")
        if not 0 <= x < self._image_width or not 0 <= y < self._image_height:
            raise ValueError("Mouse coordinates are outside the latest screenshot.")
        screen_x = self._origin_x + round(x * self._screen_width / self._image_width)
        screen_y = self._origin_y + round(y * self._screen_height / self._image_height)
        return screen_x, screen_y

    @staticmethod
    def _mouse_button(button: str, *, down: bool) -> int:
        flags = {
            ("left", True): 0x0002,
            ("left", False): 0x0004,
            ("right", True): 0x0008,
            ("right", False): 0x0010,
            ("middle", True): 0x0020,
            ("middle", False): 0x0040,
        }
        try:
            return flags[(button, down)]
        except KeyError as exc:
            raise ValueError(f"Unsupported mouse button: {button}") from exc

    @classmethod
    def _virtual_key(cls, key: str) -> int:
        normalized = key.casefold()
        if normalized in cls._SPECIAL_KEYS:
            return cls._SPECIAL_KEYS[normalized]
        if len(key) == 1:
            value = int(ctypes.windll.user32.VkKeyScanW(ord(key)))
            if value != -1:
                return value & 0xFF
        raise ValueError(f"Unsupported key: {key}")

    @staticmethod
    def _send_virtual_key(key_code: int, *, down: bool) -> None:
        ctypes.windll.user32.keybd_event(
            key_code,
            0,
            0 if down else 0x0002,
            0,
        )

    @staticmethod
    def _send_unicode_character(character: str) -> None:
        encoded = character.encode("utf-16-le")
        scan_codes = [
            int.from_bytes(encoded[index : index + 2], "little")
            for index in range(0, len(encoded), 2)
        ]
        for scan_code in scan_codes:
            for key_up in (False, True):
                item = _INPUT(
                    type=1,
                    value=_INPUT_UNION(
                        ki=_KEYBDINPUT(
                            wVk=0,
                            wScan=scan_code,
                            dwFlags=0x0004 | (0x0002 if key_up else 0),
                            time=0,
                            dwExtraInfo=0,
                        )
                    ),
                )
                sent = ctypes.windll.user32.SendInput(
                    1,
                    ctypes.byref(item),
                    ctypes.sizeof(_INPUT),
                )
                if sent != 1:
                    raise OSError("Windows rejected keyboard input.")

    def _perform_sync(self, actions: list[dict[str, Any]]) -> None:
        self._require_windows()
        if not 1 <= len(actions) <= MAX_ACTIONS:
            raise ValueError(f"actions must contain 1 to {MAX_ACTIONS} items.")
        user32 = ctypes.windll.user32
        for action in actions:
            if not isinstance(action, dict):
                raise TypeError("Each desktop action must be an object.")
            kind = action.get("action")
            if kind in {"move", "click", "double_click"}:
                x, y = self._screen_point(action.get("x"), action.get("y"))
                if not user32.SetCursorPos(x, y):
                    raise OSError("Windows rejected the mouse position.")
                if kind != "move":
                    button = str(action.get("button", "left"))
                    clicks = 2 if kind == "double_click" else 1
                    for _ in range(clicks):
                        user32.mouse_event(
                            self._mouse_button(button, down=True),
                            0,
                            0,
                            0,
                            0,
                        )
                        user32.mouse_event(
                            self._mouse_button(button, down=False),
                            0,
                            0,
                            0,
                            0,
                        )
            elif kind == "type":
                text = action.get("text")
                if not isinstance(text, str) or len(text) > 4_000:
                    raise ValueError("type requires text of at most 4,000 characters.")
                for character in text:
                    self._send_unicode_character(character)
            elif kind == "press":
                key = action.get("key")
                if not isinstance(key, str):
                    raise ValueError("press requires a key.")
                key_code = self._virtual_key(key)
                self._send_virtual_key(key_code, down=True)
                self._send_virtual_key(key_code, down=False)
            elif kind == "hotkey":
                keys = action.get("keys")
                if (
                    not isinstance(keys, list)
                    or not 2 <= len(keys) <= 4
                    or not all(isinstance(key, str) for key in keys)
                ):
                    raise ValueError("hotkey requires two to four keys.")
                key_codes = [self._virtual_key(key) for key in keys]
                for key_code in key_codes:
                    self._send_virtual_key(key_code, down=True)
                for key_code in reversed(key_codes):
                    self._send_virtual_key(key_code, down=False)
            elif kind == "scroll":
                amount = action.get("amount")
                if not isinstance(amount, int) or not -20 <= amount <= 20:
                    raise ValueError("scroll amount must be between -20 and 20.")
                user32.mouse_event(0x0800, 0, 0, amount * 120, 0)
            elif kind == "wait":
                seconds = action.get("seconds", 1)
                if not isinstance(seconds, (int, float)) or not 0 <= seconds <= 5:
                    raise ValueError("wait seconds must be between 0 and 5.")
                import time

                time.sleep(float(seconds))
            else:
                raise ValueError(f"Unsupported desktop action: {kind}")

    async def control(self, arguments: dict[str, Any]) -> dict[str, Any]:
        actions = arguments.get("actions")
        if not isinstance(actions, list):
            raise TypeError("actions must be an array.")
        await asyncio.to_thread(self._perform_sync, actions)
        result = await self.capture()
        result["actions_completed"] = len(actions)
        return result
