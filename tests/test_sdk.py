from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

from utils.gateway.sdk import LiteLLMSDK, SDKResponseStream
from utils.tools.moonkart import MoonKartClient, MoonKartTool


class LiteLLMSDKTests(IsolatedAsyncioTestCase):
    async def test_passes_moonkart_function_tool_to_completion(self) -> None:
        tool = MoonKartTool(MagicMock(spec=MoonKartClient))
        with patch(
            "utils.gateway.sdk.litellm.acompletion",
            new=AsyncMock(return_value={"choices": []}),
        ) as completion:
            await LiteLLMSDK("chatgpt/gpt-5.4").completion(
                {
                    "messages": [{"role": "user", "content": "start the moonkart"}],
                    "tools": [tool.litellm_definition],
                    "tool_choice": {
                        "type": "function",
                        "function": {"name": tool.name},
                    },
                }
            )

        self.assertEqual(
            completion.await_args.kwargs["tools"], [tool.litellm_definition]
        )
        self.assertEqual(
            completion.await_args.kwargs["tool_choice"],
            {
                "type": "function",
                "function": {"name": "control_moonkart"},
            },
        )

    async def test_passes_codex_model_and_normalizes_string_input(self) -> None:
        iterator = iter(
            [
                {
                "type": "response.output_text.delta",
                "delta": "Hello",
                },
                {
                "type": "response.completed",
                "response": {"id": "response_test", "output": []},
                },
            ]
        )

        with patch(
            "utils.gateway.sdk.litellm.responses",
            return_value=iterator,
        ) as responses:
            result = await LiteLLMSDK(
                "chatgpt/gpt-5.4",
            ).responses({"input": "Hello"})

        self.assertEqual(
            responses.call_args.kwargs["input"],
            [
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": "Hello"}],
                }
            ],
        )
        self.assertEqual(responses.call_args.kwargs["model"], "chatgpt/gpt-5.4")
        self.assertNotIn("api_base", responses.call_args.kwargs)
        completed = await result.completed_response()
        self.assertEqual(completed["output_text"], "Hello")

    async def test_recovers_function_call_from_output_item_event(self) -> None:
        function_call = {
            "type": "function_call",
            "name": "control_moonkart",
            "call_id": "call_test",
            "arguments": '{"action":"start"}',
        }

        async def events():
            yield {
                "type": "response.output_item.done",
                "output_index": 0,
                "item": function_call,
            }
            yield {
                "type": "response.completed",
                "response": {"id": "response_test", "output": []},
            }

        response = await SDKResponseStream(events()).completed_response()

        self.assertEqual(response["output"], [function_call])
