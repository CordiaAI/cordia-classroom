// Server-only: is the new app shell on for the account calling /api/new-shell (rules: lib/newShell.mjs).
// CORDIA_NEW_SHELL is read here, from the server's environment, on every request; it never goes to
// the browser in any form. The caller is identified by the Classroom API (GET /auth/me, which checks
// the access token with Supabase Auth), never by an id or email the browser sends.
import { isConnectedAppToken } from './connectedApps.mjs';

const VERIFY_TIMEOUT_MS = 5000;
const NO = (status = 401) => ({ status, newShell: false });

// The switch's setting from the server's environment: 'on' (every signed-in account), 'off', or
// 'list' (only the accounts in `entries`: Supabase user ids or emails, lowercased).
export function shellMode({ value = '', vercelEnv = '', development = false } = {}) {
  const raw = String(value || '').trim();
  if (/^(off|none)$/i.test(raw)) return { mode: 'off', entries: [] };
  if (/^all$/i.test(raw) || development || vercelEnv === 'preview') return { mode: 'on', entries: [] };
  const entries = [...new Set(raw.split(',').map(item => item.trim().toLowerCase()).filter(Boolean))];
  return entries.length ? { mode: 'list', entries } : { mode: 'off', entries: [] };
}

export function modeFromEnv(env = process.env) {
  return shellMode({ value: env.CORDIA_NEW_SHELL, vercelEnv: env.VERCEL_ENV, development: env.NODE_ENV === 'development' });
}

// What a page can know before anyone signs in (pages/_document.js). Only `next dev` renders pages
// on every request, so only there is the answer exact ({ fixed }); a Vercel preview build is on
// unless the switch says off, which /api/new-shell confirms after load ({ guess }). Anywhere else
// the page knows nothing and the browser asks /api/new-shell.
export function pageDefault(env = process.env) {
  if (env.NODE_ENV === 'development') return { fixed: modeFromEnv(env).mode === 'on' };
  return env.VERCEL_ENV === 'preview' ? { guess: true } : {};
}

export function createShellSwitch({ env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const apiBase = (env.CLASSROOM_API_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

  // The signed-in account behind this Authorization header, as the Classroom API verified it, or
  // { status } when there is none (401) or it couldn't be checked (503).
  async function verified(authorization) {
    if (!/^Bearer\s+\S+$/i.test(authorization || '') || authorization.length > 4200 || isConnectedAppToken(authorization)) return { status: 401 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${apiBase}/auth/me`, { headers: { Authorization: authorization }, signal: controller.signal });
      if (response.status === 401 || response.status === 403) return { status: 401 };
      if (!response.ok) return { status: 503 };
      const me = await response.json();
      const id = String(me?.user_id || '').toLowerCase();
      return id ? { id, email: String(me?.email || '').trim().toLowerCase() } : { status: 401 };
    } catch {
      return { status: 503 };
    } finally {
      clearTimeout(timer);
    }
  }

  // -> { status, newShell }: 200 with the answer for a verified account; 401 (signed out, a bad or
  // expired token) or 503 (couldn't check) with false. Off needs no check: it is off for everyone.
  async function decide(authorization) {
    const { mode, entries } = modeFromEnv(env);
    if (mode === 'off') return { status: 200, newShell: false };
    const account = await verified(authorization);
    if (!account.id) return NO(account.status);
    if (mode === 'on') return { status: 200, newShell: true };
    return { status: 200, newShell: entries.includes(account.id) || Boolean(account.email && entries.includes(account.email)) };
  }

  return { decide };
}

// The pages/api/new-shell.js route: GET -> { newShell: true | false } and nothing else, never cached
// by a shared cache.
export function createShellRoute(options = {}) {
  const shellSwitch = createShellSwitch(options);
  return async function newShellRoute(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ newShell: false });
    }
    try {
      const { status, newShell } = await shellSwitch.decide(req.headers?.authorization || '');
      return res.status(status).json({ newShell: newShell === true });
    } catch (error) {
      console.error('[new-shell]', error?.message || error);
      return res.status(503).json({ newShell: false });
    }
  };
}
