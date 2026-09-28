from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class SmartNotesUploadContractTests(unittest.TestCase):
    def test_form_data_upload_does_not_use_json_auth_headers(self):
        source = (ROOT / "web" / "pages" / "smartnotes.js").read_text(encoding="utf-8")
        upload_start = source.index("authorizedFetch('/extract-file-text'")
        upload_end = source.index(".then(async r =>", upload_start)
        upload_call = source[upload_start:upload_end]
        self.assertNotIn("authHeaders()", upload_call)

        # authorizedFetch sends only the Authorization header, so FormData keeps its multipart boundary.
        api = (ROOT / "web" / "lib" / "api.js").read_text(encoding="utf-8")
        helper = api[api.index("export async function authorizedFetch"):api.index("export async function apiFetch")]
        self.assertIn("authOnlyHeaders()", helper)
        self.assertNotIn("authHeaders()", helper)


if __name__ == "__main__":
    unittest.main()
