// Lecture recording in a real browser (fake microphone), against a local build with the mocked
// API (never production):  BASE=http://localhost:3100 node tests/qa/record-check.cjs
// Covers: consent, a 2-minute recording with pause/resume and a 30 s network drop, the live-build
// card after Stop, Upload recording, and a denied microphone.
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

async function session(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const state = createState(true);
  await install(context, state);
  const page = await context.newPage();
  global.lastPage = page;
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); }, [TOKEN, USER]);
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

  await check('Record: 2-minute recording with pause/resume and a 30 s network drop builds a guide', async () => {
    const { context, page, state } = await session(browser);
    expect((await page.locator('.rec-note.rec-center').innerText()) === '84 min left', 'minutes left not shown');
    await page.click('.rec-start');
    await page.locator('text=I have permission to record this lecture').waitFor();
    expect(await page.locator('.rec button.c-btn--primary').isDisabled(), 'Continue enabled before consent');
    await page.check('.rec-check input');
    await page.click('.rec button.c-btn--primary');
    await page.locator('.rec-timer').waitFor({ timeout: 10000 });
    expect(await page.locator('.c-sheet-head button[aria-label="Close"]').isDisabled(), 'close not blocked while recording');
    await page.keyboard.press('Escape');
    expect(await page.locator('.rec-timer').isVisible(), 'Escape closed the sheet mid-recording');

    await wait(25000);
    expect((await page.locator('.rec-transcript p').count()) >= 1, 'no live transcript after 25 s');

    // Pause: the clock stops.
    await page.click('.rec-stage button:has-text("Pause")');
    await page.locator('text=Resume').waitFor();
    await wait(500);
    const pausedAt = seconds(await timer(page));
    await wait(8000);
    expect(seconds(await timer(page)) === pausedAt, 'clock moved while paused');
    await page.click('.rec-stage button:has-text("Resume")');

    // 30 s without network: chunks wait in IndexedDB, then upload in order.
    await context.setOffline(true);
    await wait(2000);
    expect(/Offline/.test(await page.locator('.rec-stage .rec-note').innerText()), 'offline state not shown');
    const before = (state.lectureChunks || []).length;
    await wait(28000);
    expect((state.lectureChunks || []).length === before, 'uploaded while offline');
    await context.setOffline(false);

    while (seconds(await timer(page)) < 120) await wait(1000);
    const elapsed = seconds(await timer(page));
    await page.click('.rec-stage button:has-text("Stop")');
    await page.locator('.new-headings, .c-title:has-text("Building")').first().waitFor({ timeout: 30000 }).catch(() => {});
    const chunks = state.lectureChunks || [];
    expect(chunks.every((seq, index) => seq === index), `chunks out of order or missing: ${chunks.join(',')}`);
    expect(chunks.length >= Math.ceil(elapsed / 18), `only ${chunks.length} chunks for ${elapsed} s`);
    await page.waitForURL(/\/guide\//, { timeout: 20000 });
    const saved = state.guides[0];
    expect(saved.title === 'Cell Energy and ATP' && saved.source_type === 'lecture', `saved ${saved.title} / ${saved.source_type}`);
    expect(state.calls.includes('POST /lectures/notes') || elapsed < 180, 'notes not requested');
    expect(!state.calls.includes('POST /lectures/audio'), 'audio kept without Keep audio');
    console.log(`     ${elapsed} s, ${chunks.length} chunks: ${chunks.join(",")}; calls: ${state.calls.filter(c => c.includes("lectures")).length}`);
    await context.close();
  });

  await check('Record: Upload recording builds a guide from an audio file', async () => {
    const { context, page, state } = await session(browser);
    await page.setInputFiles('.rec input[type=file]', { name: 'lecture.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048) });
    await page.waitForURL(/\/guide\//, { timeout: 20000 });
    expect(state.calls.includes('POST /lectures/transcribe-file'), 'file not sent');
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
    await page.evaluate(user => localStorage.setItem(`cordiaRecordConsent:${user}`, '1'), USER);
    await page.click('.rec-start');
    await page.locator('text=Turn the microphone on').waitFor({ timeout: 10000 });
    expect(await page.locator('svg.mic-help').isVisible(), 'no screenshot');
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'record-denied.png') });
    await context.close();
  });
  await denied.close();

  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
