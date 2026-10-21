// Napkin visuals service (/api/visual) with a fake network and clock: three guide sections,
// one Notes highlight, a forced timeout, a rate-limit response, the monthly limit and the cache.
import assert from 'node:assert/strict';
import { BUDGET_MS, TOTAL_MS, DEFAULT_STYLE_ID, altText, cleanSvg, createVisualService, resetRateState } from '../lib/server/napkinVisual.mjs';

const ENV = { NAPKIN_API_KEY: 'nk_test', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'service', NEXT_PUBLIC_API_URL: 'https://api.example.com' };
const USER = '11111111-2222-4333-8444-555555555555';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: USER })}.sig`;

function world({ plan = 'free', used = 0, statusAfter = 2, createResponses = [], pendingForever = false } = {}) {
  const state = { clock: 0, used, calls: [], creates: [], stored: [], cache: new Map(), records: [], polls: 0 };
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    state.calls.push(`${method} ${url}`);
    if (url === 'https://api.example.com/billing/status') return init.headers?.Authorization === AUTH ? json({ plan: plan === 'pro' ? 'classroom_plus' : 'free' }) : json({ detail: 'no' }, 401);
    if (url.endsWith('/rest/v1/rpc/feature_usage_counts')) return json([{ feature: 'visual', used: state.used }]);
    if (url.endsWith('/rest/v1/rpc/record_feature_usage')) { state.used += 1; state.records.push(JSON.parse(init.body)); return json(true); }
    if (url.includes('/rest/v1/visual_cache?key=eq.')) { const key = url.split('eq.')[1].split('&')[0]; return json(state.cache.has(key) ? [state.cache.get(key)] : []); }
    if (url.endsWith('/rest/v1/visual_cache')) { const row = JSON.parse(init.body); state.cache.set(row.key, row); return json(null, 201); }
    if (url.includes('/storage/v1/object/visuals/')) { state.stored.push({ url, body: init.body }); return json({ Key: 'ok' }); }
    if (url === 'https://api.napkin.ai/v1/visual' && method === 'POST') {
      assert.equal(init.headers.Authorization, 'Bearer nk_test');
      state.creates.push(JSON.parse(init.body));
      const next = createResponses.shift();
      if (next) return next();
      return json({ id: `req${state.creates.length}`, status: 'pending' }, 201, { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '7', 'x-ratelimit-reset': '9999999999', 'x-ratelimit-window': 'minute' });
    }
    if (/\/v1\/visual\/[^/]+\/status$/.test(url)) {
      state.polls += 1;
      if (pendingForever || state.polls < statusAfter) return json({ status: 'pending' });
      const id = url.split('/').at(-2);
      return json({ id, status: 'completed', generated_files: [1, 2].map(n => ({ url: `https://files.napkin.ai/${id}/${n}.svg`, visual_id: `v${n}`, width: 800, height: 500 })) });
    }
    if (url.startsWith('https://files.napkin.ai/')) {
      assert.equal(init.headers?.Authorization, 'Bearer nk_test', 'downloads carry the auth header');
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const service = createVisualService({ env: ENV, fetch, sleep: async ms => { state.clock += ms; }, now: () => state.clock });
  return { state, service };
}

resetRateState();

// Three guide sections (art history, business law, nursing): each gets 2 stored SVG variations.
{
  const { state, service } = world();
  const sections = [
    ['What is chiaroscuro?\nThe use of strong contrast between light and dark to model form.', 'Baroque painting'],
    ['What is consideration in contract law?\nSomething of value each party gives in exchange.', 'Formation of contracts'],
    ['What are the signs of hypokalemia?\nMuscle weakness, cramps and flattened T waves.', 'Electrolyte imbalances'],
  ];
  for (const [text, context] of sections) {
    const { httpStatus, body } = await service.generate({ authorization: AUTH, text, context, theme: 'light' });
    assert.equal(httpStatus, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.visuals.length, 2);
    assert.ok(body.visuals.every(visual => visual.url.startsWith('https://db.example.co/storage/v1/object/public/visuals/')), 'never hotlinks Napkin');
    assert.match(body.alt, /^Diagram: /);
  }
  assert.equal(state.creates.length, 3);
  assert.equal(state.stored.length, 6);
  assert.ok(state.stored.every(file => file.body.includes('<rect')), 'the downloaded SVG is stored');
  assert.equal(state.records.length, 3);
  assert.equal(state.used, 3);
  const first = state.creates[0];
  assert.deepEqual(
    { format: first.format, language: first.language, style_id: first.style_id, number_of_visuals: first.number_of_visuals, sort_strategy: first.sort_strategy, transparent_background: first.transparent_background, color_mode: first.color_mode },
    { format: 'svg', language: 'en-US', style_id: DEFAULT_STYLE_ID, number_of_visuals: 3, sort_strategy: 'variation', transparent_background: true, color_mode: 'light' },
  );
  // Same section again: served from the cache, Napkin not called, nothing charged.
  const again = await service.generate({ authorization: AUTH, text: sections[0][0], context: sections[0][1], theme: 'light' });
  assert.equal(again.body.cached, true);
  assert.equal(state.creates.length, 3);
  assert.equal(state.used, 3);
  assert.equal(again.body.left, 7);
  console.log('ok   three guide sections');
}

// One Notes highlight, on a dark page: the surrounding note is context, the visual is made dark.
{
  const { state, service } = world();
  const { body } = await service.generate({ authorization: AUTH, text: 'Supply rises when price rises', context: 'Week 3 notes on markets.', theme: 'dark' });
  assert.equal(body.status, 'ok');
  assert.equal(body.theme, 'dark');
  assert.equal(state.creates[0].context, 'Week 3 notes on markets.');
  assert.equal(state.creates[0].color_mode, 'dark');
  console.log('ok   notes highlight');
}

// A slow drawing: past 20 s the route answers "pending" with a signed ticket, and the next
// call with that ticket keeps waiting on the same Napkin request (no second request, one charge).
{
  const { state, service } = world({ statusAfter: 30 });
  const first = await service.generate({ authorization: AUTH, text: 'The water cycle has four stages', theme: 'light' });
  assert.equal(first.body.status, 'pending');
  assert.ok(state.clock <= BUDGET_MS, `answered within ${BUDGET_MS} ms`);
  const done = await service.generate({ authorization: AUTH, text: 'The water cycle has four stages', theme: 'light', resume: first.body.resume });
  assert.equal(done.body.status, 'ok');
  assert.equal(state.creates.length, 1, 'the same Napkin request is resumed');
  assert.equal(state.used, 1);
  // A ticket for other content, or a forged one, is refused.
  const other = await service.generate({ authorization: AUTH, text: 'Something else entirely', theme: 'light', resume: first.body.resume });
  assert.equal(other.httpStatus, 400);
  console.log('ok   slow drawing resumes');
}

// Forced timeout: Napkin never finishes, so after 3 minutes in all the route gives up and charges nothing.
{
  const { state, service } = world({ pendingForever: true });
  let body = (await service.generate({ authorization: AUTH, text: 'The French Revolution began in 1789', theme: 'light' })).body;
  let calls = 1;
  while (body.status === 'pending' && calls < 20) {
    body = (await service.generate({ authorization: AUTH, text: 'The French Revolution began in 1789', theme: 'light', resume: body.resume })).body;
    calls += 1;
  }
  assert.deepEqual(body, { status: 'fallback', reason: 'timeout' });
  assert.ok(state.clock >= TOTAL_MS && state.clock <= TOTAL_MS + BUDGET_MS, `gave up at ${state.clock} ms`);
  assert.equal(state.creates.length, 1);
  assert.equal(state.used, 0);
  assert.equal(state.stored.length, 0);
  console.log('ok   forced timeout');
}

// Rate limit: wait for Retry-After and try once more; a second 429 falls back and later
// requests do not call Napkin until the window resets.
{
  const limited = () => new Response(JSON.stringify({ error: 'rate_limit_exceeded' }), { status: 429, headers: { 'retry-after': '3', 'x-ratelimit-remaining': '0' } });
  const once = world({ createResponses: [limited] });
  const ok = await once.service.generate({ authorization: AUTH, text: 'Photosynthesis makes glucose', theme: 'light' });
  assert.equal(ok.body.status, 'ok');
  assert.equal(once.state.creates.length, 2);
  assert.ok(once.state.clock >= 3000, 'waited for Retry-After');
  resetRateState();

  const twice = world({ createResponses: [limited, limited] });
  const failed = await twice.service.generate({ authorization: AUTH, text: 'Mitosis has four phases', theme: 'light' });
  assert.deepEqual(failed.body, { status: 'fallback', reason: 'rate_limited' });
  assert.equal(twice.state.creates.length, 2);
  assert.equal(twice.state.used, 0);
  resetRateState();

  // X-RateLimit-Remaining 0 with a reset far away: the next request skips Napkin entirely.
  const spent = () => new Response(JSON.stringify({ id: 'req1', status: 'pending' }), { status: 201, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' } });
  const window = world({ createResponses: [spent] });
  assert.equal((await window.service.generate({ authorization: AUTH, text: 'Gothic arches are pointed', theme: 'light' })).body.status, 'ok');
  const skipped = await window.service.generate({ authorization: AUTH, text: 'Romanesque arches are round', theme: 'light' });
  assert.deepEqual(skipped.body, { status: 'fallback', reason: 'rate_limited' });
  assert.equal(window.state.creates.length, 1);
  resetRateState();
  console.log('ok   rate limit');
}

// Monthly limit: Free 10, Pro 200; refused before any Napkin call.
{
  const free = world({ used: 10 });
  const refused = await free.service.generate({ authorization: AUTH, text: 'Iambic pentameter has ten syllables', theme: 'light' });
  assert.equal(refused.httpStatus, 402);
  assert.equal(refused.body.detail.plan, 'free');
  assert.equal(free.state.creates.length, 0);
  const pro = world({ plan: 'pro', used: 200 });
  const proRefused = await pro.service.generate({ authorization: AUTH, text: 'Big-O describes growth', theme: 'light' });
  assert.equal(proRefused.httpStatus, 402);
  assert.equal(proRefused.body.detail.message, 'Limit reached');
  const usage = await world({ used: 4 }).service.usageFor(AUTH);
  assert.equal(usage.body.left, 6);
  console.log('ok   limits');
}

// Not signed in, and not configured.
{
  const { service } = world();
  assert.equal((await service.generate({ authorization: 'Bearer nope', text: 'x y z' })).httpStatus, 401);
  const bare = createVisualService({ env: { NEXT_PUBLIC_API_URL: 'https://api.example.com' }, fetch: async () => new Response(JSON.stringify({ plan: 'free' })) });
  assert.deepEqual((await bare.generate({ authorization: AUTH, text: 'Some text here' })).body, { status: 'fallback', reason: 'not_configured', missing: ['NAPKIN_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] });
  console.log('ok   auth and configuration');
}

// A diagram with anything that could run is not used at all.
for (const risky of ['<svg><script>x</script></svg>', '<svg><g onload="y()"/></svg>', '<svg><a href="javascript:z()">a</a></svg>', '<svg><foreignObject><p/></foreignObject></svg>', '<svg>< script>x</svg>']) {
  assert.equal(cleanSvg(risky), '', risky);
}
assert.equal(cleanSvg('<svg viewBox="0 0 10 10"><g opacity="0.5"><text>Mitochondria</text></g></svg>'), '<svg viewBox="0 0 10 10"><g opacity="0.5"><text>Mitochondria</text></g></svg>');
assert.equal(altText('## What is osmosis?\nWater moves'), 'Diagram: What is osmosis?');
console.log('napkin visual service ok');
