"""FastAPI surface for the LiteLLM SDK gateway."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.concurrency import iterate_in_threadpool

from utils.tools.browser import BrowserUseTool
from utils.tools.computer import (
    ComputerSandboxTool,
    detect_app_request,
    detect_computer_task,
    generic_app_request_name,
    known_folder_request,
)
from utils.tools.computer_turn import (
    computer_request_text,
    computer_tool_events,
    direct_app_events,
    direct_named_app_events,
    has_one_time_computer_approval,
)
from utils.tools.desktop import detect_desktop_control_request
from utils.tools.moonkart import MoonKartTool
from utils.tools.permissions import PermissionBroker
from utils.tools.stt import STT
from utils.tools.tts import TTS

from .access_log import QuietPathAccessLogFilter
from .browser import detect_browser_task, run_browser_tool_turn
from .chat import (
    chat_chunk,
    chat_to_responses,
    chat_usage,
    to_chat_completion,
)
from .moonkart import detect_moonkart_action, run_moonkart_tool_turn
from .router import ModelRouter
from .sdk import LiteLLMSDK
from .settings import GatewaySettings


def create_app(
    settings: GatewaySettings,
    moonkart_tool: MoonKartTool | None = None,
    browser_tool: BrowserUseTool | None = None,
    computer_tool: ComputerSandboxTool | None = None,
    permission_broker: PermissionBroker | None = None,
    stt_tool: STT | None = None,
    tts_tool: TTS | None = None,
) -> FastAPI:
    kart_tool = moonkart_tool or MoonKartTool()
    web_tool = browser_tool or BrowserUseTool()
    approvals = permission_broker or PermissionBroker()
    router = ModelRouter(
        light_model=settings.light_model,
        heavy_model=settings.heavy_model,
        vision_model=settings.vision_model,
    )
    speech_to_text = stt_tool
    text_to_speech = tts_tool
    access_logger = logging.getLogger("uvicorn.access")
    quiet_health_logs = QuietPathAccessLogFilter()

    async def dispatch_response(
        sdk: LiteLLMSDK,
        payload: dict[str, Any],
        *,
        allow_browser: bool,
        allow_computer: bool,
        interactive_permissions: bool,
    ):
        action = detect_moonkart_action(payload.get("input"))
        if action is not None:
            return await run_moonkart_tool_turn(sdk, payload, action, kart_tool)
        browser_task = (
            detect_browser_task(payload.get("input")) if allow_browser else None
        )
        if browser_task is not None:
            return await run_browser_tool_turn(sdk, payload, browser_task, web_tool)
        computer_text = computer_request_text(payload.get("input"))
        folder = known_folder_request(computer_text)
        if (
            allow_computer
            and settings.computer_enabled
            and folder is not None
            and not detect_desktop_control_request(computer_text)
        ):
            from .sdk import SDKResponseStream

            return SDKResponseStream(
                direct_named_app_events(
                    computer_tool or ComputerSandboxTool(),
                    user_text=computer_text,
                    permission_broker=approvals if interactive_permissions else None,
                    approved=has_one_time_computer_approval(payload.get("input")),
                )
            )
        app = detect_app_request(computer_text)
        if (
            allow_computer
            and settings.computer_enabled
            and app is not None
            and not detect_desktop_control_request(computer_text)
        ):
            from .sdk import SDKResponseStream

            return SDKResponseStream(
                direct_app_events(
                    computer_tool or ComputerSandboxTool(),
                    app=app,
                    user_text=computer_text,
                )
            )
        if (
            allow_computer
            and settings.computer_enabled
            and generic_app_request_name(computer_text) is not None
            and not detect_desktop_control_request(computer_text)
        ):
            from .sdk import SDKResponseStream

            return SDKResponseStream(
                direct_named_app_events(
                    computer_tool or ComputerSandboxTool(),
                    user_text=computer_text,
                    permission_broker=approvals if interactive_permissions else None,
                    approved=has_one_time_computer_approval(payload.get("input")),
                )
            )
        if (
            allow_computer
            and settings.computer_enabled
            and detect_computer_task(computer_text)
        ):
            from .sdk import SDKResponseStream

            return SDKResponseStream(
                computer_tool_events(
                    sdk,
                    payload,
                    computer_tool or ComputerSandboxTool(),
                    approvals if interactive_permissions else None,
                )
            )
        return await sdk.responses(payload)

    async def start_response(
        payload: dict[str, Any],
        *,
        allow_browser: bool = True,
        allow_computer: bool = False,
        interactive_permissions: bool = False,
    ):
        route = router.route(payload)

        routed_payload = dict(payload)
        if route.reasoning_effort and "reasoning" not in routed_payload:
            routed_payload["reasoning"] = {"effort": route.reasoning_effort}

        assert route.model is not None
        try:
            return await dispatch_response(
                LiteLLMSDK(route.model, api_base=settings.upstream_api_base),
                routed_payload,
                allow_browser=allow_browser,
                allow_computer=allow_computer,
                interactive_permissions=interactive_permissions,
            )
        except Exception:
            if not route.fallback_model or route.fallback_model == route.model:
                raise
            logging.getLogger("memo.router").warning(
                "Model route %s failed for %s; falling back to %s",
                route.kind,
                route.model,
                route.fallback_model,
            )
            return await dispatch_response(
                LiteLLMSDK(
                    route.fallback_model,
                    api_base=settings.upstream_api_base,
                ),
                routed_payload,
                allow_browser=allow_browser,
                allow_computer=allow_computer,
                interactive_permissions=interactive_permissions,
            )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        nonlocal speech_to_text
        access_logger.addFilter(quiet_health_logs)
        warmup_task: asyncio.Task[None] | None = None

        async def warm_speech_model() -> None:
            nonlocal speech_to_text
            try:
                if speech_to_text is None:
                    speech_to_text = STT()
                prepare = getattr(speech_to_text, "prepare", None)
                if callable(prepare):
                    await asyncio.to_thread(prepare)
            except Exception:
                logging.getLogger("memo.stt").warning(
                    "Background speech model warmup failed.",
                    exc_info=True,
                )

        if os.environ.get("MEMO_STT_PRELOAD", "0") == "1":
            warmup_task = asyncio.create_task(warm_speech_model())
        try:
            yield
        finally:
            if warmup_task is not None and not warmup_task.done():
                warmup_task.cancel()
            approvals.cancel_all()
            try:
                await kart_tool.close()
            finally:
                access_logger.removeFilter(quiet_health_logs)

    app = FastAPI(title="Memo Gateway", version="0.1.0", lifespan=lifespan)

    @app.get("/health/liveliness")
    async def liveliness() -> dict[str, Any]:
        return {
            "status": "ok",
            "memo_api_version": 2,
            "desktop_control": settings.computer_enabled,
        }

    @app.get("/v1/models")
    async def models() -> dict[str, Any]:
        return {
            "object": "list",
            "data": [
                {
                    "id": settings.model_alias,
                    "object": "model",
                    "created": int(time.time()),
                    "owned_by": "memo",
                }
            ],
        }

    @app.post("/v1/permissions/{permission_id}")
    async def resolve_permission(
        permission_id: str,
        request: Request,
    ) -> dict[str, bool]:
        if (
            request.headers.get("x-memo-desktop") != "1"
            or request.headers.get("x-memo-computer-tools") != "1"
        ):
            raise HTTPException(status_code=403, detail="Permission resolution denied.")
        try:
            payload = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON body.") from exc
        if not isinstance(payload, dict) or not isinstance(
            payload.get("allowed"), bool
        ):
            raise HTTPException(
                status_code=400,
                detail="The allowed field must be a boolean.",
            )
        if not approvals.resolve(permission_id, payload["allowed"]):
            raise HTTPException(
                status_code=404,
                detail="Permission request is no longer pending.",
            )
        return {"resolved": True, "allowed": payload["allowed"]}

    @app.post("/v1/images/generations")
    async def image_generations() -> None:
        raise HTTPException(
            status_code=501,
            detail=(
                "Image generation is not configured. Image attachments for "
                "vision requests remain supported."
            ),
        )

    @app.post("/v1/audio/transcriptions")
    async def audio_transcriptions(
        file: UploadFile = File(...),
        model: str = Form("whisper-1"),
    ) -> dict[str, Any]:
        nonlocal speech_to_text
        if model not in {
            "realtimestt",
            "faster-whisper",
            "small.en",
            "whisper-1",
            "whisper-small",
            "small",
            "ink-whisper",
        }:
            raise HTTPException(status_code=400, detail="Unsupported STT model.")

        suffix = Path(file.filename or "recording.webm").suffix or ".webm"
        handle, temporary_name = tempfile.mkstemp(prefix="memo-stt-", suffix=suffix)
        path = Path(temporary_name)
        try:
            total = 0
            with os.fdopen(handle, "wb") as output:
                while chunk := await file.read(1024 * 1024):
                    total += len(chunk)
                    if total > 25 * 1024 * 1024:
                        raise HTTPException(
                            status_code=413,
                            detail="Audio file exceeds the 25 MB limit.",
                        )
                    output.write(chunk)
            if total == 0:
                raise HTTPException(status_code=400, detail="Audio file is empty.")

            if speech_to_text is None:
                speech_to_text = STT()
            result = await run_in_threadpool(speech_to_text.transcribe, path)
            return {
                "text": result["transcript"],
                "language": result.get("language_code"),
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Speech transcription failed: {exc}",
            ) from exc
        finally:
            await file.close()
            path.unlink(missing_ok=True)

    @app.post("/v1/audio/transcriptions/prepare")
    async def prepare_audio_transcriptions() -> dict[str, Any]:
        nonlocal speech_to_text
        if speech_to_text is None:
            speech_to_text = STT()
        prepare = getattr(speech_to_text, "prepare", None)
        if not callable(prepare):
            return {"ready": True}
        try:
            result = await run_in_threadpool(prepare)
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Speech model preparation failed: {exc}",
            ) from exc
        return result if isinstance(result, dict) else {"ready": True}

    @app.post("/v1/audio/speech")
    async def audio_speech(request: Request) -> Response:
        nonlocal text_to_speech
        try:
            payload = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON body.") from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object.")

        text = payload.get("input")
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(
                status_code=400,
                detail="The input field must contain text.",
            )
        requested_format = payload.get("response_format")
        if requested_format is not None and requested_format not in {"mp3", "wav"}:
            raise HTTPException(
                status_code=400,
                detail="Only mp3 and wav response formats are supported.",
            )

        try:
            if text_to_speech is None:
                text_to_speech = TTS()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Speech synthesis failed: {exc}",
            ) from exc
        actual_format = getattr(
            text_to_speech,
            "response_format",
            requested_format or "mp3",
        )
        response_format = requested_format or actual_format
        if actual_format != response_format:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"The configured TTS engine outputs {actual_format}; "
                    f"request response_format={actual_format}."
                ),
            )

        async def audio_stream() -> AsyncIterator[bytes]:
            iterator = text_to_speech.stream(text)
            try:
                async for chunk in iterate_in_threadpool(iterator):
                    if await request.is_disconnected():
                        break
                    yield chunk
            finally:
                close = getattr(iterator, "close", None)
                if callable(close):
                    await run_in_threadpool(close)

        return StreamingResponse(
            audio_stream(),
            media_type=("audio/wav" if response_format == "wav" else "audio/mpeg"),
            headers={
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/v1/responses")
    async def responses(request: Request):
        try:
            payload = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON body.") from exc

        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object.")
        if payload.get("model", settings.model_alias) != settings.model_alias:
            raise HTTPException(status_code=404, detail="Unknown model.")

        wants_stream = payload.get("stream") is True
        try:
            sdk_stream = await start_response(
                payload,
                allow_browser=request.headers.get("x-memo-internal-browser") != "1",
                allow_computer=request.headers.get("x-memo-computer-tools") == "1",
                interactive_permissions=wants_stream,
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=502, detail=f"Upstream model request failed: {exc}"
            ) from exc

        if not wants_stream:
            try:
                return JSONResponse(await sdk_stream.completed_response())
            except Exception as exc:
                raise HTTPException(
                    status_code=502, detail=f"Upstream stream failed: {exc}"
                ) from exc

        async def event_stream() -> AsyncIterator[str]:
            try:
                async for event in sdk_stream.events():
                    data = json.dumps(event, separators=(",", ":"))
                    yield f"data: {data}\n\n"
            except Exception as exc:
                error = {
                    "type": "error",
                    "error": {"message": f"Upstream stream failed: {exc}"},
                }
                yield f"data: {json.dumps(error, separators=(',', ':'))}\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/v1/chat/completions")
    async def chat_completions(request: Request):
        try:
            payload = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON body.") from exc

        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object.")
        if payload.get("model", settings.model_alias) != settings.model_alias:
            raise HTTPException(status_code=404, detail="Unknown model.")

        wants_stream = payload.get("stream") is True
        responses_payload = chat_to_responses(payload)
        try:
            sdk_stream = await start_response(
                responses_payload,
                allow_browser=request.headers.get("x-memo-internal-browser") != "1",
                allow_computer=request.headers.get("x-memo-computer-tools") == "1",
                interactive_permissions=wants_stream,
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=502, detail=f"Upstream model request failed: {exc}"
            ) from exc

        request_id = f"chatcmpl_{uuid.uuid4().hex}"
        if not wants_stream:
            try:
                completed = await sdk_stream.completed_response()
                return JSONResponse(
                    to_chat_completion(completed, settings.model_alias, request_id)
                )
            except Exception as exc:
                raise HTTPException(
                    status_code=502, detail=f"Upstream stream failed: {exc}"
                ) from exc

        include_usage = bool(payload.get("stream_options", {}).get("include_usage"))
        show_tool_events = request.headers.get("x-memo-desktop") == "1"

        async def chat_event_stream() -> AsyncIterator[str]:
            role_chunk = chat_chunk(
                request_id,
                settings.model_alias,
                delta={"role": "assistant", "content": ""},
            )
            yield f"data: {json.dumps(role_chunk, separators=(',', ':'))}\n\n"
            try:
                async for event in sdk_stream.events():
                    event_type = event.get("type")
                    if show_tool_events and event_type in {
                        "memo.tool_call.started",
                        "memo.tool_call.completed",
                    }:
                        tool_event = {
                            "object": "memo.tool_call",
                            "tool_call": event.get("tool_call", {}),
                        }
                        yield f"data: {json.dumps(tool_event, separators=(',', ':'))}\n\n"
                    elif show_tool_events and event_type == "memo.permission.requested":
                        permission_event = {
                            "object": "memo.permission_request",
                            "permission": event.get("permission", {}),
                        }
                        yield f"data: {json.dumps(permission_event, separators=(',', ':'))}\n\n"
                    elif show_tool_events and event_type == "memo.image.generated":
                        image_event = {
                            "object": "memo.image",
                            "image": event.get("image", {}),
                        }
                        yield f"data: {json.dumps(image_event, separators=(',', ':'))}\n\n"
                    elif event_type == "response.output_text.delta":
                        delta = event.get("delta", "")
                        chunk = chat_chunk(
                            request_id,
                            settings.model_alias,
                            delta={"content": delta},
                        )
                        yield f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n"
                    elif event_type == "response.completed":
                        final_chunk = chat_chunk(
                            request_id,
                            settings.model_alias,
                            delta={},
                            finish_reason="stop",
                        )
                        yield f"data: {json.dumps(final_chunk, separators=(',', ':'))}\n\n"
                        if include_usage:
                            response = event.get("response", {})
                            usage_chunk = chat_chunk(
                                request_id, settings.model_alias, delta={}
                            )
                            usage_chunk["choices"] = []
                            usage_chunk["usage"] = chat_usage(response)
                            yield f"data: {json.dumps(usage_chunk, separators=(',', ':'))}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as exc:
                error = {
                    "error": {
                        "message": f"Upstream stream failed: {exc}",
                        "type": "server_error",
                        "param": None,
                        "code": None,
                    }
                }
                yield f"data: {json.dumps(error, separators=(',', ':'))}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            chat_event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app
