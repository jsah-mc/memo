"""One-time approval broker for high-risk local actions."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class PendingPermission:
    id: str
    details: dict[str, Any]
    decision: asyncio.Future[bool]


import time


class PermissionBroker:
    """Coordinate a permission prompt with one waiting tool invocation."""

    def __init__(self, timeout_seconds: float = 120.0) -> None:
        self.timeout_seconds = timeout_seconds
        self._pending: dict[str, PendingPermission] = {}
        self._session_grants: dict[str, float] = {}

    def grant_session(self, scope: str, duration_seconds: float = 300.0) -> None:
        """Grant a temporary time-bounded approval for a scope."""
        self._session_grants[scope] = time.time() + duration_seconds

    def is_session_granted(self, scope: str) -> bool:
        """Check if an active session grant exists for the scope."""
        expires = self._session_grants.get(scope)
        if expires is None:
            return False
        if time.time() > expires:
            self._session_grants.pop(scope, None)
            return False
        return True

    def revoke_session(self, scope: str) -> None:
        """Revoke a session grant."""
        self._session_grants.pop(scope, None)

    def create(self, details: dict[str, Any]) -> PendingPermission:
        permission_id = f"perm_{uuid.uuid4().hex}"
        pending = PendingPermission(
            id=permission_id,
            details=dict(details),
            decision=asyncio.get_running_loop().create_future(),
        )
        self._pending[permission_id] = pending
        return pending

    async def wait(self, permission_id: str) -> bool:
        pending = self._pending.get(permission_id)
        if pending is None:
            return False
        try:
            return await asyncio.wait_for(
                asyncio.shield(pending.decision),
                timeout=self.timeout_seconds,
            )
        except TimeoutError:
            return False
        finally:
            self._pending.pop(permission_id, None)

    def resolve(self, permission_id: str, allowed: bool) -> bool:
        pending = self._pending.get(permission_id)
        if pending is None or pending.decision.done():
            return False
        pending.decision.set_result(bool(allowed))
        return True

    def cancel_all(self) -> None:
        for pending in self._pending.values():
            if not pending.decision.done():
                pending.decision.set_result(False)
        self._pending.clear()

    @property
    def pending_ids(self) -> set[str]:
        return set(self._pending)
