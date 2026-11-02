"""Backend pieces of the MCP write tools: reading a link safely (no private addresses, no LMS), a web
page's readable text, the study-set worker and the app's job routes."""
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402
from services import generation_jobs, url_fetch  # noqa: E402
from services.entitlements import LimitReached  # noqa: E402
from services.text_processing import page_text  # noqa: E402


def resolver(*addresses):
    return lambda host, port, type=None: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 0)) for address in addresses]


class FakeResponse:
    def __init__(self, status=200, headers=None, body=b""):
        self.status, self.headers, self.body = status, headers or {}, body

    def stream(self, size):
        for start in range(0, len(self.body), size):
            yield self.body[start:start + size]

    def release_conn(self):
        pass


class UrlSafetyTests(unittest.TestCase):
    def test_only_plain_web_links(self):
        for url in ("ftp://example.com/x", "file:///etc/passwd", "https://user:pw@example.com/", "https://example.com:8443/", "javascript:alert(1)", "https:///nohost"):
            with self.subTest(url), self.assertRaises(url_fetch.UnsafeUrl):
                url_fetch.check_url(url)
        self.assertEqual(url_fetch.check_url("https://Example.com/page?q=1")[1], "example.com")

    def test_lms_links_are_refused_with_the_extension_hint(self):
        for url in ("https://school.instructure.com/courses/1", "https://canvas.state.edu/courses/12/pages/x", "https://state.edu/courses/12/files",
                    "https://bb.uni.edu/webapps/x", "https://learn.blackboard.com/x", "https://moodle.uni.ac.uk/course/view.php?id=3",
                    "https://uni.brightspace.com/d2l/home", "https://app.schoology.com/course/1"):
            with self.subTest(url), self.assertRaises(url_fetch.UnsafeUrl) as ctx:
                url_fetch.check_url(url)
            self.assertIn("extension", str(ctx.exception))
        url_fetch.check_url("https://en.wikipedia.org/wiki/Mitochondrion")

    def test_private_and_internal_addresses_are_refused(self):
        for address in ("127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"):
            with self.subTest(address), self.assertRaises(url_fetch.UnsafeUrl):
                url_fetch.public_addresses("example.com", resolver(address))
        # One private answer among public ones is enough to refuse.
        with self.assertRaises(url_fetch.UnsafeUrl):
            url_fetch.public_addresses("example.com", resolver("93.184.216.34", "10.0.0.1"))
        self.assertEqual(url_fetch.public_addresses("example.com", resolver("93.184.216.34")), ["93.184.216.34"])

    def test_fetch_connects_to_the_checked_address_and_rechecks_redirects(self):
        calls = []

        def request(scheme, host, port, address, target):
            calls.append((host, address, target))
            if host == "example.com":
                return FakeResponse(302, {"Location": "http://internal.example/admin"})
            raise AssertionError("never reached")

        resolve = lambda host, port, type=None: resolver("93.184.216.34" if host == "example.com" else "10.0.0.5")(host, port)  # noqa: E731
        with self.assertRaises(url_fetch.UnsafeUrl) as ctx:
            url_fetch.fetch("https://example.com/start?a=1", resolve=resolve, request=request)
        self.assertIn("private", str(ctx.exception))
        self.assertEqual(calls, [("example.com", "93.184.216.34", "/start?a=1")])

    def test_fetch_caps_size_and_redirects(self):
        big = lambda *a: FakeResponse(200, {"Content-Type": "text/html"}, b"x" * (url_fetch.MAX_BYTES + 1))  # noqa: E731
        with self.assertRaises(url_fetch.UnsafeUrl):
            url_fetch.fetch("https://example.com/", resolve=resolver("93.184.216.34"), request=big)
        loop = lambda *a: FakeResponse(301, {"Location": "/again"})  # noqa: E731
        with self.assertRaises(url_fetch.UnsafeUrl) as ctx:
            url_fetch.fetch("https://example.com/", resolve=resolver("93.184.216.34"), request=loop)
        self.assertIn("redirects", str(ctx.exception))
        ok = lambda *a: FakeResponse(200, {"Content-Type": "text/html; charset=utf-8"}, b"<p>hi</p>")  # noqa: E731
        page = url_fetch.fetch("https://example.com/", resolve=resolver("93.184.216.34"), request=ok)
        self.assertEqual((page["content_type"], page["body"]), ("text/html; charset=utf-8", b"<p>hi</p>"))


class PageTextTests(unittest.TestCase):
    def test_reads_the_main_content_like_the_app(self):
        html = ("<html><head><title>Cell biology</title><script>var x=1</script><style>p{}</style></head><body>"
                "<nav>Home Menu</nav><header>Site</header><main><h1>Mitochondria</h1><p>" + "The mitochondria makes ATP. " * 10 + "</p></main>"
                "<aside>Ads</aside><footer>Copyright</footer></body></html>")
        title, text = page_text(html)
        self.assertEqual(title, "Cell biology")
        self.assertTrue(text.startswith("Mitochondria"))
        for noise in ("var x", "Home Menu", "Ads", "Copyright", "Site"):
            self.assertNotIn(noise, text)

    def test_without_main_uses_the_body(self):
        title, text = page_text("<body><p>Photosynthesis turns light into sugar.</p><form>Sign up</form></body>")
        self.assertEqual((title, text), ("", "Photosynthesis turns light into sugar."))


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.patches = [patch.object(generation_jobs, "get_supabase", return_value=self.db)]
        for p in self.patches:
            p.start()
        self.charged = []

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def job(self, **row):
        made = self.db.table("generation_jobs").insert({"user_id": "student-1", "status": "queued", "attempts": 0, "kind": "study_set", **row}).execute().data[0]
        return generation_jobs.claim_next() or made

    def run_job(self, job, built=None, limit=None):
        saved = {}

        def create_guide(user_id, request, extra=None):
            saved.update(user_id=user_id, request=request, extra=extra)
            return {"id": "guide-9"}

        def require(user_id, feature):
            if limit:
                raise limit

        with patch("routers.materials.build_materials", return_value=built or {"notes": "- n", "study_guide": "Q1: a\nA1: b", "flashcards": [{"front": "a", "back": "b"}], "empty": False}) as build, \
             patch("routers.guides.create_guide", side_effect=create_guide), \
             patch("services.entitlements.require", side_effect=require), \
             patch("services.entitlements.record", side_effect=lambda *args: self.charged.append(args)):
            generation_jobs.run(job)
        return saved, build

    def row(self, job_id):
        return next(row for row in self.db.rows("generation_jobs") if row["id"] == job_id)

    def test_claim_marks_one_job_running(self):
        first = self.job(source="app", input={"content": "x" * 50, "title": "Cells"})
        self.assertEqual(first["status"], "running")
        self.assertEqual(first["attempts"], 1)
        self.assertIsNone(generation_jobs.claim_next())

    def test_connected_app_text_job_builds_a_labelled_set_charged_once(self):
        job = self.job(source="mcp", title="Cells", client_name="Claude", input={"kind": "text", "text": "Mitochondria make ATP. " * 5, "outputs": ["study_guide", "flashcards"]})
        saved, build = self.run_job(job)
        row = self.row(job["id"])
        self.assertEqual((row["status"], row["study_set_id"], row["input"]), ("done", "guide-9", None))
        self.assertEqual(saved["user_id"], "student-1")
        self.assertEqual(saved["extra"], {"origin": "mcp", "origin_client": "Claude"})
        self.assertEqual((saved["request"].title, saved["request"].keep_title, saved["request"].source_type), ("Cells", True, "text"))
        self.assertEqual(build.call_args.args[3:], (False, True, True))  # no notes asked for
        self.assertEqual(self.charged, [("student-1", "guide", f"job:{job['id']}")])

    def test_app_job_saves_like_post_guides(self):
        job = self.job(source="app", title="Week 3", folder_id="ffffffff-0000-4000-8000-000000000001", input={"content": "Cells and more cells. " * 5, "title": "Week 3", "source_type": "file", "source_title": "week3.pdf", "notes": True, "flashcards": True})
        saved, _ = self.run_job(job)
        self.assertIsNone(saved["extra"])
        self.assertEqual((saved["request"].source_type, saved["request"].source_title, saved["request"].folder_id), ("file", "week3.pdf", "ffffffff-0000-4000-8000-000000000001"))

    def test_lms_link_fails_without_fetching(self):
        job = self.job(source="mcp", input={"kind": "url", "url": "https://school.instructure.com/courses/1/pages/x"})
        with patch.object(url_fetch, "_request", side_effect=AssertionError("fetched an LMS page")):
            self.run_job(job)
        row = self.row(job["id"])
        self.assertEqual(row["status"], "failed")
        self.assertIn("extension", row["error"])
        self.assertEqual(self.charged, [])

    def test_plan_limit_fails_the_job_with_the_apps_message(self):
        job = self.job(source="mcp", input={"kind": "text", "text": "Mitochondria make ATP. " * 5})
        self.run_job(job, limit=LimitReached("guide", 3, 3, "free"))
        row = self.row(job["id"])
        self.assertEqual(row["status"], "failed")
        self.assertIn("study guides", row["error"])
        self.assertEqual(self.charged, [])

    def test_unexpected_errors_never_reach_the_student(self):
        job = self.job(source="mcp", input={"kind": "text", "text": "Mitochondria make ATP. " * 5})
        with patch("routers.materials.build_materials", side_effect=RuntimeError("secret detail")):
            with patch("services.entitlements.require"):
                generation_jobs.run(job)
        self.assertEqual(self.row(job["id"])["error"], generation_jobs.GENERIC_ERROR)

    def test_stale_jobs_retry_once_then_fail(self):
        for attempts in (1, 2):
            self.db.table("generation_jobs").insert({"user_id": "s", "status": "running", "attempts": attempts, "started_at": "2020-01-01T00:00:00+00:00"}).execute()
        generation_jobs.recover_stale()
        self.assertEqual(sorted(row["status"] for row in self.db.rows("generation_jobs")), ["failed", "queued"])


class JobRouteTests(unittest.TestCase):
    def setUp(self):
        from routers import jobs
        self.jobs = jobs
        self.db = FakeDB()
        self.patches = [patch.object(jobs, "get_supabase", return_value=self.db), patch.object(jobs, "get_user_id", side_effect=lambda auth: auth.split()[-1]),
                        patch.object(jobs, "require"), patch("routers.guides.get_supabase", return_value=self.db)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_queue_then_status_returns_the_saved_guide(self):
        body = self.jobs.StudySetJobRequest(content="Mitochondria make ATP. " * 3, title="Cells", source_type="file")
        job = self.jobs.queue_job.__wrapped__(body, request=None, authorization="Bearer student-1")["job"]
        self.assertEqual(job["status"], "queued")
        stored = self.db.rows("generation_jobs")[0]
        self.assertEqual((stored["user_id"], stored["source"], stored["input"]["content"][:12]), ("student-1", "app", "Mitochondria"))
        self.db.table("study_guides").insert({"id": "g1", "user_id": "student-1", "title": "Cells"}).execute()
        stored.update(status="done", study_set_id="g1")
        result = self.jobs.job_status(job["id"], authorization="Bearer student-1")
        self.assertEqual(result["guide"]["title"], "Cells")
        with self.assertRaises(HTTPException) as ctx:
            self.jobs.job_status(job["id"], authorization="Bearer student-2")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_only_connected_app_sets_are_announced_until_seen(self):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        for source in ("app", "mcp"):
            self.db.table("generation_jobs").insert({"user_id": "student-1", "source": source, "status": "done", "created_at": now}).execute()
        unseen = self.jobs.unseen_jobs(authorization="Bearer student-1")["jobs"]
        self.assertEqual([job["source"] for job in unseen], ["mcp"])
        self.jobs.mark_seen(unseen[0]["id"], authorization="Bearer student-1")
        self.assertEqual(self.jobs.unseen_jobs(authorization="Bearer student-1")["jobs"], [])


if __name__ == "__main__":
    unittest.main()


class McpStudySetRouteTests(unittest.TestCase):
    def setUp(self):
        from routers import mcp
        self.mcp = mcp
        self.db = FakeDB()
        self.queued = []

        def rpc(name, args):
            self.queued.append((name, args))
            row = self.db.table("generation_jobs").insert({"user_id": "student-1", "status": "queued"}).execute().data[0]
            return type("R", (), {"execute": lambda _self: type("D", (), {"data": row["id"]})()})()

        self.db.rpc = rpc
        self.patches = [patch.object(mcp, "_student", return_value=("student-1", self.db)), patch.object(generation_jobs, "get_supabase", return_value=self.db)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def body(self, **source):
        return self.mcp.StudySetRequest(source=self.mcp.StudySetSource(**source))

    def test_lms_and_private_links_are_refused_before_anything_is_queued(self):
        for url in ("https://school.instructure.com/courses/1", "http://169.254.169.254/latest/meta-data"):
            with self.subTest(url), self.assertRaises(HTTPException) as ctx:
                with patch.object(url_fetch, "public_addresses", side_effect=url_fetch.UnsafeUrl("That link points to a private or internal address, which Cordia can't read.")):
                    self.mcp._queue_study_set("Bearer t", self.body(type="url", url=url))
            self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(self.queued, [])

    def test_text_is_queued_as_the_student_and_the_plan_is_checked(self):
        with patch("services.entitlements.require") as require:
            result = self.mcp._queue_study_set("Bearer t", self.body(type="text", text="Mitochondria make ATP. " * 5))
        self.assertEqual(result["status"], "queued")
        self.assertEqual(self.queued[0][0], "queue_study_set_job")
        require.assert_called_once_with("student-1", "guide")

    def test_over_the_limit_fails_the_job_and_says_so(self):
        with patch("services.entitlements.require", side_effect=LimitReached("guide", 3, 3, "free")), self.assertRaises(LimitReached) as ctx:
            self.mcp._queue_study_set("Bearer t", self.body(type="text", text="Mitochondria make ATP. " * 5))
        self.assertEqual(ctx.exception.detail["upgrade_url"], "/settings?section=subscription")
        self.assertEqual(self.db.rows("generation_jobs")[0]["status"], "failed")

    def test_a_repeated_request_returns_the_job_already_made_without_failing_it(self):
        # queue_study_set_job returns the earlier job for the same request; it may already be done,
        # and a plan limit reached since then must not mark it failed.
        done = self.db.table("generation_jobs").insert({"user_id": "student-1", "status": "done"}).execute().data[0]
        self.db.rpc = lambda name, args: type("R", (), {"execute": lambda _self: type("D", (), {"data": done["id"]})()})()
        with patch("services.entitlements.require", side_effect=LimitReached("guide", 3, 3, "free")) as require:
            result = self.mcp._queue_study_set("Bearer t", self.body(type="text", text="Mitochondria make ATP. " * 5))
        self.assertEqual(result, {"job_id": done["id"], "status": "done"})
        require.assert_not_called()
        self.assertEqual(self.db.rows("generation_jobs")[0]["status"], "done")
