from __future__ import annotations

from typing import ClassVar

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import Button, Static


class ShellPermissionScreen(ModalScreen[bool]):
    """Ask for one computer capability approval, defaulting to denial."""

    BINDINGS: ClassVar[list[tuple[str, str, str]]] = [("escape", "deny", "Deny")]
    CSS = """
    ShellPermissionScreen {
        align: center middle;
        background: rgba(0, 0, 0, 0.72);
    }

    #shell-permission-dialog {
        width: 76;
        max-width: 92%;
        height: auto;
        max-height: 80%;
        padding: 1 3;
        border: tall $warning;
        background: $panel;
    }

    #shell-permission-command {
        margin: 1 0;
        padding: 1;
        background: $surface;
        color: $text;
        border-left: solid $warning;
    }

    #shell-permission-actions {
        height: auto;
        align-horizontal: right;
    }

    #shell-permission-actions Button {
        margin-left: 1;
        border: tall $boost;
    }

    #shell-permission-actions Button:focus,
    #shell-permission-actions Button:hover {
        border: tall $warning;
    }
    """

    def __init__(self, command: str, cwd: str, kind: str = "shell_command") -> None:
        super().__init__()
        self.command = command
        self.cwd = cwd
        self.kind = kind

    def compose(self) -> ComposeResult:
        computer_control = self.kind == "computer_control"
        with Vertical(id="shell-permission-dialog"):
            yield Static(
                "Allow computer control?" if computer_control else "Allow shell command?",
                classes="permission-title",
            )
            yield Static(
                (
                    "Memo may share visible-screen screenshots with the configured "
                    "AI and control the mouse and keyboard for this task only."
                    if computer_control
                    else "This command runs on the host and is not OS-isolated."
                ),
                classes="permission-warning",
            )
            yield Static(self.command, id="shell-permission-command", markup=False)
            if not computer_control:
                yield Static(f"Working directory: {self.cwd}", markup=False)
            with Horizontal(id="shell-permission-actions"):
                yield Button("Deny", id="deny-shell", variant="default")
                yield Button("Allow once", id="allow-shell", variant="warning")

    def on_mount(self) -> None:
        self.query_one("#deny-shell", Button).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "allow-shell")

    def action_deny(self) -> None:
        self.dismiss(False)
