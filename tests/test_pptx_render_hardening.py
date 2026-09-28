from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import main as main_module  # noqa: E402
from services.pptx_rendering import (  # noqa: E402
    PptxRenderUnavailable,
    render_pptx_to_pdf,
)


class PptxRenderHardeningTests(unittest.TestCase):
    def test_uses_isolated_libreoffice_profile(self):
        observed_args = []

        def fake_run(args, **kwargs):
            observed_args.extend(args)
            output_dir = Path(args[args.index("--outdir") + 1])
            (output_dir / "presentation.pdf").write_bytes(b"%PDF-1.7 rendered")
            return subprocess.CompletedProcess(args, 0, b"", b"")

        with patch("services.pptx_rendering.subprocess.run", side_effect=fake_run):
            render_pptx_to_pdf(b"PK\x03\x04 presentation")

        self.assertTrue(any(arg.startswith("-env:UserInstallation=file:///") for arg in observed_args))

    def test_missing_renderer_is_server_error(self):
        client = TestClient(main_module.app)
        with (
            patch.object(main_module, "get_user_id", return_value="user-1"),
            patch.object(main_module, "render_pptx_to_pdf", side_effect=PptxRenderUnavailable("unavailable")),
        ):
            response = client.post(
                "/render-pptx",
                files={"file": ("lecture.pptx", b"PK\x03\x04 presentation")},
                headers={"Authorization": "Bearer test"},
            )
        self.assertEqual(response.status_code, 500)

    def test_endpoint_offloads_blocking_conversion(self):
        source = (BACKEND / "main.py").read_text(encoding="utf-8")
        self.assertIn("await run_in_threadpool(render_pptx_to_pdf, content_bytes, suffix)", source)


if __name__ == "__main__":
    unittest.main()
