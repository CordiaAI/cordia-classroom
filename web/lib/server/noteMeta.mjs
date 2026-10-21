// Server-only: an AI title and a Napkin cover graphic for each note (/api/notes/*).
//
// meta(note): reads the note through the Classroom API with the student's own sign-in (so only
// their notes), then
//   - title: if it is still "Untitled Notes", names it from the content (OpenAI, else the first
//     line) and saves the title to the note;
//   - cover: a one-variation Napkin graphic of the whole note (long notes are first condensed
//     into an outline so the graphic covers everything), stored in note_covers. A cover is
//     remade only when the note has grown by half since it was made.
// covers(): every cover this student has, for the Notes page.
import { createVisualService } from './napkinVisual.mjs';
import { chatProvider } from './aiProvider.mjs';
import { aiChat } from './aiChat.mjs';

import { DEFAULT_TITLE, MIN_CHARS, heuristicTitle, htmlToText, isDefaultTitle, needsCover } from '../noteMeta.mjs';
import { supabaseUrlFrom } from '../supabaseUrl.mjs';

export { DEFAULT_TITLE, MIN_CHARS, heuristicTitle, htmlToText, isDefaultTitle, needsCover };

export const META_RULES = `You label a student's class notes. Use only what the notes say.
Return JSON: {"title": "...", "outline": "..."}
- title: 2 to 7 words naming the subject, as a student would label the notes. No quotes, no date, no trailing punctuation.
- outline: the notes' main ideas as a short outline (a heading line, then up to 8 "- " points, each under 15 words), covering everything the notes discuss.`;

export function createNoteMetaService({ env = process.env, fetch: fetchImpl = globalThis.fetch, sleep, now } = {}) {
  const apiBase = (env.CLASSROOM_API_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const supabaseUrl = supabaseUrlFrom(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const provider = chatProvider(env);
  const openaiKey = provider.key;
  const visuals = createVisualService({ env, fetch: fetchImpl, ...(sleep ? { sleep } : {}), ...(now ? { now } : {}) });

  const db = (path, init = {}) => fetchImpl(`${supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  function userIdFromToken(authorization) {
    try {
      const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
      return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub || '';
    } catch {
      return '';
    }
  }

  // The Classroom API checks the sign-in and only returns the student's own note.
  async function readNote(authorization, noteId) {
    try {
      const response = await fetchImpl(`${apiBase}/smart_notes/${encodeURIComponent(noteId)}`, { headers: { Authorization: authorization } });
      if (!response.ok) return null;
      return (await response.json())?.note || null;
    } catch {
      return null;
    }
  }

  async function saveTitle(authorization, noteId, title) {
    try {
      const response = await fetchImpl(`${apiBase}/smart_notes/${encodeURIComponent(noteId)}`, {
        method: 'PUT', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // One small AI call for both the title and the cover outline. Null when AI isn't set up.
  async function label(text) {
    if (!openaiKey) return null;
    const out = await aiChat(provider, { system: META_RULES, user: text.slice(0, 12000), maxTokens: 400, json: true, timeoutMs: 15000, fetchImpl });
    if (!out) return null;
    try {
      const parsed = JSON.parse(out.text || '{}');
      const title = String(parsed.title || '').trim().replace(/^["']|["'.]+$/g, '').slice(0, 80);
      return { title, outline: String(parsed.outline || '').trim().slice(0, 1800) };
    } catch {
      return null;
    }
  }

  async function storedCover(noteId) {
    if (!supabaseUrl || !serviceKey) return null;
    try {
      const response = await db(`/rest/v1/note_covers?note_id=eq.${encodeURIComponent(noteId)}&select=note_id,user_id,url,alt,content_length`);
      if (!response.ok) return null;
      return (await response.json())?.[0] || null;
    } catch {
      return null;
    }
  }

  async function meta(authorization, { noteId, title: wantTitle = true, cover: wantCover = true } = {}) {
    const userId = userIdFromToken(authorization);
    if (!userId || !noteId) return { status: 401, body: { detail: 'Sign in again.' } };
    const note = await readNote(authorization, noteId);
    if (!note) return { status: 404, body: { detail: 'Note not found.' } };
    const text = htmlToText(note.content);
    if (text.length < MIN_CHARS) return { status: 200, body: { reason: 'short' } };
    const body = {};

    const existing = await storedCover(noteId);
    const coverDue = wantCover && needsCover(existing, text.length);
    const titleDue = wantTitle && isDefaultTitle(note.title);
    const labels = titleDue || (coverDue && text.length > 2000) ? await label(text) : null;

    if (titleDue) {
      const title = labels?.title || heuristicTitle(text);
      if (title && !isDefaultTitle(title) && await saveTitle(authorization, noteId, title)) body.title = title;
    }

    if (existing?.url) body.cover = { url: existing.url, alt: existing.alt };
    if (coverDue) {
      // Long notes: the outline, so the graphic covers everything the note talks about.
      const coverText = labels?.outline || text.slice(0, 2000);
      const made = await visuals.generate({ authorization, text: coverText, context: note.title && !isDefaultTitle(note.title) ? note.title : '', theme: 'light', variations: 1 });
      const file = made.httpStatus === 200 && made.body?.status === 'ok' ? made.body.visuals?.[0] : null;
      if (file?.url) {
        body.cover = { url: file.url, alt: made.body.alt };
        await db('/rest/v1/note_covers', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ note_id: String(noteId), user_id: userId, url: file.url, alt: made.body.alt || '', content_length: text.length, updated_at: new Date().toISOString() }),
        }).catch(() => {});
      } else {
        body.reason = made.httpStatus === 402 ? 'limit' : made.body?.reason || 'no_cover';
      }
    }
    return { status: 200, body };
  }

  async function covers(authorization) {
    const userId = userIdFromToken(authorization);
    if (!userId) return { status: 401, body: { detail: 'Sign in again.' } };
    if (!supabaseUrl || !serviceKey) return { status: 200, body: { covers: [], enabled: false } };
    // Same check as everywhere else: the Classroom API must accept this sign-in.
    const check = await fetchImpl(`${apiBase}/billing/status`, { headers: { Authorization: authorization } }).catch(() => null);
    if (!check?.ok) return { status: 401, body: { detail: 'Sign in again.' } };
    try {
      const response = await db(`/rest/v1/note_covers?user_id=eq.${userId}&select=note_id,url,alt,content_length`);
      return { status: 200, body: { covers: response.ok ? await response.json() : [], enabled: visuals.enabled } };
    } catch {
      return { status: 200, body: { covers: [], enabled: visuals.enabled } };
    }
  }

  return { meta, covers };
}
