// Touch-up audit, per route, light and dark (mocked API, local build only):
//  - font sizes outside 13/15/17/20/28/40, Manrope weights other than 500/600
//  - any text not in Manrope or Newsreader (Times = the webfont failed)
//  - border radii outside 12/16/20/28/999 (or 50% circles)
//  - cards nested three deep
//  - pages whose content is not on the shared container (left edge and width)
//   BASE=http://localhost:3100 node tests/qa/touchup-audit.cjs [--routes=/dashboard] [--themes=dark]
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3100';
const arg = name => { const item = process.argv.find(value => value.startsWith(`--${name}=`)); return item ? item.slice(name.length + 3) : ''; };
const G = 'a0000000-0000-4000-8000-000000000001';
const ROUTES = arg('routes') ? arg('routes').split(',') : [
  '/dashboard', '/library', '/calendar', '/smartnotes', '/smartnotes?id=n1', '/tutor', '/settings', '/settings?section=learning',
  '/settings?section=appearance', '/settings?section=plan', `/guide/${G}`, `/folder/f0000000-0000-4000-8000-000000000001`,
  `/practice/${G}`, `/quiz/${G}`, '/flashcards', '/session', '/nclex/a0000000-0000-4000-8000-000000000003', '/install-extension', '/pricing', '/mission',
];
const THEMES = (arg('themes') || 'light,dark').split(',');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new'] });
  let failures = 0;
  const containers = {};
  for (const theme of THEMES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await install(context, createState(true));
    const page = await context.newPage();
    await page.goto(BASE + '/login');
    await page.evaluate(([token, user, theme]) => { localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', theme); }, [TOKEN, USER, theme]);
    for (const route of ROUTES) {
      await page.goto(BASE + route).catch(() => {});
      await page.waitForTimeout(1300);
      const result = await page.evaluate(() => {
        const SIZES = [13, 15, 17, 20, 28, 40];
        const RADII = [0, 12, 16, 20, 28];
        const problems = new Set();
        const name = el => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).filter(c => c && !c.startsWith('jsx-')).slice(0, 2).join('.') : ''}`;
        const visible = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('.sr-only, [aria-hidden="true"]'); };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const el = walker.currentNode.parentElement;
          if (!walker.currentNode.textContent.trim() || !el || el.closest('script, style, svg, .canvas-shot, .sn-paper, .study-aid-diagram') || !visible(el)) continue;
          const s = getComputedStyle(el);
          const size = Math.round(parseFloat(s.fontSize) * 10) / 10;
          const family = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
          if (!SIZES.includes(size)) problems.add(`size ${size}px ${name(el)} "${walker.currentNode.textContent.trim().slice(0, 20)}"`);
          if (!/^(Manrope|Newsreader)$/i.test(family) && !/mono|code/i.test(s.fontFamily)) problems.add(`font ${family} ${name(el)}`);
          if (/Manrope/i.test(family) && !['500', '600'].includes(s.fontWeight)) problems.add(`weight ${s.fontWeight} ${name(el)} "${walker.currentNode.textContent.trim().slice(0, 20)}"`);
        }
        for (const el of document.querySelectorAll('body *')) {
          if (!visible(el) || el.closest('svg, .canvas-shot, .heat-grid')) continue;
          const s = getComputedStyle(el);
          for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']) {
            const raw = s[corner];
            if (raw.includes('%')) continue;
            const value = parseFloat(raw);
            const rect = el.getBoundingClientRect();
            const isPill = value >= Math.min(rect.width, rect.height) / 2 - 1;
            if (!RADII.includes(Math.round(value)) && !isPill) problems.add(`radius ${raw} ${name(el)}`);
          }
        }
        for (const card of document.querySelectorAll('.c-card .c-card .c-card')) if (visible(card) && getComputedStyle(card).backgroundColor !== 'rgba(0, 0, 0, 0)') problems.add(`card in card in card ${name(card)}`);
        const main = document.querySelector('main, .main-content');
        const first = main && [...main.querySelectorAll('h1, .c-page, .c-page-head')].find(visible);
        const rect = first ? first.getBoundingClientRect() : null;
        return { problems: [...problems], container: rect ? `${Math.round(rect.left)}+${Math.round(rect.width)}` : 'none' };
      });
      containers[route] = result.container;
      if (result.problems.length) failures += 1;
      console.log(`${result.problems.length ? 'FAIL' : 'ok  '} ${theme} ${route} [container ${result.container}]${result.problems.length ? '\n   - ' + result.problems.slice(0, 15).join('\n   - ') + (result.problems.length > 15 ? `\n   … ${result.problems.length - 15} more` : '') : ''}`);
    }
    await context.close();
  }
  await browser.close();
  console.log('\nContainers (left+width):', JSON.stringify(containers));
  process.exit(failures ? 1 : 0);
})();
