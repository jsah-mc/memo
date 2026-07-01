import os
import sys
from RealtimeSTT import AudioToTextRecorder
from rich.console import Console

console = Console()


class STT:
    def __init__(self):
        os.environ["PYTHONWARNINGS"] = "ignore"
        self._original_stderr = sys.stderr
        sys.stderr = open(os.devnull, "w")

        console.print("[yellow]Initializing STT Engine...[/yellow]")

        self.recorder = AudioToTextRecorder(
            device="cuda", compute_type="float16", language="en", spinner=False
        )

        sys.stderr = self._original_stderr
        console.print("[green]✔ STT Engine Ready![/green]")

    def start(self):
        try:
            while True:
                text = self.recorder.text()
                if text.strip():
                    console.print(f"[cyan]Heard:[/cyan] {text}")
                if (
                    "hey mimo" in text.lower().strip()
                    or "hey memo" in text.lower().strip()
                ):
                    console.print("[bold green]Mimo matched![/bold green]")
        except KeyboardInterrupt:
            pass
        finally:
            self.recorder.shutdown()
