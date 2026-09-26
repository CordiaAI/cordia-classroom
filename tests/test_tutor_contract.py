import sys
from pathlib import Path
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import app


class TutorContractTests(unittest.TestCase):
    client = TestClient(app)
    guide_id = "11111111-1111-4111-8111-111111111111"

    def guide_db(self, created=None):
        table = MagicMock()
        table.select.return_value = table
        table.eq.return_value = table
        table.limit.return_value = table
        table.insert.return_value = table
        guide = {
            "id": self.guide_id,
            "title": "Biology",
            "folder_id": "folder-1",
            "study_guide": "Q1: What is mitosis?\nA1: Cell division.",
            "notes": None,
            "source_url": "https://canvas.example/biology",
        }
        responses = [MagicMock(data=[guide])]
        if created:
            responses.append(MagicMock(data=[created]))
        table.execute.side_effect = responses
        db = MagicMock()
        db.table.return_value = table
        return db, table

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.answer_question", return_value="Mitosis is cell division.")
    @patch("main.get_user_id", return_value="student-1")
    def test_tutor_grounds_answer_in_owned_guide(self, _auth, answer, _usage, _record, _guidance):
        db, _table = self.guide_db()
        with patch("main.get_supabase", return_value=db):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={"question": "Explain mitosis", "content": "untrusted client text", "guide_id": self.guide_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer"], "Mitosis is cell division.")
        self.assertEqual(response.json()["source"], {"type": "study_guide", "id": self.guide_id, "title": "Biology"})
        self.assertEqual(answer.call_args.kwargs["context"], "Q1: What is mitosis?\nA1: Cell division.")

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.explain_retain_answer", return_value="Mitosis makes matching body cells; meiosis makes sex cells with half the chromosomes.")
    @patch("main.get_user_id", return_value="student-1")
    def test_retain_explanation_binds_selected_and_correct_answers(self, _auth, explain, _usage, _record, _guidance):
        db, _table = self.guide_db()
        turn = {
            "id": "session-1",
            "run_id": "run-1",
            "active_skill": "retain",
            "conversation_version": 2,
            "messages": [
                {"role": "user", "text": "What is the difference between mitosis and meiosis?"},
                {"role": "ai", "text": "They are two different forms of cell division."},
                {"role": "user", "text": "Please explain my missed answer."},
            ],
        }
        completed = {**turn, "status": "idle", "conversation_version": 3}
        with patch("main.get_supabase", return_value=db), \
             patch("main.claim_tutor_turn", return_value=turn), \
             patch("main.complete_tutor_turn", return_value=completed), \
             patch("main.public_tutor_session", return_value={"id": "session-1", "conversation_version": 3}):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={
                    "question": "Please explain my missed answer.",
                    "content": "",
                    "guide_id": self.guide_id,
                    "session_id": "session-1",
                    "conversation_version": 2,
                    "skill": "retain",
                    "retain_context": {
                        "question": "What is mitosis?",
                        "options": ["Meiosis", "Cell division."],
                        "selected_answer": "Meiosis",
                        "correct_answer": "Cell division.",
                    },
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer"], "Mitosis makes matching body cells; meiosis makes sex cells with half the chromosomes.")
        self.assertEqual(explain.call_args.kwargs["selected_answer"], "Meiosis")
        self.assertEqual(explain.call_args.kwargs["correct_answer"], "Cell division.")
        self.assertEqual(explain.call_args.kwargs["conversation"], turn["messages"][:-1])
        self.assertIn("What is mitosis?", explain.call_args.kwargs["context"])

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.answer_question", return_value="The selected source explains recursion.")
    @patch("main.get_user_id", return_value="student-1")
    def test_tutor_uses_selected_material_when_saved_guide_content_is_empty(self, _auth, answer, _usage, _record, _guidance):
        db, table = self.guide_db()
        table.execute.side_effect = [MagicMock(data=[{
            "id": self.guide_id,
            "title": "Recursion",
            "folder_id": None,
            "study_guide": "",
            "notes": None,
            "source_url": None,
        }])]
        with patch("main.get_supabase", return_value=db):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={"question": "Explain this", "content": "Recursion needs a base case.", "guide_id": self.guide_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(answer.call_args.kwargs["context"], "Recursion needs a base case.")

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.generate_verified_practice_set")
    @patch("main.get_user_id", return_value="student-1")
    def test_practice_endpoint_returns_exactly_ten_source_grounded_problems(self, _auth, generate, _usage, record, _guidance):
        generate.return_value = {
            "subject_area": "Biology",
            "domain": "health",
            "truth_note": "Source-grounded references",
            "problems": [
                {
                    "id": index,
                    "prompt": f"Apply source concept {index}.",
                    "answer": f"Source answer {index}.",
                    "worked_solution": "Use the cited mechanism.",
                    "source_basis": "Mitosis creates two cells.",
                    "practice_type": "scenario",
                    "answer_format": "Explain",
                    "starter_code": None,
                    "test_cases": [],
                    "expected_value": None,
                    "tolerance": None,
                    "verification": {"status": "source_grounded", "label": "Source-grounded reference"},
                }
                for index in range(1, 11)
            ],
        }
        db, _table = self.guide_db()
        with patch("main.get_supabase", return_value=db):
            response = self.client.post(
                "/practice",
                headers={"Authorization": "Bearer test"},
                json={"guide_id": self.guide_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["problems"]), 10)
        self.assertEqual(response.json()["source"]["id"], self.guide_id)
        self.assertIn("mitosis", generate.call_args.args[0])
        record.assert_called_once()

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.generate_practice_guide", return_value="Q1: Apply mitosis.\nA1: Cell division.")
    @patch("main.get_user_id", return_value="student-1")
    def test_tutor_creates_practice_guide_in_source_class(self, _auth, _generate, _usage, record, _guidance):
        created = {
            "id": "22222222-2222-4222-8222-222222222222",
            "title": "Biology — Practice Problems",
            "folder_id": "folder-1",
        }
        db, table = self.guide_db(created)
        with patch("main.get_supabase", return_value=db):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={"question": "Create practice problems from this guide", "content": "", "guide_id": self.guide_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["action"], "created_guide")
        payload = table.insert.call_args.args[0]
        self.assertEqual(payload["folder_id"], "folder-1")
        self.assertEqual(payload["source_guide_id"], self.guide_id)
        self.assertEqual(payload["source_type"], "study_guide")
        self.assertEqual(payload["source_title"], "Biology")
        self.assertEqual(payload["source_id"], self.guide_id)
        self.assertEqual(payload["flashcards"], [{"front": "Apply mitosis.", "back": "Cell division."}])
        record.assert_called_once()

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.generate_practice_guide", return_value="Q1: Apply recursion.\nA1: Use a base case.")
    @patch("main.get_user_id", return_value="student-1")
    def test_tutor_creates_practice_guide_from_owned_smartnote(self, _auth, generate, _usage, _record, _guidance):
        note_id = "33333333-3333-4333-8333-333333333333"
        note_table = MagicMock()
        note_table.select.return_value = note_table
        note_table.eq.return_value = note_table
        note_table.execute.return_value = MagicMock(data=[{
            "id": note_id,
            "title": "Recursion Notes",
            "folder_id": "folder-2",
            "content": "<h2>Recursion</h2><p>Every recursive function needs a base case.</p>",
        }])
        guide_table = MagicMock()
        guide_table.insert.return_value = guide_table
        guide_table.execute.return_value = MagicMock(data=[{
            "id": "44444444-4444-4444-8444-444444444444",
            "title": "Recursion Notes — Practice Problems",
            "folder_id": "folder-2",
        }])
        db = MagicMock()
        db.table.side_effect = lambda name: note_table if name == "smart_notes" else guide_table

        with patch("main.get_supabase", return_value=db):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={"question": "Create practice problems from these notes", "content": "untrusted", "note_id": note_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"], {"type": "smartnote", "id": note_id, "title": "Recursion Notes"})
        self.assertNotIn("<h2>", generate.call_args.args[0])
        payload = guide_table.insert.call_args.args[0]
        self.assertEqual(payload["folder_id"], "folder-2")
        self.assertEqual(payload["source_type"], "smartnote")
        self.assertEqual(payload["source_id"], note_id)
        self.assertNotIn("source_guide_id", payload)

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.answer_question", return_value="Shared answer")
    @patch("main.get_user_id", return_value="student-1")
    def test_tutor_message_returns_the_same_shared_session(self, _auth, _answer, _usage, _record, _guidance):
        db, _table = self.guide_db()
        turn = {
            "id": "session-1",
            "run_id": "run-1",
            "active_skill": "explain",
            "conversation_version": 2,
            "messages": [{"role": "user", "text": "Explain mitosis"}],
        }
        completed = {
            **turn,
            "status": "idle",
            "conversation_version": 3,
            "messages": turn["messages"] + [{"role": "ai", "text": "Shared answer"}],
        }
        with patch("main.get_supabase", return_value=db), \
             patch("main.claim_tutor_turn", return_value=turn) as claim, \
             patch("main.complete_tutor_turn", return_value=completed), \
             patch("main.public_tutor_session", return_value={"id": "session-1", "conversation_version": 3}) as public:
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={
                    "question": "Explain mitosis",
                    "content": "",
                    "guide_id": self.guide_id,
                    "session_id": "session-1",
                    "conversation_version": 2,
                    "skill": "explain",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session"]["id"], "session-1")
        self.assertEqual(response.json()["skill"], "explain")
        claim.assert_called_once()
        public.assert_called_once_with(completed)

    @patch("main.get_user_id", return_value="student-1")
    def test_capture_skill_queues_the_existing_extension_flow(self, _auth):
        turn = {
            "id": "session-1",
            "run_id": "run-1",
            "active_skill": "capture",
            "conversation_version": 4,
            "messages": [{"role": "user", "text": "Read this page"}],
            "browser_available": True,
            "browser_last_seen_at": datetime.now(timezone.utc).isoformat(),
        }
        waiting = {**turn, "status": "waiting_browser", "conversation_version": 4}
        with patch("main.claim_tutor_turn", return_value=turn), \
             patch("main.queue_browser_command", return_value={"id": "command-1"}) as queue, \
             patch("main.wait_for_browser_result", return_value=waiting) as wait, \
             patch("main.public_tutor_session", side_effect=[
                 {"browser_available": True},
                 {"id": "session-1", "status": "waiting_browser", "conversation_version": 4},
             ]):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={
                    "question": "Read this page",
                    "content": "",
                    "session_id": "session-1",
                    "conversation_version": 4,
                    "skill": "capture",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["action"], "browser_command_queued")
        self.assertEqual(response.json()["session"]["status"], "waiting_browser")
        queue.assert_called_once_with("student-1", turn, "capture_current_page", "Read this page")
        wait.assert_called_once()

    @patch("main.get_user_id", return_value="student-1")
    def test_find_material_searches_only_the_approved_active_page(self, _auth):
        turn = {
            "id": "session-1",
            "run_id": "run-1",
            "active_skill": "find_material",
            "conversation_version": 7,
            "messages": [{"role": "user", "text": "Find Exam 1 review material"}],
            "browser_available": True,
            "browser_last_seen_at": datetime.now(timezone.utc).isoformat(),
        }
        waiting = {**turn, "status": "waiting_browser"}
        with patch("main.claim_tutor_turn", return_value=turn), \
             patch("main.queue_browser_command", return_value={"id": "command-2"}) as queue, \
             patch("main.wait_for_browser_result", return_value=waiting), \
             patch("main.public_tutor_session", side_effect=[
                 {"browser_available": True},
                 {"id": "session-1", "status": "waiting_browser", "conversation_version": 7},
             ]):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={
                    "question": "Find Exam 1 review material",
                    "content": "",
                    "session_id": "session-1",
                    "conversation_version": 7,
                    "skill": "find_material",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["action"], "browser_command_queued")
        queue.assert_called_once_with(
            "student-1", turn, "find_material_current_page", "Find Exam 1 review material"
        )

    @patch("main.get_user_id", return_value="student-1")
    def test_plan_without_selected_material_points_to_calendar_dashboard(self, _auth):
        turn = {
            "id": "session-1",
            "run_id": "run-3",
            "active_skill": "plan",
            "conversation_version": 9,
            "messages": [{"role": "user", "text": "Plan my week"}],
        }
        with patch("main.claim_tutor_turn", return_value=turn), \
             patch("main.complete_tutor_turn", return_value={**turn, "status": "idle", "conversation_version": 10}), \
             patch("main.public_tutor_session", return_value={"id": "session-1", "status": "idle"}):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={
                    "question": "Plan my week",
                    "content": "",
                    "session_id": "session-1",
                    "conversation_version": 9,
                    "skill": "plan",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["action"], "opened_plan_help")
        self.assertIn("calendar reminders", response.json()["answer"])

    @patch("main.get_user_id", return_value="student-1")
    def test_organize_requires_and_uses_explicit_destination_class(self, _auth):
        target_class = "55555555-5555-4555-8555-555555555555"
        db, _table = self.guide_db()
        turn = {
            "id": "session-1",
            "run_id": "run-4",
            "active_skill": "organize",
            "conversation_version": 11,
            "messages": [{"role": "user", "text": "Move this guide"}],
        }
        completed = {**turn, "status": "idle", "conversation_version": 12}
        with patch("main.get_supabase", return_value=db), \
             patch("main.claim_tutor_turn", return_value=turn), \
             patch("main.guides.move_guide", return_value={"updated": True}) as move, \
             patch("main.complete_tutor_turn", return_value=completed), \
             patch("main.public_tutor_session", return_value={"id": "session-1", "status": "idle"}):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={
                    "question": "Move this guide",
                    "content": "",
                    "guide_id": self.guide_id,
                    "class_id": target_class,
                    "session_id": "session-1",
                    "conversation_version": 11,
                    "skill": "organize",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["action"], "organized_material")
        self.assertEqual(move.call_args.args[0], self.guide_id)
        self.assertEqual(move.call_args.args[1].folder_id, target_class)

    @patch("main.get_user_id", return_value="student-1")
    def test_browser_material_guide_uses_explicitly_selected_class(self, _auth):
        class_id = "66666666-6666-4666-8666-666666666666"
        turn = {
            "id": "session-1",
            "run_id": "run-5",
            "active_skill": "build_guide",
            "conversation_version": 13,
            "messages": [{"role": "user", "text": "Build the Exam 1 guide"}],
        }
        completed = {**turn, "status": "idle", "conversation_version": 14}
        table = MagicMock()
        table.insert.return_value = table
        table.execute.return_value = MagicMock(data=[{
            "id": "77777777-7777-4777-8777-777777777777",
            "title": "Exam 1 material — Study Guide",
            "folder_id": class_id,
        }])
        db = MagicMock()
        db.table.return_value = table

        with patch("main.get_supabase", return_value=db), \
             patch("main.claim_tutor_turn", return_value=turn), \
             patch("main.complete_tutor_turn", return_value=completed), \
             patch("main.public_tutor_session", return_value={"id": "session-1", "status": "idle"}), \
             patch("main.check_usage", return_value={"used": 0}), \
             patch("main.record_usage"), \
             patch("main._learning_guidance", return_value=""), \
             patch("main.generate_study_guide", return_value="Q1: What is a proposition?\nA1: A declarative statement."), \
             patch("main.study_guide_to_flashcards", return_value=[{"front": "What is a proposition?", "back": "A declarative statement."}]), \
             patch("main.study_guide_is_complete", return_value=True):
            response = self.client.post(
                "/chat",
                headers={"Authorization": "Bearer test"},
                json={
                    "question": "Build the Exam 1 guide",
                    "content": "Source: Exam review\nA proposition is a declarative statement.",
                    "context_title": "Exam 1 material",
                    "context_url": "https://school.instructure.com/courses/4/pages/exam-review",
                    "class_id": class_id,
                    "session_id": "session-1",
                    "conversation_version": 13,
                    "skill": "build_guide",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["action"], "created_guide")
        self.assertEqual(table.insert.call_args.args[0]["folder_id"], class_id)


if __name__ == "__main__":
    unittest.main()
