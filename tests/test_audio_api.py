from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from utils.gateway.api import create_app
from utils.gateway.settings import GatewaySettings
from utils.tools.openai_speech import OpenAI_STT, OpenAI_TTS


class FakeSTT:
    def __init__(self) -> None:
        self.received = b""
        self.prepared = False

    def prepare(self):
        self.prepared = True
        return {"ready": True, "model": "fake"}

    def transcribe(self, path: Path):
        self.received = path.read_bytes()
        return {
            "transcript": "hello from the microphone",
            "language_code": "en",
        }


class FakeTTS:
    def __init__(self) -> None:
        self.received = ""

    def synthesize(self, text: str) -> bytes:
        self.received = text
        return b"fake-mp3"


class AudioApiTests(TestCase):
    def setUp(self) -> None:
        self.stt = FakeSTT()
        self.tts = FakeTTS()
        self.client = TestClient(
            create_app(
                GatewaySettings(),
                stt_tool=self.stt,
                tts_tool=self.tts,
            )
        )

    def test_openai_compatible_transcription_endpoint(self) -> None:
        response = self.client.post(
            "/v1/audio/transcriptions",
            files={"file": ("recording.webm", b"microphone-audio", "audio/webm")},
            data={"model": "whisper-1"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"text": "hello from the microphone", "language": "en"},
        )
        self.assertEqual(self.stt.received, b"microphone-audio")

    def test_transcription_model_can_be_prepared_before_recording(self) -> None:
        response = self.client.post("/v1/audio/transcriptions/prepare")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ready": True, "model": "fake"})
        self.assertTrue(self.stt.prepared)

    def test_openai_compatible_speech_endpoint(self) -> None:
        response = self.client.post(
            "/v1/audio/speech",
            json={
                "model": "tts-1",
                "voice": "alloy",
                "input": "Speak this response",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.tts.received, "Speak this response")
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.content, b"fake-mp3")

    def test_transcription_rejects_empty_audio(self) -> None:
        response = self.client.post(
            "/v1/audio/transcriptions",
            files={"file": ("recording.webm", b"", "audio/webm")},
            data={"model": "whisper-1"},
        )

        self.assertEqual(response.status_code, 400)

    def test_speech_rejects_empty_input(self) -> None:
        response = self.client.post(
            "/v1/audio/speech",
            json={"input": "  "},
        )

        self.assertEqual(response.status_code, 400)

    def test_speech_accepts_voice_parameter(self) -> None:
        response = self.client.post(
            "/v1/audio/speech",
            json={"input": "Hello", "voice": "nova"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.tts.received, "Hello")
