import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class TuiActivityTests(unittest.TestCase):
    def test_faces_spinner_and_desktop_control_border_are_present(self):
        main = (ROOT / "utils/program/main.py").read_text(encoding="utf-8")
        styles = (ROOT / "utils/program/styles/messages.tcss").read_text(
            encoding="utf-8"
        )
        for value in (":P", ":)", ":(", "⠋", "⠏"):
            self.assertIn(value, main)
        self.assertIn('self.screen.set_class(controlling, "desktop-control-active")', main)
        self.assertIn("Screen.desktop-control-active", styles)
        self.assertIn("border: tall $warning", styles)


if __name__ == "__main__":
    unittest.main()
