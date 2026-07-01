import time
from rich.columns import Columns
from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text
from utils.asciiart import asciiart
from utils.stt import STT
from utils.tts import TTS

console = Console()


class Program:
    def __init__(self):
        console.print(Rule("[bold blue]System Boot[/bold blue]"))
        self.tts_service = TTS()
        self.stt_service = STT()

    def run(self):
        console.print("\n")
        art_panel = Panel(
            Text(asciiart[0][0].strip("\n"), style="bold cyan"),
            border_style="bright_black",
            padding=(0, 1),
        )
        info_panel = Panel.fit(
            "[bold green]Mimo AI Assistant Protocol Activated.[/bold green]\n"
            "[dim]Listening actively. Say '[bold cyan]Hey Mimo[/bold cyan]' to interact.[/dim]",
            title="[bold white]Mimo OS[/bold white]",
            border_style="green",
            padding=(1, 2),
        )
        console.print(Columns([art_panel, info_panel], equal=False, align="center"))

        try:
            while True:
                text = self.stt_service.recorder.text()

                if text.strip():
                    console.print(f"[bold blue]🎤 You:[/bold blue] {text}")

                    if (
                        "hey mimo" in text.lower().strip()
                        or "hey, mimo." in text.lower().strip()
                    ):
                        self.tts_service.speak(
                            "Wassup my homie! I am locked and loaded."
                        )

                time.sleep(0.1)

        except KeyboardInterrupt:
            console.print(Rule("[bold red]Shutting Down Cleanly[/bold red]"))
        finally:
            self.stt_service.recorder.shutdown()
