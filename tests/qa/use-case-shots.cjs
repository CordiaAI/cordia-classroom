// Product screenshots for the use-case pages, from the real UI with the mocked API only (never
// production). The guide shown is the app's built-in sample guide (web/lib/sampleGuide.js), so no
// student data appears. Writes PNGs; tests/qa/to-webp.py turns them into the WebP files in
// web/public/use-cases/.
//   BASE=http://localhost:3100 node tests/qa/use-case-shots.cjs <out-dir>
const path = require('path');
const fs = require('fs');
// The repo's Playwright when installed (npm ci at the root), else the machine's.
const { chromium } = (() => { try { return require(path.join(__dirname, '../../node_modules/playwright')); } catch { return require('playwright'); } })();
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const out = path.resolve(process.argv[2] || 'qa-screenshots/use-cases');
const G = 'a0000000-0000-4000-8000-000000000001';

async function sampleGuide() {
  const { SAMPLE_GUIDE } = await import(path.join(__dirname, '../../web/lib/sampleGuide.js'));
  return SAMPLE_GUIDE;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const sample = await sampleGuide();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  const state = createState(true);
  // One class and one guide: the sample guide, nothing else.
  state.folders = [{ id: 'f0000000-0000-4000-8000-000000000001', name: 'Study Skills' }];
  state.guides = [{ ...state.guides[0], ...sample, id: G, folder_id: state.folders[0].id, flashcard_progress: { known: [] }, read_progress: 0 }];
  state.notes = [];
  await install(context, state);
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user]) => {
    localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r');
    localStorage.setItem('theme', 'light'); localStorage.setItem('cordiaWalkthroughDone', '1');
    // One tip per session (lib/tips.js): mark it used so no tip covers the screen.
    sessionStorage.setItem('cordiaTipShown', '1');
  }, [TOKEN, USER]);

  const shots = [];
  async function shoot(name, route, prepare, clip) {
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 });
    } catch { /* slow page: shoot what loaded */ }
    await page.waitForTimeout(1200);
    if (prepare) await prepare();
    await page.waitForTimeout(600);
    const file = path.join(out, `${name}.png`);
    // Only the content: the sidebar (with the signed-in account) and empty space stay out.
    const { selector = 'main', maxHeight = 0 } = typeof clip === 'string' ? { selector: clip } : (clip || {});
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`${name}: ${selector} not found`);
    await page.screenshot({ path: file, clip: { x: box.x, y: Math.max(0, box.y), width: box.width, height: Math.min(box.height, maxHeight || box.height, 800 - Math.max(0, box.y)) } });
    shots.push(file);
    console.log('captured', name);
  }

  // 1. The New sheet on Upload: where slides and PDFs go in.
  await shoot('new-upload', '/library', async () => {
    const opener = page.getByRole('button', { name: /^New$/ }).first();
    if (await opener.count()) await opener.click();
    await page.waitForTimeout(600);
    const upload = page.getByRole('button', { name: /^Upload$/ }).first();
    if (await upload.count()) await upload.click();
  }, '[role="dialog"]');
  // 2. The finished guide: outline and study tabs.
  await shoot('guide-outline', `/guide/${G}`, null, { selector: 'main', maxHeight: 520 });
  // 3. The guide's questions, page by page.
  await shoot('guide-questions', `/guide/${G}`, async () => {
    const tab = page.getByRole('tab', { name: 'By page' }).first();
    if (await tab.count()) await tab.click();
  }, { selector: 'main', maxHeight: 640 });
  // 4. Flashcards from the guide.
  await shoot('flashcards', `/flashcards/study?guideId=${G}`, null, { selector: 'main', maxHeight: 460 });
  // 5. Learn.
  await shoot('learn', `/learn/${G}`, null, { selector: 'main', maxHeight: 620 });

  fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify(shots, null, 1));
  await browser.close();
})();
