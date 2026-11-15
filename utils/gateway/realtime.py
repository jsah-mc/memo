"""Google Gemini Live WebSocket proxy for real-time voice mode."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import websockets

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_LIVE_MODEL", "gemini-2.0-flash-exp")


async def proxy_realtime_websocket(client_ws: websockets.WebSocketServerProtocol) -> None:
    """Proxy a WebSocket connection to Google Gemini Live API."""
    if not GOOGLE_API_KEY:
        await client_ws.close(4001, "GOOGLE_API_KEY is required")
        return

    # Google Gemini Live WebSocket endpoint
    # Format: wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=...
    realtime_url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={GOOGLE_API_KEY}"

    try:
        async with websockets.connect(realtime_url) as server_ws:
            # Start bidirectional relay
            client_task = asyncio.create_task(
                client_to_server(client_ws, server_ws)
            )
            server_task = asyncio.create_task(
                server_to_client(server_ws, client_ws)
            )

            # Wait for either direction to close
            done, pending = await asyncio.wait(
                [client_task, server_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Cancel the other task
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    except websockets.exceptions.WebSocketException as exc:
        await client_ws.close(4002, f"WebSocket error: {exc}")
    except Exception as exc:
        await client_ws.close(4003, f"Server error: {exc}")


async def client_to_server(
    client_ws: websockets.WebSocketServerProtocol,
    server_ws: websockets.WebSocketClientProtocol,
) -> None:
    """Forward messages from client to OpenAI Realtime API."""
    try:
        async for message in client_ws:
            # Validate JSON if it's a text message
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                    # Optionally intercept/modify events here
                    message = json.dumps(data)
                except json.JSONDecodeError:
                    pass  # Forward non-JSON as-is

            await server_ws.send(message)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await server_ws.close()


async def server_to_client(
    server_ws: websockets.WebSocketClientProtocol,
    client_ws: websockets.WebSocketServerProtocol,
) -> None:
    """Forward messages from OpenAI Realtime API to client."""
    try:
        async for message in server_ws:
            # Validate JSON if it's a text message
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                    # Optionally intercept/modify events here
                    message = json.dumps(data)
                except json.JSONDecodeError:
                    pass  # Forward non-JSON as-is

            await client_ws.send(message)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await client_ws.close()
