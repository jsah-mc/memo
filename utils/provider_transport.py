"""Direct HTTP transport for Codex and OpenAI-compatible providers."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx

from utils.codex_auth import CodexAuth

# Each provider has its own credential; never forward another provider's key.
PROVIDERS = {
    "anthropic": ("https://api.anthropic.com/v1", "ANTHROPIC_API_KEY"),
    "openai": ("https://api.openai.com/v1", "OPENAI_API_KEY"),
    "vercel": ("https://gateway.ai.vercel.sh/v1", "VERCEL_GATEWAY_API_KEY"),
    "google": ("https://generativelanguage.googleapis.com/v1beta", "GOOGLE_API_KEY"),
    "ollama": ("http://127.0.0.1:11434/v1", None),
    "lmstudio": ("http://127.0.0.1:1234/v1", None),
    "minimax": ("https://api.minimax.io/v1", "MINIMAX_API_KEY"),
    "xai": ("https://api.x.ai/v1", "XAI_API_KEY"),
    "groq": ("https://api.groq.com/openai/v1", "GROQ_API_KEY"),
    "openrouter": ("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY"),
}


def decode_event(payload: str) -> dict[str, Any]:
    event = json.loads(payload)
    if not isinstance(event, dict):
        raise RuntimeError("Provider returned an invalid stream event.")
    if event.get("error") or event.get("type") in {"error", "response.failed"}:
        error = event.get("error") or (event.get("response") or {}).get("error") or {}
        message = (
            error.get("message", "Provider stream failed.")
            if isinstance(error, dict)
            else str(error)
        )
        raise RuntimeError(message)
    return event


async def sse_events(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    data: list[str] = []
    async for line in response.aiter_lines():
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif not line and data:
            payload = "\n".join(data)
            data = []
            if payload == "[DONE]":
                return
            yield decode_event(payload)
    if data:
        payload = "\n".join(data)
        if payload != "[DONE]":
            yield decode_event(payload)


class ProviderTransport:
    def __init__(self, model: str, *, api_base: str | None = None):
        self.provider, _, self.model = model.partition("/")
        if not self.model:
            self.provider, self.model = "openai", model
        self.api_base = api_base

    async def _headers(self) -> dict[str, str]:
        if self.provider == "chatgpt":
            return await asyncio.to_thread(CodexAuth().credentials)
        if self.provider == "google":
            key = os.environ.get("GOOGLE_API_KEY")
            if not key:
                raise RuntimeError("GOOGLE_API_KEY is required to use google provider.")
            return {"x-goog-api-key": key}
        if self.provider not in PROVIDERS:
            raise ValueError(
                f"Unsupported direct provider: {self.provider}. Use chatgpt, anthropic, openai, vercel, google, ollama, lmstudio, minimax, xai, groq, or openrouter."
            )
        key_name = PROVIDERS[self.provider][1]
        key = os.environ.get(key_name, "") if key_name else ""
        if key_name and not key:
            raise RuntimeError(f"Set {key_name} to use {self.provider}.")
        if self.provider == "anthropic":
            return {"x-api-key": key, "anthropic-version": "2023-06-01"}
        return {"Authorization": f"Bearer {key}"} if key else {}

    async def _request(
        self, body: dict[str, Any], *, responses: bool = False, stream: bool = False
    ):
        headers = await self._headers()
        if self.provider == "chatgpt":
            base = (
                self.api_base
                or os.environ.get("CHATGPT_API_BASE")
                or "https://chatgpt.com/backend-api/codex"
            )
        else:
            base = (
                self.api_base
                or os.environ.get(f"{self.provider.upper()}_API_BASE")
                or PROVIDERS[self.provider][0]
            )
        if self.provider == "anthropic":
            from utils.anthropic_transport import request_body

            body = request_body(body)
        url = base.rstrip("/") + (
            "/messages"
            if self.provider == "anthropic"
            else "/responses" if responses
            else f"/v1beta/models/{self.model}:streamGenerateContent" if self.provider == "google" and stream
            else f"/v1beta/models/{self.model}:generateContent" if self.provider == "google"
            else "/chat/completions"
        )
        body = {
            key: value
            for key, value in body.items()
            if key not in {"timeout", "api_base"}
        }
        if self.provider == "google":
            # Basic mapping for Google API
            # Google uses "contents" with "role" and "parts"
            messages = body.get("messages", [])
            google_contents = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if isinstance(content, str):
                    google_contents.append({"role": role, "parts": [{"text": content}]})
                elif isinstance(content, list):
                    parts = []
                    for part in content:
                        if isinstance(part, dict) and "text" in part:
                            parts.append({"text": part["text"]})
                    google_contents.append({"role": role, "parts": parts})
            
            body = {
                "contents": google_contents,
                "generationConfig": {
                    "temperature": body.get("temperature"),
                    "topP": body.get("top_p"),
                    "maxOutputTokens": body.get("max_tokens"),
                },
            }
        else:
            body.update(model=self.model, stream=stream)
        client = httpx.AsyncClient(timeout=httpx.Timeout(90, connect=30))
        try:
            response = await client.send(
                client.build_request("POST", url, json=body, headers=headers),
                stream=stream,
            )
            if response.status_code == 401 and self.provider == "chatgpt":
                await response.aclose()
                headers = await asyncio.to_thread(
                    CodexAuth().credentials,
                    force_refresh=True,
                    previous_token=headers["Authorization"][7:],
                )
                response = await client.send(
                    client.build_request("POST", url, json=body, headers=headers),
                    stream=stream,
                )
            if response.is_error:
                await response.aread()
                raise RuntimeError(
                    f"{self.provider} request failed (HTTP {response.status_code}). Check the provider login, model and API URL."
                )
            if not stream:
                result = response.json()
                if self.provider == "anthropic":
                    from utils.anthropic_transport import completion

                    result = completion(result)
                elif self.provider == "google":
                    # Convert Google format to OpenAI-compatible
                    if "candidates" in result and result["candidates"]:
                        candidate = result["candidates"][0]
                        if "content" in candidate and "parts" in candidate["content"]:
                            parts = candidate["content"]["parts"]
                            text = " ".join(p.get("text", "") for p in parts if "text" in p)
                            result = {"choices": [{"message": {"content": text}}]}
                await response.aclose()
                await client.aclose()
                return result
        except BaseException:
            await client.aclose()
            raise

        async def events():
            try:
                source = sse_events(response)
                if self.provider == "anthropic":
                    from utils.anthropic_transport import chat_chunks

                    source = chat_chunks(source)
                elif self.provider == "google":
                    # Google's streaming returns server-sent events with candidates
                    async for event in source:
                        if "candidates" in event and event["candidates"]:
                            candidate = event["candidates"][0]
                            if "content" in candidate and "parts" in candidate["content"]:
                                parts = candidate["content"]["parts"]
                                text = " ".join(p.get("text", "") for p in parts if "text" in p)
                                if text:
                                    yield {"choices": [{"delta": {"content": text}}]}
                else:
                    async for event in source:
                        yield event
            finally:
                await response.aclose()
                await client.aclose()

        return events()

    async def responses(self, body: dict[str, Any]):
        body = dict(body)
        # Codex requires native streaming, store=false and instructions outside input.
        body["store"] = False
        system = [body.get("instructions", "")]
        items = []
        for item in body.get("input", []):
            if isinstance(item, dict) and item.get("role") in {"system", "developer"}:
                content = item.get("content", "")
                system.append(
                    content
                    if isinstance(content, str)
                    else "\n".join(
                        p.get("text", "") for p in content if isinstance(p, dict)
                    )
                )
            else:
                items.append(item)
        body["input"] = items
        body["instructions"] = (
            "\n\n".join(s for s in system if s) or "You are a helpful assistant."
        )
        if "tools" in body:
            body["tools"] = [
                (
                    {"type": "function", **tool["function"]}
                    if isinstance(tool, dict) and isinstance(tool.get("function"), dict)
                    else tool
                )
                for tool in body["tools"]
            ]
        if isinstance(body.get("tool_choice"), dict) and isinstance(
            body["tool_choice"].get("function"), dict
        ):
            body["tool_choice"] = {
                "type": "function",
                **body["tool_choice"]["function"],
            }
        # Subscription Codex does not accept these Chat Completions controls.
        for key in ("max_output_tokens", "temperature", "top_p", "background", "user"):
            body.pop(key, None)
        return await self._request(body, responses=True, stream=True)

    async def completion(self, body: dict[str, Any]):
        if self.provider == "chatgpt":
            raise ValueError(
                "Codex uses the Responses API; call responses() instead of completion()."
            )
        return await self._request(body)

    async def completion_stream(self, body: dict[str, Any]):
        return await self._request(body, stream=True)
