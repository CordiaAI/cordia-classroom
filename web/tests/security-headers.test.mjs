import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function policy(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    delete require.cache[require.resolve('../next.config.js')];
    const [{ headers }] = await require('../next.config.js').headers();
    const header = headers.find(h => h.key === 'Content-Security-Policy-Report-Only');
    return Object.fromEntries(header.value.split('; ').map(part => {
      const [name, ...values] = part.split(' ');
      return [name, values];
    }));
  } finally {
    process.env = saved;
  }
}

test('production policy only allows the app, the API and Supabase', async () => {
  const csp = await policy({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'https://api.example.test/v1' });
  assert.deepEqual(csp['connect-src'], ["'self'", 'blob:', 'https://api.example.test',
    'https://xoolkofwihjasrvjpbrs.supabase.co', 'wss://xoolkofwihjasrvjpbrs.supabase.co']);
  assert.ok(!csp['script-src'].includes("'unsafe-eval'"));
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['report-uri'], ['/api/csp-report']);
});
