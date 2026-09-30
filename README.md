# CordiaClassroom

A Chrome side-panel extension and Classroom web app that share one Cordia Tutor session for capturing and learning from student-approved educational content.

## Overview

CordiaClassroom captures content from learning platforms, online textbooks, PDFs, slideshows, and webpages, then turns it into organized study materials.

## Features

### Core Functionality

| Feature | Description | AI Usage |
|---------|-------------|----------|
| **Smart Notes** | AI extracts key information, filtering out navigation and irrelevant content | GPT-4o identifies important concepts, definitions, and facts |
| **Study Guide** | Generates comprehensive Q&A study guides | GPT-4o creates varied question types (definition, explanation, application, comparison) with detailed answers |
| **Flashcards** | Creates flashcard-style question/answer pairs for quick review | GPT-4o generates concise Q&A pairs optimized for memorization |
| **Chat Assistant** | Interactive Q&A using captured content as knowledge base | GPT-4o answers questions in 3 modes: short, detailed, or with examples |

### Slideshow Detection & Extraction

CordiaClassroom automatically detects and extracts content from slideshows:

| Platform | Detection | Extraction |
|----------|-----------|------------|
| **Canvas LMS** | Native slideshow modules | Full text extraction from all slides |
| **Google Slides** | Embedded iframes | Detects embed, prompts to open directly |
| **PowerPoint Online** | OneDrive/SharePoint embeds | Detects embed, extracts surrounding content |
| **PowerPoint Files** | .pptx download links | Downloads and parses slide content |
| **Prezi** | Embedded presentations | Detects embed URL |
| **Generic Slideshows** | CSS class detection (.slides, .carousel) | Extracts visible slide content |

### Content Sources Supported

- **LMS Pages**: Canvas, Blackboard, Moodle, D2L Brightspace
- **Slideshows**: Google Slides, PowerPoint (online & .pptx files), Prezi, native LMS slideshows
- **Documents**: Embedded PDFs, text-based content
- **Rich Content**: Image alt-text, structured educational content

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Chrome Extension                            │
├─────────────────────────────────────────────────────────────────┤
│  Side panel UI       │  content.js          │  background.js    │
│  - Side-panel UI     │  - Slideshow detect  │  - API calls      │
│  - Display results   │  - PDF extraction    │  - Message router │
│  - Chat interface    │  - LMS content grab  │                   │
│  - Flashcard view    │  - PPTX detection    │                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼ Authenticated HTTP
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                             │
├─────────────────────────────────────────────────────────────────┤
│  /ingest             │  /generate                               │
│  - Review sections   │  - AI notes and study guides             │
│  - Detect slideshow  │  - AI flashcards                         │
│  - Return metadata   │                                          │
├─────────────────────────────────────────────────────────────────┤
│  /chat               │  Text Processing     │  Tutor session    │
│  - Shared skills     │  - LMS filtering     │  - One writer     │
│  - Context-aware     │  - Smart chunking    │  - Action evidence│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      OpenAI GPT-4o                               │
│  - Intelligent note extraction (identifies exam-worthy content) │
│  - Study guide generation (varied question types)               │
│  - Flashcard creation (memorization-optimized)                  │
│  - Contextual Q&A (short/detailed/example modes)                │
│  - Slideshow summarization                                      │
└─────────────────────────────────────────────────────────────────┘
```


### Chat Modes

- **short**: Brief, direct answers (1-2 sentences)
- **detailed**: Step-by-step explanations with full context
- **example**: Concrete, real-world examples to illustrate concepts

## How AI is Used

| Feature | AI Role | Why AI? |
|---------|---------|---------|
| **Notes** | Identifies key concepts, definitions, and exam-worthy facts | Human-like understanding of what's important to study |
| **Study Guide** | Generates varied question types with detailed answers | Creates questions that test understanding, not just memorization |
| **Flashcards** | Creates concise Q&A pairs for quick review | Optimizes content for memorization and recall |
| **Chat** | Answers questions using captured content as context | Provides personalized explanations based on the material |
| **Slideshow Summary** | Synthesizes slide content into coherent notes | Connects information across slides into study-ready format |

## Configuration

### Text Processing

The content filter in `services/text_processing.py` automatically removes:

- LMS navigation (Dashboard, Inbox, Calendar, Modules, etc.)
- UI elements (buttons, menus, breadcrumbs)
- Video player controls
- Generic web elements (cookies, privacy policy, etc.)

Supports: Canvas, Blackboard, Moodle, D2L Brightspace

### AI Parameters

In `services/llm.py`:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `model` | gpt-4o | Best quality for educational content |
| `temperature` | 0.3-0.5 | Balanced accuracy with some variety |
| `max_tokens` | 150-2048 | Varies by feature (notes vs study guide) |

## Roadmap

- [x] AI-powered note extraction
- [x] Study guide generation with varied question types
- [x] Flashcard generation
- [x] Slideshow detection (Canvas, Google Slides, PowerPoint)
- [ ] Export format
- [ ] Spaced repetition scheduling
- [x] Persistent storage (Supabase Postgres)
- [x] User accounts and saved study sets
- [ ] Video transcript extraction (YouTube, Panopto)
- [ ] OCR for scanned PDFs

## License

MIT
