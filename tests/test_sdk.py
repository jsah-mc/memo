import json
import os
from unittest import IsolatedAsyncioTestCase
from unittest.mock import MagicMock, patch

import httpx

from utils.gateway.sdk import ModelSDK, SDKResponseStream
from utils.tools.moonkart import MoonKartClient, MoonKartTool


class ModelSDKTests(IsolatedAsyncioTestCase):
    async def test_passes_moonkart_function_tool_to_completion(self):
        tool = MoonKartTool(MagicMock(spec=MoonKartClient))
        requests = []

        def handle(request):
            requests.append(request)
            return httpx.Response(200, json={"choices": []})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with (
            patch("utils.provider_transport.httpx.AsyncClient", return_value=client),
            patch.dict(os.environ, OPENAI_API_KEY="test-key"),
        ):
            await ModelSDK("openai/test-model").completion(
                {
                    "messages": [{"role": "user", "content": "start the moonkart"}],
                    "tools": [tool.function_definition],
                    "tool_choice": {
                        "type": "function",
                        "function": {"name": tool.name},
                    },
                }
            )
        body = json.loads(requests[0].content)
        self.assertEqual(body["tools"], [tool.function_definition])
        self.assertEqual(body["tool_choice"]["function"]["name"], "control_moonkart")
        self.assertEqual(body["model"], "test-model")
        self.assertEqual(
            str(requests[0].url), "https://api.openai.com/v1/chat/completions"
        )
        self.assertTrue(client.is_closed)

    async def test_streaming_chat_reassembles_multiple_tool_call_chunks_and_usage(self):
        chunks = [
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_1",
                                    "function": {
                                        "name": "SEARCH",
                                        "arguments": '{"q":',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {"index": 0, "function": {"arguments": '"hi"}'}}
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
            {
                "choices": [],
                "usage": {
                    "prompt_tokens": 5,
                    "completion_tokens": 3,
                    "total_tokens": 8,
                },
            },
        ]
        body = (
            "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
            + "data: [DONE]\n\n"
        )
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, text=body)
            )
        )
        with patch("utils.provider_transport.httpx.AsyncClient", return_value=client):
            stream = await ModelSDK("ollama/qwen3").responses({"input": "hi"})
            result = await stream.completed_response()
        self.assertEqual(result["output"][0]["name"], "SEARCH")
        self.assertEqual(json.loads(result["output"][0]["arguments"]), {"q": "hi"})
        self.assertEqual(result["usage"]["total_tokens"], 8)
        self.assertTrue(client.is_closed)

    async def test_recovers_function_call_from_output_item_event(self):
        call = {
            "type": "function_call",
            "name": "control_moonkart",
            "call_id": "call_test",
            "arguments": '{"action":"start"}',
        }

        async def events():
            yield {"type": "response.output_item.done", "output_index": 0, "item": call}
            yield {
                "type": "response.completed",
                "response": {"id": "response_test", "output": []},
            }

        response = await SDKResponseStream(events()).completed_response()
        self.assertEqual(response["output"], [call])

    async def test_stops_consuming_and_closes_after_response_completed(self):
        closed = False

        async def events():
            nonlocal closed
            try:
                yield {
                    "type": "response.completed",
                    "response": {"id": "response_test", "output": []},
                }
                raise AssertionError("stream continued after terminal event")
            finally:
                closed = True

        received = [event async for event in SDKResponseStream(events()).events()]
        self.assertEqual(received[0]["type"], "response.completed")
        self.assertTrue(closed)
