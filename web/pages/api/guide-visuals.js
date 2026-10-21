// Visuals kept beside a guide's Outline sections. GET ?guideId: the kept visuals.
// POST { guideId, section, anchor, url, alt, theme }: keep one. DELETE { guideId, id }: remove one.
// Answers { stored: false } until the guide_visuals table exists; the browser keeps them meanwhile.
import { createGuideVisualsService } from '../../lib/server/guideVisuals.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const service = createGuideVisualsService();
  const authorization = req.headers.authorization || '';
  try {
    let result;
    if (req.method === 'GET') result = await service.list({ authorization, guideId: req.query.guideId });
    else if (req.method === 'POST') result = await service.keep({ authorization, ...(req.body || {}) });
    else if (req.method === 'DELETE') result = await service.remove({ authorization, ...(req.body || {}) });
    else {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).json({ detail: 'Method not allowed' });
    }
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    console.error('[guide-visuals]', error?.message || error);
    return res.status(200).json({ stored: false });
  }
}
