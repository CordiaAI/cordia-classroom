// POST { name, titles }: the three subject icons for a class's cover, picked by a small AI call
// from the fixed list in lib/coverDesign.mjs (keyword picks when the AI isn't set up or fails).
import { aiChat } from '../../lib/server/aiChat.mjs';
import { smallChatProvider } from '../../lib/server/aiProvider.mjs';
import { COVER_ICONS, cleanIcons, keywordIcons } from '../../lib/coverDesign.mjs';
import { withAppTokensOnly } from '../../lib/server/connectedApps.mjs';

const RULES = `You choose icons for a class's cover in a study app. From the allowed icon names, pick the 3 that best show what the class is about, judging from its name and the titles of its material. Prefer icons for the subject itself over generic study icons. Answer with JSON only: {"icons": ["Name", "Name", "Name"]}.
Allowed icon names: ${COVER_ICONS.join(', ')}`;

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ detail: 'Method not allowed' });
  }
  const authorization = req.headers.authorization || '';
  const apiBase = (process.env.CLASSROOM_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  const check = authorization ? await fetch(`${apiBase}/billing/status`, { headers: { Authorization: authorization } }).catch(() => null) : null;
  if (!check?.ok) return res.status(401).json({ detail: 'Sign in again.' });
  const name = String(req.body?.name || '').slice(0, 200);
  const titles = (Array.isArray(req.body?.titles) ? req.body.titles : []).map(item => String(item || '').slice(0, 160)).filter(Boolean).slice(0, 15);
  const fallback = keywordIcons(name, titles);
  const out = await aiChat(smallChatProvider(), { system: RULES, user: `Class: ${name}\nMaterial:\n${titles.map(title => `- ${title}`).join('\n') || '(none yet)'}`, maxTokens: 200, json: true, timeoutMs: 12000, retries: 0 }).catch(() => null);
  let icons = [];
  try { icons = cleanIcons(JSON.parse(out?.text || '{}').icons); } catch { /* not JSON */ }
  return res.status(200).json({ icons: icons.length ? [...icons, ...fallback.filter(icon => !icons.includes(icon))].slice(0, 3) : fallback, ai: icons.length > 0 });
}

export default withAppTokensOnly(handler);
