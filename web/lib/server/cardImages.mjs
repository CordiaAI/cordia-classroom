// Photos on flashcards. Flow: verify the student (Classroom API /billing/status) -> check the image
// is really a JPEG, PNG, WebP or GIF under 3 MB -> store it in the public "card-images" bucket at
// <user id>/<random>.<ext> -> return its URL for the card. Server env: SUPABASE_SERVICE_ROLE_KEY.
import { randomUUID } from 'node:crypto';

export const MAX_BYTES = 3 * 1024 * 1024;
const BUCKET = 'card-images';

// The type the bytes say they are, whatever the upload claims.
export function sniffImage(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' };
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return { type: 'image/gif', ext: 'gif' };
  return null;
}

// Card photos (public, the URL goes on the card) and feedback screenshots (private, only the
// path is kept; reviewers get short-lived links) share one upload path.
const STORES = {
  card: { bucket: BUCKET, isPublic: true, maxBytes: MAX_BYTES, notSetUp: "Photos on cards aren't set up on this site yet.", tooBig: 'That photo is too large. Try one under 3 MB.', what: 'photo' },
  feedback: { bucket: 'feedback-attachments', isPublic: false, maxBytes: 5 * 1024 * 1024, notSetUp: "Screenshots on feedback aren't set up yet. Send it without one, or describe what you saw.", tooBig: 'That screenshot is too large. Try one under 5 MB.', what: 'screenshot' },
};

export function createCardImages(options = {}) {
  return createImageStore({ ...options, kind: 'card' });
}

export function createImageStore({ env = process.env, fetch: fetchImpl = fetch, kind = 'card' } = {}) {
  const store = STORES[kind] || STORES.card;
  const apiBase = (env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const NOT_SET_UP = { status: 503, body: { detail: store.notSetUp, code: 'not_configured' } };

  async function who(authorization) {
    if (!authorization) return '';
    const check = await fetchImpl(`${apiBase}/billing/status`, { headers: { Authorization: authorization } }).catch(() => null);
    if (!check?.ok) return '';
    try {
      const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
      return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub || '';
    } catch {
      return '';
    }
  }

  // { image: 'data:image/...;base64,...' } -> { url }
  async function upload(authorization, body) {
    if (!supabaseUrl || !serviceKey) return NOT_SET_UP;
    const userId = await who(authorization);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return { status: 401, body: { detail: `Sign in again to add a ${store.what}.` } };
    const match = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(body?.image || ''));
    if (!match) return { status: 400, body: { detail: `That file is not an image.` } };
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length > store.maxBytes) return { status: 413, body: { detail: store.tooBig } };
    const kind = sniffImage(bytes);
    if (!kind) return { status: 400, body: { detail: 'Use a JPEG, PNG, WebP or GIF image.' } };
    const path = `${userId.toLowerCase()}/${randomUUID()}.${kind.ext}`;
    const stored = await fetchImpl(`${supabaseUrl}/storage/v1/object/${store.bucket}/${path}`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': kind.type, 'Cache-Control': 'max-age=31536000' },
      body: bytes,
    }).catch(() => null);
    if (!stored?.ok) {
      const text = stored ? await stored.text().catch(() => '') : '';
      // No bucket yet: the migration hasn't run.
      if (/bucket not found/i.test(text)) return NOT_SET_UP;
      console.error(`[${kind}-image] store failed`, stored?.status, text.slice(0, 300));
      return { status: 502, body: { detail: `The ${store.what} didn't upload. Try again.` } };
    }
    if (!store.isPublic) return { status: 200, body: { path } };
    return { status: 200, body: { url: `${supabaseUrl}/storage/v1/object/public/${store.bucket}/${path}` } };
  }

  return { upload };
}
