"""Runs the Canvas/class-sharing migration on a throwaway local Postgres and checks its RLS rules.

Skipped when Postgres binaries are not installed. It never connects to a remote database.
"""
import glob
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = next(iter(sorted(glob.glob("/usr/lib/postgresql/*/bin"))), "")
MIGRATION = os.path.join(ROOT, "supabase", "migrations", "20261015120000_canvas_classes.sql")


def _as_postgres(args, **kwargs):
    if os.geteuid() == 0:
        args = ["runuser", "-u", "postgres", "--"] + args
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


@unittest.skipUnless(BIN and os.path.exists(os.path.join(BIN, "initdb")), "local Postgres not installed")
class CanvasClassesRlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="cordia-rls-")
        os.chmod(cls.dir, 0o777)
        cls.data = os.path.join(cls.dir, "data")
        result = _as_postgres([os.path.join(BIN, "initdb"), "-D", cls.data, "-A", "trust", "-U", "postgres"])
        if result.returncode:
            raise RuntimeError(result.stderr)
        result = _as_postgres([os.path.join(BIN, "pg_ctl"), "-D", cls.data, "-o", f"-k {cls.dir} -c listen_addresses=''", "-w", "start", "-l", os.path.join(cls.dir, "log")])
        if result.returncode:
            raise RuntimeError(result.stderr)

    @classmethod
    def tearDownClass(cls):
        _as_postgres([os.path.join(BIN, "pg_ctl"), "-D", cls.data, "-m", "immediate", "stop"])
        shutil.rmtree(cls.dir, ignore_errors=True)

    def psql(self, path):
        return subprocess.run(["psql", "-h", self.dir, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", path], capture_output=True, text=True)

    def test_migration_applies_twice_and_rls_rules_hold(self):
        for path in (os.path.join(ROOT, "tests", "rls", "supabase_stub.sql"), MIGRATION, MIGRATION):
            result = self.psql(path)
            self.assertEqual(result.returncode, 0, result.stderr)
        result = self.psql(os.path.join(ROOT, "tests", "rls", "canvas_classes_rls.sql"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RLS OK", result.stdout)


if __name__ == "__main__":
    unittest.main()
