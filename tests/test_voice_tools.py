import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace

from utils.tools.stt import STT, is_whisper_hallucination
from utils.tools.tts import TTS


class FakeRecorder:
    def __init__(self, text: str = "  hello in real time  ") -> None:
        self.result = text
        self.aborted = False
        self.was_shutdown = False

    def text(self) -> str:
        return self.result

    def abort(self) -> None:
        self.aborted = True

    def shutdown(self) -> None:
        self.was_shutdown = True


class FakeWhisperModel:
    def __init__(self, text: str = "  hello from audio  ") -> None:
        self.text = text
        self.calls = []

    def transcribe(self, audio: str, **kwargs):
        self.calls.append((audio, kwargs))
        return (
            iter([SimpleNamespace(text=self.text)]),
            SimpleNamespace(language="en", language_probability=0.99),
        )


class FakeTextToAudioStream:
    def __init__(self) -> None:
        self.fed = []
        self.plays = []
        self.was_stopped = False

    def feed(self, text: str):
        self.fed.append(text)
        return self

    def play(self, **kwargs) -> None:
        self.plays.append(kwargs)
        output = kwargs.get("output_wavfile")
        if output:
            Path(output).write_bytes(b"RIFFfake-wave")

    def stop(self) -> None:
        self.was_stopped = True


class VoiceToolTests(unittest.TestCase):
    def test_filters_common_whisper_silence_hallucinations(self):
        self.assertTrue(is_whisper_hallucination("Thank you. Thank you."))
        self.assertTrue(is_whisper_hallucination("Thanks for watching."))
        self.assertFalse(is_whisper_hallucination("Please open my calendar."))

    def test_stt_listens_with_realtimestt_recorder(self):
        recorder = FakeRecorder()
        stt = STT(recorder=recorder)

        result = stt.listen()
        stt.abort()
        stt.shutdown()

        self.assertEqual(result["transcript"], "hello in real time")
        self.assertEqual(result["provider"], "realtimestt")
        self.assertEqual(result["model"], "small.en")
        self.assertTrue(recorder.aborted)
        self.assertTrue(recorder.was_shutdown)

    def test_stt_transcribes_audio_with_faster_whisper(self):
        model = FakeWhisperModel()
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory, "input.wav")
            with wave.open(str(audio_path), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16_000)
                audio.writeframes(b"\0\0" * 100)

            result = STT(whisper_model=model).transcribe(audio_path)

        self.assertEqual(result["transcript"], "hello from audio")
        self.assertEqual(result["provider"], "realtimestt")
        self.assertEqual(result["language_code"], "en")
        self.assertEqual(result["language_probability"], 0.99)
        self.assertEqual(Path(model.calls[0][0]).name, "input.wav")
        self.assertTrue(model.calls[0][1]["vad_filter"])

    def test_stt_filters_hallucinated_file_transcript(self):
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory, "silence.wav")
            audio_path.write_bytes(b"not-empty")
            result = STT(
                whisper_model=FakeWhisperModel("Thanks for watching.")
            ).transcribe(audio_path)

        self.assertEqual(result["transcript"], "")
        self.assertTrue(result["filtered"])

    def test_tts_uses_realtimetts_streaming_playback(self):
        stream = FakeTextToAudioStream()
        tts = TTS(
            engine=object(),
            stream_factory=lambda _engine: stream,
        )

        tts.speak("Hello")

        self.assertEqual(stream.fed, ["Hello"])
        self.assertEqual(len(stream.plays), 1)
        self.assertTrue(stream.plays[0]["fast_sentence_fragment"])

    def test_tts_generates_wav_bytes(self):
        stream = FakeTextToAudioStream()
        tts = TTS(
            engine=object(),
            stream_factory=lambda _engine: stream,
        )

        self.assertEqual(tts.synthesize_bytes("Hello"), b"RIFFfake-wave")
        self.assertTrue(stream.plays[0]["muted"])

    def test_tts_stop_interrupts_stream(self):
        stream = FakeTextToAudioStream()
        tts = TTS(
            engine=object(),
            stream_factory=lambda _engine: stream,
        )
        tts.speak("Hello")

        tts.stop()

        self.assertTrue(stream.was_stopped)

    def test_tts_rejects_empty_text(self):
        tts = TTS(engine=object(), stream_factory=FakeTextToAudioStream)
        with self.assertRaisesRegex(ValueError, "cannot be empty"):
            tts.synthesize_bytes("   ")


if __name__ == "__main__":
    unittest.main()
