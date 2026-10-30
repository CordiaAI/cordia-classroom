// Photos on flashcards. POST { image: data URL } -> { url } in the public "card-images" bucket.
// Server env (never sent to the browser): SUPABASE_SERVICE_ROLE_KEY.
import { createCardImages } from '../../lib/server/cardImages.mjs';
import { withAppTokensOnly } from '../../lib/server/connectedApps.mjs';

// The browser shrinks photos first; this leaves room for a 3 MB image as base64.
export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ detail: 'Method not allowed' });
  }
  try {
    const result = await createCardImages().upload(req.headers.authorization || '', req.body || {});
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[card-image]', error?.message || error);
    return res.status(500).json({ detail: "The photo didn't upload. Try again." });
  }
}

export default withAppTokensOnly(handler);
