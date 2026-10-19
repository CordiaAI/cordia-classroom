// Notes page: AI titles and Napkin covers (routes mocked in the browser; the server side is
// covered by web/tests/note-meta.test.mjs).   BASE=http://localhost:3100 node tests/qa/notes-meta-check.cjs
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp';
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 240)}`); }
}
const LONG = '<p>The earth is round and spins on its axis once a day.</p><p>It orbits the sun once a year, which gives us seasons because the axis is tilted.</p>';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><circle cx="200" cy="150" r="90" fill="none" stroke="#536149" stroke-width="8"/><text x="200" y="160" text-anchor="middle" font-size="28" fill="#2B2A33">Earth</text></svg>';

async function session(browser, { theme = 'dark', width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const state = createState(true);
  state.notes = [
    { id: 'n1', title: 'Untitled Notes', content: LONG, updated_at: new Date().toISOString() },
    { id: 'n2', title: 'Untitled Notes', content: '<p>What past work experiences do you have?</p>', updated_at: new Date().toISOString() },
  ];
  state.noteMeta = [];
  await install(context, state);
  await context.route(/localhost:3100\/api\/notes\/(covers|meta)$/, async route => {
    const action = route.request().url().split('/').pop();
    if (action === 'covers') return route.fulfill({ json: { covers: [], enabled: true } });
    const body = JSON.parse(route.request().postData() || '{}');
    state.noteMeta.push(body);
    await new Promise(resolve => setTimeout(resolve, 1200));
    const note = state.notes.find(item => item.id === body.note_id);
    if (body.title) note.title = body.note_id === 'n2' ? 'Past Work Experience' : 'Earth Rotation and Orbit';
    return route.fulfill({ json: { ...(body.title ? { title: note.title } : {}), ...(body.cover ? { cover: { url: 'https://db.example.co/storage/v1/object/public/visuals/ab/x/0.svg', alt: 'Diagram: Earth' } } : {}) } });
  });
  await context.route(/db\.example\.co\/storage\//, route => route.fulfill({ body: SVG, headers: { 'content-type': 'image/svg+xml' } }));
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, mode]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', mode); }, [TOKEN, USER, theme]);
  return { context, page, state };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });

  for (const [width, theme] of [[1280, 'dark'], [390, 'light']]) {
    await check(`Notes page ${width}px ${theme}: untitled notes, even one sentence, get an AI title and a Napkin cover`, async () => {
      const { context, page, state } = await session(browser, { width, theme });
      await page.goto(BASE + '/smartnotes');
      await page.locator('.sn-card').first().waitFor();
      const before = await page.locator('.sn-card').first().boundingBox();
      await page.locator('.sn-card-making').first().waitFor({ timeout: 5000 });
      expect(await page.locator('.sn-card-preview').first().isVisible(), 'preview hidden while the cover is made');
      await page.locator('.sn-card-cover').nth(1).waitFor({ timeout: 10000 });
      await page.locator('.sn-card-title:has-text("Earth Rotation and Orbit")').waitFor({ timeout: 5000 });
      const after = await page.locator('.sn-card').first().boundingBox();
      expect(Math.abs(before.height - after.height) < 1 && Math.abs(before.width - after.width) < 1, 'card size changed when the cover arrived');
      await page.locator('.sn-card-title:has-text("Past Work Experience")').waitFor({ timeout: 5000 });
      expect(state.noteMeta.length === 2 && state.noteMeta.every(item => item.title && item.cover), `requests: ${JSON.stringify(state.noteMeta)}`);
      expect(await page.locator('.sn-card-cover').first().getAttribute('alt') === 'Diagram: Earth', 'no alt text');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `notes-covers-${width}-${theme}.png`) });
      await context.close();
    });
  }

  await check('Editor: a new untitled note gets an AI title once it has enough text', async () => {
    const { context, page, state } = await session(browser);
    await page.goto(BASE + '/smartnotes?id=new');
    const paper = page.locator('.sn-paper');
    await paper.waitFor();
    await paper.click();
    await page.keyboard.type('The earth is round and spins on its axis once a day. It orbits the sun once a year, which gives us the seasons because the axis is tilted.');
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'Earth Rotation and Orbit'), null, { timeout: 15000 });
    expect(state.noteMeta.filter(item => item.title && !item.cover).length === 1, `title asked ${state.noteMeta.length} times`);
    await context.close();
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
