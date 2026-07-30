"""Continuous voice-mode audio orchestration for the Textual program."""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Callable
from typing import Any

from utils.tools.stt import STT
from utils.tools.tts import TTS


class SpeechInterruptMonitor:
    """Detect sustained microphone speech while synthesized audio is playing."""

    def __init__(
        self,
        *,
        sample_rate: int = 16_000,
        minimum_rms: int | None = None,
        calibration_seconds: float = 0.45,
        confirmation_seconds: float = 0.18,
        noise_multiplier: float = 1.8,
    ) -> None:
        self.sample_rate = sample_rate
        self.minimum_rms = minimum_rms or int(
            os.environ.get("MEMO_BARGE_IN_RMS", "650")
        )
        self.calibration_seconds = calibration_seconds
        self.confirmation_seconds = confirmation_seconds
        self.noise_multiplier = noise_multiplier
        self._stream: Any = None

    def start(self, on_speech: Callable[[], None]) -> None:
        import numpy as np
        import sounddevice as sd

        started_at = time.monotonic()
        baseline_samples: list[int] = []
        speech_started_at = 0.0
        fired = False

        def callback(indata, _frames, _time_info, _status) -> None:
            nonlocal speech_started_at, fired
            if fired:
                return
            rms = int(np.sqrt(np.mean(indata.astype(np.float64) ** 2)))
            now = time.monotonic()
            elapsed = now - started_at
            if elapsed <= self.calibration_seconds:
                baseline_samples.append(rms)
                return

            baseline = (
                sorted(baseline_samples)[len(baseline_samples) // 2]
                if baseline_samples
                else 0
            )
            threshold = max(
                self.minimum_rms,
                int(baseline * self.noise_multiplier),
            )
            if rms >= threshold:
                if speech_started_at == 0.0:
                    speech_started_at = now
                elif now - speech_started_at >= self.confirmation_seconds:
                    fired = True
                    on_speech()
            else:
                speech_started_at = 0.0

        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
            callback=callback,
        )
        self._stream.start()

    def stop(self) -> None:
        stream = self._stream
        self._stream = None
        if stream is not None:
            try:
                stream.stop()
            finally:
                stream.close()


class VoiceModeIO:
    """Listen, transcribe, speak, and support user barge-in."""

    def __init__(
        self,
        *,
        stt: STT | None = None,
        tts: TTS | None = None,
        monitor_factory: Callable[[], SpeechInterruptMonitor] = (
            SpeechInterruptMonitor
        ),
    ) -> None:
        self.stt = stt or STT()
        self.tts = tts or TTS()
        self.monitor_factory = monitor_factory
        self._monitor: SpeechInterruptMonitor | None = None
        self._cancelled = False

    async def prepare(self) -> None:
        """Warm realtime STT and TTS without a simultaneous memory spike."""

        prepare_stt = getattr(self.stt, "prepare_realtime", None)
        if not callable(prepare_stt):
            prepare_stt = getattr(self.stt, "prepare", None)
        prepare_tts = getattr(self.tts, "prepare", None)
        for prepare in (prepare_stt, prepare_tts):
            if callable(prepare):
                await asyncio.to_thread(prepare)

    async def listen(self) -> str:
        """Use RealtimeSTT to capture one utterance and return its transcript."""

        self._cancelled = False
        result = await asyncio.to_thread(self.stt.listen)
        if self._cancelled:
            return ""
        transcript = result.get("transcript")
        return transcript.strip() if isinstance(transcript, str) else ""

    async def speak(self, text: str) -> bool:
        """Speak text; return True when live user speech interrupts playback."""

        self._cancelled = False
        loop = asyncio.get_running_loop()
        interrupted = asyncio.Event()
        monitor = self.monitor_factory()
        self._monitor = monitor
        monitor.start(lambda: loop.call_soon_threadsafe(interrupted.set))
        playback = asyncio.create_task(asyncio.to_thread(self.tts.speak, text))
        interrupt_wait = asyncio.create_task(interrupted.wait())
        try:
            done, _ = await asyncio.wait(
                {playback, interrupt_wait},
                return_when=asyncio.FIRST_COMPLETED,
            )
            was_interrupted = interrupt_wait in done and interrupted.is_set()
            if was_interrupted:
                await asyncio.to_thread(self.tts.stop)
            await playback
            return was_interrupted
        finally:
            monitor.stop()
            self._monitor = None
            if not interrupt_wait.done():
                interrupt_wait.cancel()

    def cancel(self) -> None:
        """Interrupt recording and playback from a synchronous UI callback."""

        self._cancelled = True
        self.stt.abort()
        monitor = self._monitor
        if monitor is not None:
            monitor.stop()
            self._monitor = None
        request_stop = getattr(self.tts, "request_stop", self.tts.stop)
        request_stop()

    async def release_recorder(self) -> None:
        """Release local speech models when voice mode is inactive."""

        await asyncio.gather(
            asyncio.to_thread(self.stt.shutdown),
            asyncio.to_thread(self.tts.shutdown),
        )

    async def close(self) -> None:
        self.cancel()
        await asyncio.gather(
            asyncio.to_thread(self.stt.shutdown),
            asyncio.to_thread(self.tts.shutdown, fast=True),
        )
