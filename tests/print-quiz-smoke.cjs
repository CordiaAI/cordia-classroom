// Printable quiz layout, against a built frontend: CORDIA_SMOKE_BASE_URL=http://localhost:3000
// (next build && next start). Every preset and one custom mix is printed to PDF (saved in
// CORDIA_PRINT_PDF_DIR, default a temp folder), then checked:
//   - no question is split across pages (every question's text sits on one PDF page, and every
//     question block is break-inside: avoid and shorter than a page)
//   - a single-type test has no Part labels or part cards; a mixed one has one per part
//   - the answer key starts on its own page after the last question
// The API is a fixture; this proves the print layout only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.CORDIA_SMOKE_BASE_URL;
const outDir = process.env.CORDIA_PRINT_PDF_DIR || path.join(os.tmpdir(), 'cordia-print-quiz');
const GUIDE = '00000000-0000-0000-0000-00000000print';
const PAGE_HEIGHT_PX = (11 - 0.8 - 0.85) * 96;

const long = n => `The ${['first', 'second', 'third', 'fourth'][n % 4]} answer choice, written long enough to wrap onto a second line at twelve points on Letter paper`;
const pools = {
  title: 'Cell Biology and Genetics: Unit Review',
  class_name: 'BIO 110: Principles of Biology',
  mc: Array.from({ length: 20 }, (_, i) => ({
    id: `mc${i}`, source: i, question: `Which statement best describes process number ${i + 1} covered in the unit on cells and inheritance?`,
    options: [0, 1, 2, 3].map(n => (i % 3 === 0 ? long(n) : `Choice ${'ABCD'[n]} for question ${i + 1}`)), answer: i % 4,
  })),
  matching: Array.from({ length: 18 }, (_, i) => ({ id: `m${i}`, source: 20 + i, term: `Term ${i + 1}`, definition: `The definition of term ${i + 1}${i % 2 ? ', which runs long enough to wrap onto a second line in the right-hand column' : ''}` })),
  fill: Array.from({ length: 14 }, (_, i) => ({
    id: `f${i}`, source: 40 + i,
    parts: i % 4 === 0 ? [`Sentence ${i + 1} puts `, { blank: 'one' }, ' and then ', { blank: 'two' }, ' in the same line of a fairly long sentence.'] : [`Sentence ${i + 1} has its key word `, { blank: 'here' }, '.'],
    blanks: i % 4 === 0 ? ['one', 'two'] : ['here'], points: i % 4 === 0 ? 2 : 1,
  })),
  short: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, source: 60 + i, question: `How does mechanism ${i + 1} explain the pattern described in the unit?`, key: `Key points for answer ${i + 1}.`, points: 4 })),
  mc_flagged: 0, fill_possible: 14, fill_locked: false,
};

// name: [format in the link (mc.matching.fill.short-flags), mixed?]
const FORMATS = {
  mixed: ['8.8.6.3-0010', true],
  'all-multiple-choice': ['12.0.0.0-0010', false],
  'all-short-answer': ['0.0.0.9-0010', false],
  'all-fill-in-the-blank': ['0.0.12.0-0010', false],
  'all-matching': ['0.16.0.0-0010', false],
  'custom-mc-fill-short-shuffled': ['5.0.4.2-1110', true],
};

const squash = text => String(text).normalize('NFKC').replace(/\s+/g, '');

async function pdfPages(file) {
  const pdfjs = await import(path.join(__dirname, '..', 'web', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(file)) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(squash(content.items.map(item => item.str).join('')));
  }
  return pages;
}

test('printable quiz: every preset and a custom mix print without splitting a question', { skip: !base, timeout: 240000 }, async () => {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CORDIA_BROWSER_PATH || undefined, headless: true });
  const page = await browser.newPage();
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'print-student', email: 'student@example.test', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  await page.route(url => !url.href.startsWith(base), route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/print-items') ? pools : {}),
  }));
  await page.goto(base);
  await page.evaluate(value => localStorage.setItem('authToken', value), token);

  try {
    for (const [name, [format, mixed]] of Object.entries(FORMATS)) {
      await page.goto(`${base}/print/quiz/${GUIDE}?f=${format}&print=0&seed=3`);
      await page.locator('.pq-paper').waitFor({ timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);

      const layout = await page.evaluate(() => ({
        partLabels: document.querySelectorAll('.pq-part').length,
        partCards: document.querySelectorAll('.pq-part-card').length,
        sections: document.querySelectorAll('.pq-version:first-child .pq-section').length,
        units: [...document.querySelectorAll('.pq-keep')].map(unit => ({
          avoid: getComputedStyle(unit).breakInside,
          height: unit.getBoundingClientRect().height,
          texts: [...unit.querySelectorAll('.pq-text, .pq-options li, .pq-term, .pq-defs li')]
            .flatMap(node => (node.classList.contains('pq-text') ? [...node.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent) : [node.textContent.replace(/^[A-Z]\s*/, '')]))
            .map(text => text.trim()).filter(text => text.length > 2),
        })),
      }));
      if (mixed) {
        assert.equal(layout.partLabels, layout.sections, `${name}: one Part label per section`);
        assert.equal(layout.partCards, layout.sections, `${name}: one summary card per part`);
      } else {
        assert.equal(layout.partLabels, 0, `${name}: no Part labels on a single-type test`);
        assert.equal(layout.partCards, 0, `${name}: no part cards on a single-type test`);
        assert.equal(layout.sections, 1, `${name}: one section heading`);
      }
      layout.units.forEach((unit, i) => {
        assert.equal(unit.avoid, 'avoid', `${name}: question block ${i + 1} must not break`);
        assert.ok(unit.height < PAGE_HEIGHT_PX, `${name}: question block ${i + 1} is taller than a page`);
      });

      const file = path.join(outDir, `printable-quiz-${name}.pdf`);
      await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
      const pages = await pdfPages(file);
      let lastQuestionPage = 0;
      layout.units.forEach((unit, i) => {
        const where = pages.findIndex(text => unit.texts.every(part => text.includes(squash(part))));
        assert.ok(where >= 0, `${name}: question block ${i + 1} is split across pages (${unit.texts[0]})`);
        lastQuestionPage = Math.max(lastQuestionPage, where);
      });
      const keyPage = pages.findIndex(text => text.includes(squash('Answer key')) && text.includes(squash('Print this page separately')));
      assert.ok(keyPage > lastQuestionPage, `${name}: the answer key starts on its own page`);
      console.log(`${name}: ${pages.length} pages, ${layout.units.length} question blocks -> ${file}`);
    }
  } finally {
    await browser.close();
  }
});
