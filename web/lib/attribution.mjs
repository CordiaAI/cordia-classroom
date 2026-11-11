// First-touch attribution: where a visitor came from the first time they landed on a public page,
// kept in this browser (localStorage, first-party only) for 30 days and sent once with sign-up
// (lib/ageCheck.js -> POST /auth/age). It never overwrites a first touch younger than 30 days and
// holds no personal data: a path, a referring host (never the full URL), campaign tags, a ?ref=
// code, Cordia's own ?from= value and, when the visit came from an AI assistant, which one.

export const FIRST_TOUCH_KEY = 'cordiaFirstTouch';
export const FIRST_TOUCH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// AI assistants, by the host a referrer or utm_source names (a subdomain such as www. counts too).
const AI_ENGINES = [
  ['chatgpt.com', 'chatgpt'],
  ['chat.openai.com', 'chatgpt'],
  ['perplexity.ai', 'perplexity'],
  ['gemini.google.com', 'gemini'],
  ['copilot.microsoft.com', 'copilot'],
  ['claude.ai', 'claude'],
];
export const AI_ENGINE_NAMES = [...new Set(AI_ENGINES.map(([, name]) => name)), 'bing_chat'];

const onHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const clip = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

// Which AI assistant sent the visit, if any. Bing counts only with a chat path (/chat): plain
// Bing search is a search engine. Browsers usually send only the referrer's origin, so a Bing chat
// visit is caught only when the path survives.
export function aiEngine({ referrerHost = '', referrerPath = '', utmSource = '' } = {}) {
  const source = String(utmSource || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  for (const [domain, name] of AI_ENGINES) {
    if ((referrerHost && onHost(referrerHost, domain)) || (source && onHost(source, domain))) return name;
  }
  if (referrerHost && onHost(referrerHost, 'bing.com') && /^\/chat(\/|$|\?)/.test(referrerPath || '')) return 'bing_chat';
  return null;
}

// The first touch for one page load: { at, landing_path, referrer_host, utm_source, utm_medium,
// utm_campaign, ref, from, ai_engine }. A referrer from this same site isn't a source.
export function firstTouchFrom({ href, referrer = '', now = Date.now() }) {
  const page = new URL(href);
  let referrerHost = null;
  let referrerPath = '';
  try {
    const from = new URL(referrer);
    if (/^https?:$/.test(from.protocol) && from.host !== page.host) {
      referrerHost = from.hostname.toLowerCase().slice(0, 255);
      referrerPath = from.pathname;
    }
  } catch { /* no referrer, or not a URL */ }
  const query = page.searchParams;
  const utmSource = clip(query.get('utm_source'), 100);
  const fromValue = clip(query.get('from'), 64);
  return {
    at: now,
    landing_path: page.pathname.slice(0, 200),
    referrer_host: referrerHost,
    utm_source: utmSource,
    utm_medium: clip(query.get('utm_medium'), 100),
    utm_campaign: clip(query.get('utm_campaign'), 100),
    ref: clip(query.get('ref'), 100),
    from: fromValue && /^[a-z0-9-]+$/.test(fromValue) ? fromValue : null,
    ai_engine: aiEngine({ referrerHost: referrerHost || '', referrerPath, utmSource: utmSource || '' }),
  };
}

const fresh = (touch, now) => Boolean(touch && Number.isFinite(touch.at) && now - touch.at < FIRST_TOUCH_DAYS * DAY_MS);

function read(storage) {
  try { return JSON.parse(storage.getItem(FIRST_TOUCH_KEY) || 'null'); } catch { return null; }
}

// Records this landing unless a first touch from the last 30 days is already kept. Storage can be
// blocked (private windows): then nothing is kept, and sign-up simply sends nothing.
export function recordFirstTouch({ href, referrer, storage, now = Date.now() }) {
  if (!storage) return null;
  const kept = read(storage);
  if (fresh(kept, now)) return kept;
  const touch = firstTouchFrom({ href, referrer, now });
  try { storage.setItem(FIRST_TOUCH_KEY, JSON.stringify(touch)); } catch { return null; }
  return touch;
}

// What sign-up sends: the kept first touch with its timestamp reduced to a date, or null.
export function firstTouchForSignup({ storage, now = Date.now() }) {
  const touch = storage && read(storage);
  if (!fresh(touch, now)) return null;
  const { at, ...rest } = touch;
  return { ...rest, first_seen: new Date(at).toISOString().slice(0, 10) };
}
