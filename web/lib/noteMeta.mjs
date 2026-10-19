// Note title and cover rules shared by the Notes page and /api/notes (lib/server/noteMeta.mjs).

export const DEFAULT_TITLE = 'Untitled Notes';
export const MIN_CHARS = 120;     // a note needs this much text before it gets a title or cover
export const REGROW = 1.5;        // remake the cover once the note is this much longer

export function htmlToText(html) {
  return String(html || '')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// Without AI: the first line or sentence, up to 7 words.
export function heuristicTitle(text) {
  const first = String(text || '').split('\n').map(line => line.trim()).find(line => line.length > 2) || '';
  const sentence = first.split(/(?<=[.!?])\s/)[0].replace(/[.!?:;,]+$/, '');
  const list = sentence.split(/\s+/).filter(Boolean).slice(0, 7);
  // Don't end on a filler word ("...spins on", "...the").
  while (list.length > 2 && /^(a|an|the|and|or|but|of|on|in|to|for|at|by|with|its|is|are|was|that|this)$/i.test(list[list.length - 1])) list.pop();
  const words = list.join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : DEFAULT_TITLE;
}

export function isDefaultTitle(title) {
  const value = String(title || '').trim().toLowerCase();
  return !value || value === DEFAULT_TITLE.toLowerCase() || value === 'untitled' || value === 'untitled note';
}

export function needsCover(cover, textLength) {
  if (textLength < MIN_CHARS) return false;
  return !cover?.url || textLength >= (cover.content_length || 0) * REGROW;
}
