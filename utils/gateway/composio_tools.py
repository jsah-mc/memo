"""Reusable Composio sessions and sanitized shared app connections."""

from __future__ import annotations

import os
import re
import threading
import time
from collections import OrderedDict
from typing import Any


def as_object(value: Any) -> dict[str, Any]:
    return value.model_dump(mode="json") if hasattr(value, "model_dump") else value


class ComposioTools:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client
        self._lock = threading.RLock()
        self._sessions: OrderedDict[tuple[str, tuple[str, ...]], tuple[float, Any]] = (
            OrderedDict()
        )

    @property
    def configured(self) -> bool:
        return self._client is not None or bool(os.environ.get("COMPOSIO_API_KEY"))

    def _get_client(self) -> Any:
        if self._client is None:
            if not self.configured:
                raise RuntimeError(
                    "Save a Composio API key in Settings to enable app integrations."
                )
            from composio import Composio

            self._client = Composio(api_key=os.environ["COMPOSIO_API_KEY"])
        return self._client

    @staticmethod
    def scope(user_id: str, toolkits: list[str]) -> tuple[str, tuple[str, ...]]:
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("Composio user identity is required.")
        if not isinstance(toolkits, list) or any(
            not isinstance(t, str)
            or not re.fullmatch(r"[a-z0-9_-]+", t.strip().lower())
            for t in toolkits
        ):
            raise ValueError("Invalid Composio toolkit names.")
        return user_id.strip(), tuple(sorted({t.strip().lower() for t in toolkits}))

    def create_session(self, user_id: str, toolkits: list[str]) -> Any:
        key = self.scope(user_id, toolkits)
        with self._lock:
            now = time.monotonic()
            cached = self._sessions.get(key)
            if cached and now - cached[0] < 900:
                self._sessions.move_to_end(key)
                return cached[1]
            session = self._get_client().sessions.create(
                user_id=key[0], **({"toolkits": list(key[1])} if key[1] else {})
            )
            self._sessions[key] = (now, session)
            self._sessions.move_to_end(key)
            while len(self._sessions) > 64:
                self._sessions.popitem(last=False)
            return session

    def invalidate(self, user_id: str) -> None:
        with self._lock:
            for key in list(self._sessions):
                if key[0] == user_id:
                    del self._sessions[key]

    def session_tools(self, user_id: str, toolkits: list[str]) -> dict[str, Any]:
        session = self.create_session(user_id, toolkits)
        return {"session_id": session.session_id, "tools": session.tools()}

    def authorize(self, user_id: str, toolkit: str) -> dict[str, str]:
        toolkit = self.scope(user_id, [toolkit])[1][0]
        request = self.create_session(user_id, [toolkit]).authorize(toolkit)
        self.invalidate(user_id)
        if not request.redirect_url:
            raise RuntimeError("Composio did not provide a sign-in URL.")
        return {"redirect_url": request.redirect_url, "connection_id": request.id}

    def execute(
        self, user_id: str, toolkits: list[str], slug: str, arguments: dict[str, Any]
    ) -> Any:
        session = self.create_session(user_id, toolkits)
        return as_object(session.execute(slug, arguments=arguments))

    def connections(self, user_id: str) -> list[dict[str, str]]:
        records = []
        cursor = None
        seen: set[str] = set()
        while True:
            page = as_object(
                self._get_client().connected_accounts.list(
                    user_ids=[user_id],
                    limit=100,
                    **({"cursor": cursor} if cursor else {}),
                )
            )
            for account in page.get("items", []):
                account = as_object(account)
                if account.get("user_id") not in {None, user_id}:
                    continue
                toolkit = as_object(account.get("toolkit", {}))
                records.append(
                    {
                        "id": account["id"],
                        "toolkit": toolkit.get("slug", ""),
                        "status": account.get("status", "UNKNOWN"),
                    }
                )
            cursor = page.get("next_cursor")
            if not cursor or cursor in seen:
                return records
            seen.add(cursor)

    def disconnect(self, user_id: str, connection_id: str) -> None:
        if not any(item["id"] == connection_id for item in self.connections(user_id)):
            raise ValueError("Connection not found for this Memo user.")
        self._get_client().connected_accounts.delete(nanoid=connection_id)
        self.invalidate(user_id)

    def toolkits(self, search: str = "") -> dict[str, Any]:
        if len(search) > 100:
            raise ValueError("App search must be 100 characters or fewer.")
        items = self._get_client().toolkits.get(
            query={
                "limit": 100,
                "sort_by": "usage",
                **({"search": search} if search else {}),
            }
        )
        items = [as_object(item) for item in items]
        return {
            "data": [
                {
                    "id": item["slug"],
                    "label": item["name"],
                    "icon": as_object(item.get("meta", {})).get("logo")
                    or f"https://logos.composio.dev/api/{item['slug']}",
                }
                for item in items
            ]
        }
