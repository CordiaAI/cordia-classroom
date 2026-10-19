// Lecture recording in a real browser (fake microphone), against a local build. /api/lectures/*
// is mocked in the browser (the server route is covered by web/tests/lecture-text.test.mjs):
//   BASE=http://localhost:3100 node tests/qa/record-check.cjs
// Covers: consent, a 2-minute recording with pause/resume and a 30 s network drop, the live
// transcript, Stop finishing fast, Stop never hanging when transcription fails, a clear message
// when transcription isn't set up, Upload recording (small and a large file split into parts),
// and a denied microphone.
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); if (global.lastPage) await global.lastPage.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'record-fail.png') }).catch(() => {}); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 240)}`); }
}

// mode: 'ok' | 'unconfigured' (503) | 'failing' (500)
async function session(browser, { mode = 'ok' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const state = createState(true);
  state.chunks = [];
  state.chunkSizes = [];
  await install(context, state);
  await context.route(/localhost:3100\/api\/lectures\/(usage|chunk|notes|title)/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.pathname.split('/').pop();
    if (action === 'usage') return route.fulfill({ json: { minutes_left: 84, minutes_limit: 120, metered: true, ready: mode !== 'unconfigured' } });
    if (action === 'chunk') {
      if (mode === 'unconfigured') return route.fulfill({ status: 503, json: { detail: "Transcription isn't set up yet.", code: 'not_configured' } });
      if (mode === 'failing') return route.fulfill({ status: 500, json: { detail: 'boom' } });
      const seq = Number(url.searchParams.get('seq'));
      state.chunks.push(seq);
      state.chunkSizes.push((req.postDataBuffer() || Buffer.alloc(0)).length);
      expect(req.headers()['x-prompt'] !== undefined, 'no prompt header');
      return route.fulfill({ json: { seq, start_ms: Number(url.searchParams.get('start_ms')), text: `Part ${seq + 1} covers cell energy and how ATP is made in the mitochondria.` } });
    }
    if (action === 'notes') return route.fulfill({ json: { notes: [{ kind: 'exam', text: 'ATP is made in mitochondria', at_ms: 0 }], class_id: state.folders[0]?.id || '' } });
    return route.fulfill({ json: { title: 'Cell Energy and ATP' } });
  });
  const page = await context.newPage();
  global.lastPage = page;
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem(`cordiaRecordConsent:${user}`, '1'); }, [TOKEN, USER]);
  await page.goto(BASE + '/dashboard');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:new', { detail: { mode: 'record' } })));
  await page.locator('.rec-start').waitFor();
  return { context, page, state };
}

const timer = page => page.locator('.rec-timer').innerText();
const seconds = text => text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);

(async () => {
  const flags = ['--headless=new', '--use-fake-device-for-media-stream'];
  const browser = await chromium.launch({ executablePath: CHROME, args: [...flags, '--use-fake-ui-for-media-stream'] });

  await check('Consent sheet on first use', async () => {
    const { context, page } = await session(browser);
    await page.evaluate(user => localStorage.removeItem(`cordiaRecordConsent:${user}`), USER);
    await page.click('.rec-start');
    await page.locator('text=I have permission to record this lecture').waitFor();
    expect(await page.locator('.rec button.c-btn--primary').isDisabled(), 'Continue enabled before consent');
    await page.check('.rec-check input');
    await page.click('.rec button.c-btn--primary');
    await page.locator('.rec-timer').waitFor({ timeout: 10000 });
    await context.close();
  });

  await check('Record: live transcript within ~12 s; 2 min with pause/resume and a 30 s drop; Stop builds the guide fast', async () => {
    const { context, page, state } = await session(browser);
    expect((await page.locator('.rec-note.rec-center').innerText()) === '84 min left', 'minutes left not shown');
    await page.click('.rec-start');
    await page.locator('.rec-timer').waitFor({ timeout: 10000 });
    const started = Date.now();
    await page.locator('.rec-transcript p:has-text("Part 1")').waitFor({ timeout: 15000 });
    console.log(`     first transcript after ${((Date.now() - started) / 1000).toFixed(1)} s`);
    await page.keyboard.press('Escape');
    expect(await page.locator('.rec-timer').isVisible(), 'Escape closed the sheet mid-recording');
    await wait(12000);
    await page.click('.rec-stage button:has-text("Pause")');
    await page.locator('.rec-stage button:has-text("Resume")').waitFor();
    await wait(500);
    const pausedAt = seconds(await timer(page));
    await wait(6000);
    expect(seconds(await timer(page)) === pausedAt, 'clock moved while paused');
    await page.click('.rec-stage button:has-text("Resume")');
    await context.setOffline(true);
    await wait(2000);
    expect(/Offline/.test(await page.locator('.rec-stage').innerText()), 'offline state not shown');
    const before = state.chunks.length;
    await wait(28000);
    expect(state.chunks.length === before, 'uploaded while offline');
    await context.setOffline(false);
    while (seconds(await timer(page)) < 120) await wait(1000);
    const elapsed = seconds(await timer(page));
    const stopAt = Date.now();
    await page.click('.rec-stage button:has-text("Stop")');
    await page.waitForURL(/\/guide\//, { timeout: 30000 });
    const stopSeconds = (Date.now() - stopAt) / 1000;
    console.log(`     ${elapsed} s recorded, ${state.chunks.length} chunks, guide ${stopSeconds.toFixed(1)} s after Stop`);
    const sorted = [...state.chunks].sort((a, b) => a - b);
    expect(sorted.every((seq, index) => seq === index), `chunks missing: ${sorted.join(',')}`);
    expect(sorted.length >= Math.ceil((elapsed - 8) / 18) + 1, `only ${sorted.length} chunks for ${elapsed} s`);
    expect(stopSeconds < 15, `Stop took ${stopSeconds} s`);
    const saved = state.guides[0];
    expect(saved.title === 'Cell Energy and ATP' && saved.source_type === 'lecture', `saved ${saved.title} / ${saved.source_type}`);
    await context.close();
  });

  await check('Transcription not set up: clear message while recording, Stop answers at once (no endless loading)', async () => {
    const { context, page } = await session(browser, { mode: 'unconfigured' });
    expect(/isn't set up/.test(await page.locator('.rec').innerText()), 'no warning on the start screen');
    await page.click('.rec-start');
    await page.locator('.rec-stage .rec-error:has-text("isn\'t set up")').waitFor({ timeout: 20000 });
    const stopAt = Date.now();
    await page.click('.rec-stage button:has-text("Stop")');
    await page.locator('.rec-finishing .rec-error').waitFor({ timeout: 10000 });
    expect(Date.now() - stopAt < 8000, 'Stop waited too long');
    expect(await page.locator('button:has-text("Try again")').isVisible(), 'no Try again');
    await context.close();
  });

  await check('Transcription failing: Stop never hangs; offers Try again after the time limit', async () => {
    const { context, page } = await session(browser, { mode: 'failing' });
    await page.click('.rec-start');
    await page.locator('.rec-timer').waitFor({ timeout: 10000 });
    await wait(10000);
    const stopAt = Date.now();
    await page.click('.rec-stage button:has-text("Stop")');
    await page.locator('button:has-text("Try again")').waitFor({ timeout: 40000 });
    console.log(`     gave up waiting after ${((Date.now() - stopAt) / 1000).toFixed(1)} s`);
    await context.close();
  });

  await check('Upload recording: a small file builds a guide', async () => {
    const { context, page, state } = await session(browser);
    await page.setInputFiles('.rec input[type=file]', { name: 'lecture.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(200000, 1) });
    await page.waitForURL(/\/guide\//, { timeout: 20000 });
    expect(state.chunks.length === 1, `sent ${state.chunks.length} parts`);
    await context.close();
  });

  await check('Upload recording: a long mp3 is split into parts sent in parallel', async () => {
    const { context, page, state } = await session(browser);
    await page.setInputFiles('.rec input[type=file]', { name: 'long-lecture.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(12_000_000, 7) });
    await page.waitForURL(/\/guide\//, { timeout: 60000 });
    expect(state.chunks.length === 4, `sent ${state.chunks.length} parts`);
    expect(state.chunkSizes.every(size => size <= 4_300_000), `part too big: ${Math.max(...state.chunkSizes)}`);
    await context.close();
  });

  await check('Upload tab: an audio file points to Record', async () => {
    const { context, page } = await session(browser);
    await page.click('button[aria-label="Back"]');
    await page.click('.new-option:has-text("Upload")');
    await page.setInputFiles('.new-panel input[type=file]', { name: 'talk.m4a', mimeType: 'audio/mp4', buffer: Buffer.alloc(64) });
    expect(/use Record, then Upload recording/.test(await page.locator('.new-error').innerText()), 'no audio hint');
    await context.close();
  });
  await browser.close();

  const denied = await chromium.launch({ executablePath: CHROME, args: [...flags, '--deny-permission-prompts'] });
  await check('Record: denied microphone shows the help screen', async () => {
    const { context, page } = await session(denied);
    await page.click('.rec-start');
    await page.locator('text=Turn the microphone on').waitFor({ timeout: 10000 });
    expect(await page.locator('svg.mic-help').isVisible(), 'no screenshot');
    await context.close();
  });
  await denied.close();

  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
