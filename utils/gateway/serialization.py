"""Serialization helpers for direct provider SDK response objects."""

from __future__ import annotations

import warnings
from typing import Any


def as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Pydantic serializer warnings:.*")
            return value.model_dump(mode="json", exclude_none=True)
    raise TypeError(f"Unsupported direct provider response type: {type(value).__name__}")
