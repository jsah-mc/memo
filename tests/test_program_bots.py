import json
import tempfile
import unittest
from pathlib import Path

from utils.program.bots import bot_prompt, find_bot, load_bots, parse_bot_command


class ProgramBotTests(unittest.TestCase):
    def test_quoted_bot_command_selects_enabled_bot_case_insensitively(self) -> None:
        bots = [
            {
                "name": "Build Bot",
                "enabled": True,
                "instructions": "Ship it.",
                "command": "build",
            }
        ]
        self.assertEqual(parse_bot_command('/bot "Build Bot"'), "Build Bot")
        bot = find_bot("build bot", bots)
        self.assertIsNotNone(bot)
        self.assertIn("Ship it.", bot_prompt(bot or {}))
        self.assertIn("browser", bot_prompt(bot or {}))

    def test_disabled_or_malformed_bot_is_not_selected(self) -> None:
        bots = [{"name": "Paused", "enabled": False, "instructions": "Wait."}]
        self.assertIsNone(find_bot("Paused", bots))
        self.assertIsNone(parse_bot_command('/bot "unfinished'))
        self.assertIsNone(parse_bot_command("/bot"))

    def test_desktop_bot_store_is_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bots.json"
            path.write_text(
                json.dumps(
                    [
                        {
                            "name": "Writer",
                            "enabled": True,
                            "instructions": "Write.",
                            "command": "writer",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            self.assertEqual(load_bots(path)[0]["name"], "Writer")
            self.assertEqual(
                load_bots(path)[0]["allowedTools"],
                ["browser", "computer", "integrations"],
            )


if __name__ == "__main__":
    unittest.main()
