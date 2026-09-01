import sys
import unittest
from unittest.mock import MagicMock, patch

sys.modules["PIL"] = MagicMock()
sys.modules["PIL.Image"] = MagicMock()

from utils.tools.computer import ComputerSandboxTool


class TestComputerSandboxOS(unittest.TestCase):
    def test_build_os_sandboxed_cmd_default(self):
        tool = ComputerSandboxTool()
        cmd, args = tool._build_os_sandboxed_cmd("ls", ["-la"])
        # Should fallback gracefully when bwrap/sandbox-exec is not installed/mocked
        self.assertIn("ls", [cmd, *args])

    @patch("shutil.which")
    def test_build_os_sandboxed_cmd_linux_bwrap(self, mock_which):
        def which_side_effect(name):
            return "/usr/bin/bwrap" if name == "bwrap" else None

        mock_which.side_effect = which_side_effect
        tool = ComputerSandboxTool()
        with patch.object(sys, "platform", "linux"):
            cmd, args = tool._build_os_sandboxed_cmd("/bin/sh", ["-c", "echo 1"])
            self.assertEqual(cmd, "/usr/bin/bwrap")
            self.assertIn("--bind", args)

    @patch("shutil.which")
    def test_build_os_sandboxed_cmd_darwin(self, mock_which):
        def which_side_effect(name):
            return "/usr/bin/sandbox-exec" if name == "sandbox-exec" else None

        mock_which.side_effect = which_side_effect
        tool = ComputerSandboxTool()
        with patch.object(sys, "platform", "darwin"):
            cmd, args = tool._build_os_sandboxed_cmd("/bin/sh", ["-c", "echo 1"])
            self.assertEqual(cmd, "/usr/bin/sandbox-exec")
            self.assertIn("-p", args)


if __name__ == "__main__":
    unittest.main()
