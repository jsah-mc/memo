"""Selective Uvicorn access-log filtering."""

from __future__ import annotations

import logging
from typing import Any

QUIET_PATHS = frozenset({"/health/liveliness"})


class QuietPathAccessLogFilter(logging.Filter):
    """Hide access records for configured paths while retaining all other logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        args: Any = record.args
        if not isinstance(args, tuple) or len(args) < 3:
            return True

        path = args[2]
        if not isinstance(path, str):
            return True
        return path.partition("?")[0] not in QUIET_PATHS
