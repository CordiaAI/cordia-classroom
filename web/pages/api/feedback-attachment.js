// Screenshots on feedback. POST { image: data URL } -> { path } in the private "feedback-attachments"
// bucket (feedback keeps the path; reviewers get short-lived links). Server env: SUPABASE_SERVICE_ROLE_KEY.
import { createImageStore } from '../../lib/server/cardImages.mjs';
import { withAppTokensOnly } from '../../lib/server/connectedApps.mjs';

export const config = { api: { bodyParser: { sizeLimit: '7mb' } } };

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ detail: 'Method not allowed' });
  }
  try {
    const result = await createImageStore({ kind: 'feedback' }).upload(req.headers.authorization || '', req.body || {});
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[feedback-attachment]', error?.message || error);
    return res.status(500).json({ detail: "The screenshot didn't upload. Try again." });
  }
}

export default withAppTokensOnly(handler);
