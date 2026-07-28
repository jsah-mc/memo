import json
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock

from utils.gateway.moonkart import (
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
    async def test_executes_authorized_tool_and_returns_followup_stream(self) -> None:
        initial = {
            "output": [
                {
                    "id": "fc_test",
                    "type": "function_call",
                    "call_id": "call_test",
                    "name": "control_moonkart",
                    "arguments": json.dumps({"action": "start"}),
                }
            ]
        }
        final = {"output_text": "MoonKart started."}
        sdk = FakeSDK(initial, final)
        tool = AsyncMock()
        tool.name = "control_moonkart"
        tool.litellm_definition = {
            "type": "function",
            "function": {"name": "control_moonkart", "parameters": {}},
        }
        tool.responses_definition = {
            "type": "function",
            "name": "control_moonkart",
            "parameters": {},
        }
        tool.execute.return_value = {
            "ok": True,
            "action": "start",
            "command": "H",
        }

        history = [
            {"role": "user", "content": "My MoonKart is in the garage."},
            {"role": "assistant", "content": "Understood."},
            {"role": "user", "content": "start the moonkart"},
        ]
        stream = await run_moonkart_tool_turn(sdk, {"input": history}, "start", tool)

        self.assertEqual(await stream.completed_response(), final)
        tool.execute.assert_awaited_once_with({"action": "start"})
        first_messages = sdk.response_payloads[0]["input"]
        self.assertEqual(first_messages[-3:], history)
        self.assertEqual(
            sdk.response_payloads[0]["tool_choice"],
            {"type": "function", "name": "control_moonkart"},
        )
        final_input = sdk.response_payloads[1]["input"]
        self.assertEqual(final_input[:-2], first_messages)
        self.assertEqual(final_input[-2]["type"], "function_call")
        self.assertEqual(final_input[-2]["call_id"], "call_test")
        output = final_input[-1]
        self.assertEqual(output["type"], "function_call_output")
        self.assertEqual(output["call_id"], "call_test")
        self.assertEqual(json.loads(output["output"])["command"], "H")

    async def test_does_not_execute_action_changed_by_model(self) -> None:
        initial = {
            "output": [
                {
                    "id": "fc_test",
                    "type": "function_call",
                    "call_id": "call_test",
                    "name": "control_moonkart",
                    "arguments": json.dumps({"action": "stop"}),
                }
            ]
        }
        sdk = FakeSDK(initial, {"output_text": "Not started."})
        tool = AsyncMock()
        tool.name = "control_moonkart"
        tool.litellm_definition = {
            "type": "function",
            "function": {"name": "control_moonkart", "parameters": {}},
        }
        tool.responses_definition = {
            "type": "function",
            "name": "control_moonkart",
            "parameters": {},
        }

        stream = await run_moonkart_tool_turn(
            sdk, {"input": "start the moonkart"}, "start", tool
        )
        await stream.completed_response()

        tool.execute.assert_not_awaited()
        result = json.loads(sdk.response_payloads[1]["input"][-1]["output"])
        self.assertFalse(result["ok"])
