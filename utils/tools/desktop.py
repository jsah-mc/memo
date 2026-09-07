"""Shared desktop tool interface backed by CUA Driver."""

from .cua_desktop import CuaDesktopController as DesktopController
from .desktop_schema import detect_desktop_control_request

__all__ = ["DesktopController", "detect_desktop_control_request"]
