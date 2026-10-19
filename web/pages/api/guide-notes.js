// POST { guide_id } -> { notes }: summary notes for a guide that has none (lib/server/guideNotes.mjs).
import { createGuideNotesService } from '../../lib/server/guideNotes.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ detail: 'Method not allowed' });
  try {
    const result = await createGuideNotesService().make(req.headers.authorization || '', String(req.body?.guide_id || ''));
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[guide-notes]', error?.message || error);
    return res.status(200).json({ notes: '', reason: 'server_error' });
  }
}
