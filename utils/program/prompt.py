"""Compatibility import for the shared AI prompt module."""

import sys

from utils.tools.ai import prompt as _shared

sys.modules[__name__] = _shared
