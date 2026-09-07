"""Compatibility import for the shared AI moonkart module."""

import sys

from utils.tools.ai import moonkart as _shared

sys.modules[__name__] = _shared
