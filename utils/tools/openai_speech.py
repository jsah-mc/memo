"""OpenAI speech-to-text and text-to-speech via Vercel AI Gateway."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

import httpx

VERCEL_GATEWAY_BASE = os.environ.get(
    "VERCEL_GATEWAY_BASE", "https://gateway.ai.vercel.sh/v1"
)
VERCEL_API_KEY = os.environ.get("VERCEL_GATEWAY_API_KEY")


class OpenAI_STT:
    """Speech-to-text using OpenAI Whisper via Vercel AI Gateway."""

    def __init__(self, model: str = "whisper-1") -> None:
        self.model = model
        self.api_base = VERCEL_GATEWAY_BASE
        self.api_key = VERCEL_API_KEY

    def transcribe(self, audio_path: Path) -> dict[str, Any]:
        """Transcribe an audio file using OpenAI Whisper."""
        if not self.api_key:
            raise RuntimeError("VERCEL_GATEWAY_API_KEY is required for STT")

        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        url = f"{self.api_base}/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self.api_key}"}

        with audio_path.open("rb") as f:
            files = {"file": (audio_path.name, f, "audio/mpeg")}
            data = {"model": self.model}

            response = httpx.post(url, headers=headers, files=files, data=data, timeout=60)
            response.raise_for_status()
            result = response.json()

        return {
            "transcript": result.get("text", ""),
            "language_code": result.get("language"),
        }

    def prepare(self) -> dict[str, Any]:
        """No preparation needed for API-based STT."""
        return {"ready": True}


class OpenAI_TTS:
    """Text-to-speech using OpenAI TTS via Vercel AI Gateway."""

    DEFAULT_MODEL = "tts-1"
    DEFAULT_VOICE = "alloy"
    SUPPORTED_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]

    def __init__(
        self,
        *,
        voice: str = DEFAULT_VOICE,
        model: str = DEFAULT_MODEL,
        muted: bool = False,
    ) -> None:
        if voice not in self.SUPPORTED_VOICES:
            raise ValueError(f"Invalid voice: {voice}. Use one of {self.SUPPORTED_VOICES}")
        self.voice = voice
        self.model = model
        self.muted = muted
        self.api_base = VERCEL_GATEWAY_BASE
        self.api_key = VERCEL_API_KEY
        self.response_format = "mp3"

    def synthesize(self, text: str) -> bytes:
        """Synthesize speech from text using OpenAI TTS."""
        if self.muted:
            return b""
        if not self.api_key:
            raise RuntimeError("VERCEL_GATEWAY_API_KEY is required for TTS")

        text = text.strip()
        if not text:
            raise ValueError("Text-to-speech input cannot be empty.")
        if len(text) > 4096:
            raise ValueError("Text-to-speech input too long (max 4096 chars).")

        url = f"{self.api_base}/audio/speech"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        payload = {
            "model": self.model,
            "voice": self.voice,
            "input": text,
            "response_format": self.response_format,
        }

        response = httpx.post(url, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        return response.content

    def synthesize_to_file(self, text: str, output_path: Path | None = None) -> Path:
        """Synthesize speech and write to a temporary file."""
        audio_data = self.synthesize(text)
        if output_path is None:
            suffix = f".{self.response_format}"
            handle, output_path = tempfile.mkstemp(prefix="memo-tts-", suffix=suffix)
            os.close(handle)
        Path(output_path).write_bytes(audio_data)
        return Path(output_path)
