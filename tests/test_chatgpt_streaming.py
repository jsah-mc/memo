from __future__ import annotations

import json
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from litellm.llms.chatgpt.responses.transformation import ChatGPTResponsesAPIConfig

from utils.tools.ai.chatgpt_streaming import ChatGPTStreamingHTTPHandler
from utils.tools.ai.codex_auth import install_codex_auth_adapter
from utils.gateway.sdk import LiteLLMSDK as GatewayLiteLLMSDK


class ChatGPTStreamingHTTPHandlerTests(IsolatedAsyncioTestCase):
    async def test_gateway_codex_uses_stream_enforcing_http_client(self) -> None:
        response_stream = object()
        responses = AsyncMock(return_value=response_stream)

        with patch("litellm.aresponses", new=responses):
            stream = await GatewayLiteLLMSDK(
                "chatgpt/gpt-5.6-luna"
            ).responses({"input": "hello"})

        self.assertIs(stream.iterator, response_stream)
        self.assertTrue(responses.await_args.kwargs["stream"])
        self.assertIsInstance(
            responses.await_args.kwargs["client"],
            ChatGPTStreamingHTTPHandler,
        )

    async def test_codex_responses_always_sends_a_streaming_request(self) -> None:
        handler = ChatGPTStreamingHTTPHandler()
        post = AsyncMock(return_value="response")

        with patch(
            "litellm.llms.custom_httpx.http_handler.AsyncHTTPHandler.post",
            new=post,
        ):
            result = await handler.post(
                "https://chatgpt.com/backend-api/codex/responses",
                data=json.dumps({"model": "gpt-5.6-luna"}),
                stream=False,
            )

        self.assertEqual(result, "response")
        self.assertTrue(post.await_args.kwargs["stream"])
        body = json.loads(post.await_args.kwargs["data"])
        self.assertTrue(body["stream"])

    async def test_chatgpt_responses_never_uses_fake_streaming(self) -> None:
        install_codex_auth_adapter()

        self.assertFalse(
            ChatGPTResponsesAPIConfig().should_fake_stream(
                model="gpt-5.6-luna",
                stream=True,
                custom_llm_provider="chatgpt",
            )
        )
