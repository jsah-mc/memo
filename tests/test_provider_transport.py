import json
import os
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import httpx
from utils.gateway.sdk import ModelSDK


class ProviderTransportTests(IsolatedAsyncioTestCase):
    async def test_anthropic_uses_native_messages_and_streams_tool_calls(self):
        requests = []
        events = [
            {"type": "message_start", "message": {"usage": {"input_tokens": 5}}},
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "tool_use", "id": "call1", "name": "SEARCH"},
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "input_json_delta", "partial_json": '{"q":"hello"}'},
            },
            {"type": "message_delta", "usage": {"output_tokens": 3}},
            {"type": "message_stop"},
        ]

        def handle(request):
            requests.append(request)
            return httpx.Response(
                200, text="".join(f"data: {json.dumps(event)}\n\n" for event in events)
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with (
            patch("utils.provider_transport.httpx.AsyncClient", return_value=client),
            patch.dict(
                os.environ,
                ANTHROPIC_API_KEY="anthropic-test",
                OPENAI_API_KEY="never-forward",
            ),
        ):
            result = await (
                await ModelSDK("anthropic/claude-test").responses(
                    {
                        "instructions": "Be honest.",
                        "input": "search hello",
                        "tools": [
                            {
                                "type": "function",
                                "name": "SEARCH",
                                "parameters": {"type": "object"},
                            }
                        ],
                    }
                )
            ).completed_response()
        request = requests[0]
        body = json.loads(request.content)
        self.assertEqual(str(request.url), "https://api.anthropic.com/v1/messages")
        self.assertEqual(request.headers["x-api-key"], "anthropic-test")
        self.assertNotIn("authorization", request.headers)
        self.assertEqual(body["system"], "Be honest.")
        self.assertEqual(body["tools"][0]["input_schema"], {"type": "object"})
        self.assertEqual(result["output"][0]["call_id"], "call1")
        self.assertEqual(json.loads(result["output"][0]["arguments"]), {"q": "hello"})
        self.assertEqual(result["usage"]["total_tokens"], 8)
        self.assertTrue(client.is_closed)

    async def test_lmstudio_sends_images_and_tool_results_without_api_key(self):
        requests = []

        def handle(request):
            requests.append(request)
            return httpx.Response(
                200,
                text='data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with (
            patch("utils.provider_transport.httpx.AsyncClient", return_value=client),
            patch.dict(os.environ, OPENAI_API_KEY="never-forward"),
        ):
            await (
                await ModelSDK("lmstudio/local-model").responses(
                    {
                        "input": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "input_image",
                                        "image_url": "data:image/png;base64,aGVsbG8=",
                                    }
                                ],
                            },
                            {
                                "type": "function_call",
                                "name": "SEARCH",
                                "arguments": "{}",
                                "call_id": "call1",
                            },
                            {
                                "type": "function_call_output",
                                "call_id": "call1",
                                "output": "found",
                            },
                        ]
                    }
                )
            ).completed_response()
        self.assertNotIn("authorization", requests[0].headers)
        body = json.loads(requests[0].content)
        self.assertEqual(body["messages"][0]["content"][0]["type"], "image_url")
        self.assertEqual(
            body["messages"][-1],
            {"role": "tool", "tool_call_id": "call1", "content": "found"},
        )

    async def test_incomplete_stream_is_not_success(self):
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, text='data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
                )
            )
        )
        with patch("utils.provider_transport.httpx.AsyncClient", return_value=client):
            with self.assertRaisesRegex(RuntimeError, "completion marker"):
                await (
                    await ModelSDK("ollama/local").responses({"input": "hello"})
                ).completed_response()
        self.assertTrue(client.is_closed)
