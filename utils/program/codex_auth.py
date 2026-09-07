"""Compatibility import for the shared AI codex_auth module."""

import sys

from utils.tools.ai import codex_auth as _shared

sys.modules[__name__] = _shared
