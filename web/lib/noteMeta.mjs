// Note title and cover rules shared by the Notes page and /api/notes (lib/server/noteMeta.mjs).

export const DEFAULT_TITLE = 'Untitled Notes';
export const MIN_CHARS = 25;      // one short sentence is enough for a title and a cover
export const TYPING_CHARS = 80;   // while typing, wait for a little more before naming the note
export const REGROW = 1.5;        // remake the cover once the note is this much longer…
export const REGROW_CHARS = 150;  // …and at least this many characters longer

export function htmlToText(html) {
  return String(html || '')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^<>]*>/g, ' ')
    // &amp; last, so "&amp;lt;" stays the text "&lt;" instead of becoming "<".
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&')
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
  return !cover?.url || textLength >= Math.max((cover.content_length || 0) * REGROW, (cover.content_length || 0) + REGROW_CHARS);
}

// An AI title is used only if it reads like a title: a few words, and not just the opening of
// the material itself (a transcript's first words are not a name).
export function sensibleTitle(candidate, source) {
  const title = String(candidate || '').trim().replace(/^["'“”]+|["'“”.]+$/g, '');
  if (!title || title.length > 80) return '';
  const words = title.split(/\s+/);
  if (words.length > 10) return '';
  const start = String(source || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, title.length + 5);
  if (words.length > 2 && start.startsWith(title.toLowerCase())) return '';
  return title;
}
