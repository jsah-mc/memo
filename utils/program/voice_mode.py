from __future__ import annotations

from textual import work
from textual.containers import VerticalScroll
from textual.css.query import NoMatches
from textual.widgets import Button, Input, Static


class VoiceModeMixin:
    def _start_voice_mode(self) -> None:
        input_widget = self.query_one("#messageinput", Input)
        if input_widget.disabled:
            return
        self._voice_mode_active = True
        self._set_composer_busy(True, "Listening…", keep_voice_enabled=True)
        input_widget.placeholder = "Listening…"
        self.query_one("#voicebutton", Button).label = "Stop"
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
            self.query_one("#voicebutton", Button).label = "Voice"
            self._set_composer_busy(False, "Ready")
        except NoMatches:
            return

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
                    "Interrupted — listening…" if interrupted else "Listening…"
                )
        except Exception as exc:  # noqa: BLE001
            messages = self.query_one("#messages", VerticalScroll)
            await messages.mount(
                Static(
                    f"Voice mode\nError: {exc}",
                    classes="chat-message tool-message",
                    markup=False,
                )
            )
            messages.scroll_end(animate=False)
        finally:
            self._voice_mode_active = False
            self._voice_worker = None
            self.voice.cancel()
            await self.voice.release_recorder()
            self._reset_voice_controls()
