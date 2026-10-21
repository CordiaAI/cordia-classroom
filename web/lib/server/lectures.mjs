// Server-only: lecture recording for /api/lectures/*. The OpenAI key never leaves the server.
//
// chunk: transcribe one short piece of audio (gpt-4o-mini-transcribe) with the transcript tail
//        and class terms as the prompt, and charge each minute of audio once per recording.
// notes: rolling notes (headings, definitions, terms, "on the exam") from recent transcript.
// title: a short AI title for the finished lecture.
// usage: recording minutes left this month.
//
// Minutes are metered in Supabase (feature "lecture_minute") when SUPABASE_SERVICE_ROLE_KEY is
// set and the lecture migration is applied; until then recording works and is not counted.

import { aiProvider, chatProvider } from './aiProvider.mjs';
import { aiChat } from './aiChat.mjs';
import { supabaseUrlFrom } from '../supabaseUrl.mjs';
export const LIMITS = { free: 120, pro: 1500 };
export const MAX_CHUNK_BYTES = 4_300_000; // under Vercel's 4.5 MB request limit
const FEATURE = 'lecture_minute';
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const EXTENSIONS = {
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a',
  'audio/aac': 'm4a', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
};

export const NOTES_RULES = `You turn a lecture transcript into short running notes. Use only what the speaker said.
Return JSON: {"notes": [{"kind": "heading"|"definition"|"term"|"exam", "text": "...", "at_ms": <start_ms of the line it came from>}], "class_id": "<id or empty>"}
- heading: the speaker moves to a new topic (a few words).
- definition: the speaker explains what something is or means.
- term: a key term, name, date, formula or idea the speaker stresses.
- exam: anything the speaker flags as important for a test, assignment or grade.
- Every item must be supported by the transcript. Do not add outside knowledge.
- class_id: the id of the class whose name best matches the lecture's subject, or "" if none fits.`;

export const TITLE_RULES = `Give this lecture a short, specific title (3 to 8 words) naming its subject, as a
student would label their notes. No quotes, no date, no trailing punctuation. Return only the title.`;

const sleepReal = ms => new Promise(resolve => setTimeout(resolve, ms));

export function currentMonth(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

// Each whole minute of audio this chunk touches, so overlap and retries are never charged twice.
export function minutesTouched(startMs, durationMs) {
  const start = Math.max(0, Math.round(startMs) || 0);
  const first = Math.floor(start / 60000);
  const last = Math.max(first, Math.floor((start + Math.max(0, Math.round(durationMs) || 0) - 1) / 60000));
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function extensionFor(contentType) {
  return EXTENSIONS[String(contentType || '').split(';')[0].trim().toLowerCase()] || '';
}

function userIdFromToken(authorization) {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub || '';
  } catch {
    return '';
  }
}

export function createLectureService({ env = process.env, fetch: fetchImpl = globalThis.fetch, sleep = sleepReal, now = () => new Date() } = {}) {
  const provider = aiProvider(env);
  const openaiKey = provider.key;
  const { transcribeModel } = provider;
  // Notes and titles are written by chatProvider (Claude when set); audio stays with Whisper.
  const writer = chatProvider(env);
  const supabaseUrl = supabaseUrlFrom(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const metered = Boolean(supabaseUrl && serviceKey);
  const apiBase = (env.CLASSROOM_API_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

  const db = (path, init = {}) => fetchImpl(`${supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  // The Classroom API checks the sign-in and knows the plan.
  async function account(authorization) {
    if (!authorization) return null;
    let response;
    try { response = await fetchImpl(`${apiBase}/billing/status`, { headers: { Authorization: authorization } }); } catch { return null; }
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    const userId = userIdFromToken(authorization);
    if (!userId) return null;
    const plan = !data?.plan || data.plan === 'free' ? 'free' : 'pro';
    const limit = Number(data?.features?.[FEATURE]?.limit) || LIMITS[plan];
    return { userId, plan, limit, unlimited: Boolean(data?.unlimited) };
  }

  async function used(userId) {
    if (!metered) return 0;
    try {
      const response = await db('/rest/v1/rpc/feature_usage_counts', { method: 'POST', body: JSON.stringify({ p_user_id: userId, p_month: currentMonth(now()) }) });
      if (!response.ok) return 0;
      const rows = await response.json();
      return Number((rows || []).find(row => row.feature === FEATURE)?.used || 0);
    } catch {
      return 0;
    }
  }

  async function left(who) {
    if (who.unlimited || !metered) return who.limit;
    return Math.max(0, who.limit - (await used(who.userId)));
  }

  async function charge(who, recordingId, startMs, durationMs) {
    if (!metered) return;
    for (const minute of minutesTouched(startMs, durationMs)) {
      try {
        await db('/rest/v1/rpc/record_feature_usage', { method: 'POST', body: JSON.stringify({ p_user_id: who.userId, p_feature: FEATURE, p_month: currentMonth(now()), p_request_key: `${FEATURE}:${recordingId}:${minute}`.slice(0, 120) }) });
      } catch { return; } // usage is best effort until the migration is applied
    }
  }

  // AI call (Groq or OpenAI) with a time limit and one retry for timeouts, rate limits and server errors.
  async function openai(path, init, { timeoutMs = 45000 } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${provider.base}${path}`, { ...init, headers: { Authorization: `Bearer ${openaiKey}`, ...(init.headers || {}) }, signal: controller.signal });
        if (response.ok) return await response.json();
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          const wait = Math.min(4000, (Number(response.headers.get('retry-after')) || 1) * 1000);
          await sleep(wait);
          continue;
        }
        return null;
      } catch {
        if (attempt === 0) continue;
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function usage(authorization) {
    const who = await account(authorization);
    if (!who) return { status: 401, body: { detail: 'Sign in again.' } };
    return { status: 200, body: { minutes_left: await left(who), minutes_limit: who.limit, metered, ready: Boolean(openaiKey) } };
  }

  async function chunk(authorization, { audio, contentType, recordingId, seq, startMs, durationMs, prompt = '', keep = false }) {
    if (!openaiKey) return { status: 503, body: { detail: "Transcription isn't set up yet.", code: 'not_configured' } };
    const who = await account(authorization);
    if (!who) return { status: 401, body: { detail: 'Sign in again.' } };
    if (!ID.test(recordingId || '')) return { status: 400, body: { detail: 'Invalid recording.' } };
    if (!audio?.length) return { status: 200, body: { seq, start_ms: startMs, text: '' } };
    if (audio.length > MAX_CHUNK_BYTES) return { status: 413, body: { detail: 'This part of the recording is too large.' } };
    const ext = extensionFor(contentType);
    if (!ext) return { status: 415, body: { detail: 'Use an mp3, m4a, wav or webm recording.' } };
    if ((await left(who)) <= 0) {
      return { status: 402, body: { detail: { code: 'limit_reached', feature: FEATURE, plan: who.plan === 'pro' ? 'classroom_plus' : 'free', limit: who.limit, message: "You've used this month's recording minutes." } } };
    }
    const form = new FormData();
    form.append('file', new Blob([audio], { type: String(contentType).split(';')[0] }), `chunk.${ext}`);
    form.append('model', transcribeModel);
    form.append('response_format', 'json');
    if (prompt) form.append('prompt', String(prompt).slice(-600));
    const data = await openai('/audio/transcriptions', { method: 'POST', body: form });
    if (!data) return { status: 502, body: { detail: "Couldn't transcribe this part. It will be retried." } };
    await charge(who, recordingId, startMs, durationMs);
    if (keep && metered) {
      const path = `${who.userId}/${recordingId}/${String(seq).padStart(5, '0')}.${ext}`;
      db(`/storage/v1/object/lecture-audio/${path}`, { method: 'POST', headers: { 'Content-Type': String(contentType).split(';')[0], 'x-upsert': 'true' }, body: audio }).catch(() => {});
    }
    return { status: 200, body: { seq, start_ms: startMs, text: String(data.text || '').trim() } };
  }

  async function notes(authorization, { segments = [], classes = [] } = {}) {
    const who = await account(authorization);
    if (!who) return { status: 401, body: { detail: 'Sign in again.' } };
    const lines = segments.filter(item => String(item?.text || '').trim()).sort((a, b) => a.start_ms - b.start_ms).map(item => `[${Math.round(item.start_ms)}] ${String(item.text).trim()}`);
    if (!lines.length || !writer.key) return { status: 200, body: { notes: [], class_id: '' } };
    const classList = classes.slice(0, 200).map(item => `${item.id}: ${item.name}`).join('\n') || '(none)';
    const out = await aiChat(writer, {
      system: NOTES_RULES,
      user: `Classes:\n${classList}\n\nTranscript (each line starts with [start_ms]):\n${lines.join('\n').slice(-24000)}`,
      maxTokens: 1400, json: true, timeoutMs: 25000, fetchImpl,
    });
    let parsed = {};
    try { parsed = JSON.parse(out?.text || '{}'); } catch { parsed = {}; }
    const starts = segments.map(item => Math.round(item.start_ms)).sort((a, b) => a - b);
    const items = (parsed.notes || []).filter(item => ['heading', 'definition', 'term', 'exam'].includes(item?.kind) && String(item?.text || '').trim()).slice(0, 40).map(item => {
      const at = Number(item.at_ms) || 0;
      return { kind: item.kind, text: String(item.text).trim().slice(0, 300), at_ms: starts.filter(start => start <= at).pop() ?? starts[0] ?? 0 };
    });
    const classId = classes.some(item => item.id === parsed.class_id) ? parsed.class_id : '';
    return { status: 200, body: { notes: items, class_id: classId } };
  }

  async function title(authorization, { text = '' } = {}) {
    const who = await account(authorization);
    if (!who) return { status: 401, body: { detail: 'Sign in again.' } };
    if (!writer.key || String(text).trim().length < 40) return { status: 200, body: { title: '' } };
    const out = await aiChat(writer, { system: TITLE_RULES, user: String(text).slice(0, 6000), maxTokens: 30, timeoutMs: 12000, fetchImpl });
    const raw = String(out?.text || '').trim().replace(/^["']|["'.]+$/g, '');
    return { status: 200, body: { title: raw.slice(0, 120) } };
  }

  return { usage, chunk, notes, title };
}
