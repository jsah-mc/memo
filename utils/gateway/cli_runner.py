"""Headless CLI runners for agent backends the gateway does not proxy directly.

When an agent's ``cli`` is a backend with a runner (currently ``opencode``),
requests are executed by spawning the CLI instead of the provider transport —
the same model ids the CLI itself reports are passed through verbatim.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from utils.gateway.cli_backends import CLI_BACKENDS, executable_search_path
from utils.gateway.sdk import SDKResponseStream
from utils.model_sdk import _responses_input_to_messages

RUNNER_BACKENDS = {"opencode"}

DEFAULT_TIMEOUT_S = 300


def _backend(backend_id: str):
    for backend in CLI_BACKENDS:
        if backend.id == backend_id:
            return backend
    return None


def _prompt_text(payload: dict[str, Any]) -> str:
    messages = _responses_input_to_messages(
        payload.get("input"), payload.get("instructions")
    )
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role") or "user")
        content = message.get("content")
        if isinstance(content, list):
            text = "\n".join(
                str(part.get("text", ""))
                for part in content
                if isinstance(part, dict)
            )
        else:
            text = str(content or "")
        if text.strip():
            parts.append(f"{role}: {text}")
    return "\n\n".join(parts)


def _opencode_args(model: str | None, prompt: str) -> list[str]:
    args = ["run", "--auto", "--format", "json"]
    if model:
        args += ["--model", model]
    args.append(prompt)
    return args


_COMMANDS = {"opencode": _opencode_args}


async def _read_stderr(proc: asyncio.subprocess.Process) -> str:
    if proc.stderr is None:
        return ""
    data = await proc.stderr.read()
    return data.decode("utf-8", "replace")


def _mcp_server_command() -> list[str]:
    script = Path(__file__).resolve().parent.parent / "mcp_server.py"
    return [sys.executable, str(script)]


def _opencode_env(agent: dict[str, Any] | None) -> dict[str, str]:
    """Expose Memo's tools to OpenCode through the local MCP server."""
    env = dict(os.environ)
    agent = agent if isinstance(agent, dict) else {}
    allowed = agent.get("allowedTools")
    groups = (
        [str(item) for item in allowed]
        if isinstance(allowed, list) and allowed
        else ["browser", "computer", "integrations"]
    )
    env["MEMO_MCP_TOOLS"] = ",".join(groups)

    user_id = agent.get("composioUserId")
    if isinstance(user_id, str) and user_id.strip():
        env["MEMO_MCP_COMPOSIO_USER"] = user_id.strip()
        toolkits = agent.get("composioToolkits")
        if isinstance(toolkits, list):
            env["MEMO_MCP_COMPOSIO_TOOLKITS"] = ",".join(
                str(item).strip().lower()
                for item in toolkits
                if str(item).strip()
            )
        allowed_tools = agent.get("allowedComposioTools")
        if isinstance(allowed_tools, list):
            env["MEMO_MCP_COMPOSIO_ALLOWED"] = ",".join(
                str(item).strip() for item in allowed_tools if str(item).strip()
            )

    config = {
        "mcp": {
            "servers": {
                "memo": {
                    "type": "local",
                    "command": _mcp_server_command(),
                    "enabled": True,
                }
            }
        }
    }
    env["OPENCODE_CONFIG_CONTENT"] = json.dumps(config)
    return env


class CLISDK:
    """Drop-in replacement for ModelSDK that runs the agent's CLI."""

    def __init__(
        self,
        backend_id: str,
        model: str | None = None,
        agent: dict[str, Any] | None = None,
    ):
        self.backend_id = backend_id
        self.model = model
        self.agent = agent

    async def responses(self, payload: dict[str, Any]) -> SDKResponseStream:
        backend = _backend(self.backend_id)
        if backend is None:
            raise RuntimeError(f"Unknown CLI backend: {self.backend_id}")
        executable = backend.resolved_executable
        if executable is None:
            raise RuntimeError(
                f"{backend.label} is not installed. {backend.install_command}"
            )
        build = _COMMANDS.get(self.backend_id)
        if build is None:
            raise RuntimeError(f"No headless runner for {backend.label}.")

        prompt = _prompt_text(payload)
        if not prompt.strip():
            raise RuntimeError("Empty prompt for CLI backend.")

        argv = [executable, *build(self.model, prompt)]
        env = (
            _opencode_env(self.agent)
            if self.backend_id == "opencode"
            else dict(os.environ)
        )
        timeout = float(os.environ.get("MEMO_CLI_TIMEOUT_S", DEFAULT_TIMEOUT_S))
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except OSError as exc:
            raise RuntimeError(f"Could not launch {backend.label}: {exc}") from exc

        stderr_task = asyncio.create_task(_read_stderr(proc))
        return SDKResponseStream(self._events(proc, stderr_task, timeout))

    async def _events(
        self,
        proc: asyncio.subprocess.Process,
        stderr_task: asyncio.Task[str],
        timeout: float,
    ) -> AsyncIterator[dict[str, Any]]:
        response_id = f"resp_{uuid.uuid4().hex}"
        text_parts: list[str] = []
        saw_json = False

        async def drain() -> AsyncIterator[dict[str, Any]]:
            nonlocal saw_json
            assert proc.stdout is not None
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    return
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, dict):
                    continue
                saw_json = True
                part = event.get("part")
                if event.get("type") == "text" and isinstance(part, dict):
                    delta = part.get("text")
                    if isinstance(delta, str) and delta:
                        text_parts.append(delta)
                        yield {
                            "type": "response.output_text.delta",
                            "delta": delta,
                        }

        try:
            async with asyncio.timeout(timeout):
                async for event in drain():
                    yield event
                await proc.wait()
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(
                f"{self.backend_id} timed out after {int(timeout)}s."
            ) from None
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

        stderr = await stderr_task
        if proc.returncode != 0:
            detail = stderr.strip()[-500:] or f"exit code {proc.returncode}"
            raise RuntimeError(f"{self.backend_id} failed: {detail}")

        text = "".join(text_parts)
        if not text.strip() and not saw_json:
            raise RuntimeError(
                f"{self.backend_id} produced no output. {stderr.strip()[-300:]}"
            )

        response = {
            "id": response_id,
            "object": "response",
            "status": "completed",
            "output": [
                {
                    "id": f"msg_{uuid.uuid4().hex}",
                    "type": "message",
                    "status": "completed",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": text,
                            "annotations": [],
                        }
                    ],
                }
            ],
            "output_text": text,
            "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
        }
        yield {"type": "response.completed", "response": response}

    async def completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        stream = await self.responses(payload)
        return await stream.completed_response()
