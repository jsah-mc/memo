"""Direct provider SDK gateway package.

Keep the application factory lazy: low-level modules such as serialization are
imported by the shared model SDK, and importing the FastAPI surface here would
otherwise cycle back into that SDK during process startup.
"""

from typing import Any

from .settings import GatewaySettings

__all__ = ["GatewaySettings", "create_app"]


def __getattr__(name: str) -> Any:
    if name == "create_app":
        from .api import create_app

        return create_app
    raise AttributeError(name)
