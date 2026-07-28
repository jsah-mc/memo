from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from utils.gateway.api import create_app
from utils.gateway.settings import GatewaySettings


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

    def stream(self, text: str):
        self.received = text
        return iter([b"fake-", b"mp3"])


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

    def test_accepts_legacy_desktop_stt_model_alias(self) -> None:
        response = self.client.post(
            "/v1/audio/transcriptions",
            files={"file": ("recording.webm", b"legacy-audio", "audio/webm")},
            data={"model": "ink-whisper"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.stt.received, b"legacy-audio")

    def test_accepts_local_stt_model_alias(self) -> None:
        response = self.client.post(
            "/v1/audio/transcriptions",
            files={"file": ("recording.wav", b"local-audio", "audio/wav")},
            data={"model": "faster-whisper"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.stt.received, b"local-audio")

    def test_openai_compatible_speech_endpoint(self) -> None:
        response = self.client.post(
            "/v1/audio/speech",
            json={
                "model": "tts-1",
                "voice": "memo",
                "input": "Speak this response",
                "response_format": "mp3",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.content, b"fake-mp3")
        self.assertEqual(self.tts.received, "Speak this response")

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
            json={"input": "  ", "response_format": "mp3"},
        )

        self.assertEqual(response.status_code, 400)

    def test_pocket_tts_requires_wav_response_format(self) -> None:
        self.tts.response_format = "wav"
        response = self.client.post(
            "/v1/audio/speech",
            json={"input": "Hello", "response_format": "mp3"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("response_format=wav", response.json()["detail"])

    def test_pocket_tts_defaults_to_its_native_wav_format(self) -> None:
        self.tts.response_format = "wav"
        response = self.client.post(
            "/v1/audio/speech",
            json={"input": "Hello"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/wav")
