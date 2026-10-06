"""Transport-independent AI orchestration for Memo clients."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from typing import Any

from utils.tools.browser import BrowserUseTool
from utils.tools.computer import (
    ComputerSandboxTool,
    detect_app_request,
    detect_computer_task,
    generic_app_request_name,
    known_folder_request,
)
from utils.tools.computer_turn import (
    computer_request_text,
    computer_tool_events,
    direct_app_events,
    direct_named_app_events,
    has_one_time_computer_approval,
)
from utils.tools.desktop import detect_desktop_control_request
from utils.tools.moonkart import MoonKartTool
from utils.tools.permissions import PermissionBroker

from .browser import detect_browser_task, run_browser_tool_turn
from .moonkart import detect_moonkart_action, run_moonkart_tool_turn
from .prompt import load_system_prompt
from .router import ModelRouter
from .sdk import ModelSDK, SDKResponseStream
from .settings import ProgramSettings

SDKFactory = Callable[..., ModelSDK]


class ProgramAI:
    """Own model routing, tools, streaming, and history without an HTTP server."""

    def __init__(
        self,
        settings: ProgramSettings | None = None,
        *,
        browser_tool: BrowserUseTool | None = None,
        moonkart_tool: MoonKartTool | None = None,
        computer_tool: ComputerSandboxTool | None = None,
        permission_broker: PermissionBroker | None = None,
        sdk_factory: SDKFactory = ModelSDK,
        system_prompt: str | None = None,
    ) -> None:
        self.settings = settings or ProgramSettings.from_environment()
        self.browser_tool = browser_tool or BrowserUseTool()
        self.moonkart_tool = moonkart_tool or MoonKartTool()
        self.computer_tool = computer_tool
        self.permission_broker = permission_broker or PermissionBroker()
        self.sdk_factory = sdk_factory
        self.system_prompt = (
            system_prompt.strip() if system_prompt is not None else load_system_prompt()
        )
        if not self.system_prompt:
            raise ValueError("The system prompt cannot be empty.")
        self.router = ModelRouter(
            light_model=self.settings.light_model,
            heavy_model=self.settings.heavy_model,
            vision_model=self.settings.vision_model,
        )
        self.history: list[dict[str, Any]] = []

    def _sdk(self, model: str) -> ModelSDK:
        return self.sdk_factory(
            model,
            api_base=self.settings.upstream_api_base,
        )

    async def _dispatch(
        self,
        sdk: ModelSDK,
        payload: dict[str, Any],
    ) -> SDKResponseStream:
        action = (
            detect_moonkart_action(payload.get("input"))
            if self.settings.moonkart_enabled
            else None
        )
        if action is not None:
            return await run_moonkart_tool_turn(
                sdk,
                payload,
                action,
                self.moonkart_tool,
            )

        browser_task = (
            detect_browser_task(payload.get("input"))
            if self.settings.browser_enabled
            else None
        )
        if browser_task is not None:
            return run_browser_tool_turn(browser_task, self.browser_tool)
        computer_text = computer_request_text(payload.get("input"))
        folder = known_folder_request(computer_text)
        if (
            self.settings.computer_enabled
            and folder is not None
            and not detect_desktop_control_request(computer_text)
        ):
            return SDKResponseStream(
                direct_named_app_events(
                    self.computer_tool or ComputerSandboxTool(),
                    user_text=computer_text,
                    permission_broker=self.permission_broker,
                    approved=has_one_time_computer_approval(payload.get("input")),
                )
            )
        app = detect_app_request(computer_text)
        if (
            self.settings.computer_enabled
            and app is not None
            and not detect_desktop_control_request(computer_text)
        ):
            return SDKResponseStream(
                direct_app_events(
                    self.computer_tool or ComputerSandboxTool(),
                    app=app,
                    user_text=computer_text,
                )
            )
        if (
            self.settings.computer_enabled
            and generic_app_request_name(computer_text) is not None
            and not detect_desktop_control_request(computer_text)
        ):
            return SDKResponseStream(
                direct_named_app_events(
                    self.computer_tool or ComputerSandboxTool(),
                    user_text=computer_text,
                    permission_broker=self.permission_broker,
                    approved=has_one_time_computer_approval(payload.get("input")),
                )
            )
        if self.settings.computer_enabled and detect_computer_task(computer_text):
            return SDKResponseStream(
                computer_tool_events(
                    sdk,
                    payload,
                    self.computer_tool or ComputerSandboxTool(),
                    self.permission_broker,
                )
            )
        return await sdk.responses(payload)

    async def _start_response(
        self,
        payload: dict[str, Any],
    ) -> SDKResponseStream:
        route = self.router.route(payload)
        try:
            return await self._dispatch(self._sdk(route.model), payload)
        except Exception:
            fallback = route.fallback_model
            if not fallback or fallback == route.model:
                raise
            logging.getLogger("memo.program.router").warning(
                "Model route %s failed for %s; falling back to %s",
                route.kind,
                route.model,
                fallback,
            )
            return await self._dispatch(self._sdk(fallback), payload)

    async def events(self, prompt: str) -> AsyncIterator[dict[str, Any]]:
        """Yield model and tool events for one user message."""

        prompt = prompt.strip()
        if not prompt:
            return

        user_message = {
            "role": "user",
            "content": [{"type": "input_text", "text": prompt}],
        }
        stream = await self._start_response(
            {
                "instructions": self.system_prompt,
                "input": [*self.history, user_message],
            }
        )
        response_text: list[str] = []
        completed = False

        async for event in stream.events():
            if event.get("type") == "response.output_text.delta":
                delta = event.get("delta")
                if isinstance(delta, str):
                    response_text.append(delta)
            elif event.get("type") == "response.completed":
                completed = True
            yield event

        if not completed:
            raise RuntimeError("The model stream ended before completing.")

        self.history.extend(
            [
                user_message,
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "".join(response_text),
                        }
                    ],
                },
            ]
        )

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        """Compatibility helper that yields only assistant text."""

        async for event in self.events(prompt):
            if event.get("type") != "response.output_text.delta":
                continue
            delta = event.get("delta")
            if isinstance(delta, str) and delta:
                yield delta

    def clear_history(self) -> None:
        self.history.clear()

    def resolve_permission(self, permission_id: str, allowed: bool) -> bool:
        return self.permission_broker.resolve(permission_id, allowed)

    async def close(self) -> None:
        self.permission_broker.cancel_all()
        await self.moonkart_tool.close()
