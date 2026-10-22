// Server-only: the visuals a student keeps beside sections of a guide's Outline (/api/guide-visuals).
//
// Every call first reads the guide through the Classroom API with the student's own sign-in, so a
// student only ever lists or changes visuals on their own guides. Rows live in guide_visuals
// (service role only). Until that table exists, answers { stored: false } and the browser keeps
// the visuals itself.
import { supabaseUrlFrom } from '../supabaseUrl.mjs';

export const MAX_PER_GUIDE = 40;
const INLINE_PREFIX = 'data:image/svg+xml;base64,';
const MAX_INLINE = 1_500_000;
const COLUMNS = 'id,section,anchor,url,alt,theme,created_at';
export const MIN_WIDTH = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userIdFromToken(authorization) {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub || '';
  } catch {
    return '';
  }
}

const clip = (value, max) => String(value || '').trim().slice(0, max);

export function createGuideVisualsService({ env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const apiBase = (env.CLASSROOM_API_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const supabaseUrl = supabaseUrlFrom(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  // Only images Cordia stored itself (napkinVisual.mjs) can be kept.
  const imagePrefix = `${supabaseUrl}/storage/v1/object/public/visuals/`;

  const db = (path, init = {}) => fetchImpl(`${supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  // The student's own guide, or null. The Classroom API checks the sign-in.
  async function owner(authorization, guideId) {
    if (!authorization || !UUID.test(String(guideId || ''))) return null;
    try {
      const response = await fetchImpl(`${apiBase}/guides/${guideId}`, { headers: { Authorization: authorization } });
      if (!response.ok) return null;
      const guide = (await response.json())?.guide;
      const userId = guide?.user_id || userIdFromToken(authorization);
      return guide?.id === guideId && userId ? userId : null;
    } catch {
      return null;
    }
  }

  // The table not existing yet (PostgREST answers 404) means: let the browser keep them.
  const notStored = { httpStatus: 200, body: { stored: false } };

  async function list({ authorization, guideId }) {
    if (!supabaseUrl || !serviceKey) return notStored;
    const userId = await owner(authorization, guideId);
    if (!userId) return { httpStatus: 404, body: { detail: 'Guide not found' } };
    const query = columns => db(`/rest/v1/guide_visuals?user_id=eq.${userId}&guide_id=eq.${guideId}&select=${columns}&order=created_at.asc&limit=${MAX_PER_GUIDE}`);
    // `width` needs migration 20261022140000; until then the list is read without it.
    let response = await query(`${COLUMNS},width`);
    if (response.status === 400) response = await query(COLUMNS);
    if (response.status === 404) return notStored;
    if (!response.ok) return { httpStatus: 502, body: { detail: "Visuals didn't load." } };
    return { httpStatus: 200, body: { stored: true, visuals: await response.json() } };
  }

  // An image Cordia stored, or (before the visuals bucket exists) the drawing itself, inline.
  async function keep({ authorization, guideId, section, anchor, url, alt, theme }) {
    if (!supabaseUrl || !serviceKey) return notStored;
    const image = String(url || '');
    const stored = image.startsWith(imagePrefix) && !/[\s"'<>]/.test(image);
    const inline = image.startsWith(INLINE_PREFIX) && image.length <= MAX_INLINE && /^[A-Za-z0-9+/=]+$/.test(image.slice(INLINE_PREFIX.length));
    if (!stored && !inline) return { httpStatus: 400, body: { detail: 'That visual can’t be kept.' } };
    const userId = await owner(authorization, guideId);
    if (!userId) return { httpStatus: 404, body: { detail: 'Guide not found' } };
    const row = {
      user_id: userId,
      guide_id: guideId,
      section: clip(section, 500),
      anchor: clip(anchor, 600),
      url: image,
      alt: clip(alt, 500),
      theme: theme === 'dark' ? 'dark' : 'light',
    };
    const response = await db('/rest/v1/guide_visuals', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (response.status === 404) return notStored;
    if (!response.ok) return { httpStatus: 502, body: { detail: "That visual didn't save. Try again." } };
    const [saved] = await response.json();
    return { httpStatus: 200, body: { stored: true, visual: saved } };
  }

  async function remove({ authorization, guideId, id }) {
    if (!supabaseUrl || !serviceKey) return notStored;
    if (!UUID.test(String(id || ''))) return { httpStatus: 400, body: { detail: 'Unknown visual' } };
    const userId = await owner(authorization, guideId);
    if (!userId) return { httpStatus: 404, body: { detail: 'Guide not found' } };
    const response = await db(`/rest/v1/guide_visuals?id=eq.${id}&user_id=eq.${userId}&guide_id=eq.${guideId}`, { method: 'DELETE' });
    if (response.status === 404) return notStored;
    if (!response.ok) return { httpStatus: 502, body: { detail: "That visual wasn't removed. Try again." } };
    return { httpStatus: 200, body: { stored: true, removed: id } };
  }

  // Moves a kept visual to another line (anchor and section) and/or sets its width (30-100, % of
  // the column). Answers widthStored: false while the width column doesn't exist yet, so the
  // browser keeps the width itself.
  async function update({ authorization, guideId, id, anchor, section, width }) {
    if (!supabaseUrl || !serviceKey) return notStored;
    if (!UUID.test(String(id || ''))) return { httpStatus: 400, body: { detail: 'Unknown visual' } };
    const patch = {};
    if (typeof anchor === 'string' && anchor.trim()) patch.anchor = clip(anchor, 600);
    if (typeof section === 'string') patch.section = clip(section, 500);
    const size = width === null ? null : Number.isFinite(Number(width)) ? Math.round(Math.min(100, Math.max(MIN_WIDTH, Number(width)))) : undefined;
    if (!Object.keys(patch).length && size === undefined) return { httpStatus: 400, body: { detail: 'Nothing to change' } };
    const userId = await owner(authorization, guideId);
    if (!userId) return { httpStatus: 404, body: { detail: 'Guide not found' } };
    const send = body => db(`/rest/v1/guide_visuals?id=eq.${id}&user_id=eq.${userId}&guide_id=eq.${guideId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
    let widthStored = size !== undefined;
    let response = await send(size === undefined ? patch : { ...patch, width: size });
    if (response.status === 400 && size !== undefined) {
      widthStored = false;
      response = Object.keys(patch).length ? await send(patch) : null;
    }
    if (response && response.status === 404) return notStored;
    if (response && !response.ok) return { httpStatus: 502, body: { detail: "That change didn't save. Try again." } };
    const [saved] = response ? await response.json() : [];
    if (response && !saved) return { httpStatus: 404, body: { detail: 'Unknown visual' } };
    return { httpStatus: 200, body: { stored: true, visual: saved || { id }, widthStored } };
  }

  return { list, keep, update, remove };
}
