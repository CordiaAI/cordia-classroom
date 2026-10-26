"""CordiaClassroom API for processing educational content and study materials."""

import logging
import os
import re
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
import anthropic
from openai import APIError, RateLimitError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from rate_limit import limiter
from routers import (
    auth, billing, calendar, chat, feedback, folders, guides, learning, materials,
    nclex, practice, quiz, search, smart_notes, stats, tutor,
)
from routers import canvas, classes, admin, public_forms, connectors, drive, plans, workspace, apps
from services import log_scrub

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

# Configure logging — never log tokens or secrets
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
log_scrub.install()

# Initialize FastAPI app
app = FastAPI(
    title="CordiaClassroom API",
    description="CordiaClassroom API for generating study materials from educational content",
    version="1.0.0",
    docs_url="/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url=None,
)

@app.on_event("startup")
def _start_sync_worker() -> None:
    from services import sync_worker
    sync_worker.start()


# Attach rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(APIError)
async def openai_error(request: Request, error: APIError):
    """One place that turns a failed OpenAI call into an answer the student can act on."""
    logger.error("OpenAI call failed request_id=%s path=%s", request.state.request_id, request.url.path, exc_info=error)
    if isinstance(error, RateLimitError):
        return JSONResponse(status_code=503, content={"detail": "Cordia's AI is busy right now. Please try again in a minute."})
    return JSONResponse(status_code=502, content={"detail": "Cordia's AI service had a problem. Please try again."})


@app.exception_handler(anthropic.APIError)
async def claude_error(request: Request, error: anthropic.APIError):
    """The same for a failed Claude call: logged with its status, answered in words the student can act on."""
    status = getattr(error, "status_code", None)
    logger.error("Claude call failed request_id=%s path=%s status=%s message=%s", request.state.request_id,
                 request.url.path, status, str(error)[:500])
    if isinstance(error, anthropic.RateLimitError) or status == 529:
        return JSONResponse(status_code=503, content={"detail": "Cordia's AI is busy right now. Please try again in a minute."})
    return JSONResponse(status_code=502, content={"detail": "Cordia's AI service had a problem. Please try again."})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Never echo submitted values back: a Canvas token could be among them.
    errors = [{"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})

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

# Guide text compresses several-fold; small responses are left alone.
app.add_middleware(GZipMiddleware, minimum_size=1024)


# Refuse oversized bodies before they are read into memory (1 GB machine). Uploads are
# capped at 50 MB by read_upload; other requests carry text, never more than a few MB.
MAX_UPLOAD_BODY = 60 * 1024 * 1024
MAX_JSON_BODY = 8 * 1024 * 1024


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit():
        multipart = request.headers.get("content-type", "").startswith("multipart/")
        if int(length) > (MAX_UPLOAD_BODY if multipart else MAX_JSON_BODY):
            return JSONResponse(status_code=413, content={"detail": "That upload is too large."})
    return await call_next(request)


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


# Added last so it is the outermost layer: the 500 and 413 replies made by the middleware above
# carry CORS headers too. Without them the browser hides the error and the app only sees a
# failed request (a guide that "took too long" the moment it failed).
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
app.include_router(connectors.router)
app.include_router(tutor.router)
app.include_router(chat.router)
app.include_router(materials.router)
app.include_router(practice.router)
app.include_router(learning.router)
app.include_router(canvas.router)
app.include_router(classes.router)
app.include_router(admin.router)
app.include_router(public_forms.router)
app.include_router(plans.router)
app.include_router(drive.router)
app.include_router(workspace.router)
app.include_router(apps.router)



@app.get("/")
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "1.0.0"}
