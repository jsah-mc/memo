"""Compatibility import for the shared AI runtime module."""

import sys

from utils.tools.ai import runtime as _shared

sys.modules[__name__] = _shared
