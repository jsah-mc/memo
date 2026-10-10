"""Persistent agent profiles owned by the Memo gateway."""

from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path
from typing import Any

from .cli_backends import validate_agent_config

DEFAULT_AGENT: dict[str, Any] = {
    "id": "memo",
    "name": "Memo",
    "role": "General assistant",
    "instructions": (
        "You are Memo, a capable general assistant. Be concise, practical, "
        "and transparent."
    ),
    "cli": "codex",
    "model": "gpt-5.6-luna",
    "color": "var(--primary)",
    "composioEnabled": False,
    "composioUserId": "",
    "composioToolkits": [],
    "computerTarget": "host",
    "builtIn": True,
}


class AgentStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._lock = threading.RLock()
        self._agents = self._load()

    def _load(self) -> list[dict[str, Any]]:
        if self._path is None or not self._path.exists():
            return []
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(payload, list):
            return []
        agents: list[dict[str, Any]] = []
        for value in payload:
            try:
                agents.append(self.validate(value, require_id=True))
            except ValueError:
                continue
        return [agent for agent in agents if agent["id"] != DEFAULT_AGENT["id"]]

    def _save(self) -> None:
        if self._path is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_suffix(f"{self._path.suffix}.tmp")
        temporary.write_text(json.dumps(self._agents, indent=2), encoding="utf-8")
        temporary.replace(self._path)

    @staticmethod
    def validate(value: object, *, require_id: bool = False) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Agent must be an object")
        required = ("name", "role", "instructions", "color")
        result: dict[str, Any] = {}
        for field in required:
            item = value.get(field)
            if not isinstance(item, str) or not item.strip():
                raise ValueError(f"Agent {field} must be a non-empty string")
            result[field] = item.strip()
        backend, model = validate_agent_config(value)
        result.update(cli=backend.id, model=model)
        for field, default in (
            ("description", result["role"]),
            ("style", "balanced"),
            ("soul", result["instructions"]),
        ):
            item = value.get(field, default)
            if not isinstance(item, str) or not item.strip():
                raise ValueError(f"Agent {field} must be a non-empty string")
            result[field] = item.strip()
        composio_enabled = value.get("composioEnabled", False)
        if not isinstance(composio_enabled, bool):
            raise ValueError("Agent composioEnabled must be a boolean")
        composio_user_id = value.get("composioUserId", "")
        if not isinstance(composio_user_id, str):
            raise ValueError("Agent composioUserId must be a string")
        raw_toolkits = value.get("composioToolkits", [])
        if not isinstance(raw_toolkits, list) or not all(
            isinstance(item, str) and item.strip() for item in raw_toolkits
        ):
            raise ValueError("Agent composioToolkits must be a list of names")
        result.update(
            composioEnabled=composio_enabled,
            composioUserId=composio_user_id.strip(),
            composioToolkits=[item.strip().lower() for item in raw_toolkits],
        )
        computer_target = value.get("computerTarget", "host")
        if computer_target == "virtual":
            computer_target = "local_vm"
        if computer_target not in {"host", "local_vm", "vps"}:
            raise ValueError("Agent computerTarget must be host, local_vm, or vps")
        result["computerTarget"] = computer_target
        agent_id = value.get("id")
        if agent_id is not None and (
            not isinstance(agent_id, str) or not agent_id.strip()
        ):
            raise ValueError("Agent id must be a non-empty string")
        if require_id and (not isinstance(agent_id, str) or not agent_id.strip()):
            raise ValueError("Agent id must be a non-empty string")
        result["id"] = (
            agent_id.strip() if isinstance(agent_id, str) else str(uuid.uuid4())
        )
        return result

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(agent) for agent in self._agents]

    def create(self, value: object) -> dict[str, Any]:
        agent = self.validate(value)
        with self._lock:
            if agent["id"] == DEFAULT_AGENT["id"]:
                raise ValueError("The reserved Memo profile cannot be created")
            existing = next(
                (item for item in self._agents if item["id"] == agent["id"]), None
            )
            if existing is not None:
                if existing == agent:
                    return dict(existing)
                raise ValueError("An agent with this id already exists")
            self._agents.append(agent)
            self._save()
        return dict(agent)

    def delete(self, agent_id: str) -> bool:
        if agent_id == DEFAULT_AGENT["id"]:
            raise ValueError("The built-in Memo agent cannot be deleted")
        with self._lock:
            remaining = [agent for agent in self._agents if agent["id"] != agent_id]
            if len(remaining) == len(self._agents):
                return False
            self._agents = remaining
            self._save()
            return True

    def update(self, agent_id: str, value: object) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Agent update must be an object")
        with self._lock:
            existing = next(
                (item for item in self._agents if item["id"] == agent_id), None
            )
            if existing is None:
                raise KeyError(agent_id)
            updated = self.validate(
                {**existing, **value, "id": agent_id}, require_id=True
            )
            self._agents = [
                updated if item["id"] == agent_id else item for item in self._agents
            ]
            self._save()
            return dict(updated)
