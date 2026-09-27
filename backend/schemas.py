"""
Pydantic models for API request/response validation.
All inputs are constrained at the schema level (defense in depth).
"""

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from urllib.parse import urlparse


class ImageData(BaseModel):
    """Single captured image for vision analysis."""
    data: str = Field(..., max_length=2_000_000)  # base64 data URL (~1.5MB max)
    slide_index: Optional[int] = None  # which slide this image belongs to
    context: Optional[str] = Field(None, max_length=1_000)  # nearby text context
    alt: Optional[str] = Field(None, max_length=500)  # alt text if available


class IngestRequest(BaseModel):
    """Request to ingest page content."""
    content: str = Field(..., min_length=1, max_length=500_000)
    content_type: str = Field(default="webpage", max_length=20)
    images: List[ImageData] = Field(default_factory=list, max_length=10)
    domain: Optional[str] = Field(default=None, max_length=30)

    @field_validator("content_type")
    @classmethod
    def validate_content_type(cls, v):
        allowed = {"webpage", "slideshow", "pdf"}
        if v not in allowed:
            raise ValueError(f"content_type must be one of: {allowed}")
        return v

class IngestResponse(BaseModel):
    """Response from content ingestion."""
    content_type: str = "webpage"
    detected_slideshow: bool = False
    is_educational: bool = False
    sections: List["EducationalSection"] = Field(default_factory=list)
    excluded_summary: str = ""
    use_images: bool = False


class EducationalSection(BaseModel):
    """A student-reviewable source section selected from captured content."""
    id: str = Field(..., pattern=r"^section-[1-9][0-9]*$")
    heading: str = Field(..., min_length=1, max_length=500)
    text: str = Field(..., min_length=1, max_length=50_000)


class GenerateRequest(BaseModel):
    """Request to generate study materials."""
    content: str = Field(..., min_length=1, max_length=500_000)
    images: List[ImageData] = Field(default_factory=list, max_length=10)
    notes: bool = True
    study_guide: bool = True
    flashcards: bool = False
    domain: Optional[str] = Field(default=None, max_length=30)


class GenerateResponse(BaseModel):
    """Response with generated study materials."""
    notes: Optional[str] = None
    study_guide: Optional[str] = None
    flashcards: Optional[List[dict]] = None


class RetainExplanationContext(BaseModel):
    """The exact answered Retain question a Tutor explanation refers to."""
    question: str = Field(..., min_length=1, max_length=2_000)
    options: List[str] = Field(..., min_length=2, max_length=10)
    selected_answer: str = Field(..., min_length=1, max_length=2_000)
    correct_answer: str = Field(..., min_length=1, max_length=2_000)


class ChatRequest(BaseModel):
    """Request for chat Q&A."""
    question: str = Field(..., min_length=1, max_length=2_000)
    content: str = Field(..., max_length=500_000)
    mode: str = Field(default="short", max_length=10)
    guide_id: Optional[str] = Field(default=None, max_length=36)
    note_id: Optional[str] = Field(default=None, max_length=36)
    context_title: Optional[str] = Field(default=None, max_length=200)
    context_url: Optional[str] = Field(default=None, max_length=2_048)
    session_id: Optional[str] = Field(default=None, max_length=36)
    conversation_version: Optional[int] = Field(default=None, ge=0)
    skill: Optional[str] = Field(default=None, max_length=30)
    class_id: Optional[str] = Field(default=None, max_length=36)
    retain_context: Optional[RetainExplanationContext] = None

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v):
        allowed = {"short", "detailed", "example"}
        if v not in allowed:
            raise ValueError(f"mode must be one of: {allowed}")
        return v

    @field_validator("context_url")
    @classmethod
    def validate_context_url(cls, value):
        if value and urlparse(value).scheme not in {"http", "https"}:
            raise ValueError("context_url must use http or https")
        return value


class ChatResponse(BaseModel):
    """Response from chat."""
    answer: str
    action: Optional[str] = None
    guide: Optional[dict] = None
    source: Optional[dict] = None
    skill: Optional[str] = None
    session: Optional[dict] = None


class PracticeRequest(BaseModel):
    """Create a temporary practice set from one guide or uploaded source."""
    guide_id: Optional[str] = Field(default=None, max_length=36)
    content: str = Field(default="", max_length=500_000)
    title: Optional[str] = Field(default=None, max_length=200)


class PracticeGradeRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    reference: str = Field(..., min_length=1, max_length=4000)
    worked_solution: str = Field(default="", max_length=6000)
    student_answer: str = Field(..., min_length=1, max_length=4000)
    work: str = Field(default="", max_length=6000)


class PracticeProgressRequest(BaseModel):
    progress: dict = Field(default_factory=dict)


class PracticeRecognizeRequest(BaseModel):
    image: str = Field(..., min_length=30, max_length=3_000_000, pattern=r"^data:image/(png|jpeg);base64,")
