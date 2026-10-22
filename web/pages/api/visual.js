// Napkin AI visuals. GET: visuals left this month. POST { text, context, theme, redraw?, resume? }:
// make a visual (redraw 1-3 asks for a new drawing of the same text); a drawing still running
// answers { status: 'pending', resume } and is called again.
// Server env (never sent to the browser): NAPKIN_API_KEY, NAPKIN_STYLE_ID (optional),
// SUPABASE_SERVICE_ROLE_KEY (storage, cache and usage).
import { createVisualService } from '../../lib/server/napkinVisual.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const service = createVisualService();
  const authorization = req.headers.authorization || '';
  try {
    let result;
    if (req.method === 'GET') result = await service.usageFor(authorization);
    else if (req.method === 'POST') {
      const { text, context, theme, redraw, resume } = req.body || {};
      result = await service.generate({ authorization, text, context, theme, redraw, resume });
    } else {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ detail: 'Method not allowed' });
    }
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    console.error('[visual]', error?.message || error);
    return res.status(200).json({ status: 'fallback', reason: 'server_error' });
  }
}
