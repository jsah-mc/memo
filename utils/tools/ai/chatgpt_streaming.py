from __future__ import annotations

import json
from typing import Any

from litellm.llms.custom_httpx.http_handler import AsyncHTTPHandler


class ChatGPTStreamingHTTPHandler(AsyncHTTPHandler):
    async def post(
        self,
        url: str,
        data: dict[str, Any] | str | bytes | None = None,
        **kwargs: Any,
    ) -> Any:
        if url.rstrip("/").endswith("/codex/responses"):
            kwargs["stream"] = True
            body = kwargs.get("json")
            if isinstance(body, dict):
                kwargs["json"] = {**body, "stream": True}
            elif isinstance(data, dict):
                data = {**data, "stream": True}
            elif isinstance(data, (str, bytes)):
                decoded = json.loads(data)
                decoded["stream"] = True
                data = json.dumps(decoded)
        return await super().post(url, data=data, **kwargs)
