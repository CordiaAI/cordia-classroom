import { apiFetch } from './api';
import { getProgress, updateProgress } from './progress';

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via']);

// Titles that came from a filename or a placeholder, not from a person or the AI.
export function looksAutomatic(title) {
  const value = String(title || '').trim();
  return !value
    || /\.(pdf|docx?|pptx?|txt|md|csv|rtf|png|jpe?g|heic)$/i.test(value)
    || /[_+]|%20|^\d{4}[-_.]\d{2}/.test(value)
    || /^(pasted notes|custom study guide|study guide|untitled|recording\b|lecture \d+$)/i.test(value)
    || (/^[a-z0-9-]+$/.test(value) && value.includes('-'));
}

// "Visual+Analysis_final.docx" -> "Visual Analysis Final". Never invents words.
export function cleanTitle(title) {
  const words = String(title || '')
    .replace(/\.(pdf|docx?|pptx?|txt|md|csv|rtf|png|jpe?g|heic)$/i, '')
    .replace(/%20|[_+\-.]+/g, ' ')
    .replace(/\b(final|copy|v\d+|\(\d+\))\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 8);
  return words.map((word, index) => (index > 0 && SMALL.has(word.toLowerCase()) ? word.toLowerCase() : /^[A-Z0-9]{2,}$/.test(word) ? word : word[0].toUpperCase() + word.slice(1).toLowerCase())).join(' ') || 'Untitled';
}

export function markRenamed(guideId) {
  updateProgress(current => ({ renamed: [...new Set([...(current.renamed || []), guideId])].slice(-500) }));
}

// Older guides get an AI title on first open, only if the student never renamed them.
export async function aiTitleFor(guide) {
  if (!guide?.id || !looksAutomatic(guide.title)) return null;
  if ((getProgress().renamed || []).includes(guide.id)) return null;
  const data = await apiFetch(`/guides/${guide.id}/title`, { method: 'POST' });
  const title = typeof data?.title === 'string' ? data.title.trim() : '';
  if (!title) return null;
  const saved = await apiFetch(`/guides/${guide.id}/rename`, { method: 'PATCH', body: JSON.stringify({ title }) });
  return saved?.title || null;
}
