"""CordiaClassroom API for processing educational content and study materials."""

import os
import re
import json
import logging
import traceback
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Header, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.concurrency import run_in_threadpool

from schemas import (
    IngestRequest, IngestResponse,
    GenerateRequest, GenerateResponse,
    PracticeRequest, PracticeGradeRequest,
    PracticeProgressRequest, PracticeRecognizeRequest,
)
from services.text_processing import (
    clean_text, chunk_text,
    is_slideshow_content, extract_slideshow_content,
    format_slideshow_text, inject_image_descriptions,
    inject_page_image_descriptions, build_review_sections, html_to_text,
)
from services.llm import (
    generate_notes_ai, generate_study_guide,
    generate_flashcards,
    analyze_images_for_slides, generate_verified_practice_set, grade_practice_answer, recognize_handwriting,
    transcribe_document_pages, transcribe_study_image,
    study_guide_is_complete, study_guide_to_flashcards,
)
from rate_limit import limiter
from routers import auth, chat, folders, guides, stats, search, quiz, billing, nclex, feedback, smart_notes, calendar, tutor, learning
from auth_utils import get_user_id
from database import get_supabase
from services.entitlements import record, require
from services.guidance import learning_guidance
from services import file_extraction as files
from services.pptx_rendering import (
    PptxRenderError,
    PptxRenderTimeout,
    PptxRenderUnavailable,
    render_pptx_to_pdf,
)
from services.tutor_sessions import append_tutor_message

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

# Configure logging — never log tokens or secrets
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="CordiaClassroom API",
    description="CordiaClassroom API for generating study materials from educational content",
    version="1.0.0",
    docs_url="/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url=None,
)

# Attach rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — restrict to known origins
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://classroom.cordiacode.com",
    "https://classroom.cordiaai.io",
]
if os.getenv("FRONTEND_URL"):
    ALLOWED_ORIGINS.append(os.getenv("FRONTEND_URL"))

# Only the published extension (plus any IDs in EXTENSION_IDS, e.g. an unpacked dev build)
# and this project's own Vercel previews may call the API from a browser.
EXTENSION_IDS = ["eddmfjcnfjfbaknmeccjbjdgpeipjbaf"] + [
    value.strip() for value in os.getenv("EXTENSION_IDS", "").split(",") if re.fullmatch(r"[a-p]{32}", value.strip())
]
ALLOWED_ORIGIN_REGEX = (
    r"chrome-extension://(" + "|".join(EXTENSION_IDS) + r")"
    r"|https://cordia-classroom(-[a-z0-9-]+-(itzjlaughs-projects|cordia-ai))?\.vercel\.app"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)
# Guide text compresses several-fold; small responses are left alone.
app.add_middleware(GZipMiddleware, minimum_size=1024)


# Shared response metadata and security headers
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    request_id = uuid4().hex[:12]
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Unhandled request error request_id=%s method=%s path=%s",
            request_id,
            request.method,
            request.url.path,
        )
        response = JSONResponse(status_code=500, content={"detail": "Unexpected server error"})
    else:
        if response.status_code >= 400:
            logger.warning(
                "Request failed request_id=%s status=%s method=%s path=%s",
                request_id,
                response.status_code,
                request.method,
                request.url.path,
            )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # HSTS — enforce HTTPS in production
    if os.getenv("ENVIRONMENT") == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# Include Supabase-backed routers
app.include_router(auth.router)
app.include_router(folders.router)
app.include_router(guides.router)
app.include_router(stats.router)
app.include_router(search.router)
app.include_router(quiz.router)
app.include_router(nclex.router)
app.include_router(billing.router)
app.include_router(feedback.router)
app.include_router(smart_notes.router)
app.include_router(calendar.router)
app.include_router(tutor.router)
app.include_router(chat.router)
app.include_router(learning.router)

# === Input sanitization helpers ===
MAX_CONTENT_LENGTH = 500_000  # 500KB max content
MAX_QUESTION_LENGTH = 2_000


def _sanitize_text(text: str, max_length: int = MAX_CONTENT_LENGTH) -> str:
    """Enforce length limits on text input."""
    if not text:
        return ""
    return text[:max_length]


@app.post("/render-pptx")
@limiter.limit("20/minute")
async def render_pptx(request: Request, file: UploadFile = None, authorization: str = Header(default="")):
    """Render an uploaded PPTX to an inline PDF without persisting either file."""
    get_user_id(authorization)
    if file is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    filename = (file.filename or "").lower()
    suffix = next((ext for ext in (".pptx", ".ppt", ".odp") if filename.endswith(ext)), None)
    if not suffix:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PPTX, PPT, or ODP.")

    content_bytes = await file.read()
    if len(content_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")
    if not content_bytes:
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        pdf_bytes = await run_in_threadpool(render_pptx_to_pdf, content_bytes, suffix)
    except PptxRenderTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except PptxRenderUnavailable as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except PptxRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )

@app.post("/extract-file-text")
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
        try:
            text = transcribe_study_image(image_url)
        except Exception as e:
            logger.error(f"Image extraction failed: {e}")
            raise HTTPException(status_code=422, detail="Could not extract content from image.")
        if not text:
            raise HTTPException(status_code=422, detail="No educational content found in this image.")
        record(user_id, "light")
    else:
        text = files.plain_text(data, extension)

    if len(text.strip()) < 10:
        raise HTTPException(status_code=422, detail="No readable text found in this file.")
    return {"text": text[:files.MAX_TEXT_CHARS]}


@app.get("/")
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "1.0.0"}


@app.post("/ingest", response_model=IngestResponse)
@limiter.limit("30/minute")
def ingest(body: IngestRequest, request: Request, authorization: str = Header(default="")):
    """
    Ingest page content for processing.
    Requires authentication. Rate limited.
    """
    try:
        # Require auth to prevent OpenAI credit abuse
        user_id = get_user_id(authorization)
        logger.info(f"Ingesting content for user={user_id[:8]}...")

        # Sanitize inputs
        content = _sanitize_text(body.content, MAX_CONTENT_LENGTH)
        if not content:
            raise HTTPException(status_code=400, detail="Content too short")

        logger.info(f"Content length: {len(content)} chars")

        # Detect if content is from a slideshow
        is_slideshow, _ = is_slideshow_content(content)

        # Convert image models to plain dictionaries for vision processing.
        images_data = []
        if body.images:
            for img in body.images[:10]:  # Max 10 images
                images_data.append({
                    "data": img.data,
                    "slide_index": img.slide_index,
                    "context": img.context,
                    "alt": img.alt,
                })

        # Screenshot-only capture has no DOM text. Transcribe visual material before
        # selection so it reaches the same student review step as page text.
        if images_data and content.strip() == "[Screenshot fallback]":
            require(user_id, "light")
            image_descriptions = analyze_images_for_slides(images_data)
            visual_text = "\n\n".join(image_descriptions.values()) if image_descriptions else ""
            if visual_text:
                record(user_id, "light")
                content = visual_text
                # The transcription is now the reviewable source. Do not retain
                # the screenshot for a second vision pass during generation.
                images_data = []
            else:
                logger.warning("Screenshot fallback produced no readable educational text")

        sections = build_review_sections(content)

        logger.info(
            "Prepared capture slideshow=%s, images=%s, sections=%s",
            is_slideshow,
            len(images_data),
            len(sections),
        )

        return IngestResponse(
            content_type=body.content_type,
            detected_slideshow=is_slideshow,
            is_educational=bool(sections),
            sections=sections,
            excluded_summary="",
            use_images=bool(images_data),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in /ingest: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to ingest content")


@app.post("/generate", response_model=GenerateResponse)
@limiter.limit("15/minute")
def generate(body: GenerateRequest, request: Request, authorization: str = Header(default="")):
    """
    Generate study materials from ingested content.
    Requires authentication. Rate limited.
    """
    try:
        user_id = get_user_id(authorization)
        logger.info(f"Generating materials for user={user_id[:8]}...")

        raw_text = _sanitize_text(body.content, MAX_CONTENT_LENGTH)
        if not raw_text:
            raise HTTPException(status_code=422, detail="Select at least one study section")

        # Validate allowance after the reviewed source text is valid.
        require(user_id, "guide")

        # Preserve structured slideshow handling for direct API clients that send
        # the original slide markup. Reviewed browser captures use plain text.
        slides = None
        is_slideshow, _ = is_slideshow_content(raw_text)
        if is_slideshow:
            slides = extract_slideshow_content(raw_text)
            if slides:
                # Format all slides as structured XML text — no AI compression
                # so every slide's content reaches generate_study_guide intact
                cleaned = format_slideshow_text(slides)
                logger.info(f"Extracted {len(slides)} slides")
            else:
                cleaned = clean_text(raw_text)
        else:
            cleaned = clean_text(raw_text)

        # Chunk the content for processing.
        # When slides are available, chunk_text produces one XML chunk per slide
        # instead of re-splitting the formatted text by paragraphs.
        chunks = chunk_text(cleaned, slides=slides)

        # Analyze images via GPT-4o vision if present, then inject descriptions
        captured_images = [image.model_dump() for image in body.images]
        has_images = False
        if captured_images:
            logger.info(f"Analyzing {len(captured_images)} images via vision API...")
            # Build slide text context for vision prompts
            slide_text_map = {}
            if slides:
                for i, s in enumerate(slides):
                    slide_text_map[i] = s.get("content", [])
            image_descs = analyze_images_for_slides(captured_images, slide_text_map)
            if image_descs:
                has_images = True
                logger.info(f"Got {len(image_descs)} image descriptions")
                if slides:
                    slides = inject_image_descriptions(slides, image_descs)
                    cleaned = format_slideshow_text(slides)
                    chunks = chunk_text(cleaned, slides=slides)
                else:
                    cleaned = inject_page_image_descriptions(cleaned, image_descs)
                    chunks = chunk_text(cleaned)
        if not chunks:
            logger.warning("No content chunks after cleaning")
            return GenerateResponse(
                notes="No meaningful content found to process.",
                study_guide=None,
                flashcards=None
            )

        # Generate requested materials
        notes_str = None
        study_guide = None
        flashcards = None
        guide_flashcards = []

        if body.notes:
            logger.info("Generating notes...")
            notes = generate_notes_ai('\n\n'.join(chunks))
            notes_str = '\n'.join(f"- {note}" for note in notes) if notes else None

        if body.study_guide:
            logger.info("Generating study guide...")
            study_guide = generate_study_guide(
                chunks,
                has_images=has_images,
                learning_guidance=learning_guidance(user_id),
            )
            if not study_guide or study_guide.startswith("[Error"):
                raise HTTPException(
                    status_code=422,
                    detail="CordiaClassroom could not build a guide from this material.",
                )
            guide_flashcards = study_guide_to_flashcards(study_guide)
            if not guide_flashcards or not study_guide_is_complete(study_guide):
                raise HTTPException(
                    status_code=422,
                    detail="CordiaClassroom received an incomplete guide. Please try again.",
                )

        if body.flashcards:
            logger.info("Generating flashcards...")
            # Reuse the canonical parser so guide and flashcard validation cannot drift.
            flashcards = guide_flashcards if study_guide else generate_flashcards(chunks)
            if not flashcards:
                raise HTTPException(status_code=422, detail="CordiaClassroom could not build flashcards from this material.")
            logger.info(f"Created {len(flashcards)} flashcards")

        record(user_id, "guide", body.request_id)
        return GenerateResponse(
            notes=notes_str,
            study_guide=study_guide,
            flashcards=flashcards
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in /generate: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to generate materials")


@app.post("/practice")
@limiter.limit("10/minute")
def create_practice_set(
    body: PracticeRequest,
    request: Request,
    authorization: str = Header(default=""),
):
    """Generate ten temporary practice problems from a guide or uploaded text."""
    user_id = get_user_id(authorization)
    content = _sanitize_text(body.content, MAX_CONTENT_LENGTH)
    title = (body.title or "Uploaded study material").strip() or "Uploaded study material"
    source = {"type": "upload", "title": title}
    domain = ""

    if body.guide_id:
        if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', body.guide_id, re.IGNORECASE):
            raise HTTPException(status_code=400, detail="That study guide link is not valid.")
        result = (
            get_supabase().table("study_guides")
            .select("id,title,study_guide,notes,domain")
            .eq("id", body.guide_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="That study guide is no longer available.")
        guide = result.data[0]
        content = _sanitize_text("\n\n".join(filter(None, [
            html_to_text(guide.get("notes") or ""),
            guide.get("study_guide") or "",
        ])), MAX_CONTENT_LENGTH)
        title = guide.get("title") or "Study Guide"
        domain = guide.get("domain") or ""
        source = {"type": "study_guide", "id": guide["id"], "title": title}

    if not content.strip():
        raise HTTPException(status_code=400, detail="Add a study guide or upload readable study material first.")

    require(user_id, "practice")
    practice = generate_verified_practice_set(content, learning_guidance(user_id), domain)
    problems = practice.get("problems", []) if isinstance(practice, dict) else []
    if len(problems) != 10:
        raise HTTPException(status_code=502, detail="Cordia could not verify a complete 10-problem set from this material. Please try another source or add more detail.")

    record(user_id, "practice")
    practice_set = {
        "title": f"{title} — Practice",
        "source": source,
        "subject_area": practice.get("subject_area") or domain or "General study",
        "domain": practice.get("domain") or domain or "general",
        "truth_note": practice.get("truth_note"),
        "problems": problems,
    }
    if source.get("type") == "study_guide":
        # A new set replaces the guide's saved set and clears its progress.
        get_supabase().table("study_guides").update({"practice_state": {**practice_set, "progress": {}}}) \
            .eq("id", source["id"]).eq("user_id", user_id).execute()
    return practice_set


def _owned_guide_practice(guide_id: str, user_id: str):
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', guide_id or "", re.IGNORECASE):
        raise HTTPException(status_code=400, detail="That study guide link is not valid.")
    result = get_supabase().table("study_guides").select("id, practice_state") \
        .eq("id", guide_id).eq("user_id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="That study guide is no longer available.")
    return result.data[0].get("practice_state")


@app.get("/practice/{guide_id}/state")
def get_practice_state(guide_id: str, authorization: str = Header(default="")):
    """Return the guide's saved practice set and progress, or null when none exists."""
    return {"practice": _owned_guide_practice(guide_id, get_user_id(authorization))}


@app.put("/practice/{guide_id}/state")
@limiter.limit("120/minute")
def save_practice_progress(guide_id: str, body: PracticeProgressRequest, request: Request, authorization: str = Header(default="")):
    """Save answers, results, and typed work for the guide's current practice set."""
    user_id = get_user_id(authorization)
    practice = _owned_guide_practice(guide_id, user_id)
    if not practice:
        raise HTTPException(status_code=404, detail="Generate a practice set first.")
    if len(json.dumps(body.progress)) > 200_000:
        raise HTTPException(status_code=413, detail="Practice progress is too large to save.")
    get_supabase().table("study_guides").update({"practice_state": {**practice, "progress": body.progress}}) \
        .eq("id", guide_id).eq("user_id", user_id).execute()
    return {"saved": True}


@app.post("/practice/grade")
@limiter.limit("60/minute")
def grade_practice(body: PracticeGradeRequest, request: Request, authorization: str = Header(default="")):
    """Mark one practice answer right or wrong, with an explanation when it is wrong."""
    user_id = get_user_id(authorization)
    result = grade_practice_answer(body.prompt, body.reference, body.worked_solution, body.student_answer, body.work)
    if not result:
        raise HTTPException(status_code=502, detail="Cordia could not check this answer. Please try again.")
    if not result["correct"] and result["explanation"]:
        # The Tutor replies to a missed answer; the page only shows Right / Not quite.
        try:
            append_tutor_message(user_id, result["explanation"])
        except Exception as e:
            logger.warning(f"Could not post practice feedback to Tutor: {e}")
    return result


@app.post("/practice/recognize")
@limiter.limit("20/minute")
def recognize_practice_handwriting(body: PracticeRecognizeRequest, request: Request, authorization: str = Header(default="")):
    """Turn a drawing from the practice workspace into clean typed text."""
    get_user_id(authorization)
    text = recognize_handwriting(body.image)
    if text is None:
        raise HTTPException(status_code=502, detail="Cordia could not read this drawing. Please try again.")
    return {"text": text}


# The Tutor model's context window (gpt-4o-mini: 128k tokens), less room for its reply and
# instructions. Estimated at ~3.5 characters per token, which errs on the side of stopping early.

