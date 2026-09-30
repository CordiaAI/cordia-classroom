# CordiaClassroom Chrome Extension

Chrome side-panel extension that captures student-approved educational content and shares one Cordia Tutor session with CordiaClassroom.

## Installation (Developer Mode)

1. Go to `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
2. Enable **Developer Mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this `extension` folder

## Usage

1. Navigate to any educational webpage (LMS, article, documentation)
2. Sign in once at **classroom.cordiaai.io**; the extension reuses that session
3. Click the CordiaClassroom extension icon
4. Ask the same **Cordia Tutor** used in Classroom, or open **Capture** and click **Read this study material**
5. Review generated guides, notes, and cards without leaving the side panel

## Features

- **Tutor Tab**: Primary shared conversation, skill, goal, and evidence from Classroom
- **Capture Tab**: Explicit current-page capture; the visible tab is not sent until the student asks
- **Notes Tab**: Bullet-point extraction of key content
- **Study Guide Tab**: AI-generated Q&A pairs
- **Flashcards Tab**: Review cards generated from the captured material
- **Shared Tutor**: Uses the same ordered conversation and active skill as CordiaClassroom
- **Find Material**: Reads a bounded set of relevant same-origin course links and up to three linked documents, excludes graded quiz/submission/grade routes, and can hand the approved material to Build Guide

## Content Sources

The extension can extract from:
- Standard webpage text
- Selected text or the main content of an LMS page
- Linked or embedded PDF, DOCX, PPTX, text, and common image files
- A screenshot fallback when a protected viewer does not expose its source

Canvas documents are read through the student's authenticated browser session first. The existing Canvas API proxy is only a fallback, so browser capture does not require a separate connector when Chrome can access the file directly.

## Files

- `manifest.json` - Extension configuration (Manifest V3)
- `popup.html/js/css` - Persistent Chrome side-panel UI (the legacy filenames are retained so existing capture tests and packaged updates keep one implementation)
- `content.js` - Small source resolver for selections, documents, and LMS pages
- `background.js` - Service worker for backend API calls
- The backend is the single document extractor; the extension does not duplicate PDF or PowerPoint parsing

## Configuration

Clicking the pinned CordiaClassroom toolbar icon opens the side panel. The production backend URL is configured in `background.js` and `popup.js`:
```javascript
const API_URL = 'https://autostudy-ai.fly.dev';
```

See main [README](../README.md) for full documentation.
