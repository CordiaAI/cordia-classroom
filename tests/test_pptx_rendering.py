from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.pptx_rendering import (  # noqa: E402
    PptxRenderError,
    PptxRenderTimeout,
    render_pptx_to_pdf,
)


class PptxRenderingTests(unittest.TestCase):
    def test_returns_valid_pdf_and_removes_temporary_directory(self):
        observed = {}

        def fake_run(args, **kwargs):
            output_dir = Path(args[args.index("--outdir") + 1])
            observed["directory"] = output_dir
            observed["args"] = args
            observed["kwargs"] = kwargs
            (output_dir / "presentation.pdf").write_bytes(b"%PDF-1.7 rendered")
            return subprocess.CompletedProcess(args, 0, b"", b"")

        with patch("services.pptx_rendering.subprocess.run", side_effect=fake_run):
            result = render_pptx_to_pdf(b"PK\x03\x04 presentation")

        self.assertEqual(result, b"%PDF-1.7 rendered")
        self.assertFalse(observed["directory"].exists())
        self.assertEqual(observed["args"][0], "soffice")
        self.assertEqual(observed["kwargs"]["timeout"], 90)
        self.assertFalse(observed["kwargs"]["shell"])

    def test_rejects_invalid_pdf_output(self):
        def fake_run(args, **kwargs):
            output_dir = Path(args[args.index("--outdir") + 1])
            (output_dir / "presentation.pdf").write_bytes(b"not a pdf")
            return subprocess.CompletedProcess(args, 0, b"", b"")

        with patch("services.pptx_rendering.subprocess.run", side_effect=fake_run):
            with self.assertRaises(PptxRenderError):
                render_pptx_to_pdf(b"PK\x03\x04 presentation")

    def test_maps_missing_renderer(self):
        with patch("services.pptx_rendering.subprocess.run", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(PptxRenderError, "unavailable"):
                render_pptx_to_pdf(b"PK\x03\x04 presentation")

    def test_maps_conversion_timeout(self):
        timeout = subprocess.TimeoutExpired("soffice", 30)
        with patch("services.pptx_rendering.subprocess.run", side_effect=timeout):
            with self.assertRaises(PptxRenderTimeout):
                render_pptx_to_pdf(b"PK\x03\x04 presentation")


if __name__ == "__main__":
    unittest.main()
