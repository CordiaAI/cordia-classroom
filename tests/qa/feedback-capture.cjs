// Before/after screenshots for the Nov 5 beta feedback fixes, on the mocked API (never production).
//   BASE=http://localhost:3100 node tests/qa/feedback-capture.cjs <out-dir>
// One PNG per item, state, width (390 phone, 1440 desktop) and theme (light, dark).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const out = path.resolve(process.argv[2] || 'qa-screenshots/feedback');
const G = 'a0000000-0000-4000-8000-000000000001';
const LECTURE = 'a0000000-0000-4000-8000-000000000009';
const WIDTHS = [390, 1440];
// What /api/guide-notes writes for the lecture's notes (the model call itself is not run here).
const OUTLINE = '> How cells turn food into ATP.\n\n## Where it happens\n- Glycolysis runs in the cytoplasm\n- The Krebs cycle and the electron transport chain run in the mitochondria\n\n## How the stages connect\n- The Krebs cycle feeds the electron transport chain\n  - It hands over NADH and FADH2\n\n## Key points\n- ATP is made in the mitochondria\n- Glycolysis happens in the cytoplasm';
const THEMES = ['light', 'dark'];

const mc = (question, answer, wrong) => ({ question, options: [answer, ...wrong], correct_index: 0 });
const SHORT = [
  mc('What type of organization was Alpha Gamma?', 'A local fraternity', ['A national sorority', 'A campus newspaper', 'A debate society']),
  mc('Which composer wrote the Erlking?', 'Schubert', ['Brahms', 'Chopin', 'Liszt']),
  mc('What does a celesta sound like?', 'Bells', ['Drums', 'Strings', 'Reeds']),
];
const LONG = [
  mc('At what school is the Oregon Alpha Sigma chapter, and when was it founded?', 'Oregon State University, founded in 1915 as the chapter that later merged with Gamma Phi.', ['University of Oregon, founded in 1921 as a local club that joined later.', 'Portland State University, founded in 1948 after the war ended.', 'Willamette University, founded in 1903 by a group of rowers.']),
  mc('How does the Erlking portray its characters and the galloping horse in one song?', 'One singer portrays four characters, and repeated piano triplets depict the galloping horse throughout.', ['Four singers share the characters while the orchestra plays a slow march under them.', 'One singer narrates while a chorus answers, and strings imitate the wind outside.', 'Two singers trade verses and the piano stays silent until the very last line.']),
];

async function session(page, questions) {
  await page.route(/\/quiz\/[^/]+\/session$/, route => route.fulfill({ json: { questions, cards: questions.map((_, i) => ({ type: 'mc', concepts: [i] })), types: ['mc'] } }));
}

const SCENES = [
  { item: '01', name: 'learn-typed', url: `/learn/${G}`, types: ['type'], questions: SHORT, run: start },
  { item: '02', name: 'learn-wrap', url: `/learn/${G}`, types: ['type'], questions: LONG, run: start },
  { item: '09', name: 'learn-pressed', url: `/learn/${G}`, types: ['mc'], questions: SHORT, run: async page => { await start(page); const option = page.locator('.quiz-option').first(); const box = await option.boundingBox(); await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(120); }, after: page => page.mouse.up() },
  { item: '11', name: 'library-toggle', url: '/library', clip: '.c-viewtoggle, .c-seg--icons' },
  { item: '13', name: 'library-cards', url: '/library', cards: true },
  { item: '14', name: 'library-tabs', url: '/library', clip: '[role=tablist], .c-seg' },
  { item: '15', name: 'guide-notes', url: `/guide/${LECTURE}`, setup: page => page.route('**/api/guide-notes', route => route.fulfill({ json: { notes: OUTLINE } })) },
  { item: '16', name: 'guide-highlight', url: `/guide/${G}`, run: async page => {
    await page.waitForSelector('.study-doc p, .study-doc li, .guide-notes p, .guide-notes li', { timeout: 15000 });
    await page.evaluate(() => {
      const node = document.querySelector('.study-doc li, .study-doc p, .guide-notes li, .guide-notes p');
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(400);
  } },
];

async function start(page) {
  await page.getByRole('button', { name: /Start learning|Next round/ }).click();
  await page.locator('.learn-card').waitFor({ timeout: 15000 });
  await page.waitForTimeout(250);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const scene of SCENES.filter(s => !only || only.includes(s.item))) {
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 }, deviceScaleFactor: 1 });
        const state = createState(true);
        state.guides.push({ ...state.guides[1], id: LECTURE, title: 'Cell Respiration Lecture', study_guide: '', notes: '- ATP is made in the mitochondria\n- Glycolysis happens in the cytoplasm\n- The Krebs cycle feeds the electron transport chain', source_type: 'lecture', flashcards: [], folder_id: null });
        state.guides.push({ ...state.guides[1], id: 'a0000000-0000-4000-8000-000000000010', title: 'Untitled notes', folder_id: null, is_bookmarked: false });
        await install(context, state);
        await context.addInitScript(([token, user, view, themeName, types]) => {
          localStorage.setItem('authToken', token);
          localStorage.setItem('userId', user);
          localStorage.setItem('theme', themeName);
          localStorage.setItem('cordiaLearnAskSure', 'off');
          if (types) localStorage.setItem('cordiaLearnTypes', JSON.stringify(types));
          if (view) localStorage.setItem('cordiaLibraryView', view);
        }, [TOKEN, USER, scene.cards ? 'cards' : '', theme, scene.types || null]);
        const page = await context.newPage();
        if (scene.questions) await session(page, scene.questions);
        if (scene.setup) await scene.setup(page);
        const file = path.join(out, `${scene.item}-${scene.name}-${width}-${theme}.png`);
        try {
          await page.goto(BASE + scene.url, { waitUntil: 'load' });
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(600);
          if (scene.run) await scene.run(page);
          if (scene.clip) {
            const target = page.locator(scene.clip).first();
            await target.waitFor({ timeout: 10000 });
            await target.scrollIntoViewIfNeeded();
            const box = await target.boundingBox();
            await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: Math.min(width, box.width + 32), height: box.height + 32 } });
          } else {
            await page.screenshot({ path: file, fullPage: !scene.run });
          }
          if (scene.after) await scene.after(page);
          console.log('ok  ', path.basename(file));
        } catch (error) {
          console.log('FAIL', path.basename(file), error.message.split('\n')[0]);
        }
        await context.close();
      }
    }
  }
  await browser.close();
})();
