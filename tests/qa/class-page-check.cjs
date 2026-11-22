// The class page in the new shell (docs/redesign/PLAN.md T7) in a real browser against a local dev
// server and the mock API: a Canvas class with an exam in three days and its review set, a Canvas
// class with guides and no exam, a class without Canvas, and an empty class. Checks what each shows,
// the ⋯ on every row (F3), the composer's chat, and takes screenshots. Run the app on the port first:
//   npm run dev --prefix web -- -p 3107
//   BASE=http://localhost:3107 CHROME=/path/to/chrome SHOTS=/tmp/shots node tests/qa/class-page-check.cjs
// OFF=1 checks the off path instead (run the server with CORDIA_NEW_SHELL=off): today's page.
// ONLY=regex runs some checks. The first visit to a page in `next dev` compiles it, so waits are generous.
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3107';
const SHOTS = process.env.SHOTS || '';
const CALC = 'f0000000-0000-4000-8000-0000000000c1';
const BUS = 'f0000000-0000-4000-8000-0000000000b2';
const EH = 'f0000000-0000-4000-8000-0000000000e3';
const EMPTY = 'f0000000-0000-4000-8000-0000000000d4';
const DAY = 86400000;
const results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function inDays(days, hour = 9, minute = 30) {
  const date = new Date(Date.now() + days * DAY);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}
const print = question => String(question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 48);

async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 3).join(' | ').slice(0, 500)}`); }
}

// A guide with Learn questions; `levels` are the Learn levels of its first ideas (3 mastered, 2 familiar, 1 learning).
function guide(id, title, folderId, { ideas = 8, levels = [], days = 3, ...extra } = {}) {
  const topics = ['the derivative', 'a related rate', 'a critical point', 'the second derivative test', 'concavity', 'an inflection point', 'a limit at infinity', 'an indeterminate form', 'the mean value theorem', 'implicit differentiation'];
  const questions = Array.from({ length: ideas }, (_, index) => ({
    question: `In ${title}, what does ${topics[index % topics.length]} (${index + 1}) tell you about a function?`,
    options: ['How the output changes as the input changes', 'The area under the curve', 'Where the graph crosses the axis', 'The largest value it can take'],
    correct_index: 0,
  }));
  const saved = {};
  levels.forEach((level, index) => { saved[index] = { q: print(questions[index].question), l: level, at: dayKey(new Date(Date.now() - DAY)), sure: true }; });
  return {
    id, title, folder_id: folderId, created_at: new Date(Date.now() - days * DAY).toISOString(), read_progress: 0, is_bookmarked: false,
    study_guide: questions.map((q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${q.options[0]}.`).join('\n'), notes: '- Rates of change', flashcards: [],
    quiz_questions: questions, flashcard_progress: { learn: { levels: saved } }, source_type: 'file', source_title: 'Slides.pdf', ...extra,
  };
}

function seed() {
  const state = createState(true);
  state.folders = [
    { id: CALC, name: 'MA 125 MA-125-001: Calculus I', class_id: 'cls-ma125' },
    { id: BUS, name: 'BUS 101 BUS-101-101: Professional Experience', class_id: 'cls-bus101' },
    { id: EH, name: 'Composition I' },
    { id: EMPTY, name: 'Art History: Renaissance' },
  ];
  state.guides = [
    guide('a0000000-0000-4000-8000-0000000000a1', 'Exam 3: review', CALC, { ideas: 10, levels: [3, 3, 3, 3, 2, 2, 1], days: 1, source_type: 'review' }),
    guide('a0000000-0000-4000-8000-0000000000a2', '3.9 Related rates', CALC, { levels: [3, 3, 2, 1, 1], days: 2, source_title: 'Week 9 Related rates.pptx' }),
    guide('a0000000-0000-4000-8000-0000000000a3', '4.1 Maximum and minimum values', CALC, { levels: [3, 3, 3, 3, 2], days: 4, source_title: '4.1 Maximum and minimum values.pdf' }),
    guide('a0000000-0000-4000-8000-0000000000a4', '4.3 How derivatives affect the shape of a graph', CALC, { levels: [3, 2], days: 6, source_type: 'canvas_module' }),
    guide('a0000000-0000-4000-8000-0000000000a5', '4.4 Indeterminate forms and L’Hôpital’s rule', CALC, { levels: [], days: 8, source_type: 'lecture' }),
    guide('a0000000-0000-4000-8000-0000000000b1', 'Writing a professional résumé', BUS, { levels: [3, 1], source_title: 'Resume workshop.pdf' }),
    guide('a0000000-0000-4000-8000-0000000000b2', 'Workplace ethics frameworks', BUS, { levels: [], source_type: 'webpage' }),
    guide('a0000000-0000-4000-8000-0000000000e1', 'Thesis statements that argue', EH, { levels: [2, 1], source_title: 'Thesis handout.docx' }),
  ];
  state.notes = [{ id: 'n0000000-0000-4000-8000-000000000001', title: 'Optimization worked examples', folder_id: CALC, content: '<p>Box volume.</p>', updated_at: ago(60 * 26) }];
  state.lectures = [{ id: 'l0000000-0000-4000-8000-000000000001', title: 'Lecture 22: Curve sketching', folder_id: CALC, lecture_date: dayKey(new Date(Date.now() - 2 * DAY)), created_at: ago(60 * 48) }];
  state.canvas = {
    connected: true, last_synced_at: ago(12),
    courses: [{ id: 101, imported: true, class_id: 'cls-ma125', name: 'Calculus I' }, { id: 102, imported: true, class_id: 'cls-bus101', name: 'Professional Experience' }],
  };
  state.classDeadlines = {
    'cls-ma125': [
      { id: 'canvas-9', title: 'Exam 3', due_at: inDays(3, 9, 30), done: false, submitted: false },
      { id: 'canvas-10', title: 'Homework 10', due_at: inDays(4, 23, 59), done: false, submitted: false },
      { id: 'canvas-11', title: 'Quiz 8', due_at: inDays(7, 10, 0), done: false, submitted: false },
      { id: 'canvas-12', title: 'Written homework 9', due_at: inDays(-2, 23, 59), done: false, submitted: true },
    ],
    'cls-bus101': [{ id: 'canvas-20', title: 'A07AA Rough draft, résumé', due_at: inDays(5, 23, 59), done: false, submitted: false }],
  };
  state.coursework = [
    { id: 'canvas-9', title: 'Exam 3', course: 'MA-125-001', due_at: inDays(3, 9, 30), type: 'exam', done: false },
    { id: 'canvas-10', title: 'Homework 10', course: 'MA-125-001', due_at: inDays(4, 23, 59), type: 'assignment', done: false },
    { id: 'canvas-11', title: 'Quiz 8', course: 'MA-125-001', due_at: inDays(7, 10, 0), type: 'quiz', done: false },
  ];
  state.grades = { 101: { canvas_score: 88, canvas_letter: 'B', score: 88, letter: 'B', weighted: false, upcoming: [] }, 102: { score: null, letter: null, upcoming: [] } };
  state.sets = [
    { id: 's1', title: 'Exam 3 practice problems', card_count: 42, studied_by: 6, owner_name: 'Maya', mine: false, saved: false, versions: [] },
    { id: 's2', title: 'Related rates cards', card_count: 18, studied_by: 2, owner_name: null, mine: true, saved: false, versions: [] },
  ];
  state.chatsApi = 'full';
  state.chats = [
    { id: 'd0000000-0000-4000-8000-000000000001', guide_id: null, class_id: CALC, title: 'Why the chain rule works', messages: [{ role: 'user', text: 'Why the chain rule works' }, { role: 'ai', text: 'The inner function changes the rate.' }], created_at: ago(300), updated_at: ago(300) },
    { id: 'd0000000-0000-4000-8000-000000000002', guide_id: null, class_id: CALC, title: 'Related rates practice', messages: [{ role: 'user', text: 'Related rates practice' }], created_at: ago(3000), updated_at: ago(3000) },
  ];
  state.tutor.messages = [];
  return state;
}

async function routes(context, state) {
  const json = (route, data) => route.fulfill({ json: data });
  // Later routes win in Playwright: these refine the mock for the class page.
  await context.route(/localhost:8000\/classes\/([^/?]+)(\/deadlines)?(\?.*)?$/, route => {
    const match = new URL(route.request().url()).pathname.match(/^\/classes\/([^/]+)(\/deadlines)?$/);
    if (!match || route.request().method() !== 'GET') return route.fallback();
    const id = decodeURIComponent(match[1]);
    if (match[2]) return json(route, { deadlines: state.classDeadlines[id] || [] });
    const code = id === 'cls-ma125' ? 'MA 125' : 'BUS 101';
    return json(route, { class: { id, code, name: code === 'MA 125' ? 'Calculus I' : 'Professional Experience', school: 'South Alabama' }, sets: id === 'cls-ma125' ? state.sets : [] });
  });
  await context.route(/localhost:8000\/calendar\/coursework/, route => json(route, { connected: true, counts: { upcoming: state.coursework.length, missing: 0, completed: 0 }, upcoming: state.coursework, missing: [], completed: [] }));
  await context.route(/localhost:8000\/canvas\/courses\/(\d+)\/grades/, route => {
    const id = new URL(route.request().url()).pathname.match(/courses\/(\d+)/)[1];
    return json(route, state.grades[id] || { score: null, letter: null, upcoming: [] });
  });
  await context.route(/localhost:8000\/smart_notes(\/[^/?]+)?$/, route => {
    const method = route.request().method();
    if (method === 'GET') return json(route, { notes: state.notes });
    const id = new URL(route.request().url()).pathname.split('/')[2];
    const body = JSON.parse(route.request().postData() || '{}');
    if (method === 'PUT') { const note = state.notes.find(item => item.id === id); if (note) note.folder_id = body.folder_id || null; return json(route, { updated: true }); }
    if (method === 'DELETE') { state.notes = state.notes.filter(item => item.id !== id); return json(route, { deleted: true }); }
    return route.fallback();
  });
  await context.route(/\/api\/lectures\/list/, route => json(route, { lectures: state.lectures }));
  await context.route(/supabase\.co\/rest\/v1\/class_share_defaults/, route => json(route, [{ share: false }]));
  await context.route(/localhost:8000\/sharing\/settings/, route => json(route, { show_first_name: true }));
}

async function session(browser, { width = 1440, height = 900, theme = 'light', reduced = false, touch = false } = {}) {
  // A touch screen (a tablet in the new shell): no hover, a coarse pointer.
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: theme, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  const state = seed();
  await install(context, state);
  await routes(context, state);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|404|401|net::ERR|Content Security Policy|Refused to execute script|vercel-scripts/.test(message.text())) problems.push(message.text()); });
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, look]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', look); localStorage.setItem('cordiaWalkthroughDone', '1'); }, [TOKEN, USER, theme]);
  return { context, page, state, problems };
}

async function open(page, folderId, tab = '') {
  await page.goto(`${BASE}/folder/${folderId}${tab ? `?tab=${tab}` : ''}`);
  await page.waitForSelector(process.env.OFF ? '.cls-page, .c-empty' : '.cls-v2, .c-empty[role="alert"]', { timeout: 60000 });
  await page.waitForTimeout(700);
}
const text = (page, selector) => page.evaluate(sel => { const element = document.querySelector(sel); return element ? element.textContent.replace(/\s+/g, ' ').trim() : ''; }, selector);
const texts = (page, selector) => page.$$eval(selector, elements => elements.map(element => element.textContent.replace(/\s+/g, ' ').trim()));
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--headless=new'] });

  if (process.env.OFF) {
    await check('off path: with the shell off, today\'s class page shows (no tabs of the new page, its own tabs)', async () => {
      const { page, problems, context } = await session(browser);
      await open(page, CALC);
      expect(await page.$('.cls-page'), 'today\'s page');
      expect(!(await page.$('.cls-v2')), 'no new page');
      const tabs = await texts(page, '.cls-tabs [role="tab"]');
      expect(JSON.stringify(tabs) === JSON.stringify(['Your material', 'Course files', 'Grades', 'Class sets', 'Deadlines']), 'tabs ' + JSON.stringify(tabs));
      await shot(page, 'off-1440-light');
      expect(!problems.length, problems.join(' | '));
      await context.close();
    });
    await check('off path at 390 × 844: today\'s page, a page icon for an unread guide and a ring for a started one', async () => {
      const { page, problems, context } = await session(browser, { width: 390, height: 844 });
      await open(page, CALC);
      expect(await page.$('.cls-page'), 'today\'s page');
      await shot(page, 'off-390-light');
      await page.click('.cls-tabs [role="tab"]:has-text("Class sets")');
      await page.waitForTimeout(600);
      await shot(page, 'off-390-sets');
      expect((await texts(page, '.cp-chip')).includes('Yours'), 'Yours chip');
      expect(!problems.length, problems.join(' | '));
      await context.close();
    });
    await browser.close();
    const failed = results.filter(ok => !ok).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }

  await check('Canvas class with an exam: header, tabs, rows, exam card and Due soon', async () => {
    const { page, problems, context } = await session(browser);
    await open(page, CALC);
    expect((await text(page, 'h1.cls-name')) === 'Calculus I', 'title');
    const meta = await text(page, '.cls-head-meta');
    expect(/^MA 125 · synced from Canvas 1[0-3] minutes ago$/.test(meta), 'meta ' + meta);
    expect((await text(page, '.cls-share')) === 'Private', 'sharing button');
    const tabs = await texts(page, '.cls-tabs [role="tab"]');
    expect(JSON.stringify(tabs) === JSON.stringify(['Chats', 'Guides5', 'Files', 'Deadlines', 'Grades']), 'tabs ' + JSON.stringify(tabs));
    const rows = await texts(page, '.cls-panel .cls-row .cls-row-title');
    expect(rows[0] === 'Exam 3: review', 'review set leads: ' + rows[0]);
    expect(await page.$('.cls-row.is-lead .c-ring'), 'lead ring');
    const lead = await text(page, '.cls-row.is-lead .cls-mastery');
    expect(lead === '4 of 10 mastered', 'lead mastery ' + lead);
    const second = await page.$$eval('.cls-row:not(.is-lead)', items => items.map(item => item.querySelector('.c-meta')?.textContent));
    expect(second[0] === 'Lecture slides · 8 ideas', 'source and ideas ' + second[0]);
    expect((await page.$$('.cls-row .cls-bar')).length >= 3, 'mastery bars');
    expect((await texts(page, '.cls-row')).length === 7, 'five guides, a note and a lecture');
    // Exam card
    expect((await text(page, '.cls-exam-title')) === 'Exam 3', 'exam title');
    const when = await text(page, '.cls-exam-head .c-meta');
    expect(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · 9:30 AM · in 3 days$/.test(when), 'when ' + when);
    const pct = await text(page, '.cls-exam-pct');
    expect(pct === '52%', 'readiness ' + pct);
    const line = await text(page, '.cls-exam-line');
    expect(line === '6 ideas left to master. 2 today keeps you on pace.', 'pace ' + line);
    const start = await page.$eval('.cls-exam .c-btn--primary', link => [link.textContent.trim(), link.getAttribute('href')]);
    expect(start[0] === 'Start today’s 2' && /\/learn\/a0000000-0000-4000-8000-0000000000a1\?test=\d{4}-\d{2}-\d{2}$/.test(start[1]), 'start ' + start);
    const timed = await page.$eval('.cls-exam .cls-exam-actions .c-btn--secondary', link => link.getAttribute('href'));
    expect(/&mode=timed$/.test(timed), 'timed ' + timed);
    expect((await page.$$('.c-btn--primary')).filter(Boolean).length >= 1, 'one olive');
    // Due soon (the exam isn't repeated) and the grade estimate
    const due = await texts(page, '.cls-due-name');
    expect(JSON.stringify(due) === JSON.stringify(['Homework 10', 'Quiz 8', 'Grade estimate']), 'due ' + JSON.stringify(due));
    expect((await text(page, '.cls-grade')) === '88.0% · B', 'grade');
    await shot(page, 'calc-guides-1440-light');
    expect(!problems.length, problems.join(' | '));
    await context.close();
  });

  await check('one olive button on the page besides New chat: Start today\'s N', async () => {
    const { page, context } = await session(browser);
    await open(page, CALC);
    const olive = await page.$$eval('main .c-btn--primary, .cls-v2 .c-btn--primary', items => items.filter(item => item.offsetParent).map(item => item.textContent.trim()));
    expect(olive.length === 1 && olive[0].startsWith('Start today'), 'olive ' + JSON.stringify(olive));
    await context.close();
  });

  await check('every row\'s ⋯ is hidden at rest, shows on hover and on keyboard focus, and lists the guide\'s actions', async () => {
    const { page, context } = await session(browser);
    await open(page, CALC);
    const opacity = selector => page.$eval(selector, element => getComputedStyle(element).opacity);
    const first = '.cls-row:nth-child(2) .cls-more';
    expect((await opacity(first)) === '0', 'hidden at rest');
    await page.hover('.cls-row:nth-child(2)');
    await page.waitForTimeout(250);
    expect((await opacity(first)) === '1', 'shown on hover');
    await page.mouse.move(5, 5);
    await page.focus('.cls-row:nth-child(2) .cls-learn');
    await page.waitForTimeout(250);
    expect((await opacity(first)) === '1', 'shown on focus');
    await page.click(first);
    await page.waitForSelector('.c-menu.is-floating');
    const items = await texts(page, '.c-menu.is-floating [role="menuitem"]');
    expect(JSON.stringify(items) === JSON.stringify(['Open guide', 'Rename', 'Move to class', 'Star', 'Delete']), 'menu ' + JSON.stringify(items));
    await shot(page, 'calc-row-menu-1440-light');
    await page.keyboard.press('Escape');
    // Every row of every list has one.
    const counts = await page.$$eval('.cls-row', rows => rows.map(row => row.querySelectorAll('.cls-more').length));
    expect(counts.every(count => count === 1), 'one ⋯ per row ' + counts);
    expect((await page.$$('.cls-due-item .cls-more')).length === 2, 'Due soon rows');
    expect((await page.$$('.cls-exam .cls-more')).length === 1, 'exam card');
    await context.close();
  });

  await check('on a touch screen every ⋯ shows without hovering', async () => {
    const { page, context } = await session(browser, { width: 1024, height: 768, touch: true });
    await open(page, CALC);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches), 'a screen without hover');
    const all = await page.$$eval('.cls-more', items => items.map(item => getComputedStyle(item).opacity));
    expect(all.length > 5 && all.every(value => value === '1'), 'opacity ' + all);
    await context.close();
  });

  await check('class sets: Yours is a chip, centred on its row; others can be saved and reported from ⋯', async () => {
    const { page, context } = await session(browser);
    await open(page, CALC);
    await page.click('.cls-sets-toggle');
    await page.waitForSelector('.cp-chip');
    const box = await page.$eval('.cp-chip', chip => { const own = chip.getBoundingClientRect(); const row = chip.closest('.cp-row').getBoundingClientRect(); const style = getComputedStyle(chip); return { mid: Math.abs((own.top + own.bottom) / 2 - (row.top + row.bottom) / 2), padding: style.paddingLeft, height: own.height }; });
    expect(box.mid <= 1 && box.padding === '12px' && box.height === 28, 'chip ' + JSON.stringify(box));
    expect((await page.$$('.cp-row .cls-more')).length === 1, 'Report ⋯ on the classmate\'s set');
    await page.hover('.cp-row:has(.cp-chip)');
    await shot(page, 'calc-sets-1440-light');
    await context.close();
  });

  await check('each tab: Chats lists the class\'s saved chats; Files, Deadlines and Grades show', async () => {
    const { page, problems, context } = await session(browser);
    await open(page, CALC, 'chats');
    const chats = await texts(page, '.cls-panel .cls-row-title');
    expect(JSON.stringify(chats) === JSON.stringify(['Why the chain rule works', 'Related rates practice']), 'chats ' + JSON.stringify(chats));
    const href = await page.$eval('.cls-panel .cls-row-main', link => link.getAttribute('href'));
    expect(href === '/chat/d0000000-0000-4000-8000-000000000001', 'chat link ' + href);
    await page.click('.cls-panel .cls-row:first-child .cls-more');
    await page.waitForSelector('.c-menu.is-floating');
    const items = await texts(page, '.c-menu.is-floating [role="menuitem"]');
    expect(JSON.stringify(items) === JSON.stringify(['Open chat', 'Rename', 'Move to class', 'Delete']), 'chat menu ' + JSON.stringify(items));
    await page.keyboard.press('Escape');
    await shot(page, 'calc-chats-1440-light');
    await page.click('#cls-tab-files');
    await page.waitForTimeout(800);
    expect((await text(page, '.cls-files-head')).startsWith('Synced from Canvas'), 'files head');
    await shot(page, 'calc-files-1440-light');
    await page.click('#cls-tab-deadlines');
    await page.waitForTimeout(500);
    const deadlines = await texts(page, '.cp-deadline .cp-title');
    expect(deadlines.length === 4, 'deadlines ' + deadlines);
    expect((await page.$$('.cp-deadline .cls-more')).length === 4, 'deadline ⋯');
    await page.click('.cp-deadline:first-child .cp-open');
    await page.waitForTimeout(800);
    expect(await page.$('[role="dialog"]'), 'assignment sheet opens');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await shot(page, 'calc-deadlines-1440-light');
    await page.click('#cls-tab-grades');
    await page.waitForTimeout(1200);
    await shot(page, 'calc-grades-1440-light');
    expect(!problems.length, problems.join(' | '));
    await context.close();
  });

  await check('the composer\'s picker is this class; a message starts a chat in the class, shown in place; Back lists it under Chats', async () => {
    const { page, state, problems, context } = await session(browser);
    await open(page, CALC);
    const picker = await text(page, '.cls-composer .c-class-picker-label');
    expect(/MA 125/.test(picker), 'picker ' + picker);
    await page.fill('.cls-composer textarea', 'Quiz me on related rates');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cls-chat .chat-home-thread', { timeout: 20000 });
    await page.waitForTimeout(800);
    expect(state.calls.includes('POST /chats'), 'POST /chats');
    expect(state.live?.class_id === CALC, 'chat in this class ' + JSON.stringify(state.live));
    expect((await text(page, '.chat-home-title')) === 'Quiz me on related rates', 'title');
    await shot(page, 'calc-chat-1440-light');
    await page.click('.chat-home-top .c-icon-btn');
    await page.waitForSelector('.cls-v2');
    await page.click('#cls-tab-chats');
    await page.waitForTimeout(900);
    const chats = await texts(page, '.cls-panel .cls-row-title');
    expect(chats[0] === 'Quiz me on related rates', 'listed ' + JSON.stringify(chats));
    expect(!problems.length, problems.join(' | '));
    await context.close();
  });

  await check('Canvas class with guides and no exam: Build review set, Files and Grades tabs', async () => {
    const { page, problems, context } = await session(browser);
    await open(page, BUS);
    expect((await text(page, '.cls-exam-title')) === 'No exam coming up', 'card');
    expect((await text(page, '.cls-exam .c-btn')) === 'Build review set', 'build');
    const tabs = await texts(page, '.cls-tabs [role="tab"]');
    expect(tabs.includes('Files') && tabs.includes('Grades'), 'tabs ' + tabs);
    expect(!(await page.$('.cls-grade')), 'no grade estimate without a score');
    await shot(page, 'bus-guides-1440-light');
    expect(!problems.length, problems.join(' | '));
    await context.close();
  });

  await check('class without Canvas: no Files or Grades, no Due soon; Deadlines asks for the course code', async () => {
    const { page, problems, context } = await session(browser);
    await open(page, EH);
    const tabs = await texts(page, '.cls-tabs [role="tab"]');
    expect(JSON.stringify(tabs) === JSON.stringify(['Chats', 'Guides1', 'Deadlines']), 'tabs ' + JSON.stringify(tabs));
    expect(!(await page.$('.cls-due')), 'no Due soon');
    expect((await text(page, '.cls-head-meta')) === '', 'no meta');
    await shot(page, 'eh-guides-1440-light');
    await page.click('#cls-tab-deadlines');
    await page.waitForTimeout(400);
    expect(await page.$('.cls-needs-code'), 'needs code');
    await shot(page, 'eh-deadlines-1440-light');
    expect(!problems.length, problems.join(' | '));
    await context.close();
  });

  await check('empty class: no exam card, empty states that say what to do', async () => {
    const { page, problems, context } = await session(browser);
    await open(page, EMPTY);
    expect(!(await page.$('.cls-exam')), 'no exam card');
    expect((await text(page, '.cls-empty .cls-line')) === 'No guides in this class yet', 'empty guides');
    await shot(page, 'empty-guides-1440-light');
    await page.click('#cls-tab-chats');
    await page.waitForTimeout(300);
    expect((await text(page, '.cls-empty .c-meta')) === 'Ask about this class above to start a chat.', 'empty chats');
    await shot(page, 'empty-chats-1440-light');
    expect(!problems.length, problems.join(' | '));
    await context.close();
  });

  // Screens for the finish gate: light and dark, 1440 × 900, 1024 (sidebar folded), 880 (stacked), 1440 × 640.
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [[1440, 900], [1024, 768], [880, 900], [1440, 640]]) {
      await check(`screens ${theme} ${width}×${height}`, async () => {
        const { page, problems, context } = await session(browser, { width, height, theme, reduced: true });
        for (const [folder, key] of [[CALC, 'calc'], [BUS, 'bus'], [EH, 'eh'], [EMPTY, 'empty']]) {
          await open(page, folder);
          await shot(page, `${key}-${width}x${height}-${theme}`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow <= 0, `${key} scrolls sideways by ${overflow}px`);
        }
        await open(page, CALC);
        await page.hover('.cls-row:nth-child(3)');
        await page.click('.cls-row:nth-child(3) .cls-more');
        await page.waitForTimeout(300);
        await shot(page, `calc-menu-${width}x${height}-${theme}`);
        expect(!problems.length, problems.join(' | '));
        await context.close();
      });
    }
  }

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
