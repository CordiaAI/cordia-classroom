// Server-only: Napkin AI visuals for /api/visual. The Napkin key never leaves the server.
//
// Flow: verify the student (Classroom API /billing/status, which also gives the plan) ->
// cache lookup by hash(text + context + style + theme) -> monthly limit -> POST /v1/visual ->
// poll status every 1.5 s for up to 20 s -> download every file at once with the auth header
// (Napkin URLs expire after 30 minutes) -> store in our own bucket -> charge one use -> cache.
// A drawing still running after 20 s returns { status: 'pending', resume } and the page calls
// again with `resume` (a signed ticket) to keep waiting, up to 3 minutes in all, so a slow
// drawing never runs into the serverless time limit. Anything that goes wrong on Napkin's side
// returns { status: 'fallback' } so the page shows its own themed diagram instead.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseUrlFrom } from '../supabaseUrl.mjs';

export const NAPKIN_BASE = 'https://api.napkin.ai';
// Built-in "Pastel Field" (Casual): soft sage and orange fills, close to Cordia's palette, until
// NAPKIN_STYLE_ID picks another (https://api.napkin.ai/docs/styles).
export const DEFAULT_STYLE_ID = 'CDGQ6XB1DGPQ6VV6EGPQ4CG';
export const LIMITS = { free: 10, pro: 200 };
// Checked every second, so a finished drawing is picked up quickly.
export const POLL_MS = 1000;
export const BUDGET_MS = 20000;
export const TOTAL_MS = 180000;
export const VARIATIONS = 3;
export const BUCKET = 'visuals';
const MAX_TEXT = 2000;
const MAX_CONTEXT = 1500;

export function cacheKey({ text, context = '', style, theme, variations = VARIATIONS }) {
  const parts = variations === 2 ? [text, context, style, theme] : [text, context, style, theme, variations];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// Alt text from the content itself: its first line, trimmed to a sentence.
export function altText(text) {
  const first = String(text || '').split('\n').map(line => line.replace(/^[#>*\-\d.)\s]+/, '').trim()).find(Boolean) || 'concept';
  return `Diagram: ${first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first}`;
}

// Generated SVGs are shown through <img>, where scripts never run. A diagram never needs a
// script, embedded HTML, an event handler or a javascript: link, so an SVG with any of them is
// not used at all (no partial cleaning that a crafted file could slip through).
const RISKY_SVG = /<\s*script|<\s*foreignObject|\son[a-z]+\s*=|javascript\s*:/i;
export function cleanSvg(svg) {
  const text = String(svg);
  return RISKY_SVG.test(text) ? '' : text;
}

export function currentMonth(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

const sleepReal = ms => new Promise(resolve => setTimeout(resolve, ms));

// Shared across requests in one server instance: when Napkin says the window is spent,
// nobody calls it again until the reset time.
const rateState = { blockedUntil: 0 };
export function resetRateState() { rateState.blockedUntil = 0; }

function noteRateHeaders(headers, now) {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (remaining !== null && Number(remaining) <= 0 && reset) rateState.blockedUntil = Math.max(rateState.blockedUntil, reset * 1000);
  else if (now >= rateState.blockedUntil) rateState.blockedUntil = 0;
}

export function createVisualService({ env = process.env, fetch: fetchImpl = globalThis.fetch, sleep = sleepReal, now = () => Date.now() } = {}) {
  const supabaseUrl = supabaseUrlFrom(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const napkinKey = env.NAPKIN_API_KEY || '';
  const napkinBase = (env.NAPKIN_API_BASE || NAPKIN_BASE).replace(/\/$/, '');
  const apiBase = (env.CLASSROOM_API_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const style = env.NAPKIN_STYLE_ID || DEFAULT_STYLE_ID;
  const enabled = Boolean(napkinKey && supabaseUrl && serviceKey);
  // Which server settings are missing (names only), so "not set up" says what to add.
  const missing = [!napkinKey && 'NAPKIN_API_KEY', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  if (missing.length) console.warn('[visual] not set up; missing', missing.join(', '));

  // The resume ticket: which Napkin request, when it started, for whom and for what content.
  const sign = value => createHmac('sha256', `cordia-visual:${serviceKey}`).update(value).digest('base64url');
  const ticket = (userId, key, id, startedAt) => `${id}.${startedAt}.${sign(`${userId}|${key}|${id}|${startedAt}`)}`;
  function readTicket(value, userId, key) {
    const [id, startedAt, mac] = String(value || '').split('.');
    if (!id || !startedAt || !mac) return null;
    const expected = Buffer.from(sign(`${userId}|${key}|${id}|${startedAt}`));
    const given = Buffer.from(mac);
    return given.length === expected.length && timingSafeEqual(given, expected) ? { id, startedAt: Number(startedAt) } : null;
  }

  const db = (path, init = {}) => fetchImpl(`${supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  async function account(authorization) {
    if (!authorization) return null;
    const response = await fetchImpl(`${apiBase}/billing/status`, { headers: { Authorization: authorization } });
    if (!response.ok) return null;
    const data = await response.json();
    const userId = data?.user_id || userIdFromToken(authorization);
    if (!userId) return null;
    const plan = data?.plan === 'free' || !data?.plan ? 'free' : 'pro';
    return { userId, plan, unlimited: Boolean(data?.unlimited) };
  }

  async function used(userId) {
    const response = await db('/rest/v1/rpc/feature_usage_counts', { method: 'POST', body: JSON.stringify({ p_user_id: userId, p_month: currentMonth(new Date(now())) }) });
    if (!response.ok) return 0;
    const rows = await response.json();
    return Number((rows || []).find(row => row.feature === 'visual')?.used || 0);
  }

  async function usage(who) {
    const limit = LIMITS[who.plan];
    const count = await used(who.userId);
    return { plan: who.plan, limit, used: count, left: who.unlimited ? limit : Math.max(0, limit - count) };
  }

  async function cached(key) {
    const response = await db(`/rest/v1/visual_cache?key=eq.${key}&select=files,alt,theme`);
    if (!response.ok) return null;
    const rows = await response.json();
    return rows?.[0] || null;
  }

  async function store(key, index, svg) {
    const path = `${key.slice(0, 2)}/${key}/${index}.svg`;
    const response = await db(`/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/svg+xml', 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
      body: svg,
    });
    if (!response.ok) throw new Error('store');
    return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
  }

  // POST /v1/visual. On 429 wait for Retry-After and try once more (if it fits the budget).
  async function createRequest(body, deadline) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (rateState.blockedUntil > now()) {
        const wait = rateState.blockedUntil - now();
        if (attempt > 0 || now() + wait + POLL_MS > deadline) return { fallback: 'rate_limited' };
        await sleep(wait);
      }
      const response = await fetchImpl(`${napkinBase}/v1/visual`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${napkinKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      noteRateHeaders(response.headers, now());
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 0;
        const waitMs = Math.max(retryAfter * 1000, 1000);
        rateState.blockedUntil = Math.max(rateState.blockedUntil, now() + waitMs);
        if (attempt > 0 || now() + waitMs + POLL_MS > deadline) return { fallback: 'rate_limited' };
        await sleep(waitMs);
        continue;
      }
      if (!response.ok) return { fallback: 'napkin_error' };
      const data = await response.json();
      return data?.id ? { id: data.id } : { fallback: 'napkin_error' };
    }
    return { fallback: 'rate_limited' };
  }

  async function waitForFiles(id, deadline) {
    while (now() + POLL_MS <= deadline) {
      await sleep(POLL_MS);
      const response = await fetchImpl(`${napkinBase}/v1/visual/${encodeURIComponent(id)}/status`, { headers: { Authorization: `Bearer ${napkinKey}`, Accept: 'application/json' } });
      if (!response.ok) { if (response.status >= 500) continue; return { fallback: 'napkin_error' }; }
      const data = await response.json();
      if (data?.status === 'completed') return data.generated_files?.length ? { files: data.generated_files } : { fallback: 'no_visuals' };
      if (data?.status === 'failed' || data?.error) return { fallback: 'napkin_error' };
    }
    return { fallback: 'timeout' };
  }

  async function generate({ authorization, text, context = '', theme = 'light', variations = VARIATIONS, resume = '' }) {
    const who = await account(authorization);
    if (!who) return { httpStatus: 401, body: { detail: 'Sign in again.' } };
    const content = String(text || '').trim().slice(0, MAX_TEXT);
    if (content.length < 3) return { httpStatus: 400, body: { detail: 'Nothing to draw.' } };
    const mode = theme === 'dark' ? 'dark' : 'light';
    if (!enabled) return { httpStatus: 200, body: { status: 'fallback', reason: 'not_configured', missing } };

    const key = cacheKey({ text: content, context, style, theme: mode, variations });
    const [hit, counts] = await Promise.all([cached(key), usage(who)]);
    if (hit?.files?.length) {
      return { httpStatus: 200, body: { status: 'ok', cached: true, visuals: hit.files, alt: hit.alt, theme: hit.theme || mode, left: counts.left, limit: counts.limit } };
    }
    const resumed = resume ? readTicket(resume, who.userId, key) : null;
    if (resume && !resumed) return { httpStatus: 400, body: { detail: 'That drawing request expired. Try again.' } };
    if (!resumed && !who.unlimited && counts.left <= 0) {
      return { httpStatus: 402, body: { detail: { code: 'limit_reached', feature: 'visual', plan: who.plan === 'pro' ? 'classroom_plus' : 'free', used: counts.used, limit: counts.limit, message: who.plan === 'pro' ? 'Limit reached' : "You've used this month's visuals." } } };
    }

    const deadline = now() + BUDGET_MS;
    const created = resumed ? { id: resumed.id } : await createRequest({
      format: 'svg',
      content,
      // Napkin replaced context_before/context_after with one context field (API v0.5.1).
      ...(context ? { context: String(context).slice(0, MAX_CONTEXT) } : {}),
      language: 'en-US',
      style_id: style,
      number_of_visuals: variations,
      // Variations that differ in layout, so the choice is a real choice (API v1.1.4).
      sort_strategy: 'variation',
      transparent_background: true,
      color_mode: mode,
    }, deadline);
    if (created.fallback) return { httpStatus: 200, body: { status: 'fallback', reason: created.fallback } };
    const startedAt = resumed?.startedAt || now();
    const result = await waitForFiles(created.id, Math.min(deadline, startedAt + TOTAL_MS));
    if (result.fallback === 'timeout' && now() + POLL_MS < startedAt + TOTAL_MS) {
      return { httpStatus: 200, body: { status: 'pending', resume: ticket(who.userId, key, created.id, startedAt) } };
    }
    if (result.fallback) return { httpStatus: 200, body: { status: 'fallback', reason: result.fallback } };

    // Download now: Napkin's links expire after 30 minutes, and we never hotlink them.
    // All versions at once, each downloaded and stored in parallel.
    const saved = await Promise.all(result.files.slice(0, variations).map(async (file, index) => {
      try {
        const response = await fetchImpl(file.url, { headers: { Authorization: `Bearer ${napkinKey}` } });
        if (!response.ok) return null;
        const clean = cleanSvg(await response.text());
        if (!clean) return null;
        // Without the "visuals" bucket (migration not run) the drawing is still shown, inline.
        const url = await store(key, index, clean).catch(() => `data:image/svg+xml;base64,${Buffer.from(clean).toString('base64')}`);
        return { url, width: file.width || null, height: file.height || null };
      } catch { return null; /* skip this variation */ }
    }));
    const visuals = saved.filter(Boolean);
    if (!visuals.length) return { httpStatus: 200, body: { status: 'fallback', reason: 'download_failed' } };

    const alt = altText(content);
    await Promise.all([
      db('/rest/v1/rpc/record_feature_usage', { method: 'POST', body: JSON.stringify({ p_user_id: who.userId, p_feature: 'visual', p_month: currentMonth(new Date(now())), p_request_key: `visual:${key}`.slice(0, 120) }) }),
      db('/rest/v1/visual_cache', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key, user_id: who.userId, theme: mode, alt, files: visuals }) }),
    ]);
    const left = who.unlimited ? counts.limit : Math.max(0, counts.left - 1);
    return { httpStatus: 200, body: { status: 'ok', cached: false, visuals, alt, theme: mode, left, limit: counts.limit } };
  }

  async function usageFor(authorization) {
    const who = await account(authorization);
    if (!who) return { httpStatus: 401, body: { detail: 'Sign in again.' } };
    if (!enabled) return { httpStatus: 200, body: { enabled: false, missing, plan: who.plan, limit: LIMITS[who.plan], left: LIMITS[who.plan] } };
    return { httpStatus: 200, body: { enabled: true, ...(await usage(who)) } };
  }

  return { generate, usageFor, enabled };
}

function userIdFromToken(authorization) {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub || '';
  } catch {
    return '';
  }
}
