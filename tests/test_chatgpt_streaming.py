import json
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import httpx
from utils.gateway.sdk import ModelSDK


class DirectCodexStreamingTests(IsolatedAsyncioTestCase):
    async def test_codex_native_stream_normalizes_input_tools_and_instructions(self):
        requests = []

        def handle(request):
            requests.append(request)
            return httpx.Response(
                200,
                text='data: {"type":"response.output_text.delta","delta":"Hello"}\n\ndata: {"type":"response.completed","response":{"output":[]}}\n\n',
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with (
            patch("utils.provider_transport.httpx.AsyncClient", return_value=client),
            patch(
                "utils.provider_transport.CodexAuth.credentials",
                return_value={
                    "Authorization": "Bearer token",
                    "ChatGPT-Account-Id": "account",
                },
            ),
        ):
            stream = await ModelSDK("chatgpt/test-model").responses(
                {
                    "input": [
                        {"role": "system", "content": "Be kind"},
                        {"role": "user", "content": "hi"},
                    ],
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": "SEARCH",
                                "parameters": {"type": "object"},
                            },
                        }
                    ],
                }
            )
            result = await stream.completed_response()
        request = requests[0]
        body = json.loads(request.content)
        self.assertEqual(
            str(request.url), "https://chatgpt.com/backend-api/codex/responses"
        )
        self.assertTrue(body["stream"])
        self.assertFalse(body["store"])
        self.assertEqual(body["model"], "test-model")
        self.assertEqual(body["instructions"], "Be kind")
        self.assertEqual(body["input"], [{"role": "user", "content": "hi"}])
        self.assertEqual(body["tools"][0]["name"], "SEARCH")
        self.assertEqual(request.headers["chatgpt-account-id"], "account")
        self.assertEqual(result["output_text"], "Hello")
        self.assertTrue(client.is_closed)

    async def test_subscription_http_401_refreshes_once(self):
        tokens = []

        def handle(request):
            tokens.append(request.headers["authorization"])
            if len(tokens) == 1:
                return httpx.Response(401)
            return httpx.Response(
                200,
                text='data: {"type":"response.completed","response":{"output":[]}}\n\n',
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with (
            patch("utils.provider_transport.httpx.AsyncClient", return_value=client),
            patch(
                "utils.provider_transport.CodexAuth.credentials",
                side_effect=[
                    {"Authorization": "Bearer old"},
                    {"Authorization": "Bearer new"},
                ],
            ) as auth,
        ):
            result = await (
                await ModelSDK("chatgpt/test").responses({"input": "hi"})
            ).completed_response()
        self.assertEqual(tokens, ["Bearer old", "Bearer new"])
        self.assertTrue(auth.call_args.kwargs["force_refresh"])
        self.assertEqual(auth.call_args.kwargs["previous_token"], "old")
        self.assertEqual(result["output_text"], "")

    async def test_stream_failure_is_not_treated_as_completion(self):
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    text='data: {"type":"response.failed","response":{"error":{"message":"model failed"}}}\n\n',
                )
            )
        )
        with (
            patch("utils.provider_transport.httpx.AsyncClient", return_value=client),
            patch(
                "utils.provider_transport.CodexAuth.credentials",
                return_value={"Authorization": "Bearer token"},
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "model failed"):
                await (
                    await ModelSDK("chatgpt/test").responses({"input": "hi"})
                ).completed_response()
        self.assertTrue(client.is_closed)
