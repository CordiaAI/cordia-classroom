from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from unittest.mock import MagicMock, call, patch

ROOT = Path(__file__).resolve().parents[1]


class SharedTutorSessionContractTests(unittest.TestCase):
    def test_skill_router_is_small_and_intent_based(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        from services.tutor_sessions import TUTOR_SKILLS, infer_tutor_skill

        self.assertEqual(infer_tutor_skill("Create practice questions from this guide"), "practice")
        self.assertEqual(infer_tutor_skill("Build a study guide from this page"), "build_guide")
        self.assertEqual(infer_tutor_skill("Find material for Exam 1 in Canvas"), "find_material")
        self.assertEqual(infer_tutor_skill("Explain why this answer is wrong"), "explain")
        self.assertEqual(infer_tutor_skill("Explain this study guide"), "explain")
        self.assertEqual(infer_tutor_skill("Create a study guide from this"), "build_guide")
        self.assertEqual(set(TUTOR_SKILLS), {
            "explain", "capture", "build_guide", "practice", "retain", "plan", "find_material", "organize"
        })
        for definition in TUTOR_SKILLS.values():
            self.assertTrue(definition["outcome"])
            self.assertEqual(definition["version"], 1)
            self.assertTrue(definition["complete_when"])
            self.assertIn("available", definition)
            self.assertIn("tools", definition)
            self.assertIn("requires_context", definition)
            self.assertIn("confirm", definition)
            self.assertTrue(definition["instruction"])
        self.assertTrue(TUTOR_SKILLS["find_material"]["available"])
        self.assertEqual(TUTOR_SKILLS["find_material"]["tools"], ["read_page", "navigate_same_origin"])
        self.assertTrue(TUTOR_SKILLS["plan"]["available"])
        self.assertTrue(TUTOR_SKILLS["organize"]["available"])

    def test_browser_presence_expires_instead_of_claiming_a_stale_connection(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        from services.tutor_sessions import public_tutor_session

        old = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
        session = public_tutor_session({
            "id": "session-1",
            "browser_available": True,
            "browser_last_seen_at": old,
        })
        self.assertFalse(session["browser_available"])
        fresh = public_tutor_session({
            "id": "session-1",
            "browser_available": True,
            "browser_last_seen_at": datetime.now(timezone.utc).isoformat(),
        })
        self.assertTrue(fresh["browser_available"])

    def test_public_session_exposes_browser_context_availability_not_raw_content(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        from services.tutor_sessions import public_tutor_session

        session = public_tutor_session({"id": "session-1", "browser_content": "Approved course notes"})
        self.assertTrue(session["browser_content_available"])
        self.assertNotIn("browser_content", session)

    def test_extension_does_not_run_a_background_tutor_session(self):
        worker = (ROOT / "extension" / "background.js").read_text(encoding="utf-8")
        panel = (ROOT / "extension" / "popup.js").read_text(encoding="utf-8")
        self.assertNotIn("/tutor/session", worker + panel)
        self.assertNotIn("setInterval", panel)
        self.assertNotIn("updateBrowserContext", worker + panel)

    def test_stale_agent_run_does_not_leave_both_surfaces_permanently_locked(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        from services.tutor_sessions import public_tutor_session

        stale = public_tutor_session({
            "id": "session-1",
            "status": "running",
            "run_started_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        self.assertEqual(stale["status"], "idle")

        stale_browser = public_tutor_session({
            "id": "session-1",
            "status": "waiting_browser",
            "run_started_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
        })
        self.assertEqual(stale_browser["status"], "idle")

    def test_browser_result_finishes_the_same_ordered_turn_once(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        from services.tutor_sessions import update_browser_context

        row = {
            "id": "session-1",
            "user_id": "student-1",
            "status": "waiting_browser",
            "run_id": "run-1",
            "conversation_version": 4,
            "messages": [{"role": "user", "text": "Capture this"}],
            "browser_command": {"id": "command-1", "status": "pending", "type": "capture_current_page"},
        }
        table = MagicMock()
        table.select.return_value = table
        table.update.return_value = table
        table.eq.return_value = table
        table.limit.return_value = table
        table.execute.side_effect = [MagicMock(data=[row]), MagicMock(data=[row])]
        db = MagicMock()
        db.table.return_value = table

        with patch("services.tutor_sessions.get_supabase", return_value=db):
            update_browser_context("student-1", "session-1", {
                "browser_available": True,
                "last_action_result": {
                    "command_id": "command-1",
                    "status": "completed",
                    "action": "capture_current_page",
                    "section_count": 3,
                    "evidence": [],
                },
            })

        payload = table.update.call_args.args[0]
        self.assertEqual(payload["status"], "idle")
        self.assertIsNone(payload["run_id"])
        self.assertEqual(payload["conversation_version"], 5)
        self.assertEqual(payload["browser_command"]["status"], "completed")
        self.assertEqual(payload["messages"][-1]["text"], "Captured 3 study sections from the current page.")
        self.assertEqual(payload["action_history"][-1]["action"], "capture_current_page")
        self.assertIn(call("conversation_version", 4), table.eq.call_args_list)
        self.assertIn(call("run_id", "run-1"), table.eq.call_args_list)
        self.assertIn(call("status", "waiting_browser"), table.eq.call_args_list)

    def test_stale_browser_result_cannot_write_to_a_newer_turn(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        from fastapi import HTTPException
        from services.tutor_sessions import update_browser_context

        row = {
            "id": "session-1",
            "user_id": "student-1",
            "status": "waiting_browser",
            "run_id": "run-2",
            "conversation_version": 5,
            "browser_command": {"id": "command-2", "status": "pending", "type": "capture_current_page"},
        }
        table = MagicMock()
        table.select.return_value = table
        table.eq.return_value = table
        table.limit.return_value = table
        table.execute.return_value = MagicMock(data=[row])
        db = MagicMock()
        db.table.return_value = table

        with patch("services.tutor_sessions.get_supabase", return_value=db), self.assertRaises(HTTPException) as error:
            update_browser_context("student-1", "session-1", {
                "browser_available": True,
                "last_action_result": {
                    "command_id": "command-1",
                    "status": "completed",
                    "action": "capture_current_page",
                },
            })

        self.assertEqual(error.exception.status_code, 409)
        table.update.assert_not_called()

    def test_browser_commands_require_an_explicit_supported_permission(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        from fastapi import HTTPException
        from services.tutor_sessions import queue_browser_command

        turn = {"id": "session-1", "run_id": "run-1", "permission_scope": []}
        with self.assertRaises(HTTPException) as denied:
            queue_browser_command("student-1", turn, "capture_current_page", "Read this")
        self.assertEqual(denied.exception.status_code, 403)

        turn["permission_scope"] = ["read_page"]
        with self.assertRaises(HTTPException) as unsupported:
            queue_browser_command("student-1", turn, "submit_assignment", "Submit this")
        self.assertEqual(unsupported.exception.status_code, 400)

    def test_find_material_result_is_shared_with_clickable_evidence(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        from services.tutor_sessions import update_browser_context

        row = {
            "id": "session-1",
            "user_id": "student-1",
            "status": "waiting_browser",
            "run_id": "run-2",
            "conversation_version": 8,
            "messages": [{"role": "user", "text": "Find Exam 1 material"}],
            "browser_command": {"id": "command-2", "status": "pending", "type": "find_material_current_page"},
        }
        table = MagicMock()
        table.select.return_value = table
        table.update.return_value = table
        table.eq.return_value = table
        table.limit.return_value = table
        table.execute.side_effect = [MagicMock(data=[row]), MagicMock(data=[row])]
        db = MagicMock()
        db.table.return_value = table
        evidence = [{"title": "Exam 1 review", "url": "https://school.test/review.pdf", "source_type": "course_link"}]

        with patch("services.tutor_sessions.get_supabase", return_value=db):
            update_browser_context("student-1", "session-1", {
                "last_action_result": {
                    "command_id": "command-2",
                    "status": "completed",
                    "action": "find_material_current_page",
                    "evidence": evidence,
                },
            })

        payload = table.update.call_args.args[0]
        self.assertEqual(payload["messages"][-1]["text"], "Found 1 relevant source on the current page.")
        self.assertEqual(payload["messages"][-1]["evidence"], evidence)

    def test_extension_is_a_four_action_side_panel_while_web_owns_tutor_session(self):
        import json

        manifest = json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))
        worker = (ROOT / "extension" / "background.js").read_text(encoding="utf-8")
        panel = (ROOT / "extension" / "popup.js").read_text(encoding="utf-8")
        web_tutor = (ROOT / "web" / "components" / "AIChatWidget.js").read_text(encoding="utf-8")

        self.assertEqual(manifest["side_panel"]["default_path"], "popup.html")
        self.assertIn("sidePanel", manifest["permissions"])
        self.assertNotIn("default_popup", manifest["action"])
        self.assertIn("openPanelOnActionClick", worker)
        self.assertNotIn("'/tutor/session'", worker)
        self.assertIn("action: 'createStudyGuide'", panel)
        self.assertNotIn("tutorSession", panel)
        self.assertIn("apiFetch('/tutor/session')", web_tutor)
        self.assertIn("session_id: session.id", web_tutor)
        self.assertIn('<TutorSelect label="Destination class"', web_tutor)
        tutor_select = (ROOT / "web" / "components" / "TutorSelect.js").read_text(encoding="utf-8")
        self.assertIn("aria-label={label}", tutor_select)
        self.assertIn("needsTargetClass ? targetClassId", web_tutor)

    def test_session_schema_is_one_per_user_and_user_scoped(self):
        migration = (ROOT / "supabase" / "migrations" / "20260917000000_shared_tutor_sessions.sql").read_text(encoding="utf-8")
        self.assertIn("unique (user_id)", migration)
        self.assertIn("enable row level security", migration)
        self.assertIn("revoke all on table public.tutor_sessions from public, anon, authenticated", migration)
        self.assertIn("grant select, insert, update, delete on table public.tutor_sessions to service_role", migration)
        self.assertNotIn("create policy", migration)
        self.assertIn("'waiting_browser'", migration)
        self.assertIn("browser_content text", migration)
        self.assertIn("action_history jsonb", migration)

    def test_backend_prefers_an_explicit_service_role_environment_variable(self):
        database = (ROOT / "backend" / "database.py").read_text(encoding="utf-8")
        example = (ROOT / "backend" / ".env.example").read_text(encoding="utf-8")
        self.assertIn('os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")', database)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here", example)

    def test_auth_client_is_fresh_and_uses_browser_compatible_implicit_oauth(self):
        import sys
        sys.path.insert(0, str(ROOT / "backend"))
        import database

        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_ANON_KEY": "anon-key",
        }
        with patch("database.os.getenv", side_effect=environment.get), patch("database.create_client") as create:
            client = MagicMock()
            create.return_value = client
            self.assertIs(database.get_auth_supabase(), client)
            create.assert_called_once()
            args = create.call_args.args
            options = create.call_args.kwargs["options"]
            self.assertEqual(args, (environment["SUPABASE_URL"], environment["SUPABASE_ANON_KEY"]))
            self.assertFalse(options.auto_refresh_token)
            self.assertFalse(options.persist_session)
            self.assertEqual(options.flow_type, "implicit")
            self.assertTrue(hasattr(options, "storage"))

    def test_browser_context_rejects_non_web_urls_and_unbounded_results(self):
        import sys
        from pydantic import ValidationError
        sys.path.insert(0, str(ROOT / "backend"))
        from routers.tutor import BrowserActionResult, BrowserContextUpdate, BrowserObservation
        from schemas import ChatRequest

        with self.assertRaises(ValidationError):
            BrowserObservation(url="javascript:alert(1)")
        with self.assertRaises(ValidationError):
            ChatRequest(question="Explain", content="notes", context_url="file:///secret")
        with self.assertRaises(ValidationError):
            BrowserActionResult(command_id="command-1", status="completed", action="capture", error="x" * 501)
        with self.assertRaises(ValidationError):
            BrowserActionResult(
                command_id="command-1",
                status="completed",
                action="capture",
                evidence=[{"url": "https://example.test", "title": str(index)} for index in range(21)],
            )
        update = BrowserContextUpdate(
            session_id="session-1",
            browser_content="Password: do-not-store Access Token=secret-value Course notes",
        )
        self.assertNotIn("do-not-store", update.browser_content)
        self.assertNotIn("secret-value", update.browser_content)

    def test_web_tutor_loads_browser_content_only_when_capture_exists(self):
        widget = (ROOT / "web" / "components" / "AIChatWidget.js").read_text(encoding="utf-8")
        self.assertIn("browser_content_available", widget)
        self.assertIn("/tutor/session/browser-content", widget)
        self.assertIn("material?.kind === 'browser'", widget)


if __name__ == "__main__":
    unittest.main()
