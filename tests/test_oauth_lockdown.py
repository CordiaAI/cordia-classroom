"""OAuth lockdown: connected-app tokens get nothing until an MCP migration grants it.

Runs the lockdown migration on a throwaway local Postgres (skipped when Postgres isn't installed),
checks the access-token hook's output, and runs supabase/checks/oauth_lockdown.sql, which must
return no rows. Never connects to a remote database.
"""
import glob
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = next(iter(sorted(glob.glob("/usr/lib/postgresql/*/bin"))), "")
MIGRATIONS = os.path.join(ROOT, "supabase", "migrations")
LOCKDOWN = os.path.join(MIGRATIONS, "20261031120000_oauth_lockdown.sql")
CONNECTED_APPS = os.path.join(MIGRATIONS, "20261031130000_mcp_connected_apps.sql")
CHECK = os.path.join(ROOT, "supabase", "checks", "oauth_lockdown.sql")


def _as_postgres(args, **kwargs):
    if os.geteuid() == 0:
        args = ["runuser", "-u", "postgres", "--"] + args
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


@unittest.skipUnless(BIN and os.path.exists(os.path.join(BIN, "initdb")), "local Postgres not installed")
class OAuthLockdownDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="cordia-lockdown-")
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

    def psql(self, path, *extra):
        return subprocess.run(["psql", "-h", self.dir, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", *extra, "-f", path], capture_output=True, text=True)

    def test_lockdown_applies_twice_hook_rewrites_and_nothing_is_reachable(self):
        for path in (os.path.join(ROOT, "tests", "rls", "supabase_stub.sql"), LOCKDOWN, LOCKDOWN):
            result = self.psql(path)
            self.assertEqual(result.returncode, 0, result.stderr)
        result = self.psql(os.path.join(ROOT, "tests", "rls", "oauth_lockdown_rls.sql"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("LOCKDOWN OK", result.stdout)
        result = self.psql(CHECK, "-At")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "", "mcp_client can reach objects outside the allow-list")

    def test_connected_apps_check_records_use_and_cleanup_spares_connected_apps(self):
        for path in (os.path.join(ROOT, "tests", "rls", "supabase_stub.sql"), LOCKDOWN, CONNECTED_APPS, CONNECTED_APPS):
            result = self.psql(path)
            self.assertEqual(result.returncode, 0, result.stderr)
        result = self.psql(os.path.join(ROOT, "tests", "rls", "mcp_connected_apps_rls.sql"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CONNECTED APPS OK", result.stdout)
        result = self.psql(CHECK, "-At")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "", "mcp_client can reach objects outside the allow-list")


class OAuthLockdownMigrationLintTests(unittest.TestCase):
    """Static checks on every migration: grants to the connected-app role must be allow-listed."""

    def test_every_grant_to_mcp_client_is_on_the_allow_list(self):
        allowed = open(CHECK).read()
        problems = []
        for path in sorted(glob.glob(os.path.join(MIGRATIONS, "*.sql"))):
            sql = re.sub(r"--[^\n]*", "", open(path).read())
            for match in re.finditer(r"grant\s+(.+?)\s+on\s+(.+?)\s+to\s+([^;]+);", sql, re.I | re.S):
                grantees = match.group(3).lower()
                if "mcp_client" not in grantees:
                    continue
                target = re.sub(r"\s+", " ", match.group(2).strip())
                name = re.sub(r"^(table|function|sequence|schema)\s+", "", target, flags=re.I)
                if name.split("(")[0] not in allowed:
                    problems.append(f"{os.path.basename(path)}: grant on {target} to mcp_client is not in supabase/checks/oauth_lockdown.sql")
                if re.search(r"\ball\s+(tables|functions|sequences)\b", match.group(2), re.I):
                    problems.append(f"{os.path.basename(path)}: blanket grant to mcp_client")
            for match in re.finditer(r"grant\s+mcp_client\s+to\s+([^;]+);", sql, re.I):
                if match.group(1).strip().lower() != "authenticator":
                    problems.append(f"{os.path.basename(path)}: mcp_client granted to {match.group(1).strip()}")
            if re.search(r"alter\s+default\s+privileges[^;]*mcp_client", sql, re.I):
                problems.append(f"{os.path.basename(path)}: default privileges for mcp_client")
        self.assertEqual(problems, [])

    def test_hook_keeps_app_tokens_and_is_only_runnable_by_auth(self):
        sql = open(LOCKDOWN).read()
        self.assertIn("revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated", sql)
        self.assertIn("if coalesce(claims ->> 'client_id', '') <> '' then", sql)


if __name__ == "__main__":
    unittest.main()
