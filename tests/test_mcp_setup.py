import json
import tempfile
import unittest
from pathlib import Path

from utils.mcp_setup import merge_json_server, server_config


class MCPSetupTests(unittest.TestCase):
    def test_server_config_runs_managed_memo_checkout(self) -> None:
        config = server_config(Path("memo-root"))
        self.assertEqual(config["command"], "uv")
        self.assertEqual(config["args"][-1], "memo-mcp")
        self.assertIn("--directory", config["args"])

    def test_json_registration_preserves_other_servers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mcp.json"
            path.write_text(json.dumps({"mcpServers": {"other": {"command": "other"}}}), encoding="utf-8")
            config = {"command": "uv", "args": ["run", "memo-mcp"]}
            merge_json_server(path, "mcpServers", config)
            document = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(document["mcpServers"]["memo"], config)
            self.assertIn("other", document["mcpServers"])

    def test_invalid_json_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mcp.json"
            path.write_text("{broken", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                merge_json_server(path, "mcpServers", {})
            self.assertEqual(path.read_text(encoding="utf-8"), "{broken")


if __name__ == "__main__":
    unittest.main()
