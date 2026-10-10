import json
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import httpx

from utils.gateway.sdk import ModelSDK, SDKResponseStream


class ModelSDKTests(IsolatedAsyncioTestCase):
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
            "name": "search_notes",
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
