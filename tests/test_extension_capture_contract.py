import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ExtensionCaptureContractTests(unittest.TestCase):
    def setUp(self):
        self.worker = (ROOT / "extension" / "background.js").read_text(encoding="utf-8")
        self.panel = (ROOT / "extension" / "popup.js").read_text(encoding="utf-8")
        self.html = (ROOT / "extension" / "popup.html").read_text(encoding="utf-8")
        self.scraper = (ROOT / "extension" / "content.js").read_text(encoding="utf-8")
        self.manifest = json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))

    def test_one_button_runs_the_four_step_study_workflow(self):
        self.assertIn("captureScreen, scrapePage, extractEducationalContent, createStudyGuide, saveStudyGuide", self.worker)
        self.assertEqual(self.html.count('class="step"'), 4)
        self.assertEqual(self.html.count('id="make-guide"'), 1)
        for action in ("captureScreen", "scrapePage", "extractEducationalContent", "createStudyGuide"):
            self.assertIn(f"action: '{action}'", self.panel)
        for removed in ("getTutorSession", "setTutorSkill", "updateBrowserContext", "requestActiveTabAccess"):
            self.assertNotIn(removed, self.worker + self.panel)

    def test_panel_defers_save_and_redirects_only_after_confirmation(self):
        self.assertIn("action: 'saveStudyGuide'", self.panel)
        self.assertIn("if (!saved?.guide?.id)", self.worker)
        self.assertIn("chrome.tabs.update(message.tabId", self.worker)
        self.assertIn("chrome.tabs.create({ url: guideUrl })", self.worker)
        self.assertIn("classroom.cordiacode.com/guide/", self.worker)
        self.assertIn('id="save-bubble"', self.html)
        self.assertIn('Save to Classroom', self.html)

    def test_site_access_is_declared_not_runtime_choreography(self):
        self.assertEqual(self.manifest["host_permissions"], ["<all_urls>"])
        self.assertNotIn("optional_host_permissions", self.manifest)
        self.assertNotIn("addHostAccessRequest", self.worker)

    def test_capture_permission_failure_falls_back_to_page_reading(self):
        self.assertIn("step('capture', 'skipped')", self.panel)
        self.assertIn("await capture();", self.panel)
        self.assertIn("await scrape();", self.panel)
        self.assertIn("Chrome could not read or capture this page", self.panel)

    def test_scraper_uses_readability_with_lms_fallback(self):
        self.assertTrue((ROOT / "extension" / "vendor" / "Readability.js").exists())
        self.assertIn("new Readability(copy", self.scraper)
        self.assertIn(".ic-Layout-contentMain", self.scraper)
        self.assertIn("window.getSelection()", self.scraper)
        self.assertIn("iframe[src], embed[src], object[data], a[href]", self.scraper)
        self.assertIn("normalizeCanvasDownload", self.scraper)

    def test_documents_are_downloaded_from_extension_origin(self):
        self.assertIn("async function extractDocument", self.worker)
        self.assertIn("credentials: 'include'", self.worker)
        self.assertIn("new FormData()", self.worker)
        self.assertIn("'/extract-file-text'", self.worker)
        self.assertNotIn("fetchFile", self.scraper)

    def test_screen_capture_and_generation_reuse_existing_backend(self):
        self.assertIn("chrome.tabs.captureVisibleTab", self.worker)
        self.assertIn("apiFetch('/ingest'", self.worker)
        self.assertIn("apiFetch('/generate'", self.worker)
        self.assertIn("apiFetch('/guides'", self.worker)
        self.assertIn("'[Screenshot fallback]'", self.panel)

    def test_title_uses_content_instead_of_file_preview(self):
        self.assertIn("function chooseGuideTitle()", self.panel)
        self.assertIn("(?:exam|test|quiz)", self.panel)
        self.assertIn("file\\s*preview", self.panel)

    def test_panel_removes_current_tab_and_duplicate_connection_controls(self):
        self.assertNotIn("Current tab", self.html)
        self.assertNotIn("disconnect", self.html.lower())
        self.assertEqual(self.html.count('role="status"'), 1)

    def test_panel_has_direct_contextual_tutor_without_session_polling(self):
        self.assertIn('id="tutor-form"', self.html)
        self.assertIn("action: 'askTutor'", self.panel)
        self.assertIn("apiFetch('/chat'", self.worker)
        self.assertNotIn("'/tutor/session'", self.worker + self.panel)

    def test_extension_reuses_classroom_session_without_password_form(self):
        bridge = (ROOT / "extension" / "asai-bridge.js").read_text(encoding="utf-8")
        self.assertNotIn('type="password"', self.html)
        self.assertIn("localStorage.getItem('authToken')", bridge)
        self.assertIn("chrome.storage.local.set", bridge)
        self.assertIn("forceRefresh", bridge)
        self.assertIn("localStorage.setItem('refreshToken'", bridge)
        self.assertNotIn("refreshToken:", self.worker)
        self.assertIn("validateClassroomAuth", self.worker)
        self.assertIn("apiFetch('/auth/me')", self.worker)
        self.assertIn("syncClassroomAuth", self.worker)
        self.assertIn("chrome.storage.onChanged.addListener", self.panel)
        self.assertIn("window.addEventListener('focus', initAuth)", self.panel)

    def test_custom_extension_code_is_small(self):
        self.assertLess(len(self.worker.splitlines()), 220)
        self.assertLess(len(self.panel.splitlines()), 290)
        # 170: shadow-DOM/frame text, Google export, and capture ordering (2026-09-27 capture audit).
        self.assertLess(len(self.scraper.splitlines()), 170)


if __name__ == "__main__":
    unittest.main()
