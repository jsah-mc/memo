"""Compatibility import for the shared AI settings module."""

import sys

from utils.tools.ai import settings as _shared

sys.modules[__name__] = _shared
