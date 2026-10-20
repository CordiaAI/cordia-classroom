// Notes: AI title and Napkin cover (see lib/server/noteMeta.mjs).
//   GET  /api/notes/covers            this student's note covers
//   POST /api/notes/meta { note_id, title, cover }
// Server env: GROQ_API_KEY or OPENAI_API_KEY (titles, outlines), NAPKIN_API_KEY + SUPABASE_SERVICE_ROLE_KEY (covers).
import { createNoteMetaService } from '../../../lib/server/noteMeta.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const service = createNoteMetaService();
  const authorization = req.headers.authorization || '';
  try {
    let result;
    if (req.query.action === 'covers' && req.method === 'GET') result = await service.covers(authorization);
    else if (req.query.action === 'meta' && req.method === 'POST') {
      const { note_id: noteId, title = true, cover = true } = req.body || {};
      result = await service.meta(authorization, { noteId: String(noteId || ''), title: Boolean(title), cover: Boolean(cover) });
    } else return res.status(404).json({ detail: 'Not found' });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[notes]', req.query.action, error?.message || error);
    return res.status(200).json({ reason: 'server_error' });
  }
}
