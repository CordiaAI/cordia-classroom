// Logs uncaught browser errors so they show up in Vercel runtime logs ("Client error").
// No user content: message, page path, file and line only.
const clip = (value, size) => String(value || '').slice(0, size);

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  console.error('Client error', JSON.stringify({
    message: clip(body?.message, 300),
    page: clip(body?.page, 200).split('?')[0],
    source: clip(body?.source, 200).split('?')[0],
    line: Number(body?.line) || null,
    stack: clip(body?.stack, 1200),
    version: clip(body?.version, 40),
  }));
  return res.status(204).end();
}

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };
