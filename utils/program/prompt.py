"""System-prompt loading for the local Memo program."""

from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SYSTEM_PROMPT_PATH = PROJECT_ROOT / "system.txt"


def load_system_prompt(path: str | Path = SYSTEM_PROMPT_PATH) -> str:
    """Read and validate Memo's system prompt."""

    prompt_path = Path(path).expanduser().resolve()
    if not prompt_path.is_file():
        raise FileNotFoundError(f"System prompt not found: {prompt_path}")
    prompt = prompt_path.read_text(encoding="utf-8").strip()
    if not prompt:
        raise ValueError(f"System prompt is empty: {prompt_path}")
    return prompt
