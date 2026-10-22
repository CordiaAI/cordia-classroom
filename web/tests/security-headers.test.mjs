import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function policy(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    delete require.cache[require.resolve('../next.config.js')];
    const rules = await require('../next.config.js').headers();
    const rule = rules.find(r => r.headers.some(h => h.key === 'Content-Security-Policy'));
    // Classroom's pages only; the Assistant app behind /assistant loads different resources.
    assert.equal(rule.source, '/((?!assistant(?:/|$)).*)');
    const header = rule.headers.find(h => h.key === 'Content-Security-Policy');
    return Object.fromEntries(header.value.split('; ').map(part => {
      const [name, ...values] = part.split(' ');
      return [name, values];
    }));
  } finally {
    process.env = saved;
  }
}

test('production policy only allows the app, the API, Supabase and the MediaPipe files', async () => {
  const csp = await policy({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'https://api.example.test/v1' });
  // jsDelivr and Google storage serve air drawing's MediaPipe wasm and hand model (components/AirDraw.js).
  assert.deepEqual(csp['connect-src'], ["'self'", 'blob:', 'https://api.example.test',
    'https://xoolkofwihjasrvjpbrs.supabase.co', 'wss://xoolkofwihjasrvjpbrs.supabase.co',
    'https://cdn.jsdelivr.net', 'https://storage.googleapis.com']);
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'blob:', 'https://xoolkofwihjasrvjpbrs.supabase.co']);
  assert.ok(!csp['script-src'].includes("'unsafe-eval'"));
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['report-uri'], ['/api/csp-report']);
});
