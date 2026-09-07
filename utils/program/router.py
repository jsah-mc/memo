"""Compatibility import for the shared AI router module."""

import sys

from utils.tools.ai import router as _shared

sys.modules[__name__] = _shared
