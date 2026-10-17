import unittest
from unittest.mock import AsyncMock, patch

from utils import mcp_server


class _FakeAI:
    def __init__(self, *, system_prompt=None):
        self.system_prompt = system_prompt
        self.close = AsyncMock()

    async def stream(self, prompt):
        yield f"answer:{prompt}"


class MCPServerTests(unittest.IsolatedAsyncioTestCase):
    async def test_ask_memo_streams_and_closes_runtime(self) -> None:
        instance = _FakeAI()
        with patch.object(mcp_server, "ProgramAI", return_value=instance):
            answer = await mcp_server.ask_memo("ship it")
        self.assertEqual(answer, "answer:ship it")
        instance.close.assert_awaited_once()

    async def test_named_bot_supplies_its_prompt(self) -> None:
        bot = {"name": "Builder", "command": "build", "instructions": "Build carefully.", "enabled": True}
        instance = _FakeAI()
        with patch.object(mcp_server, "load_bots", return_value=[bot]), patch.object(
            mcp_server, "ProgramAI", return_value=instance
        ) as runtime:
            await mcp_server.ask_memo("work", "builder")
        self.assertIn("Build carefully.", runtime.call_args.kwargs["system_prompt"])

    async def test_unknown_bot_is_rejected(self) -> None:
        with (
            patch.object(mcp_server, "load_bots", return_value=[]),
            self.assertRaises(ValueError),
        ):
            await mcp_server.ask_memo("work", "missing")


if __name__ == "__main__":
    unittest.main()
