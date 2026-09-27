// Loads the real extension and checks what it captures on page shapes students hit in
// Canvas, Moodle, Blackboard, D2L, and plain sites. Only the Classroom API upload is stubbed.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const extensionPath = path.join(__dirname, '..', 'extension');
const LESSON = '<h1>Mitosis</h1><p>Mitosis separates replicated chromosomes into two identical nuclei during cell division. It proceeds through prophase, metaphase, anaphase and telophase.</p><p>Cytokinesis then divides the cytoplasm between the two daughter cells.</p>';
const doc = (title, body) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

const PAGES = {
  '/article': doc('Mitosis', `<nav>Course menu</nav><main>${LESSON}</main>`),
  '/courses/1/pages/slides': doc('Slides', '<div id="content"><a href="/courses/1/files/99/download?wrap=1" title="Test2Review.pdf">Test2Review.pdf</a><iframe src="/courses/1/files/99/file_preview?annotate=0" title="Test2Review.pdf"></iframe></div>'),
  '/lesson-with-footer-pdf': doc('Mitosis', `<main>${LESSON}</main><footer><a href="/files/handbook.pdf">Student handbook</a></footer>`),
  '/lesson-linking-pdf': doc('Mitosis', `<main>${LESSON}${LESSON}<p>See <a href="/docs/extra.pdf">extra.pdf</a></p></main>`),
  '/thin-file-page': doc('Files', '<div id="content"><a href="/docs/notes.pdf">Download</a></div>'),
  '/same-origin-frame': doc('Week 3', '<iframe src="/frame-content"></iframe>'),
  '/frame-content': doc('Frame', LESSON),
  '/cross-origin-frame': doc('External tool', '<iframe src="http://127.0.0.1:{OTHER}/tool"></iframe>'),
  '/shadow-dom': doc('Unit 4', `<d2l-page></d2l-page><script>customElements.define('d2l-page', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(LESSON)}; } });</script>`),
  '/pptx-link': doc('Lecture', '<main><a href="/docs/lecture.pptx">Lecture 5 slides</a></main>'),
  '/selected-text': doc('Mitosis', `<main>${LESSON}<p id="pick">Anaphase pulls sister chromatids apart.</p><a href="/files/syllabus.pdf">Syllabus.pdf</a></main>`),
  '/google-doc-link': doc('Week 2 reading', '<main><a href="https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit">Week 2 reading</a></main>'),
  '/huge-embed': doc('Huge', '<embed src="/huge.pdf" type="application/pdf">'),
};

function serve(port, handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const other = await serve(0, (_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(doc('Tool', LESSON)); });
  const otherPort = other.address().port;
  const site = await serve(0, (req, res) => {
    const route = req.url.split('?')[0];
    if (route === '/huge.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(60 * 1024 * 1024) });
      return res.end();
    }
    if (/\.(pdf|pptx)$|\/download$/.test(route)) {
      res.writeHead(200, { 'content-type': route.endsWith('.pptx') ? 'application/octet-stream' : 'application/pdf' });
      return res.end(Buffer.from('%PDF-1.4 fixture'));
    }
    const page = PAGES[route];
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page ? page.replace('{OTHER}', otherPort) : '');
  });
  const base = `http://127.0.0.1:${site.address().port}`;

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      self.apiFetch = async (_path, options) => {
        const file = options.body.get('file');
        return new Response(JSON.stringify({ text: `UPLOADED ${file.name}` }), { status: 200 });
      };
    });
    const page = await context.newPage();
    async function capture(route, prepare) {
      await page.goto(base + route);
      if (prepare) await page.evaluate(prepare);
      await page.bringToFront();
      return worker.evaluate(async () => {
        try { return await scrapePage(); } catch (error) { return { error: error.message }; }
      });
    }
    async function raw(route) {
      await page.goto(base + route);
      await page.bringToFront();
      return worker.evaluate(async () => {
        const tab = await activeWebTab();
        await ensureScraper(tab.id);
        return chrome.tabs.sendMessage(tab.id, { action: 'scrapePage' });
      });
    }

    const lesson = /replicated chromosomes/;
    assert.match((await capture('/article')).text, lesson);
    assert.equal((await capture('/courses/1/pages/slides')).sourceType, 'file');
    assert.match((await capture('/lesson-with-footer-pdf')).text, lesson, 'footer links must not replace the lesson');
    assert.match((await capture('/lesson-linking-pdf')).text, lesson, 'a lesson with its own text keeps it');
    assert.match((await capture('/thin-file-page')).text, /^UPLOADED /, 'a bare download page uses the file');
    assert.match((await capture('/same-origin-frame')).text, lesson, 'same-origin frames (Moodle, SCORM)');
    assert.match((await capture('/cross-origin-frame')).text, lesson, 'cross-origin frames (external tools)');
    assert.match((await capture('/shadow-dom')).text, lesson, 'web components (D2L Brightspace)');
    assert.match((await capture('/pptx-link')).text, /^UPLOADED /, 'document links without a filename label');
    const selected = await capture('/selected-text', () => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('pick'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    assert.equal(selected.sourceType, 'selected_text');
    assert.equal((await raw('/google-doc-link')).url, 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=pdf');
    assert.match((await capture('/huge-embed')).error, /larger than 50 MB/);
    console.log('extension capture matrix passed');
  } finally {
    await context.close();
    site.close();
    other.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
