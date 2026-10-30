// Runs a web-standard handler (Request in, Response out) as a pages/api route, so the MCP SDK's
// fetch-style handler can live in the pages router. Streams the response, which SSE needs.
const MAX_BODY = 4 * 1024 * 1024;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function toWebRequest(req, body) {
  const first = value => String(value || '').split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) || (req.socket?.encrypted ? 'https' : 'http');
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host) || 'localhost';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return new Request(new URL(req.url, `${proto}://${host}`), { method: req.method, headers, body: body?.length ? body : undefined });
}

export function webHandler(handle) {
  return async function route(req, res) {
    let response;
    try {
      const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : await readBody(req);
      response = await handle(toWebRequest(req, body));
    } catch (error) {
      res.statusCode = error.status || 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: error.status === 413 ? 'Request body too large' : 'Server error' }));
      return;
    }
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) { res.end(); return; }
    const reader = response.body.getReader();
    req.on('close', () => { reader.cancel().catch(() => {}); });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  };
}
