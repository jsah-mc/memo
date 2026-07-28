"""Local realtime speech-to-text with RealtimeSTT and faster-whisper."""

from __future__ import annotations

import argparse
import ctypes
import logging
import os
import re
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_RATE = 16_000
DEFAULT_MODEL = "small.en"
SILENCE_DURATION_SECONDS = 0.6
MAX_WAIT_FOR_SPEECH_SECONDS = 15.0

logger = logging.getLogger(__name__)
_CUDA_DLL_HANDLES: list[Any] = []
_CUDA_DLL_PATHS: set[Path] = set()

WHISPER_HALLUCINATIONS = {
    "thank you",
    "thanks for watching",
    "subscribe to my channel",
    "like and subscribe",
    "please subscribe",
    "thank you for watching",
    "bye",
    "you",
    "the end",
    "продолжение следует",
    "sous-titres",
    "sous-titres réalisés par la communauté d'amara.org",
    "sottotitoli creati dalla comunità amara.org",
    "untertitel von stephanie geiges",
    "amara.org",
    "www.mooji.org",
    "ご視聴ありがとうございました",
}
_HALLUCINATION_REPEAT_RE = re.compile(
    r"^(?:thank you|thanks|bye|you|ok|okay|the end|[.\s,!])+$",
    flags=re.IGNORECASE,
)


def _configure_cuda_dlls() -> None:
    """Expose pip-installed CUDA 12 runtime DLLs to CTranslate2 on Windows."""

    if sys.platform != "win32":
        return
    package_root = Path(sys.prefix, "Lib", "site-packages", "nvidia")
    candidates = (
        package_root / "cublas" / "bin",
        package_root / "cudnn" / "bin",
    )
    paths = [path.resolve() for path in candidates if path.is_dir()]
    if not paths:
        return

    current_path = os.environ.get("PATH", "")
    existing = {part.casefold() for part in current_path.split(os.pathsep)}
    additions = [str(path) for path in paths if str(path).casefold() not in existing]
    if additions:
        os.environ["PATH"] = os.pathsep.join([*additions, current_path])

    for path in paths:
        if path in _CUDA_DLL_PATHS:
            continue
        _CUDA_DLL_HANDLES.append(os.add_dll_directory(str(path)))
        _CUDA_DLL_PATHS.add(path)


def is_whisper_hallucination(transcript: str) -> bool:
    """Return whether Whisper likely produced a stock phrase from silence."""

    cleaned = transcript.strip().casefold()
    if not cleaned:
        return True
    normalized = cleaned.rstrip(".!")
    return (
        cleaned in WHISPER_HALLUCINATIONS
        or normalized in WHISPER_HALLUCINATIONS
        or _HALLUCINATION_REPEAT_RE.fullmatch(cleaned) is not None
    )


class STT:
    """Own a persistent RealtimeSTT recorder backed by faster-whisper."""

    def __init__(
        self,
        *,
        model_name: str | None = None,
        language: str | None = None,
        device: str | None = None,
        compute_type: str | None = None,
        recorder: Any | None = None,
        recorder_factory: Callable[..., Any] | None = None,
        whisper_model: Any | None = None,
    ) -> None:
        self.model_name = model_name or os.environ.get(
            "MEMO_WHISPER_MODEL",
            DEFAULT_MODEL,
        )
        self.language = language or os.environ.get("MEMO_WHISPER_LANGUAGE", "")
        self.device = device or os.environ.get("MEMO_WHISPER_DEVICE", "auto")
        self.compute_type = compute_type or os.environ.get(
            "MEMO_WHISPER_COMPUTE_TYPE"
        )
        self.cpu_threads = max(
            1,
            int(os.environ.get("MEMO_SPEECH_CPU_THREADS", "4")),
        )
        self._recorder = recorder
        self._recorder_factory = recorder_factory
        self._whisper_model = whisper_model
        self._active_device: str | None = None
        self._listen_lock = threading.Lock()

    def _runtime(self) -> tuple[str, str]:
        device = self.device
        if device in {"auto", "cuda"}:
            _configure_cuda_dlls()
        if device == "auto":
            try:
                import ctranslate2

                cuda_available = ctranslate2.get_cuda_device_count() > 0
                if cuda_available and sys.platform == "win32":
                    try:
                        ctypes.WinDLL("cublas64_12.dll")
                    except OSError:
                        cuda_available = False
                device = "cuda" if cuda_available else "cpu"
            except Exception:  # noqa: BLE001 - CUDA discovery must fail closed.
                device = "cpu"
        compute_type = self.compute_type or (
            "float16" if device == "cuda" else "int8"
        )
        return device, compute_type

    def _create_recorder(self):
        if self._recorder_factory is None:
            from RealtimeSTT import AudioToTextRecorder

            self._recorder_factory = AudioToTextRecorder

        device, compute_type = self._runtime()
        if device == "cpu":
            os.environ.setdefault("OMP_NUM_THREADS", str(self.cpu_threads))
        options = {
            "transcription_engine": "faster_whisper",
            "model": self.model_name,
            "language": self.language,
            "device": device,
            "compute_type": compute_type,
            "beam_size": 1,
            "batch_size": 0,
            "spinner": False,
            "no_log_file": True,
            "debug_mode": False,
            "silero_use_onnx": None,
            "silero_backend": "auto",
            "post_speech_silence_duration": SILENCE_DURATION_SECONDS,
            "min_length_of_recording": 0.3,
            "pre_recording_buffer_duration": 0.5,
            "ensure_sentence_starting_uppercase": True,
            "ensure_sentence_ends_with_period": False,
            "faster_whisper_vad_filter": True,
        }
        try:
            recorder = self._recorder_factory(**options)
            self._active_device = device
            return recorder
        except Exception:
            if device != "cuda":
                raise
            logger.warning(
                "RealtimeSTT CUDA initialization failed; using CPU int8.",
                exc_info=True,
            )
            options["device"] = "cpu"
            options["compute_type"] = "int8"
            self.device = "cpu"
            self.compute_type = "int8"
            recorder = self._recorder_factory(**options)
            self._active_device = "cpu"
            return recorder

    def _get_recorder(self):
        if self._recorder is None:
            self._recorder = self._create_recorder()
        return self._recorder

    @staticmethod
    def _result(text: str, model: str) -> dict[str, Any]:
        text = text.strip()
        filtered = is_whisper_hallucination(text)
        return {
            "success": True,
            "transcript": "" if filtered else text,
            "filtered": filtered,
            "provider": "realtimestt",
            "model": model,
            "language_code": None,
            "language_probability": None,
        }

    def listen(self) -> dict[str, Any]:
        """Wait for one spoken utterance and return its final transcript."""

        with self._listen_lock:
            text = self._get_recorder().text()
        return self._result(str(text or ""), self.model_name)

    def _get_whisper_model(self):
        if self._whisper_model is None:
            from faster_whisper import WhisperModel

            device, compute_type = self._runtime()
            if device == "cpu":
                os.environ.setdefault("OMP_NUM_THREADS", str(self.cpu_threads))
            try:
                self._whisper_model = WhisperModel(
                    self.model_name,
                    device=device,
                    compute_type=compute_type,
                    cpu_threads=self.cpu_threads,
                )
                self._active_device = device
            except Exception:
                if device != "cuda":
                    raise
                logger.warning(
                    "faster-whisper CUDA failed; using CPU int8.",
                    exc_info=True,
                )
                self.device = "cpu"
                self.compute_type = "int8"
                self._whisper_model = WhisperModel(
                    self.model_name,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=self.cpu_threads,
                )
                self._active_device = "cpu"
        return self._whisper_model

    def transcribe(self, audio_path: str | Path) -> dict[str, Any]:
        """Transcribe an existing audio file with faster-whisper."""

        path = Path(audio_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Audio file not found: {path}")
        if path.stat().st_size == 0:
            raise ValueError("Audio file is empty.")

        model = self._get_whisper_model()
        arguments: dict[str, Any] = {
            "beam_size": 1,
            "vad_filter": True,
            "condition_on_previous_text": False,
        }
        if self.language:
            arguments["language"] = self.language
        try:
            segments, info = model.transcribe(str(path), **arguments)
            materialized_segments = list(segments)
        except RuntimeError:
            if self._active_device != "cuda":
                raise
            logger.warning(
                "faster-whisper CUDA decoding failed; retrying on CPU int8.",
                exc_info=True,
            )
            from faster_whisper import WhisperModel

            self.device = "cpu"
            self.compute_type = "int8"
            self._active_device = "cpu"
            self._whisper_model = WhisperModel(
                self.model_name,
                device="cpu",
                compute_type="int8",
                cpu_threads=self.cpu_threads,
            )
            segments, info = self._whisper_model.transcribe(
                str(path),
                **arguments,
            )
            materialized_segments = list(segments)

        text = " ".join(
            str(segment.text).strip()
            for segment in materialized_segments
            if getattr(segment, "text", None)
        )
        result = self._result(text, self.model_name)
        result["language_code"] = getattr(info, "language", None)
        result["language_probability"] = getattr(
            info,
            "language_probability",
            None,
        )
        return result

    def abort(self) -> None:
        recorder = self._recorder
        abort = getattr(recorder, "abort", None)
        if callable(abort):
            abort()

    @staticmethod
    def _terminate_process(process: Any) -> None:
        if process is None:
            return
        try:
            if not process.is_alive():
                return
            process.terminate()
            process.join(timeout=0.25)
            if process.is_alive():
                kill = getattr(process, "kill", None)
                if callable(kill):
                    kill()
                process.join(timeout=0.25)
        except (OSError, ValueError, AttributeError):
            logger.debug("Speech worker was already closed.", exc_info=True)

    def _prepare_fast_shutdown(self, recorder: Any) -> None:
        """Wake recorder threads and stop child processes without 10s joins."""

        for name, value in (
            ("is_shut_down", True),
            ("continuous_listening", False),
            ("is_recording", False),
            ("is_running", False),
        ):
            if hasattr(recorder, name):
                setattr(recorder, name, value)

        for name in (
            "start_recording_event",
            "stop_recording_event",
            "shutdown_event",
        ):
            event = getattr(recorder, name, None)
            set_event = getattr(event, "set", None)
            if callable(set_event):
                set_event()

        self._terminate_process(getattr(recorder, "reader_process", None))
        self._terminate_process(getattr(recorder, "transcript_process", None))

    def shutdown(self) -> None:
        with self._listen_lock:
            recorder = self._recorder
            self._recorder = None
            if recorder is None:
                return
            self._prepare_fast_shutdown(recorder)
            shutdown = getattr(recorder, "shutdown", None)
            if callable(shutdown):
                shutdown()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Transcribe locally with RealtimeSTT and faster-whisper."
    )
    parser.add_argument(
        "audio",
        nargs="?",
        help="Existing audio file. Omit it for realtime microphone input.",
    )
    return parser


def main() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    args = build_parser().parse_args()
    stt = STT()
    try:
        result = stt.transcribe(args.audio) if args.audio else stt.listen()
        print(result["transcript"])
    finally:
        stt.shutdown()


if __name__ == "__main__":
    main()
