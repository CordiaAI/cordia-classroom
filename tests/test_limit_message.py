import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from services import entitlements


class LimitMessageTests(unittest.TestCase):
    def test_single_allowance_reads_naturally(self):
        self.assertEqual(entitlements.limit_message("practice", 1), "You've used your free practice set.")
        self.assertEqual(entitlements.limit_message("ai_quiz", 1), "You've used your free AI Retain quiz.")

    def test_larger_allowance_keeps_count(self):
        self.assertEqual(entitlements.limit_message("guide", 5), "You've used all 5 study guides this month.")


if __name__ == "__main__":
    unittest.main()
