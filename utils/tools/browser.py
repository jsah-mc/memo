"""direct provider tool adapter for the isolated Browser Use agent."""

from __future__ import annotations

import asyncio
import copy
import os

from utils.browser.main import DEFAULT_BASE_URL, DEFAULT_MODEL, execute_browser_task

_BROWSER_LITELLM_DEFINITION = {
    "type": "function",
    "function": {
        "name": "browse_web",
        "description": (
            "Use a real web browser to visit sites, navigate pages, click, type, "
            "and collect information needed to complete the user's browser task."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The complete browser task to perform.",
                }
            },
            "required": ["task"],
        },
        "strict": True,
    },
}


class BrowserUseTool:
    """Execute Browser Use directly from Memo's main Python environment."""

    name = "browse_web"

    def __init__(self, timeout_seconds: float | None = None) -> None:
        self.timeout_seconds = timeout_seconds or float(
            os.environ.get("MEMO_BROWSER_TIMEOUT", "600")
        )
        self._lock = asyncio.Lock()

    @property
    def function_definition(self) -> dict:
        return copy.deepcopy(_BROWSER_LITELLM_DEFINITION)

    async def execute(self, arguments: dict) -> dict[str, object]:
        task = arguments.get("task")
        if not isinstance(task, str) or not task.strip():
            raise ValueError("Browser tool arguments require a non-empty `task`.")
        if len(task) > 20_000:
            raise ValueError("Browser task is too long.")

        async with self._lock:
            try:
                return await asyncio.wait_for(
                    execute_browser_task(
                        task.strip(),
                        base_url=DEFAULT_BASE_URL,
                        model=os.environ.get("MEMO_MODEL", DEFAULT_MODEL),
                    ),
                    timeout=self.timeout_seconds,
                )
            except TimeoutError:
                raise RuntimeError("Browser Use timed out.") from None
