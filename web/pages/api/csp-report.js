// Logs browser Content-Security-Policy violation reports so they show up in Vercel runtime logs.
export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  // Browsers send application/csp-report, which Next leaves as a raw string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const report = body?.['csp-report'] || {};
  console.warn('CSP violation', JSON.stringify({
    directive: report['effective-directive'] || report['violated-directive'],
    blocked: report['blocked-uri'],
    page: (report['document-uri'] || '').split('?')[0],
    source: report['source-file'],
    line: report['line-number'],
  }));
  return res.status(204).end();
}

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };
