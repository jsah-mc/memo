"""Shared AI runtime for the gateway, program, and messaging integrations."""

from .runtime import ProgramAI
from .settings import ProgramSettings

AI = ProgramAI
AISettings = ProgramSettings

__all__ = ["AI", "AISettings", "ProgramAI", "ProgramSettings"]
