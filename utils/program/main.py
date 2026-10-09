from __future__ import annotations

import asyncio
import os
import time
from typing import ClassVar

from textual import work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.widgets import Button, Input, Static

from utils.tools.ai import ProgramAI

from .permission_screen import ShellPermissionScreen
from .voice import VoiceModeIO
from .voice_mode import VoiceModeMixin


class MemoApp(VoiceModeMixin, App):
    TITLE = "Memo"
    BINDINGS: ClassVar[list[tuple[str, str, str]]] = [
        ("ctrl+d", "toggle_dark", "Toggle dark mode"),
        ("ctrl+n", "new_chat", "New chat"),
    ]
    CSS_PATH: ClassVar[list[str]] = [
        "./styles/messagerow.tcss",
        "./styles/messages.tcss",
    ]
    SPINNER: ClassVar[tuple[str, ...]] = (
        "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"
    )

    def __init__(
        self,
        ai: ProgramAI | None = None,
        voice: VoiceModeIO | None = None,
    ) -> None:
        super().__init__()
        self._preload_voice = ai is None and voice is None
        self.ai = ai or ProgramAI()
        self.voice = voice or VoiceModeIO()
        self._voice_mode_active = False
        self._voice_worker = None
        self._activity = "idle"
        self._activity_detail = "Ready · ^N new · ^D theme · /quit"
        self._spinner_index = 0
        self._active_desktop_calls: set[str] = set()

    def compose(self) -> ComposeResult:
        self.theme = "catppuccin-mocha"
        with VerticalScroll(id="messages"):
            yield Static(
                "Memo\nAsk a question or describe a task to get started.",
                id="empty-state",
                markup=False,
            )
        with Vertical(id="composer"):
            yield Static(
                "Ready · ^N new · ^D theme · /quit",
                id="status",
                markup=False,
            )
            with Horizontal(classes="messagerow"):
                yield Input(placeholder="Message Memo", id="messageinput")
                yield Button("Voice", id="voicebutton")
                yield Button("Send", id="sendbutton", variant="primary")

    def on_mount(self) -> None:
        self.query_one("#messageinput", Input).focus()
        self.set_interval(0.08, self._advance_spinner)
        self._render_activity()
        if (
            self._preload_voice
            and os.environ.get("MEMO_SPEECH_PRELOAD", "0") == "1"
        ):
            self.run_voice_warmup()

    @work(thread=False, exclusive=True, group="voice-warmup")
    async def run_voice_warmup(self) -> None:
        """Load local voice models without blocking the Textual UI."""

        try:
            await self.voice.prepare()
        except (OSError, RuntimeError):
            return

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        await self._submit_input(event.input)

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "sendbutton":
            await self._submit_input(self.query_one("#messageinput", Input))
        elif event.button.id == "voicebutton":
            if self._voice_mode_active:
                self._stop_voice_mode()
            else:
                self._start_voice_mode()

    async def _submit_input(self, input_widget: Input) -> None:
        if input_widget.disabled:
            return
        prompt = input_widget.value.strip()
        if not prompt:
            return
        if prompt == "/quit":
            self.exit()
            return

        input_widget.value = ""
        self._set_composer_busy(True, "Thinking…")
        response = await self._mount_turn(prompt)
        self.send_message(prompt, response)

    async def _mount_turn(self, prompt: str) -> Static:
        messages = self.query_one("#messages", VerticalScroll)
        empty_state = messages.query("#empty-state").first()
        if empty_state is not None:
            await empty_state.remove()
        await messages.mount(
            Static(
                f"You\n{prompt}",
                classes="chat-message user-message",
                markup=False,
            )
        )
        response = Static(
            "Memo\n",
            classes="chat-message assistant-message",
            markup=False,
        )
        await messages.mount(response)
        messages.scroll_end(animate=False)
        return response

    @work(exclusive=True)
    async def send_message(self, prompt: str, response: Static) -> None:
        input_widget = self.query_one("#messageinput", Input)
        messages = self.query_one("#messages", VerticalScroll)
        try:
            await self._stream_ai_response(prompt, response)
        finally:
            if not self._voice_mode_active:
                self._set_composer_busy(False, "Ready")
                input_widget.focus()
            messages.scroll_end(animate=False)

    def _advance_spinner(self) -> None:
        if self._activity != "loading":
            return
        self._spinner_index = (self._spinner_index + 1) % len(self.SPINNER)
        self._render_activity()

    def _render_activity(self) -> None:
        face = {
            "idle": ":P",
            "done": ":)",
            "error": ":(",
        }.get(self._activity, self.SPINNER[self._spinner_index])
        self.query_one("#status", Static).update(
            f"{face}  {self._activity_detail}"
        )

    def _set_activity(self, activity: str, detail: str) -> None:
        self._activity = activity
        self._activity_detail = detail
        self._render_activity()

    def _set_desktop_control(self, call_id: str, active: bool) -> None:
        if active:
            self._active_desktop_calls.add(call_id)
        else:
            self._active_desktop_calls.discard(call_id)
        controlling = bool(self._active_desktop_calls)
        self.screen.set_class(controlling, "desktop-control-active")
        if controlling:
            self._set_activity("loading", "Agent controlling this desktop")

    async def _stream_ai_response(self, prompt: str, response: Static) -> str:
        messages = self.query_one("#messages", VerticalScroll)
        output: list[str] = []
        tool_widgets: dict[str, Static] = {}
        last_render = 0.0

        def render_response(*, force: bool = False) -> None:
            nonlocal last_render
            now = time.monotonic()
            if not force and now - last_render < 0.05:
                return
            response.update(f"Memo\n{''.join(output)}")
            messages.scroll_end(animate=False)
            last_render = now

        try:
            async for event in self.ai.events(prompt):
                event_type = event.get("type")
                if event_type == "response.output_text.delta":
                    delta = event.get("delta")
                    if isinstance(delta, str):
                        output.append(delta)
                        render_response()
                        self._set_activity("loading", "Writing…")
                elif event_type == "memo.tool_call.started":
                    call = event.get("tool_call", {})
                    call_id = str(call.get("id", "tool"))
                    name = str(call.get("name", "tool"))
                    widget = Static(
                        f"Tool\n{name} is running…",
                        classes="chat-message tool-message",
                        markup=False,
                    )
                    self._set_activity("loading", f"Running {name}…")
                    tool_widgets[call_id] = widget
                    await messages.mount(widget, before=response)
                    messages.scroll_end(animate=False)
                elif event_type == "memo.tool_call.completed":
                    call = event.get("tool_call", {})
                    call_id = str(call.get("id", "tool"))
                    name = str(call.get("name", "tool"))
                    failed = bool(call.get("is_error"))
                    status = "failed" if failed else "completed"
                    widget = tool_widgets.get(call_id)
                    if widget is not None:
                        widget.update(f"Tool\n{name} {status}")
                    if name == "control_computer":
                        self._set_desktop_control(call_id, False)
                    self._set_activity("loading", "Thinking…")
                    messages.scroll_end(animate=False)
                elif event_type == "memo.permission.requested":
                    permission = event.get("permission", {})
                    permission_id = str(permission.get("id", ""))
                    command = str(permission.get("command", ""))
                    cwd = str(permission.get("cwd", ""))
                    kind = str(permission.get("kind", "shell_command"))
                    call_id = str(permission.get("tool_call_id", ""))
                    widget = tool_widgets.get(call_id)
                    tool_name = (
                        "control_computer"
                        if kind == "computer_control"
                        else "run_shell_command"
                    )
                    if widget is not None:
                        widget.update(f"Tool\n{tool_name} needs permission")
                    allowed = await self.push_screen_wait(
                        ShellPermissionScreen(command, cwd, kind)
                    )
                    self.ai.resolve_permission(permission_id, allowed)
                    if kind == "computer_control" and allowed:
                        self._set_desktop_control(call_id, True)
                    if widget is not None:
                        state = "approved" if allowed else "denied"
                        widget.update(f"Tool\n{tool_name} permission {state}")
                elif event_type == "response.completed":
                    self._set_activity("loading", "Finishing…")
        except Exception as exc:  # noqa: BLE001
            for call_id in tuple(self._active_desktop_calls):
                self._set_desktop_control(call_id, False)
            self._set_activity("error", "Error")
            response.update(f"Memo\nError: {exc}")
            return ""
        render_response(force=True)
        for call_id in tuple(self._active_desktop_calls):
            self._set_desktop_control(call_id, False)
        self._set_activity("done", "Done")
        return "".join(output).strip()

    def action_toggle_dark(self) -> None:
        self.theme = (
            "catppuccin-mocha"
            if self.theme == "catppuccin-latte"
            else "catppuccin-latte"
        )

    async def action_new_chat(self) -> None:
        if self._voice_mode_active:
            self._stop_voice_mode()
        self.workers.cancel_all()
        self.ai.clear_history()
        for call_id in tuple(self._active_desktop_calls):
            self._set_desktop_control(call_id, False)
        await self.query_one("#messages", VerticalScroll).remove_children()
        await self.query_one("#messages", VerticalScroll).mount(
            Static(
                "Memo\nAsk a question or describe a task to get started.",
                id="empty-state",
                markup=False,
            )
        )
        input_widget = self.query_one("#messageinput", Input)
        self._set_activity("idle", "Ready · ^N new · ^D theme · /quit")
        self._set_composer_busy(False, "Ready")
        input_widget.focus()

    def _set_composer_busy(
        self,
        busy: bool,
        status: str,
        *,
        keep_voice_enabled: bool = False,
    ) -> None:
        self.query_one("#messageinput", Input).disabled = busy
        self.query_one("#sendbutton", Button).disabled = busy
        self.query_one("#voicebutton", Button).disabled = busy and not keep_voice_enabled
        if busy:
            self._set_activity("loading", status)
        elif self._activity not in {"done", "error"}:
            self._set_activity("idle", status)

    async def on_unmount(self) -> None:
        for call_id in tuple(self._active_desktop_calls):
            self._set_desktop_control(call_id, False)
        if self._voice_mode_active:
            self._stop_voice_mode()
        voice_close = asyncio.create_task(self.voice.close())
        ai_close = asyncio.create_task(self.ai.close())
        done, pending = await asyncio.wait(
            {voice_close, ai_close},
            timeout=1.0,
        )
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            if not task.cancelled():
                task.exception()
