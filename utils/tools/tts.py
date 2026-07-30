"""Local streaming text-to-speech with RealtimeTTS and PocketTTS."""

from __future__ import annotations

import argparse
import gc
import os
import re
import sys
import tempfile
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = "pocket-tts"
DEFAULT_VOICE = "alba"
DEFAULT_DEVICE = "cuda"


def _sentence_fragments(text: str) -> list[str]:
    fragments = [
        fragment.strip()
        for fragment in re.split(r"(?<=[.!?])\s+", text)
        if fragment.strip()
    ]
    return fragments or [text]


class TTS:
    """Synthesize and play local PocketTTS audio through RealtimeTTS."""

    response_format = "wav"

    def __init__(
        self,
        *,
        voice: str = DEFAULT_VOICE,
        device: str | None = None,
        muted: bool = False,
        engine: Any | None = None,
        stream_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.voice = voice
        self.muted = muted
        self.device = device or os.environ.get(
            "MEMO_POCKETTTS_DEVICE",
            DEFAULT_DEVICE,
        )
        self.cpu_threads = max(
            1,
            int(os.environ.get("MEMO_SPEECH_CPU_THREADS", "4")),
        )
        self._engine = engine
        self._stream_factory = stream_factory
        self._audio_stream: Any | None = None
        self._lock = threading.Lock()

    @staticmethod
    def _validated_text(text: str) -> str:
        text = text.strip()
        if not text:
            raise ValueError("Text-to-speech input cannot be empty.")
        if len(text) > 10_000:
            raise ValueError("Text-to-speech input is too long.")
        return text

    def _stream_player(self):
        if self._audio_stream is None:
            if self._engine is None:
                from RealtimeTTS import PocketTTSEngine

                if self.device == "cpu":
                    import torch

                    torch.set_num_threads(self.cpu_threads)
                self._engine = PocketTTSEngine(
                    voice=self.voice,
                    device=self.device,
                    streaming=True,
                    max_tokens=max(
                        8,
                        int(os.environ.get("MEMO_POCKETTTS_MAX_TOKENS", "24")),
                    ),
                )
            if self._stream_factory is None:
                from RealtimeTTS import TextToAudioStream

                self._stream_factory = TextToAudioStream
            self._audio_stream = self._stream_factory(
                self._engine,
                muted=self.muted,
            )
        return self._audio_stream

    def prepare(self) -> dict[str, Any]:
        """Load PocketTTS and its playback stream before the first utterance."""

        with self._lock:
            self._stream_player()
        return {
            "ready": True,
            "model": DEFAULT_MODEL,
            "voice": self.voice,
            "device": self.device,
        }

    @staticmethod
    def _play_options() -> dict[str, Any]:
        return {
            "fast_sentence_fragment": True,
            "minimum_first_fragment_length": 8,
            "minimum_sentence_length": 8,
            "tokenize_sentences": _sentence_fragments,
            "buffer_threshold_seconds": 0.1,
        }

    def speak(self, text: str) -> None:
        """Stream PocketTTS audio to the speakers as it is generated."""

        text = self._validated_text(text)
        with self._lock:
            stream = self._stream_player()
            stream.feed(text)
            stream.play(**self._play_options())

    def stop(self) -> None:
        """Stop current synthesis and playback immediately."""

        stream = self._audio_stream
        if stream is not None:
            stream.stop()

    def request_stop(self) -> None:
        """Signal playback to stop without joining worker threads."""

        stream = self._audio_stream
        engine = self._engine
        stop_engine = getattr(engine, "stop", None)
        if callable(stop_engine):
            stop_engine()
        if stream is None:
            return
        for event in getattr(stream, "abort_events", ()):
            event.set()
        player = getattr(stream, "player", None)
        stop_player = getattr(player, "stop", None)
        if callable(stop_player):
            try:
                stop_player(immediate=True)
            except TypeError:
                stop_player()

    def synthesize(
        self,
        text: str,
        output_path: str | Path | None = None,
    ) -> Path:
        """Generate a WAV file and return its path."""

        text = self._validated_text(text)
        if output_path is None:
            descriptor, name = tempfile.mkstemp(prefix="memo-tts-", suffix=".wav")
            os.close(descriptor)
            path = Path(name)
        else:
            path = Path(output_path).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)

        with self._lock:
            stream = self._stream_player()
            stream.feed(text)
            stream.play(
                output_wavfile=str(path),
                muted=True,
                **self._play_options(),
            )
        return path

    def synthesize_bytes(self, text: str) -> bytes:
        path = self.synthesize(text)
        try:
            return path.read_bytes()
        finally:
            path.unlink(missing_ok=True)

    def stream(self, text: str, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
        """Yield a generated WAV file in transport-sized chunks."""

        path = self.synthesize(text)
        try:
            with path.open("rb") as audio:
                while chunk := audio.read(chunk_size):
                    yield chunk
        finally:
            path.unlink(missing_ok=True)

    def play(self, audio_path: str | Path) -> None:
        """Play an existing WAV file through the default output device."""

        import sounddevice as sd
        import soundfile as sf

        path = Path(audio_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Audio file not found: {path}")
        audio, sample_rate = sf.read(path, dtype="float32")
        sd.play(audio, sample_rate)
        sd.wait()

    def shutdown(self, *, fast: bool = False) -> None:
        if fast:
            self.request_stop()
        else:
            self.stop()
            engine = self._engine
            close = getattr(engine, "shutdown", None)
            if callable(close):
                close()
        self._audio_stream = None
        self._engine = None
        gc.collect()
        torch = sys.modules.get("torch")
        cuda = getattr(torch, "cuda", None)
        empty_cache = getattr(cuda, "empty_cache", None)
        if callable(empty_cache):
            empty_cache()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Speak text locally with RealtimeTTS and PocketTTS."
    )
    parser.add_argument("text", help="Text to synthesize.")
    parser.add_argument("--output", type=Path, help="Optional WAV output path.")
    parser.add_argument(
        "--no-play",
        action="store_true",
        help="Generate audio without playing it.",
    )
    return parser


def main() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    args = build_parser().parse_args()
    tts = TTS()
    try:
        if args.output or args.no_play:
            path = tts.synthesize(args.text, args.output)
            print(path)
        else:
            tts.speak(args.text)
    finally:
        tts.shutdown()


if __name__ == "__main__":
    main()
