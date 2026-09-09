"""Lazy Composio session adapter; credentials never cross into the renderer."""

from __future__ import annotations

import os
from typing import Any


class ComposioTools:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    @property
    def configured(self) -> bool:
        return self._client is not None or bool(os.environ.get("COMPOSIO_API_KEY"))

    def _get_client(self) -> Any:
        if self._client is None:
            if not self.configured:
                raise RuntimeError("Set COMPOSIO_API_KEY to enable Composio tools")
            from composio import Composio

            self._client = Composio(api_key=os.environ["COMPOSIO_API_KEY"])
        return self._client

    def create_session(self, user_id: str, toolkits: list[str]) -> Any:
        return self._get_client().sessions.create(
            user_id=user_id,
            **({"toolkits": toolkits} if toolkits else {}),
        )

    def session_tools(self, user_id: str, toolkits: list[str]) -> dict[str, Any]:
        session = self.create_session(user_id, toolkits)
        return {"session_id": session.session_id, "tools": session.tools()}

    def authorize(self, user_id: str, toolkit: str) -> dict[str, str]:
        session = self.create_session(user_id, [toolkit])
        request = session.authorize(toolkit)
        return {"redirect_url": request.redirect_url}

    def execute(
        self, user_id: str, toolkits: list[str], slug: str, arguments: dict[str, Any]
    ) -> Any:
        session = self.create_session(user_id, toolkits)
        result = session.execute(slug, arguments)
        if hasattr(result, "model_dump"):
            return result.model_dump()
        return result
