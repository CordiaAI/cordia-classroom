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

// Generates and saves one guide from source text. Runs as a background job, so it
// only uses the values passed in, never page state.
export async function generateAndSave({ source, requestId, title, sourceTitle, sourceType, sourceUrl, externalSourceId, folderId, notes, flashcards, manualPairs }) {
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
  if (generated.detail) {
    const detail = typeof generated.detail === 'string' ? generated.detail : generated.detail.message;
    const error = new Error(detail || 'Study guide generation failed.');
    error.upgrade = generated.detail.code === 'limit_reached' || Boolean(generated.detail.upgrade_url);
    throw error;
  }
  if (!generated.study_guide || generated.study_guide.startsWith('[Error')) {
    throw new Error(`CordiaClassroom could not build “${title}” from this material.`);
  }

  let studyGuide = generated.study_guide;
  let cards = generated.flashcards || null;
  if (manualPairs?.length) {
    const numbers = [...studyGuide.matchAll(/^Q(\d+):/gm)].map(match => Number(match[1]));
    studyGuide = `${studyGuide.trimEnd()}\n${pairsToGuide(manualPairs, numbers.length ? Math.max(...numbers) : 0)}`;
    if (flashcards) cards = [...(cards || []), ...pairsToCards(manualPairs)];
  }

  const saved = await apiFetch('/guides', {
    method: 'POST',
    body: JSON.stringify({
      title,
      notes: generated.notes || null,
      study_guide: studyGuide,
      flashcards: cards,
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
