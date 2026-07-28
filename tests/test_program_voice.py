from __future__ import annotations

import threading
import unittest

from utils.program.voice import VoiceModeIO


class FakeTTS:
    def __init__(self) -> None:
        self.stopped = threading.Event()
        self.play_started = threading.Event()
        self.was_shutdown = False

    def speak(self, _text: str) -> None:
        self.play_started.set()
        self.stopped.wait(2)

    def stop(self) -> None:
        self.stopped.set()

    def shutdown(self, *, fast: bool = False) -> None:
        self.fast_shutdown = fast
        self.was_shutdown = True


class FakeSTT:
    def __init__(self) -> None:
        self.listened = False
        self.aborted = False
        self.was_shutdown = False

    def listen(self):
        self.listened = True
        return {"transcript": "  hello in real time  "}

    def abort(self) -> None:
        self.aborted = True

    def shutdown(self) -> None:
        self.was_shutdown = True


class ImmediateInterruptMonitor:
    def __init__(self) -> None:
        self.was_stopped = False

    def start(self, on_speech) -> None:
        on_speech()

    def stop(self) -> None:
        self.was_stopped = True


class VoiceModeTests(unittest.IsolatedAsyncioTestCase):
    async def test_listen_uses_persistent_realtimestt_recorder(self) -> None:
        stt = FakeSTT()
        voice = VoiceModeIO(stt=stt)  # type: ignore[arg-type]

        transcript = await voice.listen()

        self.assertEqual(transcript, "hello in real time")
        self.assertTrue(stt.listened)

    async def test_user_speech_interrupts_tts_playback(self) -> None:
        tts = FakeTTS()
        monitor = ImmediateInterruptMonitor()
        voice = VoiceModeIO(
            stt=FakeSTT(),  # type: ignore[arg-type]
            tts=tts,  # type: ignore[arg-type]
            monitor_factory=lambda: monitor,  # type: ignore[arg-type]
        )

        interrupted = await voice.speak("answer")

        self.assertTrue(interrupted)
        self.assertTrue(tts.stopped.is_set())
        self.assertTrue(monitor.was_stopped)

    async def test_close_shuts_down_both_local_engines(self) -> None:
        stt = FakeSTT()
        tts = FakeTTS()
        voice = VoiceModeIO(
            stt=stt,  # type: ignore[arg-type]
            tts=tts,  # type: ignore[arg-type]
        )

        await voice.close()

        self.assertTrue(stt.aborted)
        self.assertTrue(stt.was_shutdown)
        self.assertTrue(tts.was_shutdown)
        self.assertTrue(tts.fast_shutdown)


if __name__ == "__main__":
    unittest.main()
