"""Contracts for the shared AI package and legacy imports."""

import ast
import unittest
from pathlib import Path

from utils.program.ai import ProgramAI
from utils.program.settings import ProgramSettings
from utils.tools.ai import AI, AISettings
from utils.tools.ai.prompt import SYSTEM_PROMPT_PATH, load_system_prompt


class SharedAITests(unittest.TestCase):
    def test_legacy_imports_use_shared_classes(self) -> None:
        self.assertIs(ProgramAI, AI)
        self.assertIs(ProgramSettings, AISettings)

    def test_default_prompt_still_uses_project_root(self) -> None:
        expected = Path(__file__).resolve().parents[1] / "system.txt"
        self.assertEqual(SYSTEM_PROMPT_PATH, expected)
        self.assertEqual(load_system_prompt(), expected.read_text().strip())

    def test_shared_package_has_no_program_or_gateway_dependency(self) -> None:
        package = Path(__file__).resolve().parents[1] / "utils" / "tools" / "ai"
        for source in package.glob("*.py"):
            for node in ast.walk(ast.parse(source.read_text())):
                if isinstance(node, ast.ImportFrom):
                    self.assertFalse(
                        (node.module or "").startswith(
                            ("utils.program", "utils.gateway", "fastapi", "textual")
                        ),
                        str(source),
                    )
