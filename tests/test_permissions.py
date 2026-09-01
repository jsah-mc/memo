import time
import unittest
from utils.tools.permissions import PermissionBroker


class TestPermissions(unittest.TestCase):
    def test_session_grants(self):
        broker = PermissionBroker()
        self.assertFalse(broker.is_session_granted("shell"))

        broker.grant_session("shell", duration_seconds=1.0)
        self.assertTrue(broker.is_session_granted("shell"))

        broker.revoke_session("shell")
        self.assertFalse(broker.is_session_granted("shell"))

    def test_session_grant_expiry(self):
        broker = PermissionBroker()
        broker.grant_session("shell", duration_seconds=0.01)
        time.sleep(0.02)
        self.assertFalse(broker.is_session_granted("shell"))


if __name__ == "__main__":
    unittest.main()
