"""The upload boxes and the server accept exactly the same file types, and each type is really read.

Sample files are in tests/fixtures/uploads: an iPhone-style HEIC photo stored sideways with an EXIF
rotation, a BMP and a TIFF scan, and an old PowerPoint 97 (.ppt) deck exported by LibreOffice.
"""
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image
from pypdf import PdfWriter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "tests" / "fixtures" / "uploads"

from routers import materials
from services import file_extraction as files
from services.pptx_rendering import PptxRenderError


def sample(name):
    return (SAMPLES / name).read_bytes()


def decoded_image(data_url):
    header, data = data_url.split(";base64,", 1)
    return header[len("data:"):], Image.open(io.BytesIO(base64.b64decode(data)))


def web_upload_module(expression):
    node = shutil.which("node")
    if not node:  # CI always has node (the verify job installs it before the unit tests run)
        raise unittest.SkipTest("node is not installed")
    script = f"import * as m from {json.dumps((ROOT / 'web' / 'lib' / 'uploadTypes.mjs').as_uri())}; console.log(JSON.stringify({expression}));"
    out = subprocess.run([node, "--no-warnings", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60, check=True)
    return json.loads(out.stdout)


class PickerMatchesServerTests(unittest.TestCase):
    def test_the_upload_boxes_accept_exactly_the_server_types(self):
        web = web_upload_module("m.UPLOAD_TYPES")
        self.assertEqual(len(web), len(set(web)), "web/lib/uploadTypes.mjs lists a type twice")
        self.assertEqual(set(web), set(files.UPLOAD_TYPES))
        self.assertEqual(web_upload_module("m.UPLOAD_ACCEPT"), ",".join(f".{t}" for t in web))

    def test_both_sides_say_the_same_thing_about_unreadable_types(self):
        names = ["essay.doc", "notes.rtf", "notes.odt", "essay.pages", "talk.key", "data.numbers", "archive.zip", "noextension"]
        web = web_upload_module(f"{json.dumps(names)}.map(m.uploadTypeProblem)")
        server = [files.unsupported_detail(files.extension_of(name)) for name in names]
        self.assertEqual(web, server)
        self.assertEqual(server[0], "Save this as .docx first, then upload it.")
        self.assertEqual(server[3], "Export this as a PDF first, then upload it.")

    def test_types_the_server_cannot_read_are_refused_before_any_work(self):
        for name in ("essay.doc", "notes.rtf", "clip.mp4", "photo.avif", "drawing.svg"):
            with self.subTest(name=name), self.assertRaises(HTTPException) as caught:
                materials.readable_text("user-1", name, b"not read")
            self.assertEqual(caught.exception.status_code, 415)


class ConvertedImageTests(unittest.TestCase):
    def test_iphone_heic_photo_becomes_an_upright_jpeg(self):
        media, image = decoded_image(files.image_data_url(sample("notes-photo.heic"), "heic"))
        self.assertEqual(media, "image/jpeg")
        self.assertEqual(image.format, "JPEG")
        self.assertEqual(image.size, (200, 320))  # stored 320x200 with EXIF orientation 6

    def test_bmp_and_tiff_scans_become_jpeg(self):
        for name, extension in (("scan.bmp", "bmp"), ("scan.tiff", "tiff"), ("scan.tiff", "tif")):
            with self.subTest(name=name, extension=extension):
                media, image = decoded_image(files.image_data_url(sample(name), extension))
                self.assertEqual((media, image.format, image.size), ("image/jpeg", "JPEG", (320, 200)))

    def test_large_photos_are_shrunk_to_the_long_side_limit(self):
        out = io.BytesIO()
        Image.new("RGB", (4032, 3024), "white").save(out, "TIFF")
        _, image = decoded_image(files.image_data_url(out.getvalue(), "tiff"))
        self.assertEqual(image.size, (files.MAX_CONVERTED_SIDE, 1536))

    def test_photos_over_the_pixel_limit_are_refused_before_decoding(self):
        with patch.object(files, "MAX_CONVERTED_PIXELS", 320 * 200 - 1), self.assertRaises(HTTPException) as caught:
            files.image_data_url(sample("scan.tiff"), "tiff")
        self.assertEqual(caught.exception.status_code, 413)

    def test_formats_the_models_read_are_sent_as_they_are(self):
        self.assertEqual(files.image_data_url(b"12", "png"), "data:image/png;base64,MTI=")

    def test_a_broken_photo_is_a_readable_error(self):
        with self.assertRaises(HTTPException) as caught:
            files.image_data_url(b"not really a photo", "heic")
        self.assertEqual(caught.exception.status_code, 422)

    def test_heic_upload_reaches_the_reader_as_jpeg_and_costs_one_reading_action(self):
        seen = {}

        def transcribe(url):
            seen["url"] = url
            return "Mitosis: one cell becomes two"

        with patch.object(materials, "transcribe_study_image", side_effect=transcribe), \
                patch.object(materials, "require") as require, patch.object(materials, "record") as record:
            result = materials.readable_text("user-1", "IMG_0042.HEIC", sample("notes-photo.heic"))
        self.assertEqual(result, {"text": "Mitosis: one cell becomes two"})
        self.assertTrue(seen["url"].startswith("data:image/jpeg;base64,"))
        require.assert_called_once_with("user-1", "light")
        record.assert_called_once_with("user-1", "light")


def pdf_with_text_page():
    # A one-page PDF standing in for LibreOffice's output when the real converter isn't installed.
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


class OldPowerPointTests(unittest.TestCase):
    def test_ppt_goes_through_the_slide_viewer_conversion(self):
        with patch.object(materials, "render_pptx_to_pdf", return_value=pdf_with_text_page()) as render, \
                patch.object(files, "pdf_text", return_value="Cell cycle\nInterphase comes before mitosis"):
            result = materials.readable_text("user-1", "week3.ppt", sample("cell-cycle.ppt"))
        render.assert_called_once_with(sample("cell-cycle.ppt"), ".ppt")
        self.assertIn("Interphase", result["text"])

    def test_a_ppt_the_converter_cannot_read_says_to_save_as_pptx(self):
        with patch.object(materials, "render_pptx_to_pdf", side_effect=PptxRenderError("bad")):
            with self.assertRaises(HTTPException) as caught:
                materials.readable_text("user-1", "week3.ppt", b"broken")
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("Save it as .pptx", caught.exception.detail)

    @unittest.skipUnless(shutil.which("soffice"), "LibreOffice is not installed here (the server image has it)")
    def test_real_ppt_file_is_read_with_libreoffice(self):
        text = materials.readable_text("user-1", "cell-cycle.ppt", sample("cell-cycle.ppt"))["text"]
        self.assertIn("Cell cycle", text)
        self.assertIn("Interphase comes before mitosis", text)


if __name__ == "__main__":
    unittest.main()
