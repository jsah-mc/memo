import logging
from unittest import TestCase

from utils.gateway.access_log import QuietPathAccessLogFilter


def access_record(path: str) -> logging.LogRecord:
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("127.0.0.1:1234", "GET", path, "1.1", 200),
        exc_info=None,
    )


class QuietPathAccessLogFilterTests(TestCase):
    def test_hides_liveliness_requests_with_or_without_query(self) -> None:
        quiet_filter = QuietPathAccessLogFilter()

        self.assertFalse(quiet_filter.filter(access_record("/health/liveliness")))
        self.assertFalse(
            quiet_filter.filter(access_record("/health/liveliness?probe=true"))
        )

    def test_keeps_other_access_and_unstructured_records(self) -> None:
        quiet_filter = QuietPathAccessLogFilter()
        ordinary = logging.LogRecord(
            "uvicorn.access", logging.INFO, __file__, 1, "Server ready", (), None
        )

        self.assertTrue(quiet_filter.filter(access_record("/v1/models")))
        self.assertTrue(quiet_filter.filter(ordinary))
