"""Turning captured or uploaded material into study guides.

Pipeline: the extension or web app sends a page (/ingest) or a file
(/extract-file-text); the student reviews the sections; /generate builds the
guide. /render-pptx previews slide decks.
"""
import logging

from fastapi import APIRouter, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from auth_utils import get_user_id
from rate_limit import limiter
from schemas import GenerateRequest, GenerateResponse, IngestRequest, IngestResponse
from services import file_extraction as files
from services.entitlements import record, require
from services.guidance import learning_guidance
from services.llm import (
    analyze_images_for_slides, generate_flashcards, generate_notes_ai, generate_study_guide,
    study_guide_is_complete, study_guide_to_flashcards, transcribe_document_pages, transcribe_study_image,
)
from services.pptx_rendering import PptxRenderError, PptxRenderTimeout, PptxRenderUnavailable, render_pptx_to_pdf
from services.text_processing import (
    build_review_sections, chunk_text, clean_text, extract_slideshow_content, format_slideshow_text,
    inject_image_descriptions, inject_page_image_descriptions, is_slideshow_content,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["materials"])

MAX_CONTENT_LENGTH = 500_000
SLIDE_DECK_TYPES = (".pptx", ".ppt", ".odp")
SCREENSHOT_ONLY = "[Screenshot fallback]"


@router.post("/render-pptx")
@limiter.limit("20/minute")
async def render_pptx(request: Request, file: UploadFile = None, authorization: str = Header(default="")):
    """Render an uploaded slide deck to an inline PDF without keeping either file."""
    get_user_id(authorization)
    if file is None:
        raise HTTPException(status_code=400, detail="No file uploaded")
    suffix = next((ext for ext in SLIDE_DECK_TYPES if (file.filename or "").lower().endswith(ext)), None)
    if not suffix:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PPTX, PPT, or ODP.")
    data = files.read_upload(file)
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")
    try:
        pdf = await run_in_threadpool(render_pptx_to_pdf, data, suffix)
    except PptxRenderTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except PptxRenderUnavailable as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except PptxRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": "inline"})


@router.post("/extract-file-text")
@limiter.limit("20/minute")
def extract_file_text(request: Request, file: UploadFile = None, authorization: str = Header(default="")):
    """Extract plain text from an uploaded PDF, DOCX, PPTX, image, or text file."""
    user_id = get_user_id(authorization)
    if file is None:
        raise HTTPException(status_code=400, detail="No file uploaded")
    extension = files.extension_of(file.filename)
    data = files.read_upload(file)

    if extension == "pptx":
        return files.pptx_slides(data)
    if extension == "pdf":
        reader = files.open_pdf(data)
        text = files.pdf_text(reader)
        if len(text.strip()) < 200:
            scans = files.pdf_page_scans(reader)
            if scans:
                require(user_id, "light")
                text = transcribe_document_pages(scans) or text
                record(user_id, "light")
    elif extension == "docx":
        text = files.docx_text(data)
    elif extension in files.IMAGE_TYPES:
        image_url = files.image_data_url(data, extension)
        require(user_id, "light")
        text = transcribe_study_image(image_url)
        if not text:
            raise HTTPException(status_code=422, detail="No educational content found in this image.")
        record(user_id, "light")
    else:
        text = files.plain_text(data, extension)

    if len(text.strip()) < 10:
        raise HTTPException(status_code=422, detail="No readable text found in this file.")
    return {"text": text[:files.MAX_TEXT_CHARS]}


@router.post("/ingest", response_model=IngestResponse)
@limiter.limit("30/minute")
def ingest(body: IngestRequest, request: Request, authorization: str = Header(default="")):
    """Split a captured page into sections the student reviews before generating."""
    user_id = get_user_id(authorization)
    content = (body.content or "")[:MAX_CONTENT_LENGTH]
    if not content:
        raise HTTPException(status_code=400, detail="Content too short")

    is_slideshow, _ = is_slideshow_content(content)
    images = [{"data": i.data, "slide_index": i.slide_index, "context": i.context, "alt": i.alt} for i in body.images[:10]]

    # A screenshot-only capture has no page text: transcribe it now so the student
    # reviews it like any other text, and don't send the image to vision a second time.
    if images and content.strip() == SCREENSHOT_ONLY:
        require(user_id, "light")
        descriptions = analyze_images_for_slides(images)
        visual_text = "\n\n".join(descriptions.values()) if descriptions else ""
        if visual_text:
            record(user_id, "light")
            content = visual_text
            images = []
        else:
            logger.warning("Screenshot fallback produced no readable educational text")

    sections = build_review_sections(content)
    logger.info("Prepared capture slideshow=%s images=%s sections=%s", is_slideshow, len(images), len(sections))
    return IngestResponse(
        content_type=body.content_type,
        detected_slideshow=is_slideshow,
        is_educational=bool(sections),
        sections=sections,
        excluded_summary="",
        use_images=bool(images),
    )


def _study_chunks(raw_text: str, images: list) -> tuple:
    """Chunks for the guide prompt, with image descriptions woven in. Returns (chunks, has_images).

    Direct API clients may send slide markup; that keeps one chunk per slide. Reviewed
    browser captures arrive as plain text.
    """
    slides = extract_slideshow_content(raw_text) if is_slideshow_content(raw_text)[0] else None
    if slides:
        logger.info("Extracted %s slides", len(slides))
        text = format_slideshow_text(slides)
    else:
        text = clean_text(raw_text)

    if images:
        slide_text = {i: slide.get("content", []) for i, slide in enumerate(slides or [])}
        descriptions = analyze_images_for_slides(images, slide_text)
        if descriptions:
            logger.info("Got %s image descriptions for %s images", len(descriptions), len(images))
            if slides:
                slides = inject_image_descriptions(slides, descriptions)
                return chunk_text(format_slideshow_text(slides), slides=slides), True
            return chunk_text(inject_page_image_descriptions(text, descriptions)), True
    return chunk_text(text, slides=slides), False


def _guide(user_id: str, chunks: list, has_images: bool) -> tuple:
    study_guide = generate_study_guide(chunks, has_images=has_images, learning_guidance=learning_guidance(user_id))
    if not study_guide:
        raise HTTPException(status_code=422, detail="CordiaClassroom could not build a guide from this material.")
    cards = study_guide_to_flashcards(study_guide)
    if not cards or not study_guide_is_complete(study_guide):
        raise HTTPException(status_code=422, detail="CordiaClassroom received an incomplete guide. Please try again.")
    return study_guide, cards


@router.post("/generate", response_model=GenerateResponse)
@limiter.limit("15/minute")
def generate(body: GenerateRequest, request: Request, authorization: str = Header(default="")):
    """Build notes, a study guide, and/or flashcards from the sections the student kept."""
    user_id = get_user_id(authorization)
    raw_text = (body.content or "")[:MAX_CONTENT_LENGTH]
    if not raw_text:
        raise HTTPException(status_code=422, detail="Select at least one study section")
    require(user_id, "guide")

    chunks, has_images = _study_chunks(raw_text, [image.model_dump() for image in body.images])
    if not chunks:
        logger.warning("No content chunks after cleaning")
        return GenerateResponse(notes="No meaningful content found to process.")

    notes = None
    if body.notes:
        points = generate_notes_ai("\n\n".join(chunks))
        notes = "\n".join(f"- {point}" for point in points) if points else None

    study_guide, guide_cards = _guide(user_id, chunks, has_images) if body.study_guide else (None, [])

    flashcards = None
    if body.flashcards:
        # Cards come from the guide when there is one, so guide and cards can't disagree.
        flashcards = guide_cards if study_guide else generate_flashcards(chunks)
        if not flashcards:
            raise HTTPException(status_code=422, detail="CordiaClassroom could not build flashcards from this material.")

    record(user_id, "guide", body.request_id)
    return GenerateResponse(notes=notes, study_guide=study_guide, flashcards=flashcards)
