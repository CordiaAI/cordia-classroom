"""CordiaClassroom API for processing educational content and study materials."""

import os
import re
import html
import logging
import traceback
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Header, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.concurrency import run_in_threadpool

from schemas import (
    IngestRequest, IngestResponse,
    GenerateRequest, GenerateResponse,
    ChatRequest, ChatResponse, PracticeRequest
)
from services.text_processing import (
    clean_text, chunk_text,
    is_slideshow_content, extract_slideshow_content,
    format_slideshow_text, inject_image_descriptions,
    inject_page_image_descriptions, build_review_sections
)
from services.llm import (
    generate_notes_ai, generate_study_guide,
    generate_flashcards, answer_question, explain_retain_answer,
    analyze_images_for_slides, generate_practice_guide, generate_verified_practice_set,
    study_guide_is_complete, study_guide_to_flashcards,
)
from routers import auth, folders, guides, stats, search, quiz, billing, nclex, exam, feedback, smart_notes, calendar, tutor
from auth_utils import get_user_id
from database import get_supabase
from routers.billing import check_usage, record_usage
from services.pptx_rendering import (
    PptxRenderError,
    PptxRenderTimeout,
    PptxRenderUnavailable,
    render_pptx_to_pdf,
)
from services.tutor_sessions import (
    claim_tutor_turn,
    complete_tutor_turn,
    fail_tutor_turn,
    public_tutor_session,
    queue_browser_command,
    TUTOR_SAFETY_POLICY,
    tutor_skill_instruction,
    wait_for_browser_result,
)

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

# Configure logging — never log tokens or secrets
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Rate limiter — keyed by IP address
limiter = Limiter(key_func=get_remote_address)

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
    "https://autostudyai.online",
    "https://www.autostudyai.online",
    "https://classroom.cordiacode.com",
]
if os.getenv("FRONTEND_URL"):
    ALLOWED_ORIGINS.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"chrome-extension://.*|https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)


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
app.include_router(exam.router)
app.include_router(billing.router)
app.include_router(feedback.router)
app.include_router(smart_notes.router)
app.include_router(calendar.router)
app.include_router(tutor.router)

def _learning_guidance(user_id: str) -> str:
    try:
        from routers.stats import learning_profile_for_user
        return learning_profile_for_user(user_id)["generation_guidance"]
    except Exception:
        return ""


# === Input sanitization helpers ===
MAX_CONTENT_LENGTH = 500_000  # 500KB max content
MAX_QUESTION_LENGTH = 2_000


def _sanitize_text(text: str, max_length: int = MAX_CONTENT_LENGTH) -> str:
    """Enforce length limits on text input."""
    if not text:
        return ""
    return text[:max_length]


def _plain_context(text: str) -> str:
    """Turn SmartNote HTML into readable model context without another parser."""
    if not re.search(r"<[^>]+>", text or ""):
        return text
    text = re.sub(r"</?(?:p|div|li|h[1-6]|blockquote|br)[^>]*>", "\n", text, flags=re.IGNORECASE)
    return html.unescape(re.sub(r"<[^>]+>", "", text))


def _verified_retain_context(body: ChatRequest, content: str):
    """Validate that a queued Retain explanation still belongs to the owned guide."""
    retain = body.retain_context
    if not retain:
        return None
    if not body.guide_id:
        raise HTTPException(status_code=400, detail="A Retain explanation requires its study guide")
    if retain.selected_answer not in retain.options or retain.correct_answer not in retain.options:
        raise HTTPException(status_code=400, detail="Retain answers do not match the question choices")
    if retain.selected_answer == retain.correct_answer:
        raise HTTPException(status_code=400, detail="This Retain answer is already correct")

    normalized_source = re.sub(r"\s+", " ", content).casefold()
    normalized_question = re.sub(r"\s+", " ", retain.question).casefold()
    normalized_answer = re.sub(r"\s+", " ", retain.correct_answer).casefold()
    if normalized_question not in normalized_source or normalized_answer not in normalized_source:
        raise HTTPException(status_code=409, detail="This Retain question no longer matches the selected guide")
    return retain


@app.post("/render-pptx")
@limiter.limit("20/minute")
async def render_pptx(request: Request, file: UploadFile = None, authorization: str = Header(default="")):
    """Render an uploaded PPTX to an inline PDF without persisting either file."""
    get_user_id(authorization)
    if file is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    filename = (file.filename or "").lower()
    if not filename.endswith(".pptx"):
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PPTX.")

    content_bytes = await file.read()
    if len(content_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")
    if not content_bytes:
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        pdf_bytes = await run_in_threadpool(render_pptx_to_pdf, content_bytes)
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
async def extract_file_text(request: Request, file: UploadFile = None, authorization: str = Header(default="")):
    """Extract plain text from uploaded PDF, DOCX, PPTX, or TXT file."""
    import io
    try:
        user_id = get_user_id(authorization)
        if file is None:
            raise HTTPException(status_code=400, detail="No file uploaded")

        filename = (file.filename or "").lower()
        content_bytes = await file.read()

        if len(content_bytes) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 20MB)")

        text = ""

        if filename.endswith(".pdf"):
            try:
                import importlib
                PdfReader = None
                try:
                    PyPDF2 = importlib.import_module("PyPDF2")
                    PdfReader = PyPDF2.PdfReader
                except ImportError:
                    try:
                        pypdf = importlib.import_module("pypdf")
                        PdfReader = pypdf.PdfReader
                    except ImportError:
                        raise HTTPException(status_code=500, detail="Neither PyPDF2 nor pypdf is installed.")
                reader = PdfReader(io.BytesIO(content_bytes))
                parts = []
                for page in reader.pages:
                    extracted = page.extract_text()
                    if extracted:
                        parts.append(extracted)
                text = "\n\n".join(parts)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=422, detail="Could not extract text from PDF. Use a text-based PDF.")

        elif filename.endswith(".docx"):
                    try:
                        try:
                            import docx  # type: ignore
                        except ImportError:
                            raise HTTPException(status_code=500, detail="python-docx is not installed.")
                        Document = docx.Document
                        doc = Document(io.BytesIO(content_bytes))
                        text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
                    except HTTPException:
                        raise
                    except Exception:
                        raise HTTPException(status_code=422, detail="Could not read DOCX file.")

        elif filename.endswith(".pptx"):
            try:
                try:
                    import importlib
                    pptx_mod = importlib.import_module("pptx")
                    Presentation = pptx_mod.Presentation
                except ImportError:
                    raise HTTPException(status_code=500, detail="python-pptx is not installed.")
                prs = Presentation(io.BytesIO(content_bytes))
                slides_out = []
                marked_parts = []
                for slide_num, slide in enumerate(prs.slides, 1):
                    shape_texts = []
                    for shape in slide.shapes:
                        if hasattr(shape, "text") and shape.text.strip():
                            shape_texts.append(shape.text.strip())
                    slides_out.append({"number": slide_num, "texts": shape_texts})
                    if shape_texts:
                        # Embed "--- Slide N ---" markers so is_slideshow_content()
                        # detects this as slideshow content and routes it through
                        # the slide-aware processing path in /generate.
                        marked_parts.append(f"--- Slide {slide_num} ---\n" + "\n".join(shape_texts))
                pptx_text = "\n\n".join(marked_parts)
                return {"text": pptx_text[:500_000], "slides": slides_out}
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=422, detail="Could not read PPTX file.")

        elif filename.endswith((".txt", ".md", ".csv")):
            try:
                text = content_bytes.decode("utf-8", errors="ignore")
            except Exception:
                raise HTTPException(status_code=422, detail="Could not read text file.")

        elif filename.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif")):
            # Image files — use GPT-4o vision to transcribe educational content
            try:
                from services.llm import get_openai_client
                client = get_openai_client()
                if not client:
                    raise HTTPException(status_code=500, detail="AI service unavailable")
                import base64 as _b64
                ext = filename.rsplit(".", 1)[-1].lower()
                mime_map = {
                    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                    "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp",
                    "tiff": "image/tiff", "tif": "image/tiff",
                }
                mime = mime_map.get(ext, "image/jpeg")
                b64 = _b64.b64encode(content_bytes).decode()
                usage = check_usage(user_id, "lightweight")
                response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                            {"type": "text", "text": (
                                "You are extracting educational content from an image (e.g. a photo of "
                                "notes, a textbook page, a whiteboard, or a diagram). Transcribe ALL "
                                "visible text exactly as written, then describe any diagrams, charts, "
                                "or formulas with enough detail to study from. Use clear headings where "
                                "visible. If the image contains no educational content, respond with "
                                "exactly: NO_EDUCATIONAL_CONTENT"
                            )}
                        ]
                    }],
                    max_tokens=2000,
                )
                text = (response.choices[0].message.content or "").strip()
                if "NO_EDUCATIONAL_CONTENT" in text:
                    raise HTTPException(status_code=422, detail="No educational content found in this image.")
                record_usage(user_id, "lightweight", usage)
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Image extraction failed: {e}")
                raise HTTPException(status_code=422, detail="Could not extract content from image.")

        else:
            # Universal fallback: try UTF-8 decode for any unknown extension.
            # Works for json, yaml, html, xml, source code, etc.
            decoded = None
            try:
                decoded = content_bytes.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                try:
                    decoded = content_bytes.decode("latin-1", errors="ignore")
                except Exception:
                    decoded = None
            if not decoded:
                raise HTTPException(status_code=400, detail="This file type is not supported. Try PDF, DOCX, PPTX, an image, or a plain-text file.")
            # Reject if content is mostly binary garbage
            printable = sum(1 for c in decoded if c.isprintable() or c in "\n\r\t")
            if len(decoded) > 0 and printable / len(decoded) < 0.85:
                raise HTTPException(status_code=400, detail="This file appears to be a binary file with no readable text. Please upload a PDF, DOCX, PPTX, image, or text file.")
            text = decoded

        if not text or len(text.strip()) < 10:
            raise HTTPException(status_code=422, detail="No readable text found in this file.")

        return {"text": text[:500_000]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in /extract-file-text: {e}")
        raise HTTPException(status_code=500, detail="Failed to extract file text")


@app.get("/")
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "1.0.0"}


@app.get("/domains")
def list_domains():
    """Return available academic domains and their exam modes."""
    from domains import DOMAIN_LIST
    return {"domains": DOMAIN_LIST}


@app.post("/ingest", response_model=IngestResponse)
@limiter.limit("30/minute")
async def ingest(body: IngestRequest, request: Request, authorization: str = Header(default="")):
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
            usage = check_usage(user_id, "lightweight")
            image_descriptions = analyze_images_for_slides(images_data)
            visual_text = "\n\n".join(image_descriptions.values()) if image_descriptions else ""
            if visual_text:
                record_usage(user_id, "lightweight", usage)
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
async def generate(body: GenerateRequest, request: Request, authorization: str = Header(default="")):
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
        usage = check_usage(user_id, "build")

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
                domain=body.domain,
                learning_guidance=_learning_guidance(user_id),
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

        record_usage(user_id, "build", usage)
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
async def create_practice_set(
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
            _plain_context(guide.get("notes") or ""),
            guide.get("study_guide") or "",
        ])), MAX_CONTENT_LENGTH)
        title = guide.get("title") or "Study Guide"
        domain = guide.get("domain") or ""
        source = {"type": "study_guide", "id": guide["id"], "title": title}

    if not content.strip():
        raise HTTPException(status_code=400, detail="Add a study guide or upload readable study material first.")

    usage = check_usage(user_id, "build")
    practice = await run_in_threadpool(
        generate_verified_practice_set,
        content,
        _learning_guidance(user_id),
        domain,
    )
    problems = practice.get("problems", []) if isinstance(practice, dict) else []
    if len(problems) != 10:
        raise HTTPException(status_code=502, detail="Cordia could not verify a complete 10-problem set from this material. Please try another source or add more detail.")

    record_usage(user_id, "build", usage)
    return {
        "title": f"{title} — Practice",
        "source": source,
        "subject_area": practice.get("subject_area") or domain or "General study",
        "domain": practice.get("domain") or domain or "general",
        "truth_note": practice.get("truth_note"),
        "problems": problems,
    }


@app.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat(body: ChatRequest, request: Request, authorization: str = Header(default="")):
    """
    Answer questions about the content.
    Requires authentication. Rate limited.
    """
    user_id = None
    session_turn = None
    try:
        user_id = get_user_id(authorization)
        logger.info(f"Chat from user={user_id[:8]}...")

        question = _sanitize_text(body.question, MAX_QUESTION_LENGTH)
        content = _sanitize_text(body.content, MAX_CONTENT_LENGTH)
        request_content = content

        if not question:
            raise HTTPException(status_code=400, detail="Question is required")

        if body.guide_id and body.note_id:
            raise HTTPException(status_code=400, detail="Choose one study source")

        guide = None
        note = None
        source = None
        if body.guide_id:
            if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', body.guide_id, re.IGNORECASE):
                raise HTTPException(status_code=400, detail="Invalid guide ID")
            result = get_supabase().table("study_guides") \
                .select("id,title,folder_id,study_guide,notes,source_url") \
                .eq("id", body.guide_id) \
                .eq("user_id", user_id) \
                .execute()
            if not result.data:
                raise HTTPException(status_code=404, detail="Guide not found")
            guide = result.data[0]
            content = _sanitize_text(
                guide.get("study_guide") or guide.get("notes") or request_content,
                MAX_CONTENT_LENGTH,
            )
            source = {"type": "study_guide", "id": guide["id"], "title": guide.get("title") or "Study Guide"}
        elif body.note_id:
            if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', body.note_id, re.IGNORECASE):
                raise HTTPException(status_code=400, detail="Invalid note ID")
            result = get_supabase().table("smart_notes") \
                .select("id,title,folder_id,content") \
                .eq("id", body.note_id) \
                .eq("user_id", user_id) \
                .execute()
            if not result.data:
                raise HTTPException(status_code=404, detail="Note not found")
            note = result.data[0]
            content = _sanitize_text(
                _plain_context(note.get("content") or request_content),
                MAX_CONTENT_LENGTH,
            )
            source = {"type": "smartnote", "id": note["id"], "title": note.get("title") or "SmartNote"}
        elif body.context_title and content:
            source = {
                "type": "browser" if body.context_url else "file",
                "title": body.context_title.strip() or "Attached file",
            }
            if body.context_url:
                source["url"] = body.context_url

        context_class_id = body.class_id or (guide or note or {}).get("folder_id")

        if body.session_id:
            session_turn = claim_tutor_turn(
                user_id=user_id,
                session_id=body.session_id,
                expected_version=body.conversation_version,
                message=question,
                requested_skill=body.skill,
                guide_id=body.guide_id,
                class_id=context_class_id,
            )

        def finish(response: ChatResponse):
            if not session_turn:
                return response
            row = complete_tutor_turn(
                user_id,
                session_turn,
                response.model_dump(exclude_none=True),
            )
            return response.model_copy(update={
                "skill": session_turn["active_skill"],
                "session": public_tutor_session(row),
            })

        active_skill = session_turn.get("active_skill") if session_turn else body.skill
        if active_skill in {"capture", "find_material"}:
            if not session_turn or not public_tutor_session(session_turn)["browser_available"]:
                return finish(ChatResponse(
                    answer="Open the CordiaClassroom browser side panel, then try the browser request again.",
                    action="browser_unavailable",
                ))
            command_type = "capture_current_page" if active_skill == "capture" else "find_material_current_page"
            queue_browser_command(user_id, session_turn, command_type, question)
            answer = (
                "Working in the browser side panel now. Keep it open while I read the current page."
                if active_skill == "capture"
                else "Looking for relevant study material linked from the current page."
            )
            row = wait_for_browser_result(user_id, session_turn, answer)
            return ChatResponse(
                answer=answer,
                action="browser_command_queued",
                skill=active_skill,
                session=public_tutor_session(row),
            )

        if active_skill == "plan":
            if not content.strip():
                return finish(ChatResponse(
                    answer="Open Canvas calendar reminders on the Dashboard to review what is due today and what is coming next.",
                    action="opened_plan_help",
                ))

        if active_skill == "organize":
            if not (guide or note):
                return finish(ChatResponse(answer="Choose a study guide or SmartNote to organize."))
            if not body.class_id:
                return finish(ChatResponse(answer="Choose the destination class before organizing this material."))
            if guide:
                guides.move_guide(
                    guide["id"],
                    guides.MoveGuideRequest(folder_id=body.class_id),
                    authorization,
                )
            else:
                smart_notes.update_note(
                    note["id"],
                    smart_notes.UpdateNoteRequest(folder_id=body.class_id),
                    authorization,
                )
            return finish(ChatResponse(
                answer=f"Moved {(source or {}).get('title') or 'the material'} to the selected class.",
                action="organized_material",
                source=source,
            ))

        if not content.strip():
            if source:
                return finish(ChatResponse(
                    answer=f"{source.get('title') or 'The selected material'} is selected, but it does not contain readable study material yet. Add content or choose another source."
                ))
            return finish(ChatResponse(answer="Choose a study guide, SmartNote, or uploaded file before asking Cordia."))

        # Validate mode
        if body.mode not in ("short", "detailed", "example"):
            raise HTTPException(status_code=400, detail="Invalid mode")

        wants_practice = active_skill == "practice" or bool(re.search(
            r'\b(create|make|generate|build)\b.*\bpractice\b.*\b(problems?|questions?|guide)\b',
            question,
            re.IGNORECASE,
        ))
        if wants_practice:
            usage = check_usage(user_id, "build")
            practice = generate_practice_guide(content, _learning_guidance(user_id))
            if not practice or practice.startswith("[Error"):
                raise HTTPException(status_code=502, detail="Cordia could not create practice problems from this material")
            practice_cards = study_guide_to_flashcards(practice)
            if not practice_cards or not study_guide_is_complete(practice):
                raise HTTPException(status_code=502, detail="Cordia received incomplete practice problems. Please try again.")
            source_title = (source or {}).get("title") or "Study Material"
            payload = {
                "user_id": user_id,
                "folder_id": context_class_id,
                "title": f"{source_title} — Practice Problems",
                "study_guide": practice,
                "flashcards": practice_cards,
                "source_type": (source or {}).get("type"),
                "source_title": source_title,
                "source_id": (source or {}).get("id"),
            }
            if guide:
                payload.update(source_url=guide.get("source_url"), source_guide_id=guide["id"])
            created = get_supabase().table("study_guides").insert(payload).execute()
            if not created.data:
                raise HTTPException(status_code=500, detail="Practice guide could not be saved")
            record_usage(user_id, "build", usage)
            saved = created.data[0]
            location = " in the same class" if saved.get("folder_id") else " in Study Guides"
            return finish(ChatResponse(
                answer=f"Created {saved['title']}{location}.",
                action="created_guide",
                guide={"id": saved["id"], "title": saved["title"], "folder_id": saved.get("folder_id")},
                source=source,
            ))

        if active_skill == "build_guide":
            usage = check_usage(user_id, "build")
            chunks = chunk_text(clean_text(content))
            study_guide = generate_study_guide(
                chunks,
                learning_guidance=_learning_guidance(user_id),
            )
            flashcards = study_guide_to_flashcards(study_guide or "")
            if not study_guide or not flashcards or not study_guide_is_complete(study_guide):
                raise HTTPException(status_code=502, detail="Cordia could not build a complete guide from this material")
            source_title = (source or {}).get("title") or "Study Material"
            payload = {
                "user_id": user_id,
                "folder_id": context_class_id,
                "title": f"{source_title} — Study Guide",
                "study_guide": study_guide,
                "flashcards": flashcards,
                "source_type": (source or {}).get("type"),
                "source_title": source_title,
                "source_id": (source or {}).get("id"),
                "source_url": (source or {}).get("url") or (guide or {}).get("source_url"),
            }
            if guide:
                payload["source_guide_id"] = guide["id"]
            created = get_supabase().table("study_guides").insert(payload).execute()
            if not created.data:
                raise HTTPException(status_code=500, detail="Study guide could not be saved")
            record_usage(user_id, "build", usage)
            saved = created.data[0]
            location = " in the same class" if saved.get("folder_id") else " in Study Guides"
            return finish(ChatResponse(
                answer=f"Created {saved['title']}{location}.",
                action="created_guide",
                guide={"id": saved["id"], "title": saved["title"], "folder_id": saved.get("folder_id")},
                source=source,
            ))

        usage = check_usage(user_id, "lightweight")
        guidance = "\n".join(filter(None, [
            _learning_guidance(user_id),
            tutor_skill_instruction(active_skill),
            TUTOR_SAFETY_POLICY,
        ]))
        retain_context = _verified_retain_context(body, content)
        if retain_context:
            previous_messages = (session_turn or {}).get("messages") or []
            answer = explain_retain_answer(
                question=retain_context.question,
                options=retain_context.options,
                selected_answer=retain_context.selected_answer,
                correct_answer=retain_context.correct_answer,
                context=content,
                conversation=previous_messages[:-1],
                learning_guidance=guidance,
            )
        else:
            previous_messages = (session_turn or {}).get("messages") or []
            answer = answer_question(
                question=question,
                context=content,
                mode=body.mode,
                learning_guidance=guidance,
                conversation=previous_messages[:-1],
                allow_clarification=active_skill in {"explain", "retain", None},
            )

        record_usage(user_id, "lightweight", usage)
        return finish(ChatResponse(answer=answer, source=source))

    except HTTPException as error:
        if user_id and session_turn:
            fail_tutor_turn(user_id, session_turn, str(error.detail))
        raise
    except Exception as e:
        if user_id and session_turn:
            fail_tutor_turn(user_id, session_turn, "Unexpected Tutor error")
        logger.error(f"Error in /chat: {e}\n{traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={"answer": "Error processing your question. Please try again."}
        )

