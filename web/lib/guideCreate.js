import { apiFetch, getToken, responseJson } from './api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
// A long document can take a few minutes to become a guide.
const GUIDE_TIMEOUT_MS = 6 * 60 * 1000;
// /generate keeps at most this much source text (MAX_CONTENT_LENGTH in backend/main.py).

export const MAX_SOURCE_CHARS = 500_000;

export function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

export function newRequestId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

export function combinedSource(items) {
  if (items.length === 1) return items[0].text;
  return items.map(item => `${baseName(item.name)}\n\n${item.text}`).join('\n\n');
}

export function pairsToGuide(pairs, offset = 0) {
  return pairs.map((pair, index) => `Q${offset + index + 1}: ${pair.term.trim()}\nA${offset + index + 1}: ${pair.definition.trim()}`).join('\n');
}

export function pairsToCards(pairs) {
  return pairs.map(pair => ({
    front: pair.term.trim(),
    back: pair.definition.trim(),
    ...(pair.frontImage ? { front_image: pair.frontImage } : {}),
    ...(pair.image ? { image: pair.image } : {}),
  }));
}

function limitError(detail, fallback) {
  const message = typeof detail === 'string' ? detail : detail?.message;
  const error = new Error(message || fallback);
  error.upgrade = detail?.code === 'limit_reached' || Boolean(detail?.upgrade_url);
  return error;
}

const JOB_POLL_MS = 2500;
const JOB_WAIT_MS = 12 * 60 * 1000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Waits for a study set the server is building (POST /study-set-jobs), then returns the saved guide.
async function waitForJob(jobId, title) {
  const until = Date.now() + JOB_WAIT_MS;
  let misses = 0;
  while (Date.now() < until) {
    await wait(JOB_POLL_MS);
    const data = await apiFetch('/study-set-jobs/' + jobId, { reportFailure: true });
    if (!data || data.failed) {
      if (++misses >= 8) throw new Error("Couldn't reach Classroom while building the guide. It will be in your Library when it's ready.");
      continue;
    }
    misses = 0;
    if (data.job?.status === 'done' && data.guide) return data.guide;
    if (data.job?.status === 'failed') throw limitError(data.job.error, `CordiaClassroom could not build “${title}” from this material.`);
  }
  throw new Error('The guide is taking longer than usual. It will be in your Library when it’s ready.');
}

// Generates and saves one guide from source text. Runs as a background job, so it only uses the
// values passed in, never page state. The server builds it (services/generation_jobs.py), so it
// carries on if the student closes the page; before that server code is deployed, the guide is
// built in two requests while the page waits (/generate, then /guides).
export async function generateAndSave({ source, requestId, title, keepTitle = false, sourceTitle, sourceType, sourceUrl, externalSourceId, folderId, notes, flashcards }) {
  const queued = await apiFetch('/study-set-jobs', {
    method: 'POST',
    body: JSON.stringify({
      content: source, title, keep_title: keepTitle, notes: Boolean(notes), flashcards: Boolean(flashcards),
      source_type: sourceType || null, source_title: sourceTitle || null, source_url: sourceUrl || null,
      external_source_id: externalSourceId || null, folder_id: folderId || null,
    }),
    reportFailure: true,
  });
  if (queued?.job?.id) return waitForJob(queued.job.id, title);
  if (queued?.detail && queued.detail !== 'Not Found') {
    if (queued.failed) throw new Error("Couldn't reach Classroom while building the guide. Try again.");
    throw limitError(queued.detail, 'Study guide generation failed.');
  }

  const generated = await apiFetch('/generate', {
    method: 'POST',
    body: JSON.stringify({ content: source, notes, study_guide: true, flashcards, request_id: requestId }),
    // A long document can take a few minutes to write; the request_id keeps a retry free.
    timeoutMs: GUIDE_TIMEOUT_MS,
    reportFailure: true,
  });
  if (!generated || generated.failed) {
    throw new Error(generated?.failed === 'timeout'
      ? 'The guide took too long to come back. Try again; you will not be charged twice.'
      : "Couldn't reach Classroom while building the guide. Try again; you will not be charged twice.");
  }
  if (generated.detail) throw limitError(generated.detail, 'Study guide generation failed.');
  if (!generated.study_guide || generated.study_guide.startsWith('[Error')) {
    throw new Error(`CordiaClassroom could not build “${title}” from this material.`);
  }

  const saved = await apiFetch('/guides', {
    method: 'POST',
    body: JSON.stringify({
      title,
      // Without a typed name, the server cleans the file or page name, or names the guide from its content.
      keep_title: keepTitle,
      notes: generated.notes || null,
      study_guide: generated.study_guide,
      flashcards: generated.flashcards || null,
      source_url: sourceUrl || null,
      external_source_id: externalSourceId || null,
      source_type: sourceType,
      source_title: sourceTitle,
      source_id: externalSourceId || null,
      ...(folderId ? { folder_id: folderId } : {}),
    }),
  });
  if (!saved?.guide) throw new Error(`Could not save “${title}”.`);
  return saved.guide;
}


// Reads a file's text through the backend (PDF, DOCX, PPTX, images via OCR, text).
export async function extractFileText(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(API + '/extract-file-text', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (getToken() || '') },
    body: formData,
  });
  const data = await responseJson(response);
  if (!response.ok || !data.text) throw new Error(`${file.name}: ${data.detail || 'Could not read this file.'}`);
  return data.text;
}
