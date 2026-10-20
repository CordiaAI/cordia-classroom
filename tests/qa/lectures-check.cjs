// Lectures section, guide Notes/Cards, and Record's browser-speech fallback, in a real browser
// against a local build (/api/* mocked in the browser).  BASE=http://localhost:3100 node tests/qa/lectures-check.cjs
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp';
const LID = 'c0000000-0000-4000-8000-000000000001';
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n')[0].slice(0, 240)}`); }
}
const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const LECTURE = {
  id: LID, title: 'Supply and Demand Basics', folder_id: 'f0000000-0000-4000-8000-000000000001', source: 'recording', lecture_date: '2026-10-17', duration_ms: 3000000,
  transcript: 'Today we cover supply and demand. This will definitely be on the midterm. Problem set three is due Friday.',
  segments: [{ start_ms: 0, text: 'Today we cover supply and demand.' }, { start_ms: 20000, text: 'This will definitely be on the midterm, so know how the curves shift.' }, { start_ms: 40000, text: 'Problem set three is due Friday before class.' }],
  analysis: {
    analyzed: true, summary: ['Supply and demand set prices.', 'Curves shift when conditions change.'],
    watch_for: [{ point: 'Know how the curves shift', why: 'exam', quote: 'This will definitely be on the midterm', at_ms: 20000 }],
    outline: [{ heading: 'Supply and demand', at_ms: 0, points: ['Prices balance supply and demand'] }],
    terms: [{ term: 'Demand curve', definition: 'Quantity wanted at each price', at_ms: 0 }],
    questions: [{ question: 'What happens when supply falls?', at_ms: 20000 }],
  },
};

async function session(browser, { width = 1440, theme = 'light', lecture = LECTURE } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const state = createState(true);
  state.todo = { id: 'd1', title: 'Problem set 3', kind: 'assignment', due_at: `${soon}T23:59:00Z`, said: 'Friday', quote: 'Problem set three is due Friday', at_ms: 40000, status: 'suggested' };
  state.saved = [];
  state.lecture = lecture;
  state.analyzeCalls = 0;
  await install(context, state);
  await context.route(/localhost:3100\/api\/lectures\/(list|get|save|update|delete|todo|todos|usage|analyze)/, async route => {
    const url = new URL(route.request().url());
    const action = url.pathname.split('/').pop();
    const body = JSON.parse(route.request().postData() || '{}');
    if (action === 'list') return route.fulfill({ json: { enabled: true, lectures: [{ id: LID, title: LECTURE.title, folder_id: LECTURE.folder_id, source: 'recording', lecture_date: '2026-10-17', duration_ms: 3000000, summary: 'Supply and demand set prices.', watch_count: 1, todo_count: 1 }] } });
    if (action === 'get') return route.fulfill({ json: { lecture: state.lecture, todos: state.todo.status === 'dismissed' ? [] : [state.todo] } });
    if (action === 'save') { state.saved.push(body); return route.fulfill({ json: { lecture: { id: LID, title: LECTURE.title } } }); }
    if (action === 'todo') { Object.assign(state.todo, body.status ? { status: body.status } : {}); return route.fulfill({ json: { todo: state.todo } }); }
    if (action === 'todos') return route.fulfill({ json: { todos: state.todo.status === 'confirmed' ? [{ ...state.todo, lecture_id: LID, lecture_title: LECTURE.title }] : [] } });
    if (action === 'analyze') { state.analyzeCalls += 1; await new Promise(resolve => setTimeout(resolve, 1200)); return route.fulfill({ json: { analysis: { ...LECTURE.analysis, note_id: 'note-9' }, todos: [state.todo] } }); }
    if (action === 'usage') return route.fulfill({ json: { minutes_left: 84, minutes_limit: 120, ready: false } });
    return route.fulfill({ json: {} });
  });
  await context.route(/localhost:3100\/api\/guide-notes$/, route => route.fulfill({ json: { notes: '> How cells are built and powered.\n\n## Cells\n- **Cells** are the basic unit of life.\n- The **mitochondria** make energy.\n  - Through cellular respiration\n\n## Membranes\n- Membranes control what enters and leaves.\n\n## Key points\n- Cells are the basic unit of life.\n- Mitochondria make the cell\'s energy.' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, mode]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', mode); localStorage.setItem(`cordiaRecordConsent:${user}`, '1'); }, [TOKEN, USER, theme]);
  return { context, page, state, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

  for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) {
    await check(`Library → Lectures tab and the lecture page (${width}px ${theme})`, async () => {
      const { context, page, errors } = await session(browser, { width, theme });
      await page.goto(BASE + '/library?tab=lectures');
      await page.locator('.lecture-row:has-text("Supply and Demand Basics")').waitFor();
      expect(await page.locator('.c-seg a[aria-selected="true"]').innerText() === 'Lectures', 'Lectures is not the third tab');
      await page.screenshot({ path: path.join(SHOTS, `lectures-list-${width}.png`) });
      await page.click('.lecture-row');
      await page.waitForURL(/\/lecture\//);
      await page.locator('.lecture-title').waitFor();
      await page.locator('h2:has-text("Summary")').waitFor();
      for (const title of ['Summary', 'What to watch for', 'To do', 'Notes', 'Key terms', 'Questions from class', 'Transcript']) {
        expect(await page.locator(`h2:has-text("${title}")`).count() === 1, `missing ${title}`);
      }
      expect(/definitely be on the midterm/.test(await page.locator('.lecture-quote').first().innerText()), 'no quote');
      await page.screenshot({ path: path.join(SHOTS, `lecture-page-${width}-${theme}.png`), fullPage: true });
      await page.locator('.lecture-time').first().click();
      await page.locator('.lecture-line').first().waitFor();
      await page.click('button:has-text("Add to calendar")');
      await page.locator('text=On your calendar').waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow <= 0, `sideways scroll ${overflow}px`);
      expect(!errors.length, errors.join(' | '));
      await context.close();
    });
  }

  await check('A lecture saved without notes gets them written on open, with Open in Notes', async () => {
    const bare = { ...LECTURE, analysis: { analyzed: false } };
    const { context, page, state, errors } = await session(browser, { lecture: bare });
    await page.goto(BASE + '/lecture/' + LID);
    await page.locator('h2:has-text("Notes")').waitFor();
    await page.locator('text=Writing your notes').waitFor({ timeout: 5000 });
    await page.locator('.lecture-outline-heading:has-text("Supply and demand")').waitFor({ timeout: 10000 });
    expect(await page.getAttribute('a:has-text("Open in Notes")', 'href') === '/smartnotes?id=note-9', 'no link to the note');
    expect(state.analyzeCalls === 1, `analyze called ${state.analyzeCalls} times`);
    expect(!errors.length, errors[0]);
    await context.close();
  });

  await check('Add notes → saved as a lecture → opens it', async () => {
    const { context, page, state } = await session(browser);
    await page.goto(BASE + '/library?tab=lectures');
    await page.click('.c-page-head button:has-text("Add notes")');
    await page.locator('.lecture-add-text').fill('Professor said the essay on the French Revolution is due next Monday. Causes: debt, inequality, Enlightenment ideas.');
    await page.click('button:has-text("Save lecture")');
    await page.waitForURL(/\/lecture\//);
    expect(state.saved[0].source === 'notes' && /French Revolution/.test(state.saved[0].transcript), JSON.stringify(state.saved[0]).slice(0, 120));
    await context.close();
  });

  await check('Confirmed to-do shows on Calendar and in Today → Due soon, linking to its lecture', async () => {
    const { context, page, state } = await session(browser);
    state.todo.status = 'confirmed';
    await page.goto(BASE + '/calendar');
    await page.locator('.calendar-item-lecture:has-text("Problem set 3")').first().waitFor({ timeout: 10000 });
    expect((await page.locator('.calendar-item-lecture').first().getAttribute('href')) === `/lecture/${LID}`, 'wrong link');
    // Today lists the three soonest; with no Canvas deadlines the lecture to-do is among them.
    await context.route(/localhost:8000\/calendar\/connection$/, route => route.fulfill({ json: { connected: false } }));
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.evaluate(([token, user]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); }, [TOKEN, USER]);
    await page.goto(BASE + '/dashboard');
    await page.locator('#due-title').waitFor({ timeout: 10000 });
    await page.locator('a.c-list-row:has-text("Problem set 3")').waitFor({ timeout: 10000 });
    await context.close();
  });

  await check('Guide: Notes is a study guide (overview, outline, key points); Cards has the questions and Flip cards', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/guide/a0000000-0000-4000-8000-000000000001');
    await page.locator('.guide-outline-section h2:has-text("Cells")').waitFor({ timeout: 10000 });
    expect(await page.locator('.reader-actions').count() === 0, 'questions shown in Notes');
    expect(/How cells are built/.test(await page.locator('.guide-overview').innerText()), 'no overview');
    expect(await page.locator('.guide-sub li:has-text("cellular respiration")').count() === 1, 'no sub-points');
    expect(await page.locator('.guide-notes strong:has-text("mitochondria")').count() === 1, 'key terms not bold');
    expect(await page.locator('.guide-key li').count() === 2, 'no Key points at the end');
    await page.screenshot({ path: path.join(SHOTS, 'guide-notes-outline.png'), fullPage: true });
    await page.click('.c-pill:has-text("Cards")');
    await page.locator('.reader-actions').first().waitFor();
    expect(await page.locator('a:has-text("Flip cards")').count() === 1, 'no Flip cards button');
    await context.close();
  });

  await check('Record without server transcription uses the browser\'s speech recognition', async () => {
    const { context, page } = await session(browser);
    await page.goto(BASE + '/dashboard');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:new', { detail: { mode: 'record' } })));
    await page.locator('text=Transcribed by your browser').waitFor({ timeout: 10000 });
    await page.click('.rec-start');
    await page.locator('.rec-timer').waitFor({ timeout: 10000 });
    expect(!(await page.locator('.rec-error:has-text("set up")').count()), 'shows the not-set-up error while recording');
    await context.close();
  });

  await check('Browser speech: words still pending (never final) are kept on Stop and on Chrome restarts', async () => {
    const { context, page, state } = await session(browser);
    // A fake engine like Chrome on a long stretch of speech: only interim results; a restart
    // (its ~1 minute limit) partway through; finals never come.
    await page.addInitScript(() => {
      const said = ['Today we are covering the causes of the French Revolution in seventeen eighty nine', 'and how the debt crisis and bread prices pushed people to act'];
      let part = 0;
      class FakeRecognition {
        start() { this.running = true; const text = said[Math.min(part, said.length - 1)]; part += 1;
          setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: false })] }), 300);
          if (part === 1) setTimeout(() => { if (this.running) { this.running = false; this.onend?.(); } }, 900); }
        stop() { if (!this.running) return; this.running = false; setTimeout(() => this.onend?.(), 200); }
      }
      window.SpeechRecognition = FakeRecognition;
      window.webkitSpeechRecognition = FakeRecognition;
    });
    await page.goto(BASE + '/dashboard');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('cordia:new', { detail: { mode: 'record' } })));
    await page.locator('text=Transcribed by your browser').waitFor({ timeout: 10000 });
    await page.click('.rec-start');
    await page.locator('.rec-timer').waitFor({ timeout: 10000 });
    await page.locator('.rec-transcript p:has-text("French Revolution")').waitFor({ timeout: 5000 });
    await page.locator('.rec-interim:has-text("bread prices")').waitFor({ timeout: 5000 });
    await page.click('.rec-stage button:has-text("Stop")');
    await page.waitForURL(/\/lecture\//, { timeout: 15000 });
    const saved = state.saved[0] || {};
    expect(/French Revolution/.test(saved.transcript) && /bread prices/.test(saved.transcript), `saved: ${JSON.stringify(saved.transcript)}`);
    await context.close();
  });

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
