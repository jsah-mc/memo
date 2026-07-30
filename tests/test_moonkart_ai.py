from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock

from utils.gateway.moonkart import (
    detect_moonkart_action as detect_gateway_moonkart_action,
)
from utils.gateway.moonkart import (
    run_moonkart_tool_turn as run_gateway_moonkart_tool_turn,
)
from utils.program.moonkart import (
    detect_moonkart_action,
    run_moonkart_tool_turn,
)


class FakeStream:
    def __init__(self, response: dict):
        self.response = response

    async def completed_response(self) -> dict:
        return self.response

    async def events(self):
        text = self.response.get("output_text", "")
        if text:
            yield {"type": "response.output_text.delta", "delta": text}
        yield {"type": "response.completed", "response": self.response}


class FakeSDK:
    def __init__(self, initial: dict, final: dict):
        self.streams = [FakeStream(initial), FakeStream(final)]
        self.response_payloads: list[dict] = []

    async def responses(self, payload: dict) -> FakeStream:
        self.response_payloads.append(payload)
        return self.streams[len(self.response_payloads) - 1]


class MoonKartIntentTests(TestCase):
    def test_detects_start_and_stop_spellings(self) -> None:
        self.assertEqual(detect_moonkart_action("start the moonkart"), "start")
        self.assertEqual(detect_moonkart_action("Please start MoonCart"), "start")
        self.assertEqual(detect_moonkart_action("start the moon cart"), "start")
        self.assertEqual(detect_moonkart_action("stop the moon kart"), "stop")
        self.assertEqual(
            detect_moonkart_action([{"role": "user", "content": "stop the moonkart"}]),
            "stop",
        )

    def test_rejects_ambiguous_or_unrelated_requests(self) -> None:
        self.assertIsNone(detect_moonkart_action("Tell me about MoonKart"))
        self.assertIsNone(detect_moonkart_action("Don't start the MoonKart"))
        self.assertIsNone(detect_moonkart_action("Never stop MoonCart"))
        self.assertIsNone(
            detect_moonkart_action("Start MoonKart and then stop MoonKart")
        )


class MoonKartAIToolTests(IsolatedAsyncioTestCase):
    async def test_executes_authorized_action_without_model_round_trip(self) -> None:
        sdk = FakeSDK({}, {})
        tool = AsyncMock()
        tool.name = "control_moonkart"
        tool.execute.return_value = {
            "ok": True,
            "action": "start",
            "command": "H",
        }

        stream = await run_moonkart_tool_turn(
            sdk,
            {"input": "start the moon cart"},
            "start",
            tool,
        )
        events = [event async for event in stream.events()]

        tool.execute.assert_awaited_once_with({"action": "start"})
        self.assertEqual(sdk.response_payloads, [])
        self.assertEqual(events[0]["type"], "memo.tool_call.started")
        self.assertEqual(events[1]["type"], "memo.tool_call.completed")
        self.assertEqual(events[1]["tool_call"]["result"]["command"], "H")
        self.assertEqual(events[2]["delta"], "MoonKart start command sent (H).")
        self.assertEqual(events[3]["type"], "response.completed")

    async def test_reports_hardware_error_as_failed_tool_call(self) -> None:
        sdk = FakeSDK({}, {})
        tool = AsyncMock()
        tool.name = "control_moonkart"
        tool.execute.side_effect = ConnectionError("MoonKart not found")

        stream = await run_moonkart_tool_turn(
            sdk,
            {"input": "stop moonkart"},
            "stop",
            tool,
        )
        events = [event async for event in stream.events()]

        self.assertTrue(events[1]["tool_call"]["is_error"])
        self.assertIn("MoonKart not found", events[2]["delta"])


class GatewayMoonKartTests(IsolatedAsyncioTestCase):
    async def test_spaced_name_executes_gateway_tool_without_model(self) -> None:
        self.assertEqual(
            detect_gateway_moonkart_action("please start the moon cart"),
            "start",
        )
        sdk = FakeSDK({}, {})
        tool = AsyncMock()
        tool.name = "control_moonkart"
        tool.execute.return_value = {
            "ok": True,
            "action": "start",
            "command": "H",
        }

        stream = await run_gateway_moonkart_tool_turn(
            sdk,
            {"input": "please start the moon cart"},
            "start",
            tool,
        )
        response = await stream.completed_response()

        tool.execute.assert_awaited_once_with({"action": "start"})
        self.assertEqual(sdk.response_payloads, [])
        self.assertEqual(response["output_text"], "MoonKart start command sent (H).")
