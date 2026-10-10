"""Private Composio broker for Memo's desktop gateway."""

from __future__ import annotations

import hmac
import os
from typing import Any

from composio import Composio
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field

app = FastAPI(title="Memo Composio Broker", docs_url=None, redoc_url=None)


def as_object(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return as_object(value.model_dump(mode="json"))
    if isinstance(value, dict):
        return {key: as_object(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_object(item) for item in value]
    return value


def authorize(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("MEMO_BROKER_TOKEN", "")
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid broker credentials.")


def client() -> Composio:
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Broker is not configured.")
    return Composio(api_key=key)


def user_id() -> str:
    return os.environ.get("MEMO_COMPOSIO_USER_ID", "memo-desktop")


class Scope(BaseModel):
    toolkits: list[str] = Field(default_factory=list, max_length=100)


class Execution(Scope):
    slug: str = Field(min_length=1, max_length=200)
    arguments: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/health")
def health(_: None = Depends(authorize)) -> dict[str, bool]:
    return {"configured": True}


@app.get("/api/toolkits")
def toolkits(
    search: str = Query(default="", max_length=100),
    _: None = Depends(authorize),
) -> dict[str, Any]:
    items = client().toolkits.get(
        query={
            "limit": 100,
            "sort_by": "usage",
            **({"search": search} if search else {}),
        }
    )
    return {
        "data": [
            {
                "id": item["slug"],
                "label": item["name"],
                "icon": as_object(item.get("meta", {})).get("logo")
                or f"https://logos.composio.dev/api/{item['slug']}",
            }
            for item in (as_object(value) for value in items)
        ]
    }


@app.get("/api/connections")
def connections(_: None = Depends(authorize)) -> dict[str, Any]:
    records: list[dict[str, str]] = []
    cursor = None
    seen: set[str] = set()
    while True:
        page = as_object(
            client().connected_accounts.list(
                user_ids=[user_id()],
                limit=100,
                **({"cursor": cursor} if cursor else {}),
            )
        )
        for account in page.get("items", []):
            account = as_object(account)
            if account.get("user_id") not in {None, user_id()}:
                continue
            records.append(
                {
                    "id": account["id"],
                    "toolkit": as_object(account.get("toolkit", {})).get("slug", ""),
                    "status": account.get("status", "UNKNOWN"),
                }
            )
        cursor = page.get("next_cursor")
        if not cursor or cursor in seen:
            return {"data": records}
        seen.add(cursor)


@app.delete("/api/connections/{connection_id}", status_code=204)
def disconnect(connection_id: str, _: None = Depends(authorize)) -> Response:
    owned = {item["id"] for item in connections()["data"]}
    if connection_id not in owned:
        raise HTTPException(status_code=404, detail="Connection not found.")
    client().connected_accounts.delete(nanoid=connection_id)
    return Response(status_code=204)


@app.post("/api/authorize/{toolkit}")
def connect(toolkit: str, _: None = Depends(authorize)) -> dict[str, str]:
    request = (
        client()
        .sessions.create(user_id=user_id(), toolkits=[toolkit])
        .authorize(toolkit)
    )
    if not request.redirect_url:
        raise HTTPException(
            status_code=502, detail="Composio did not provide a sign-in URL."
        )
    return {"redirect_url": request.redirect_url, "connection_id": request.id}


@app.post("/api/session")
def session(scope: Scope, _: None = Depends(authorize)) -> dict[str, Any]:
    value = client().sessions.create(
        user_id=user_id(),
        **({"toolkits": scope.toolkits} if scope.toolkits else {}),
    )
    return {"session_id": value.session_id, "tools": as_object(value.tools())}


@app.post("/api/execute")
def execute(request: Execution, _: None = Depends(authorize)) -> Any:
    session = client().sessions.create(
        user_id=user_id(),
        **({"toolkits": request.toolkits} if request.toolkits else {}),
    )
    return as_object(session.execute(request.slug, arguments=request.arguments))
