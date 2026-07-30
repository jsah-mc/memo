"""Optional hardware tools used by Memo clients."""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .browser import BrowserUseTool
    from .moonkart import MoonKartClient, MoonKartNotFoundError, MoonKartTool
    from .stt import STT
    from .tts import TTS

__all__ = [
    "STT",
    "TTS",
    "BrowserUseTool",
    "MoonKartClient",
    "MoonKartNotFoundError",
    "MoonKartTool",
]


def __getattr__(name: str) -> Any:
    if name == "BrowserUseTool":
        from .browser import BrowserUseTool

        return BrowserUseTool
    if name == "STT":
        from .stt import STT

        return STT
    if name == "TTS":
        from .tts import TTS

        return TTS
    if name in {"MoonKartClient", "MoonKartNotFoundError", "MoonKartTool"}:
        from .moonkart import MoonKartClient, MoonKartNotFoundError, MoonKartTool

        return {
            "MoonKartClient": MoonKartClient,
            "MoonKartNotFoundError": MoonKartNotFoundError,
            "MoonKartTool": MoonKartTool,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
