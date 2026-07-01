from __future__ import annotations

from RealtimeTTS import TextToAudioStream, KokoroEngine
from rich.console import Console

console = Console()

# Compatibility patches for kokoro-onnx / transformers
import kokoro.model
import kokoro.modules
import torch


def _kmodel_device(self):
    return next(self.parameters()).device


if hasattr(kokoro.model.KModel, "device"):
    del kokoro.model.KModel.device
kokoro.model.KModel.device = property(_kmodel_device)


_albert_forward = kokoro.modules.AlbertModel.forward


def _patched_custom_albert_forward(self, *args, **kwargs):
    outputs = _albert_forward(self, *args, **kwargs)
    if isinstance(outputs, tuple):
        return outputs[0]
    return outputs.last_hidden_state


kokoro.modules.CustomAlbert.forward = _patched_custom_albert_forward


class TTS:
    def __init__(self):
        console.print("[yellow]Initializing Local Kokoro TTS Engine...[/yellow]")

        self.engine = KokoroEngine(voice="am_adam")
        self.stream = TextToAudioStream(self.engine)

        console.print("[green]\u2714 Kokoro TTS Engine Ready![/green]")

    def speak(self, text: str):
        if not text.strip():
            return

        console.print(
            f"[bold magenta]Mimo says:[/bold magenta] [italic white]{text}[/italic white]"
        )
        self.stream.feed(text)
        self.stream.play()

    def stop(self):
        self.stream.stop()
