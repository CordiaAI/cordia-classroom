"""Runs the backend unit tests like `python -m unittest discover -s tests -v`,
minus tests that are known to fail only on this Mac. CI runs every test, including these."""
import sys
import unittest

# Passes in CI (release-checks.yml is green on main) but takes ~57s instead of <2s on this Mac.
LOCAL_SKIP = {
    "test_html_to_text.HtmlToTextTests.test_cost_grows_linearly_with_hostile_input",
}

def flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item

suite = unittest.defaultTestLoader.discover("tests")
kept = unittest.TestSuite(t for t in flatten(suite) if t.id() not in LOCAL_SKIP)
for test_id in sorted(LOCAL_SKIP):
    print(f"skipped locally (CI still runs it): {test_id}")
result = unittest.TextTestRunner(verbosity=2).run(kept)
sys.exit(0 if result.wasSuccessful() else 1)
