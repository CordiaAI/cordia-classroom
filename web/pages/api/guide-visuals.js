// Visuals kept beside a guide's Outline sections. GET ?guideId: the kept visuals.
// POST { guideId, section, anchor, url, alt, theme }: keep one. PATCH { guideId, id, anchor?, section?, width? }:
// move it to another line and/or resize it. DELETE { guideId, id }: remove one.
// Answers { stored: false } until the guide_visuals table exists; the browser keeps them meanwhile.
import { createGuideVisualsService } from '../../lib/server/guideVisuals.mjs';
import { withAppTokensOnly } from '../../lib/server/connectedApps.mjs';

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const service = createGuideVisualsService();
  const authorization = req.headers.authorization || '';
  try {
    let result;
    if (req.method === 'GET') result = await service.list({ authorization, guideId: req.query.guideId });
    else if (req.method === 'POST') result = await service.keep({ authorization, ...(req.body || {}) });
    else if (req.method === 'PATCH') result = await service.update({ authorization, ...(req.body || {}) });
    else if (req.method === 'DELETE') result = await service.remove({ authorization, ...(req.body || {}) });
    else {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
      return res.status(405).json({ detail: 'Method not allowed' });
    }
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    console.error('[guide-visuals]', error?.message || error);
    return res.status(200).json({ stored: false });
  }
}

export default withAppTokensOnly(handler);
