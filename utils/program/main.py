from __future__ import annotations

import asyncio
import time

from textual import work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, VerticalScroll
from textual.widgets import Button, Input, Static

from .ai import ProgramAI
from .voice import VoiceModeIO


class MemoApp(App):
    BINDINGS = [
        ("ctrl+d", "toggle_dark", "Toggle dark mode"),
        ("ctrl+n", "new_chat", "New chat"),
    ]
    CSS_PATH = ["./styles/messagerow.tcss", "./styles/messages.tcss"]

    def __init__(
        self,
        ai: ProgramAI | None = None,
        voice: VoiceModeIO | None = None,
    ) -> None:
        super().__init__()
        self.ai = ai or ProgramAI()
        self.voice = voice or VoiceModeIO()
        self._voice_mode_active = False
        self._voice_worker = None

    def compose(self) -> ComposeResult:
        self.theme = "catppuccin-mocha"
        yield VerticalScroll(id="messages")
        with Horizontal(classes="messagerow"):
            yield Input(
                placeholder="Message Memo",
                id="messageinput",
            )
            yield Button("🎤", id="voicebutton")
            yield Button("➤", id="sendbutton")

    def on_mount(self) -> None:
        self.query_one("#messageinput", Input).focus()

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
        input_widget.disabled = True
        response = await self._mount_turn(prompt)
        self.send_message(prompt, response)

    async def _mount_turn(self, prompt: str) -> Static:
        messages = self.query_one("#messages", VerticalScroll)
        await messages.mount(
            Static(f"You\n{prompt}", classes="chat-message user-message")
        )
        response = Static("Memo\n", classes="chat-message assistant-message")
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
                input_widget.disabled = False
                input_widget.focus()
            messages.scroll_end(animate=False)

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
                elif event_type == "memo.tool_call.started":
                    call = event.get("tool_call", {})
                    call_id = str(call.get("id", "tool"))
                    name = str(call.get("name", "tool"))
                    widget = Static(
                        f"Tool\n{name} is running…",
                        classes="chat-message tool-message",
                    )
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
                    messages.scroll_end(animate=False)
        except Exception as exc:
            response.update(f"Memo\nError: {exc}")
            return ""
        render_response(force=True)
        return "".join(output).strip()

    def _start_voice_mode(self) -> None:
        input_widget = self.query_one("#messageinput", Input)
        if input_widget.disabled:
            return
        self._voice_mode_active = True
        input_widget.disabled = True
        input_widget.placeholder = "Listening…"
        self.query_one("#voicebutton", Button).label = "■"
        self._voice_worker = self.run_voice_mode()

    def _stop_voice_mode(self) -> None:
        self._voice_mode_active = False
        self.voice.cancel()
        worker = self._voice_worker
        self._voice_worker = None
        if worker is not None:
            worker.cancel()
        self._reset_voice_controls()

    def _reset_voice_controls(self) -> None:
        try:
            input_widget = self.query_one("#messageinput", Input)
            input_widget.disabled = False
            input_widget.placeholder = "Message Memo"
            input_widget.focus()
            self.query_one("#voicebutton", Button).label = "🎤"
        except Exception:
            # The widgets may already be unmounted during application shutdown.
            pass

    @work(exclusive=True, group="voice")
    async def run_voice_mode(self) -> None:
        input_widget = self.query_one("#messageinput", Input)
        try:
            while self._voice_mode_active:
                input_widget.placeholder = "Listening…"
                transcript = await self.voice.listen()
                if not self._voice_mode_active:
                    break
                if not transcript:
                    continue

                input_widget.value = transcript
                response = await self._mount_turn(transcript)
                input_widget.value = ""
                input_widget.placeholder = "Thinking…"
                answer = await self._stream_ai_response(transcript, response)
                if not self._voice_mode_active:
                    break
                if not answer:
                    continue

                input_widget.placeholder = "Speaking…"
                interrupted = await self.voice.speak(answer)
                if not self._voice_mode_active:
                    break
                input_widget.placeholder = (
                    "Interrupted — listening…"
                    if interrupted
                    else "Listening…"
                )
        except Exception as exc:
            messages = self.query_one("#messages", VerticalScroll)
            await messages.mount(
                Static(
                    f"Voice mode\nError: {exc}",
                    classes="chat-message tool-message",
                )
            )
            messages.scroll_end(animate=False)
        finally:
            self._voice_mode_active = False
            self._voice_worker = None
            self.voice.cancel()
            await self.voice.release_recorder()
            self._reset_voice_controls()

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
        await self.query_one("#messages", VerticalScroll).remove_children()
        input_widget = self.query_one("#messageinput", Input)
        input_widget.disabled = False
        input_widget.focus()

    async def on_unmount(self) -> None:
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
