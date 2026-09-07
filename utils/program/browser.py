"""Compatibility import for the shared AI browser module."""

import sys

from utils.tools.ai import browser as _shared

sys.modules[__name__] = _shared
