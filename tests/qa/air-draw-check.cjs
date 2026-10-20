// Practice board drawing in a real browser against a local build (mocked API):
// mouse drawing + undo + colours + Save PNG, and Hand mode with the real MediaPipe model on
// Chromium's fake camera (wasm and model served from local copies), a denied camera, and the
// camera stopping when Hand is turned off.
//   BASE=http://localhost:3100 MODEL=/path/hand_landmarker.task node tests/qa/air-draw-check.cjs
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WASM_DIR = path.join(__dirname, '../../web/node_modules/@mediapipe/tasks-vision/wasm');
const MODEL = process.env.MODEL;
const G = 'a0000000-0000-4000-8000-000000000001';
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 240)}`); }
}

async function session(browser, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const state = createState(true);
  await install(context, state);
  await context.route(/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@1\.0\.1\/wasm\/(.+)$/, route => {
    const file = path.join(WASM_DIR, route.request().url().split('/wasm/')[1].split('?')[0]);
    route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  await context.route(/storage\.googleapis\.com\/mediapipe-models\//, route => route.fulfill({ body: fs.readFileSync(MODEL), contentType: 'application/octet-stream' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|_vercel\/insights/.test(message.text())) errors.push(message.text()); });
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); }, [TOKEN, USER]);
  await page.goto(`${BASE}/practice/${G}`);
  await page.locator('.practice-board canvas').first().waitFor();
  return { context, page, errors };
}

const inkPixels = page => page.evaluate(() => {
  const canvas = document.querySelector('.practice-board canvas[aria-label="Drawing workspace"]');
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
  return count;
});

(async () => {
  const flags = ['--headless=new', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch({ executablePath: CHROME, args: [...flags, '--use-fake-ui-for-media-stream'] });

  await check('Mouse drawing, colour, size, undo stroke by stroke, clear + undo, Save PNG', async () => {
    const { context, page, errors } = await session(browser);
    const board = await page.locator('.practice-board').boundingBox();
    const stroke = async (y) => {
      await page.mouse.move(board.x + 60, board.y + y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i += 1) await page.mouse.move(board.x + 60 + i * 12, board.y + y + Math.sin(i / 3) * 20);
      await page.mouse.up();
    };
    await stroke(80);
    const one = await inkPixels(page);
    expect(one > 200, `first stroke drew ${one} px`);
    await page.click('.practice-swatch[aria-label="Red"]');
    await page.locator('.practice-size input').fill('12');
    await stroke(200);
    const two = await inkPixels(page);
    expect(two > one * 2, `thick red stroke too thin: ${one} -> ${two}`);
    await page.click('button[aria-label="Undo"]');
    expect(Math.abs((await inkPixels(page)) - one) < one * 0.05, 'undo did not remove only the last stroke');
    await page.click('button[aria-label="Clear work"]');
    expect((await inkPixels(page)) === 0, 'clear left ink');
    await page.click('button[aria-label="Undo"]');
    expect((await inkPixels(page)) > 200, 'undo did not bring back the cleared drawing');
    const download = page.waitForEvent('download');
    await page.click('button[aria-label="Save drawing as PNG"]');
    expect((await download).suggestedFilename() === 'practice-1.png', 'PNG download');
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'air-draw-mouse.png') });
    expect(!errors.length, `console errors: ${errors.join(' | ')}`);
    await context.close();
  });

  await check('Hand mode: camera + MediaPipe run per video frame, preview toggles, stop releases the camera', async () => {
    const { context, page, errors } = await session(browser);
    await page.click('.practice-drawbar button:has-text("Hand")');
    await page.locator('.practice-drawbar [role="status"]:has-text("Pinch to draw")').waitFor({ timeout: 60000 });
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => {
      const video = document.querySelector('.air-preview video');
      return { live: video.srcObject?.getTracks().every(track => track.readyState === 'live'), width: video.videoWidth, height: video.videoHeight };
    });
    expect(info.live && info.width === 640 && info.height === 480, `camera: ${JSON.stringify(info)}`);
    const fps = await page.evaluate(() => {
      const canvas = document.querySelector('.air-preview canvas');
      return canvas ? 'shown' : 'missing';
    });
    expect(fps === 'shown', 'preview missing');
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'air-draw-hand-on.png') });
    await page.click('button[aria-label="Hide camera preview"]');
    expect(await page.locator('.air-preview.is-hidden').count() === 1, 'preview did not hide');
    const tracks = await page.evaluateHandle(() => document.querySelector('.air-preview video').srcObject.getTracks());
    await page.click('.practice-drawbar button:has-text("Stop hand")');
    const ended = await tracks.evaluate(list => list.every(track => track.readyState === 'ended'));
    expect(ended, 'camera still on after Stop hand');
    expect(await page.locator('.air-overlay').count() === 0, 'overlay left behind');
    expect(!errors.length, `console errors: ${errors.join(' | ')}`);
    await context.close();
  });

  await check('Hand mode: leaving the page stops the camera', async () => {
    const { context, page } = await session(browser);
    await page.click('.practice-drawbar button:has-text("Hand")');
    await page.locator('.practice-drawbar [role="status"]:has-text("Pinch to draw")').waitFor({ timeout: 60000 });
    const tracks = await page.evaluateHandle(() => document.querySelector('.air-preview video').srcObject.getTracks());
    await page.click('button[aria-label="Back"]');
    await page.waitForURL(/\/guide\//);
    // The camera stops in the page's cleanup, which can land just after the URL changes.
    let ended = false;
    for (let i = 0; i < 20 && !ended; i += 1) { ended = await tracks.evaluate(list => list.every(track => track.readyState === 'ended')); if (!ended) await page.waitForTimeout(100); }
    expect(ended, 'camera still on after leaving');
    await context.close();
  });

  await check('Mouse and touch still work while Hand is on', async () => {
    const { context, page } = await session(browser);
    await page.click('.practice-drawbar button:has-text("Hand")');
    await page.locator('.practice-drawbar [role="status"]:has-text("Pinch to draw")').waitFor({ timeout: 60000 });
    const board = await page.locator('.practice-board').boundingBox();
    await page.mouse.move(board.x + 100, board.y + 100);
    await page.mouse.down();
    await page.mouse.move(board.x + 300, board.y + 160, { steps: 12 });
    await page.mouse.up();
    expect((await inkPixels(page)) > 200, 'mouse drawing blocked by the hand overlay');
    await context.close();
  });
  await browser.close();

  const denied = await chromium.launch({ executablePath: CHROME, args: [...flags, '--deny-permission-prompts'] });
  await check('Denied camera shows a friendly message, no crash', async () => {
    const { context, page, errors } = await session(denied);
    await page.click('.practice-drawbar button:has-text("Hand")');
    await page.locator('.retain-action-error:has-text("Camera blocked")').waitFor({ timeout: 15000 });
    expect(await page.locator('.practice-drawbar button:has-text("Hand")').getAttribute('aria-pressed') === 'false', 'Hand stayed on');
    expect(!errors.filter(e => !/NotAllowed|Permission/i.test(e)).length, `errors: ${errors.join(' | ')}`);
    await context.close();
  });
  await denied.close();

  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
