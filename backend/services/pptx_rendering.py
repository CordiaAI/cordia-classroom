"""Temporary, bounded PPTX-to-PDF conversion for the SmartNotes viewer."""

from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory


class PptxRenderError(RuntimeError):
    """Raised when a presentation cannot be rendered safely."""


class PptxRenderTimeout(PptxRenderError):
    """Raised when LibreOffice exceeds the conversion time limit."""


class PptxRenderUnavailable(PptxRenderError):
    """Raised when the LibreOffice executable is unavailable."""


def render_pptx_to_pdf(content_bytes: bytes, suffix: str = ".pptx") -> bytes:
    """Convert presentation bytes (.pptx, .ppt, .odp) to PDF bytes without persisting either file."""
    with TemporaryDirectory(prefix="autostudy-pptx-") as directory:
        workdir = Path(directory)
        source = workdir / f"presentation{suffix}"
        output = workdir / "presentation.pdf"
        source.write_bytes(content_bytes)

        profile_uri = (workdir / "libreoffice-profile").as_uri()
        args = [
            "soffice",
            "--headless",
            f"-env:UserInstallation={profile_uri}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(workdir),
            str(source),
        ]

        try:
            result = subprocess.run(
                args,
                check=False,
                capture_output=True,
                timeout=90,  # large image-heavy decks on a cold, single-CPU machine
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise PptxRenderTimeout("PPTX rendering timed out") from exc
        except FileNotFoundError as exc:
            raise PptxRenderUnavailable("PPTX renderer is unavailable") from exc
        except OSError as exc:
            raise PptxRenderError("PPTX renderer could not start") from exc

        if result.returncode != 0:
            raise PptxRenderError("PPTX rendering failed")
        if not output.is_file():
            raise PptxRenderError("PPTX renderer produced no PDF")

        pdf_bytes = output.read_bytes()
        if not pdf_bytes.startswith(b"%PDF-"):
            raise PptxRenderError("PPTX renderer produced an invalid PDF")
        return pdf_bytes
