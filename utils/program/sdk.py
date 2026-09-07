"""Compatibility import for the shared AI sdk module."""

import sys

from utils.tools.ai import sdk as _shared

sys.modules[__name__] = _shared
